# Contributing to FMLCore

Thanks for improving FMLCore. Keep pull requests focused, reviewable, and safe
for people running their own forks.

## Start with a branch

Fork the repository, create a branch from the current default branch, and give
it a purpose-based name:

```bash
git switch -c fix/profile-image-validation
```

Do not commit `.env` files, credentials, database dumps, uploads, or build
output. Copy the example environment files instead.

## Product work follows stages

Read `docs/PROGRESS.md` before starting. New product features are built one
numbered stage at a time. Propose the scope and meaningful decisions, obtain
the owner's explicit approval, then implement and document the completed work.
This keeps the roadmap, API, interface, and version history aligned.

## Before opening a pull request

1. Keep the change scoped; explain any behavior, data, or configuration impact.
2. Run `npm ci && npm run build` in `front-end`.
3. Run `python -m compileall -q app` with the backend virtual environment.
4. Manually exercise the changed workflow against a fresh/local database.
5. Update documentation, examples, and `CHANGELOG.md` when users or operators
   need to do something differently.

Pull requests should state the problem, approach, verification performed, and
any follow-up work. Include screenshots for visible UI changes and avoid
unrelated formatting churn.

## Maintainer release checklist

1. Review and merge only passing CI runs.
2. Confirm environment examples and deployment notes cover new settings.
3. Back up production PostgreSQL before a release that changes data behavior.
4. Deploy to a staging environment, then verify `/health`, sign-up/login, post
   creation, media upload, and the primary changed path.
5. Update `VERSION`, `CHANGELOG.md`, FastAPI's version, `front-end/package.json`,
   and `docs/PROGRESS.md` together for a completed stage.
6. Monitor application logs, error rates, database capacity, and upload storage
   after release; retain a documented rollback point.

## Code and configuration conventions

- Keep the front-end API route same-origin (`/api`) so session cookies remain
  first-party.
- Production must use HTTPS, a unique `JWT_SECRET`, restricted `CORS_ORIGINS`,
  and secure cookies.
- Keep backend taxonomy and `front-end/lib/taxonomy.js` synchronized.
- Do not represent unimplemented roadmap items as shipped functionality.
