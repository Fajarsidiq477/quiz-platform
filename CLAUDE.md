# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Status

The Next.js app and the full database layer (Drizzle schema, migrations, tests) exist. There is no UI, no Auth.js wiring, and no BullMQ worker yet; `src/app` is still the create-next-app placeholder.

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
```

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
- RLS is bypassed by superusers and (without `FORCE`) table owners. The app must connect as a non-owner, non-superuser role. Sign-in by email happens before a school is known, so the Auth.js lookup needs a separate role that bypasses RLS (not built yet). Creating a school also needs a privileged role, because the `schools` policy only exposes the current school.
- In tests, backdate timing with `withoutTriggers(db, ...)` (`session_replication_role = replica`, superuser only) since the guards make timing immutable.

## Conventions

- Strict TypeScript.
- Validate all external input with Zod (API routes, server actions, job payloads).
- Every feature ships with a test.
- Keep commits small.
