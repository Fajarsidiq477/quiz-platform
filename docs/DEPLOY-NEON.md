# Putting the platform online: Neon (database) + Vercel (app)

Neon is only the **database**. The app itself runs on **Vercel**. Both have free plans. Plan for
about 45 minutes the first time. Everything below is done once; after that, a class day is just
opening the site.

```
 students' phones ──internet──▶ Vercel (the app, Singapore) ──▶ Neon (Postgres, Singapore)
```

Neon and Vercel rename screens now and then, so a button may be labelled a little differently from
here; the ideas stay the same.

You will handle **three secrets**. Keep them in a password manager, never in git, chat or email:

| Secret | What it is | Where it goes |
|---|---|---|
| **Owner connection** | Neon's own login. Can change tables and **skips school separation**. | Only on **your laptop** (migrations, creating the first admin). **Never on Vercel.** |
| **App connection** | The limited `quiz_app` login made in step 4. | Vercel as `DATABASE_URL`. |
| **Auth secret** | A random string that signs sign-in cookies. | Vercel as `AUTH_SECRET`. |

## Why two database logins

The platform keeps each school's data apart with Postgres row-level security. Postgres skips that
for superusers and for roles with `BYPASSRLS`, and **every role you create in Neon's console (and
the one Neon's Vercel integration puts in `DATABASE_URL`) has `BYPASSRLS`**. So the web app must use
a role created with SQL (`docs/neon-app-role.sql`). `npm run db:check` tells you whether a
connection is safe.

---

## 1. Create the Neon project

1. Sign up at neon.com (GitHub login is fine) and create a **project**: name `quiz-platform`, the
   newest Postgres version offered, and region **AWS Asia Pacific (Singapore)**.
2. Keep the default database (`neondb`) and the default owner role.

## 2. Copy the two connection strings

In the project, click **Connect**. There are two versions of the same address; the toggle is
**Connection pooling**:

- **Direct** (host has no `-pooler`): used on your laptop for migrations and admin commands.
- **Pooled** (host contains `-pooler`): used by the app on Vercel.

Copy the **direct** one for the owner role now. It looks like
`postgresql://neondb_owner:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
If a later step fails to connect and the string ends in `&channel_binding=require`, delete that part.

## 3. Create the tables (migrations), from your laptop

In PowerShell in the project folder, using the **owner, direct** string (quotes matter):

```powershell
$env:DATABASE_URL = "postgresql://neondb_owner:...direct...?sslmode=require"
npm run db:migrate
```

It should end with "migrations applied successfully". In Neon's **Tables** page you should now see
`schools`, `users`, `classes`, `quizzes`, `attempts`... (13 tables, plus a `drizzle` schema).

## 4. Create the app's limited login

1. Make a password with letters and digits only (PowerShell):

   ```powershell
   $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
   ```

2. Open Neon's **SQL Editor** (it runs as the owner), paste the contents of
   `docs/neon-app-role.sql`, **replace `CHANGE_ME_STRONG_PASSWORD` with that password**, and run it.
   Do **not** create this role in the console's Roles page.
3. Build the **app connection string**: take the **pooled** string from step 2 and change the user
   and password:
   `postgresql://quiz_app:THE_PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

## 5. Check it is safe

```powershell
$env:DATABASE_URL = "postgresql://quiz_app:...pooled...?sslmode=require"
npm run db:check
```

You want: `OK: this connection is safe for the web app`. If it says **NOT SAFE**, do not deploy: read
the PROBLEM lines (a wrong role or missing grants). Also run it once with the owner string to see
what a bad one looks like (it reports `BYPASSRLS`).

## 6. Create the school and your admin account

Still on your laptop, with the **owner, direct** string as `DATABASE_ADMIN_URL`:

```powershell
$env:DATABASE_ADMIN_URL = "postgresql://neondb_owner:...direct...?sslmode=require"
npm run user:create -- --school-slug kbs --school-name "KBS" --email you@school.sch.id --name "Your Name" --role admin
```

It prints a random temporary password **once** (or pass `--password "..."`, at least 8 characters). Save it, then change it by running `user:set-password`. Later, a
forgotten student password is reset the same way: `npm run user:set-password -- --email ...`.
Then clear the variables (`Remove-Item Env:DATABASE_URL, Env:DATABASE_ADMIN_URL`) or close the window.

## 7. Deploy the app on Vercel

1. Sign in at vercel.com with GitHub, choose **Add New > Project**, and import
   `Fajarsidiq477/quiz-platform` (allow Vercel to read that private repository).
2. Framework: **Next.js** (detected). Leave the build settings alone.
3. Under **Environment Variables**, add exactly two (for Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the **app, pooled** string from step 4 |
   | `AUTH_SECRET` | a new random string (`$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`) |

   Do **not** add `DATABASE_ADMIN_URL` or the owner string. Do **not** use Vercel's "Neon
   integration": it would set `DATABASE_URL` to the owner role, which skips school separation.
4. **Deploy.** Then open **Settings > Functions** and set the region to **Singapore (sin1)**
   (redeploy after changing it) so the app sits next to the database.

## 8. Try it

1. Open your `https://….vercel.app` address, sign in as the admin, create a class, turn on its
   **class code**, and build (or import from Excel) a short quiz.
2. On a phone, open the same address, **Create an account** with the class code, and take the quiz.
3. Check the results page shows the attempt.

## Before a real class

- **Wake the database.** The free database sleeps after 5 minutes idle; the first request takes a
  moment. Open the site yourself a few minutes before students arrive.
- **Have students sign in before the quiz starts.** Sign-in is the slow step when many happen at once.
- **Backups.** Neon's free plan can only restore the last **6 hours**. Take your own copy after each
  class with a direct owner connection and `pg_dump` (or Neon's export), and keep it somewhere safe.
- **Limits.** Free is 100 compute-hours and 0.5 GB per month. A class of 30 uses a tiny fraction.
  Watch the Neon dashboard the first month.
- **Terms.** Vercel's free (Hobby) plan is for personal, non-commercial use. Using it for your own
  class is likely fine; for school-wide use check their terms or use a paid host.
- **Student data.** You are storing names, emails and answers of students. Get the school's OK.

## If something goes wrong

| What you see | Likely cause and fix |
|---|---|
| `password authentication failed` | Wrong password or user in the string. Recheck step 4; remove `&channel_binding=require`. |
| `relation "users" does not exist` | Migrations not run against this database (step 3). |
| `permission denied for table …` | The grants were not run (step 4), or a new migration was added later and the default privileges did not cover it: re-run the two `GRANT` lines. |
| Pages load but nothing is listed, sign-in always fails | The app role cannot read the tables, or `DATABASE_URL` points at a different database. Run `npm run db:check` with that string. |
| Everything works but `db:check` says **NOT SAFE** | The app is using a role that skips school separation. Fix before real use. |
| Sign-in loops back to the login page | `AUTH_SECRET` missing or changed after signing in; set it and sign in again. |
| First page after a pause is slow | The free database was asleep. It wakes in about a second; open the site before class. |
| `too many connections` | Use the **pooled** string (host contains `-pooler`) for the app. |

## Updating later

Push code to GitHub and Vercel redeploys. If a release adds a migration, run
`npm run db:migrate` from your laptop with the **owner, direct** string **before** using the new
version, then `npm run db:check` with the app string.
