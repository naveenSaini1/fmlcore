# FMLCore

FMLCore is an 18+ social app for funny, embarrassing, painful, and random life
stories. Its product rule is simple: **relatability over likes and followers**.

> **Current version:** 0.7.0 · Stages 0–7 are complete. See the
> [roadmap and handoff](docs/PROGRESS.md) before planning new product work.

## What is included

- Next.js 15 front end with the App Router, Tailwind, and Motion.
- FastAPI and SQLAlchemy API, backed by PostgreSQL.
- JWT sessions in HTTP-only cookies, content reporting, blocking/muting, and
  per-IP limits for sensitive actions.
- Posts, images, comments, reactions, explore, notifications, profiles,
  dynamic themes, and a weekly leaderboard.

## Fork and run locally

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

3. Start PostgreSQL:

   ```bash
   cd backend
   docker compose up -d
   ```

   The development database listens on `localhost:5433`. Its credentials are
   intentionally local-only defaults; never reuse them in a deployed system.

4. In a second terminal, start the API:

   ```bash
   cd backend
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

5. In a third terminal, start the web app:

   ```bash
   cd front-end
   npm ci
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Signed-out visitors land
   on Explore; signed-in users have a personal space on the home page. `/me` is
   the public About page with founder and platform information. API documentation is
   available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) and
   the liveness endpoint is `GET /health`.

### Local troubleshooting

- `docker compose` must be installed as a Docker plugin. If it is unavailable,
  point `DATABASE_URL` at any PostgreSQL 16-compatible database instead.
- Browser requests use `/api/*`; Next.js proxies them to `API_ORIGIN` (default
  `http://127.0.0.1:8000`). Do not set `NEXT_PUBLIC_API_URL` to a different
  origin unless you have also planned cookie/CORS behavior deliberately.
- Tailwind is pinned to `4.1.16`. Do not update it casually: later versions can
  conflict with Next 15's require hook.

## Deploying

The repository includes production Dockerfiles and a self-hosted Compose
configuration. Follow [the deployment guide](docs/DEPLOYMENT.md) before making
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
