# Deployment guide

This guide describes the supplied self-hosted Docker deployment. It publishes
the Next.js app on port 3000 and the separate owner-only admin console on
127.0.0.1:3001; put a TLS-terminating reverse proxy such as Caddy or Nginx in
front of the domains you intend to expose.

## Production requirements

- A Linux host with Docker Engine and the Compose plugin.
- A DNS name and HTTPS reverse proxy for the public app.
- Durable storage for PostgreSQL and uploaded media.
- PostgreSQL 16 with the pgvector extension available.
- A billing-enabled Gemini API project and a Groq API key for Same Sky. The
  worker remains idle until both providers are configured and Gemini billing
  is confirmed.
- A backup location that is separate from the application host.

## Configure secrets

From the repository root, create the production environment file:

```bash
cp .env.production.example .env.production
```

Set all placeholder values. Generate both `JWT_SECRET` and
`SAME_SKY_HASH_SECRET` with a password manager or:

```bash
openssl rand -hex 32
```

Set `CORS_ORIGINS` to the exact HTTPS origins for the web app and admin console,
for example `https://app.example.com,https://admin.example.com`. Set
`ADMIN_EMAILS` to the comma-separated email address or addresses of existing
FMLCore accounts allowed into the console. Do not use `*`: authenticated cookie
requests require explicit origins. Keep `.env.production` private; it is ignored
by Git. The admin app uses normal account login, then the backend checks this
allowlist on every admin request.

For Same Sky, configure `GEMINI_API_KEY` from a project with Cloud Billing
active, then set `GEMINI_PAID_SERVICE_CONFIRMED=true`; also configure
`GROQ_API_KEY`. Both models analyze opted-in posts, and Gemini creates the
embeddings. Unpaid Gemini API content may be used to improve Google's products;
paid-service prompts and responses are not used for product improvement under
Google's current terms. Groq's inference retention controls are described in
its [data guide](https://console.groq.com/docs/your-data). The Gemini flag is
an operator confirmation, not an automatic billing check. Review the full
[Same Sky privacy guide](SAME_SKY_PRIVACY.md) and
[Google's current API terms](https://ai.google.dev/gemini-api/terms) before
enabling the worker.

## Build and start

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
docker compose -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

The Compose configuration creates two named volumes and a background worker:

- `postgres_data` for PostgreSQL data.
- `uploads_data` for user-uploaded media.
- `same-sky-worker` analyzes each newly created post/confession and handles
  matching jobs from the database queue; it has no public port.
- `admin-web` serves the separate console at `127.0.0.1:3001`; expose it through
  a protected HTTPS admin domain when needed.

Back these up before releases and test restoring them. Do not rely on a
container image or a single host disk as a backup strategy.

## Reverse proxy and HTTPS

Proxy the public domain to `http://127.0.0.1:3000` and let the proxy manage TLS.
If you want remote admin access, proxy the separate admin domain to
`http://127.0.0.1:3001` and include that exact HTTPS origin in `CORS_ORIGINS`.
The compose port binds to loopback; do not expose port 3001 directly to the
public network.
Do not expose the database or API ports publicly. With HTTPS in front of the
web app, production session cookies are marked `Secure`; users must access the
application through HTTPS.

The browser calls the web app at `/api/*`; Next.js proxies that traffic to the
internal API container. This preserves the HTTP-only session cookie as
first-party and means the API does not need a public hostname.

## Verify every deployment

1. Open the public HTTPS URL and confirm no mixed-content errors appear.
2. Check `https://YOUR_DOMAIN/api/health`.
3. Create a new account, sign in/out, create a post, add a reaction/comment,
   and upload an image.
4. Open the admin HTTPS domain and confirm an allowlisted account can sign in
   while a non-allowlisted account is denied.
5. Check logs for failures:

   ```bash
   docker compose -f docker-compose.production.yml logs --tail=100 api web admin-web same-sky-worker
   ```

6. Confirm the database and uploads volumes have current backups.

## Updates and rollback

Before updating, take a database backup and record the currently deployed Git
commit or image digest. Pull the desired revision, rebuild, and run the
verification steps above. To roll back code, redeploy the last known-good
revision; only restore a database backup when the data change requires it.

## Database migrations

Alembic tracks schema changes. The API image runs `alembic upgrade head` before
starting Uvicorn. The first migration bootstraps missing legacy tables,
preserves existing data, applies the old profile/confession compatibility
columns, enables pgvector, and creates the Same Sky tables. Back up PostgreSQL
before upgrading an existing deployment and confirm the database role can run
`CREATE EXTENSION vector`; managed PostgreSQL providers may require an operator
to enable the extension first.

Keep each later schema change in a new reviewed Alembic revision. Do not delete
the migration version table or run `create_all` as a substitute for production
migrations. When changing the embedding model or dimensions, use a planned
re-embedding migration and keep old and new vector spaces separate until the
new vectors are ready.

## Operational ownership

Monitor container restarts, API errors, disk/volume usage, database connections,
and backup completion. Rotate `JWT_SECRET` only with a planned session
invalidation process. Review access to the deployment host, GitHub repository,
and backup destination regularly.
