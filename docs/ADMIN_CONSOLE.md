# FMLCore Admin Console

The admin console is a separate Next.js app in `backend-front-end/`. It uses the
same FMLCore visual theme and runs on port `3001` in development.

## Local setup

1. Add the owner's existing account email to `ADMIN_EMAILS` in `backend/.env`.
   This is an allowlist; the console does not have a separate password or a
   default administrator credential.
2. Include both web origins in `CORS_ORIGINS`:
   `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001`.
3. Apply the database migration from `backend/`:

   ```bash
   .venv/bin/alembic upgrade head
   ```

4. Start the API, then run the admin frontend:

   ```bash
   cd backend-front-end
   npm install
   npm run dev
   ```

5. Open `http://localhost:3001` and sign in using the existing FMLCore account
   whose email is on the allowlist.

## Google sign-in

When `GOOGLE_CLIENT_ID` is configured, the admin login also offers Continue with
Google. Use the same Google account used to create the existing FMLCore profile;
Google-only accounts do not need a password. Add the exact admin origin (for
example, `https://admin.fmlcore.com`) to the Web client's Authorized JavaScript
origins in Google Auth Platform, and include it in backend `CORS_ORIGINS`.
This uses the Google Identity Services popup callback, without a redirect URI.

The console checks `/admin/me` after authentication. The backend still checks
`ADMIN_EMAILS` on every admin endpoint; Google sign-in never grants admin access
by itself. Email verification/account-linking challenges use the existing code
entry flow. New Google accounts must create their profile on the public app first.

## Dashboard data

- Overview totals include accounts, accounts with a recorded sign-in, sign-ins
  during the last 24 hours and 7 days, posts, confessions, matching-enabled
  accounts, and background-job counts.
- The account list shows email, join date, last sign-in, post/confession totals,
  and Same Sky readiness. Selecting an account shows comment/reaction totals and
  matching-attempt counts.
- The dashboard shows activity metadata only. It does not expose passwords,
  private post/confession text, API keys, or direct messages.
- Login timestamps are recorded at successful login. Existing accounts are
  backfilled to their account-creation time because signup immediately creates a
  signed-in session.

## Runtime Same Sky settings

`ADMIN_EMAILS` contains comma-separated existing account emails. The backend
checks the allowlist on every admin endpoint request. Same Sky thresholds and
the no-match cooldown are stored in `system_settings`; saved values take effect
immediately without restarting the API or worker. If a database override has
not been saved yet, values fall back to `SAME_SKY_REQUIRED_POSTS`,
`SAME_SKY_REQUIRED_CONFESSIONS`, and `SAME_SKY_RETRY_MINUTES` in the backend
environment.

The admin settings panel also controls the platform's default theme. Acid Lime
is the initial default. The choice applies to new accounts and visitors who
have not saved a theme; existing account and guest theme choices are preserved.

The retry input is in minutes. `1440` means one day; `1` is suitable for local
testing. A cooldown is applied after a completed no-match search, not when a
user starts matching.

## Production

Set `ADMIN_EMAILS` and include the admin HTTPS origin in `CORS_ORIGINS`. The
production Compose service binds to `127.0.0.1:3001`; expose it through the
operator's HTTPS reverse proxy only when needed. Keep the backend API and
database private. Apply migrations before switching traffic to a new release.

## Production worker status and API failures

For a separate worker container, set `SAME_SKY_WORKER_MANAGED=true` in API and
worker environments. Status uses the worker's named PostgreSQL listener, not API
container PIDs. The console disables process start/stop in this mode; operators
use Compose to manage the service. See [SERVER_RUNBOOK.md](SERVER_RUNBOOK.md)
for the deployment, checks, and the repaired overview/JSON parser failure.
