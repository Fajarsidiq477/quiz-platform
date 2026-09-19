# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Status

The Next.js app, the full database layer (Drizzle schema, migrations, tests), authentication, admin management of **Classes** and **Quizzes** (with their questions), student self-registration, and the **student area** (see your quizzes, take them with a server-side countdown and autosave, automatic grading, results) exist. Still placeholders: the admin Students and Question bank pages. Not built yet: manual grading, teacher-side results and analytics, and the BullMQ worker.

## Commands

```bash
npm run dev                          # Next.js dev server
npm run build                        # production build
npm run lint                         # eslint
npm run typecheck                    # tsc --noEmit
npm test                             # all tests (vitest run)
npx vitest run tests/db/attempts.test.ts        # one file
npx vitest run -t "converges on one row"        # one test by name
npm run db:generate                  # drizzle-kit: diff src/db/schema -> new SQL migration
npx drizzle-kit generate --custom --name=<x>    # empty hand-written migration (triggers, RLS)
npm run db:migrate                   # apply migrations to DATABASE_URL (copy .env.example to .env)
npm run db:dev                       # local dev database on :5433, no install needed (PGlite, data in .pglite/); keep it running next to `npm run dev`
npm run user:create -- --school-slug kbs --school-name "KBS" --email a@kbs.sch.id --name "A" --role admin [--password "..."]
npm run user:set-password -- --email a@kbs.sch.id [--password "..."]   # also clears a lockout
```

Local dev needs `.env` with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres` and `AUTH_SECRET`, plus `npm run db:dev` running. That dev database logs in as a superuser, so **RLS is inactive locally**; only the tests prove RLS.

Tests need no database: `tests/db/helpers.ts` boots an in-process Postgres (PGlite) and applies the real `drizzle/` migrations, so triggers, partial indexes and RLS are exercised for real.

## Stack

- TypeScript (strict mode) and Next.js
- PostgreSQL with Drizzle ORM (chosen because the schema needs partial unique indexes, CHECK constraints and composite FKs, which Drizzle expresses natively)
- Redis and BullMQ for queues and background jobs
- Auth.js for authentication

## Non-negotiable rules

These are hard constraints. Do not trade them away for convenience or speed.

1. **Timers are server-side.** The server is the source of truth for quiz timing (start time, deadline, expiry). Never trust a client-supplied clock or remaining time.
2. **Submissions are idempotent.** Submitting the same answer or attempt more than once (retries, double-clicks, network replays) must produce the same result and never create duplicates or double-score.
3. **Questions are versioned.** Editing a question creates a new version rather than mutating in place, so past attempts keep referring to the exact version the student saw.
4. **Every core table has `school_id`.** The platform is multi-tenant by school. Every core table carries `school_id`, and queries must be scoped by it.
5. **No secrets in code.** Credentials, keys, and tokens come from environment/config only.

## Database design

The approved schema proposal covers `schools`, `users`, `classes`, `enrollments`, `questions` / `question_versions` / `question_options`, `quizzes`, `quiz_questions`, `attempts`, `answers` and `idempotency_keys`. Decisions that span several tables:

- **Composite tenant FKs.** Every tenant table has `school_id NOT NULL` and `UNIQUE (id, school_id)`. Child FKs are composite, `(parent_id, school_id)`, so a row can never reference a parent in another school. `schools` is the tenant root.
- **Row-Level Security** on every tenant table, keyed on `current_setting('app.school_id')`, set per transaction. Still filter by `school_id` in queries; RLS is a backstop.
- **Versioning.** `questions` is a stable identity; content lives in immutable `question_versions` (`UNIQUE (question_id, version_no)`). `quiz_questions` pins a specific version, so a published quiz never changes. Edit a question by inserting a new version, never by updating one.
- **Server-side timer.** `attempts.deadline_at` is computed once at attempt start (`LEAST(started_at + time_limit, quiz.closes_at)`). The client never sends a time. Every answer write checks `now() <= deadline_at`. A BullMQ delayed job auto-expires attempts as a backup only.
- **Idempotency.** Answers upsert on `UNIQUE (attempt_id, quiz_question_id)`. A partial unique index allows one `in_progress` attempt per student per quiz. Final submit is a status-guarded transition (`WHERE status = 'in_progress'`). Replayable POSTs also use `idempotency_keys`.
- Users belong to exactly one school, and each class has one teacher (`classes.teacher_id`).

### Where things live

- `src/db/schema/*.ts` is the source of truth for tables, indexes and CHECKs. `people.ts` (users, classes, enrollments), `question-bank.ts`, `quizzes.ts`, `attempts.ts` (attempts, answers), `idempotency.ts`.
- `drizzle/0002_guards_and_rls.sql` is hand-written and holds everything Drizzle's schema cannot express: the triggers below and the RLS policies. Migration order matters: `0000` creates `citext`, `0001` is generated, `0002` is the guards.
- `src/db/tenant.ts` `withSchool(db, schoolId, fn)` runs a transaction with `app.school_id` set. Use it for tenant queries.

### Behaviour enforced by triggers (not just app code)

- `attempts` insert: the trigger overwrites `started_at`/`deadline_at`/`status`/`max_score` and checks quiz is published and open, the user is an active student enrolled in the quiz's class, and `attempt_no <= max_attempts`. Do not compute deadlines in app code.
- `attempts` update: identity and timing columns are immutable; status only moves `in_progress -> submitted|expired -> graded`. `submitted` is refused after `deadline_at` + 5s grace; `expired` is refused before the deadline.
- `answers`: writes to `response` require an `in_progress` attempt within the deadline (+5s grace). Grading fields cannot be set on insert.
- `question_versions`: insert as a draft, add `question_options`, then publish by setting `published_at`. Publishing validates the content (option counts, correct answers, `accepted_answers`). Published versions and their options reject UPDATE/DELETE.
- `quiz_questions` only accepts published versions; a quiz's items, `class_id` and `time_limit_seconds` are frozen once any attempt exists.

### Patterns to follow

- **Start attempt / save answer / submit** are meant to be idempotent via `INSERT ... ON CONFLICT DO NOTHING/UPDATE` on the unique keys, and `UPDATE attempts SET status = 'submitted' WHERE id = $1 AND status = 'in_progress'` (a replay matches 0 rows).
- **Reordering `quiz_questions.position`**: the unique constraint is not deferrable, so move rows to a temporary offset first, then to their final positions.

### Gotchas

- Drizzle splits migration files on the literal `--> statement-breakpoint` marker, even inside a SQL comment. Never write that token in a comment.
- Superusers always bypass RLS, so the app must connect as a non-owner, non-superuser role (the tables use `FORCE ROW LEVEL SECURITY`, so owners are subject to it too). Tests that prove RLS must run under `asAppRole(db, ...)` from `tests/db/helpers.ts`; a superuser test passes even when the policy is broken.
- Looking a school up by slug is not allowed by the per-school policies, so `provisionUser` / `npm run user:create` must use `DATABASE_ADMIN_URL` (a role that bypasses RLS), never the web app's connection.
- In tests, backdate timing with `withoutTriggers(db, ...)` (`session_replication_role = replica`, superuser only) since the guards make timing immutable.

## Authentication

Auth.js v5 (`next-auth@beta`) with the Credentials provider: email and password only, no SSO. Admins are created with `npm run user:create`; students either register themselves with a class join code (see "Student self-registration") or are created the same way. Only `student` and `admin` can sign in (`src/auth/roles.ts`); `teacher` exists in the database but is refused for now. There is no change-password or forgot-password page yet; an admin resets with `npm run user:set-password`.

- **Sessions are stateless JWTs** (8 hours) with claims `uid`, `schoolId`, `role`. There is no Auth.js adapter or `accounts`/`sessions` table, and Auth.js never creates users.
- **Passwords** are hashed with scrypt from `node:crypto` (`src/auth/password.ts`, parameters stored inside each hash so they can be raised later). Login checks only the shape of the input; the strength rule (8-128 chars) applies when an admin sets a password.
- **Sign-in check** is `authenticate()` in `src/auth/sign-in-policy.ts`. Every failure (wrong password, unknown email, disabled/archived account, teacher role) looks identical to the visitor, and a password check always runs so timing does not reveal whether an email exists. Do not add distinguishing messages to the login page.
- **Lockout:** 5 wrong passwords in a row lock the account for 15 minutes (`users.failed_login_attempts`, `locked_until`); a locked account refuses even the right password, and a success or `user:set-password` clears it.
- **`src/auth/config.ts`** is the DB-free part of the config (used by `src/proxy.ts`); **`src/auth/index.ts`** adds the Credentials provider and `jwt` callback that hit the database. Keep DB code out of `config.ts` and `proxy.ts`.
- **`src/proxy.ts`** (Next 16's `middleware`) only does optimistic redirects from the cookie. Real authorisation is `requireUser(role)` / `getCurrentUser()` in `src/auth/dal.ts`, which re-checks the database on every request, so a disabled account or changed role takes effect immediately even with a valid cookie. Call these in every page, server action and route handler that needs a user.
- **Sign-in lookup vs RLS:** the user is found by email before the school is known, via the SELECT-only `auth_lookup` policy (migration `0003`), which exposes only the row matching a transaction-local `app.auth_email`. See `src/auth/lookup.ts`. Lockout updates then run inside `withSchool`, so no extra write policy is needed. Only `lookupCredentialsByEmail` returns the hash.
- The login form is a server action in `src/app/login/page.tsx`; a successful `signIn` redirects by throwing, so only `AuthError` may be caught there.
- Required env: `AUTH_SECRET`, `DATABASE_URL` (see `.env.example`).
- Type augmentation for the session, user and JWT is in `src/auth/next-auth.d.ts`; the JWT interface must be augmented via `@auth/core/jwt`, not `next-auth/jwt` (which only re-exports it).
- Scripts in `scripts/` run through `tsx` as CommonJS, so no top-level `await`; wrap the body in an async `main()`.
- Password hashing makes the auth tests slow (about 25s for the whole suite).

## Admin area

`src/app/admin/layout.tsx` is the dashboard shell (header, sidebar, main). Components live in `src/components/admin/`, and the sidebar entries in `nav-items.ts`.

- **Access is checked in every page, not the layout.** A layout does not re-run on client-side navigation and cannot stop child routes from rendering, so the layout is display-only. Every `page.tsx` / `route.ts` under `src/app/admin` must call `await requireUser("admin")` itself, and server actions and data functions should re-check too. `tests/admin/pages-are-protected.test.ts` fails if a page forgets.
- **Adding a section:** create `src/app/admin/<name>/page.tsx` (copy an existing placeholder, keep the `requireUser` call), then add it to `ADMIN_NAV`. A test fails if a nav link has no page.
- The layout's title template does not apply to `/admin/page.tsx` (same segment), so that page sets an `absolute` title.
- The shell is a CSS grid. On phones it stacks three areas, so the mobile media query must set three `grid-template-rows` (`auto auto 1fr`); inheriting the desktop `auto 1fr` stretches the nav strip and leaves a blank gap under the header (`tests/admin/mobile-layout.test.ts`).
- The user menu in the header is a Suspense-wrapped server component so the shell streams without waiting on the user lookup.

## Student area

Pages: `/student` (quizzes by phase), `/student/quizzes/[id]` (rules, start, past attempts) and `/student/attempts/[id]`, which is the quiz itself while the attempt is open and the result once it is not. Logic is in `src/features/student/` (`service.ts`, pure `grading.ts`, `answers.ts`, `actions.ts`); the browser side is in `src/components/student/`.

- **The server owns time.** The deadline is set by a database trigger when the attempt starts. The page gets `remainingMs` computed by the database clock; the browser counts down from that with `performance.now()` (never `Date`, never the device clock), re-syncs on every save, and submits automatically at zero. All of that is cosmetic: the database refuses answer writes and submits after the deadline plus a 5 second grace (`GRACE_MS`). Do not add client-supplied times anywhere.
- **Idempotent by construction.** `startAttempt` returns the open attempt instead of creating a second (partial unique index); `saveAnswer` upserts on `(attempt_id, quiz_question_id)`; `submitAttempt` is a guarded `UPDATE ... WHERE status = 'in_progress'` that also grades, in the same transaction, so a replay or a timer/button race does nothing the second time. Saves and submits lock the attempt row (`FOR UPDATE`).
- **The answer key never reaches the browser while a quiz is open.** `TakingItem` has no `isCorrect`, accepted answers or explanation; `tests/student/service.test.ts` asserts this, and it was also checked against the rendered page's data. Correctness only appears in `ReviewItem`, after the attempt ends and only if the quiz's results setting allows (`canSeeResults`: `after_submit`, `after_close`, `never`). Hidden results must not leak scores or answers in any field.
- **Grading is automatic and all-or-nothing** (`grading.ts`): multiple choice needs exactly the correct set, short answers match any accepted answer ignoring case, spacing and full-width characters, unanswered is 0, no negative marking.
- **No background worker yet.** An attempt whose time ran out is ended lazily by `finishOverdueAttempts` whenever that student loads a student page or starts a quiz (it waits out the grace period first). Until the BullMQ worker exists, an abandoned attempt stays `in_progress` until then, so any teacher-side view of attempts must not assume it has been closed.
- **Autosave** is `SaveQueue` (`save-queue.ts`, plain TypeScript, unit-tested): text is debounced, choices save at once, one request per question at a time, failures retry and keep the answer, a refusal from the server is shown and not retried. `AttemptRunner` sends the full set of answers with the final submit, so a lost autosave cannot lose an answer.
- The shuffle option orders questions per attempt with a seed from the attempt id (`seededShuffle`), so a refresh does not reorder them.
- **Component tests** run in jsdom: start the file with `// @vitest-environment jsdom` and name it `*.test.tsx`. Use fake timers including `performance`, and make a fake server report a *shrinking* remaining time, because every save re-syncs the countdown.
- **In service tests never nest `asAppRole` callbacks** (do not call a helper that uses it from inside another `as(() => ...)`): the inner call's `reset role` ends the restricted role for the outer one and RLS silently stops applying. Compute inputs first.

## Student self-registration

`/register` is the only public sign-up. A student enters a **class join code**, their name, email and a password; the account is created as an active `student`, enrolled in that class, and signed in.

- **The join code is the only gate.** `classes.join_code` is 8 characters from an unambiguous alphabet (`src/features/classes/join-code.ts`), unique across all schools, null = registration off for that class. Admins turn it on, replace it (the old one stops working at once) or turn it off on the class page (`setJoinCode`). Do not add another way to create accounts without its own gate.
- **The school and role never come from the form.** The school is the class's school and the role is fixed to `student` in `registerStudent`; a test (`tests/admin/actions-are-protected.test.ts`) fails if the register code reads `role`, `schoolId` or `status` from the form.
- **Lookup by code vs RLS:** the class is found before any school is known, via the SELECT-only `join_code_lookup` policy (migration `0006`), which exposes only the class whose code matches a transaction-local `app.join_code`. The inserts then run inside `withSchool`. Same pattern as `auth_lookup`.
- **The register action is the one public server action** and does not call `requireUser`. It is listed in `PUBLIC_ACTION_FILES` in the guard test; adding to that list is a security decision.
- **Known limits:** there is no rate limiting on `/register` yet (the code space of about 10^12 makes guessing impractical, but a Redis-based limiter is still worth adding), and a duplicate email is reported as "already exists", which tells someone with a valid code that the email is registered. There is no email verification.

## Classes and quizzes (admin)

Feature code lives in `src/features/<feature>/`: `schemas.ts` (Zod), `service.ts` (database logic), `actions.ts` (server actions). Pages are in `src/app/admin/{classes,quizzes}`, and forms in `src/components/admin/`.

- **Services take a `Ctx` (`{ schoolId, userId }`) and run inside `withSchool`.** They also filter by `school_id` explicitly. They throw `ServiceError` (`src/features/errors.ts`) for anything the user can fix; the action turns it into an inline form error. Anything else is a real bug and is rethrown.
- **Every exported server action must start with `await requireUser("admin")`** (`tests/admin/actions-are-protected.test.ts` checks the source). Actions are public POST endpoints; the proxy only covers the cookie, and the action check is what stops a valid cookie whose account was since disabled. "use server" files may only export async functions.
- **Validate in the action, trust in the service.** Actions parse form data with the Zod schemas; `saveQuestionAction` receives the whole question as one JSON `payload` field built by the client form. Services accept already-parsed types.
- **Redirect after `try`, never inside it:** `runAction` in `src/features/action-helpers.ts` does this. `redirect()` works by throwing.
- **A quiz is a draft, published or closed.** Only a draft can be edited (settings, questions). Publishing needs a window, a future closing time and at least one question. Unpublish is refused once any attempt exists. Deleting a quiz with attempts, or a class with quizzes or enrolments, archives it (hidden, history kept) instead of deleting.
- **Questions are versioned on edit.** Adding a question creates `questions` + version 1 and publishes it (the database validates the content at publish). Editing content inserts version n+1 and repoints the quiz item; the old version stays untouched. A points-only change keeps the version. Removing a question from a quiz leaves it in the question bank.
- **Reordering goes through a temporary position** because `(quiz_id, position)` is unique and not deferrable (`moveQuestion`). Positions can have gaps after a removal.
- **Times are handled in the browser.** The server does not know the teacher's time zone: `DateTimeField` converts a `datetime-local` value to an ISO instant before submitting, and `LocalDateTime` renders instants in the viewer's zone after hydration.
- **Raw SQL subqueries must qualify columns** (`"classes"."id"`): Drizzle drops the table name in single-table queries, so a bare `id` inside the subquery silently means the inner table's own `id`.
- Notices after redirects use fixed codes (`?notice=saved`, see `banner.tsx`), never free text from the URL.

## Conventions

- Strict TypeScript.
- Validate all external input with Zod (API routes, server actions, job payloads).
- Every feature ships with a test.
- Keep commits small.
