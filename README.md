# FMLCore

An 18+ Gen Z social app for unfiltered life — funny, embarrassing, painful, random.
Tagline: **Life is weird. You're not the only one.** Relatability over likes and followers.

> **Current version: 0.7.0** · Stages 0–7 built · Next: Stage 8 (real-time interactions)

## For anyone (human or AI) picking this up

- **What it is / design rules:** [docs/fmlcore-vision.md](docs/fmlcore-vision.md) and [.cursor/rules/fmlcore.mdc](.cursor/rules/fmlcore.mdc)
- **What's built, per version:** [CHANGELOG.md](CHANGELOG.md)
- **Detailed state + where to continue:** [docs/PROGRESS.md](docs/PROGRESS.md)
- **Future feature specifications:** [planned stages 8–10](docs/PROGRESS.md#future-feature-specifications)

**Build rule:** the product is built one numbered stage at a time. **Do not write product code for a new stage until the owner names the stage and gives an explicit "go".** Propose the scope and key decisions first, get the yes, then build, drive it end-to-end, and bump the version files.

## Stack

- **Front-end:** Next.js (JavaScript, App Router) + Tailwind v4 + Motion
- **Back-end:** Python FastAPI + SQLAlchemy 2.0 (REST)
- **Data:** PostgreSQL
- **Auth:** JWT in an httponly cookie

## Layout

```
backend/      FastAPI app (app/), docker-compose.yml (Postgres), uploads/ (media)
front-end/    Next.js app (app/, lib/)
docs/         vision + progress
image/        icons
CHANGELOG.md  build log by version
VERSION       current version string
```

## Run it (dev)

1. **Postgres** — from `backend/`: `docker compose up -d` (listens on host port **5433**, per `docker-compose.yml`). Any Postgres matching `backend/.env` works.
2. **Back-end** — from `backend/`:
   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   Tables are auto-created on startup (no migration tool). API docs at `http://127.0.0.1:8000/docs`.
3. **Front-end** — from `front-end/`: `npm install && npm run dev`
4. Open **http://localhost:3000**

### Dev notes (important)

- **Same-origin API proxy:** the browser calls `/api/*`, which `front-end/next.config.mjs` rewrites to `http://127.0.0.1:8000/*`. This keeps the session cookie first-party, so **login persists from either `localhost` or `127.0.0.1`.** `front-end/.env.local` sets `NEXT_PUBLIC_API_URL=/api`.
- **Tailwind is pinned to `4.1.16`.** Do not let it drift to 4.3.x — that pulls the ESM-only `magic-string@1.x`, which crashes Next 15's require-hook and 500s every page.
- Google Fonts are fetched at build; offline they fall back with a harmless warning.
- **Dev test account** (local DB only): `runtest_1793786793@example.com` / `supersecret8`.

## Versioning

`0.<stage>.<patch>` — the minor tracks the completed build stage.
