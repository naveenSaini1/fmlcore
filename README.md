# FMLCore

FMLCore is an 18+ social app for funny, embarrassing, painful, and random life
stories. Its product rule is simple: **relatability over likes and followers**.

> **Current version:** 0.9.0 · Stage 9-1 adds Same Sky matching. See the
> [roadmap and handoff](docs/PROGRESS.md) before planning new product work.

## What is included

- Next.js 15 front end with the App Router, Tailwind, and Motion.
- FastAPI and SQLAlchemy API, backed by PostgreSQL.
- JWT sessions in HTTP-only cookies, content reporting, blocking/muting, and
  per-IP limits for sensitive actions.
- Posts, images, comments, reactions, explore, notifications, profiles,
  dynamic themes, and a live weekly leaderboard. Browser notifications are
  opt-in from Notifications or Edit Profile.
- Same Sky matching from existing posts and Confession Sky balloons. Each new
  post/confession is analyzed once after saving; “Start Matching” later compares
  the stored results. Same Sky has mutual match
  suggestions and a configurable retry timer after no match. Stage 9-2 chat
  implementation is present but still needs safety and production verification;
  see the current handoff before deploying it.
- Skin Studio provides five complete presentation skins at
  `/settings/appearance` and Edit Profile, with compact circle selectors
  for skins and color themes. Skin controls layout/fonts; theme controls colors.
  Both preferences persist per account.
- Signed-out visitors can open Skins & colors from the navbar (palette icon on
  phones). Their choices apply immediately and persist on that browser.
- Same Sky eligibility thresholds are configurable with `SAME_SKY_REQUIRED_POSTS`
  and `SAME_SKY_REQUIRED_CONFESSIONS` in backend settings.

## Fork and run locally

Google sign-in, email OTP setup, account-linking rules, and reusable email code
are documented in [Authentication](docs/AUTHENTICATION.md). Configure SMTP and a
Google Web client ID before testing live delivery/sign-in; both are disabled
until configured. New email/password accounts require OTP before creation.
Password login does not ask for another code; existing accounts remain unchanged.

### Prerequisites

- Git
- Node.js 20+ and npm 10+
- Python 3.10+
- Docker Engine with the Compose plugin (recommended for PostgreSQL)

1. Click **Fork** on GitHub, then clone your fork:

   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/fmlcore.git
   cd fmlcore
   ```

2. Create local configuration files. These stay untracked:

   ```bash
   cp backend/.env.example backend/.env
   cp front-end/.env.example front-end/.env.local
   ```

   Set a unique `JWT_SECRET` in `backend/.env` even for a shared development
   environment. Keep `APP_ENV=development` and `COOKIE_SECURE=false` locally.
   Same Sky uses Gemini for analysis by default and supports Groq as an
   admin-selectable analysis provider. Gemini is required for embeddings. Set
   `GEMINI_API_KEY` and `GEMINI_PAID_SERVICE_CONFIRMED=true` only after Gemini
   billing is active; set `GROQ_API_KEY` only if you want Groq available in the
   admin switch.

3. Start PostgreSQL:

   ```bash
   cd backend
   docker compose up -d
   ```

   The development database listens on `localhost:5433` and uses the pgvector
   Postgres image. Its credentials are intentionally local-only defaults;
   never reuse them in a deployed system.

4. In a second terminal, start the API:

   ```bash
   cd backend
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/alembic upgrade head
   .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

5. In a third terminal, start the background analysis worker:

   ```bash
   cd backend
   .venv/bin/python -m app.same_sky_worker
   ```

   The worker analyzes queued new posts and confessions, then handles local
   matching jobs. It defers analysis until both AI providers are configured and
   Gemini billing is confirmed.

6. In a fourth terminal, start the web app:

   ```bash
   cd front-end
   npm ci
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Signed-out visitors land
   on Explore; signed-in users have a profile-led home page with their stories
   and an Edit profile link to `/profile` for skins and color themes. `/me` is
   the public About page with founder and platform information. API documentation is
   available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) and
   the liveness endpoint is `GET /health`.

7. To use the separate owner console, add your existing account email to
   `ADMIN_EMAILS` in `backend/.env`, include `http://localhost:3001` in
   `CORS_ORIGINS`, then start its frontend:

   ```bash
   cd backend-front-end
   npm ci
   npm run dev
   ```

   Open [http://localhost:3001](http://localhost:3001) and sign in with that
   account. See [the admin console guide](docs/ADMIN_CONSOLE.md) for the metrics,
   privacy boundary, and editable Same Sky rules.

### Local troubleshooting

- `docker compose` must be installed as a Docker plugin. If it is unavailable,
  point `DATABASE_URL` at PostgreSQL 16 with the `vector` extension installed.
- Browser requests use `/api/*`; Next.js proxies them to `API_ORIGIN` (default
  `http://127.0.0.1:8000`). Do not set `NEXT_PUBLIC_API_URL` to a different
  origin unless you have also planned cookie/CORS behavior deliberately.
- Tailwind is pinned to `4.1.16`. Do not update it casually: later versions can
  conflict with Next 15's require hook.
- Gemini's unpaid API service can use submitted prompts and responses to improve
  Google's products. Same Sky requires a
  billing-enabled Gemini project; see the [privacy and operations guide](docs/SAME_SKY_PRIVACY.md)
  before enabling it.

## Public profiles and match identity

Click a public author’s name or avatar to open `/users/{username}`. Profiles
have Posts and Confessions tabs, showing only public, non-anonymous stories.
Anonymous and private stories stay excluded even when viewing your own public
profile. Emails and account settings are never part of the public profile API.
Existing block and mute filters apply.

Same Sky suggestions start with generated aliases. Chat also hides usernames,
photos, biographies, and public account identifiers until that person chooses
**Reveal my profile** under **Names & profile sharing**. Consent is one-sided
and specific to that conversation. A private nickname changes only your view.
**Stop sharing my profile** hides the profile again for future reads, but cannot
erase what someone already saw or saved. Messages users write can still identify
them; profile hiding does not redact message content. Existing matches default
to anonymous when migration `20261111_0916` is applied.

## Deploying

The repository includes production Dockerfiles and a self-hosted Compose
configuration. Start with [the production server runbook](docs/SERVER_RUNBOOK.md) for the active
server and follow [the deployment guide](docs/DEPLOYMENT.md) before making
the app public. It covers HTTPS, production secrets, persistent volumes,
backups, verification, and the current database-migration limitation.

## Verification

Run these before opening a pull request:

```bash
cd front-end && npm ci && npm run build
cd ../backend && .venv/bin/python -m compileall -q app
```

GitHub Actions performs the same build and Python syntax checks for every push
and pull request. The project does not yet have an automated integration-test
suite, so manually check signup, login, creating a post, reacting, commenting,
and image upload when those areas change.

## Contributing and maintenance

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, review, release, and
maintenance workflow. Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md); do not include secrets, user data, or reproduction
details in public issues.

Product direction and the strict one-stage-at-a-time rule live in
[docs/fmlcore-vision.md](docs/fmlcore-vision.md) and
[docs/PROGRESS.md](docs/PROGRESS.md). The build log is in [CHANGELOG.md](CHANGELOG.md).

## Versioning

Versions use `0.<stage>.<patch>`: the minor number tracks a completed product
stage. Update `VERSION`, `CHANGELOG.md`, the FastAPI version, the front-end
package version, and `docs/PROGRESS.md` together when shipping a stage.
