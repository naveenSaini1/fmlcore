# Deployment guide

This guide describes the supplied self-hosted Docker deployment. It publishes
the Next.js app on port 3000; put a TLS-terminating reverse proxy such as Caddy,
Nginx, or your hosting platform in front of it.

## Production requirements

- A Linux host with Docker Engine and the Compose plugin.
- A DNS name and HTTPS reverse proxy for the public app.
- Durable storage for PostgreSQL and uploaded media.
- A backup location that is separate from the application host.

## Configure secrets

From the repository root, create the production environment file:

```bash
cp .env.production.example .env.production
```

Set all placeholder values. Generate `JWT_SECRET` with a password manager or:

```bash
openssl rand -hex 32
```

Set `CORS_ORIGINS` to the exact HTTPS web origin, for example
`https://fml.example.com`. Do not use `*`: authenticated cookie requests require
an explicit origin. Keep `.env.production` private; it is ignored by Git.

## Build and start

```bash
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
docker compose -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

The Compose configuration creates two named volumes:

- `postgres_data` for PostgreSQL data.
- `uploads_data` for user-uploaded media.

Back these up before releases and test restoring them. Do not rely on a
container image or a single host disk as a backup strategy.

## Reverse proxy and HTTPS

Proxy the public domain to `http://127.0.0.1:3000` and let the proxy manage TLS.
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
4. Check logs for failures:

   ```bash
   docker compose -f docker-compose.production.yml logs --tail=100 api web
   ```

5. Confirm the database and uploads volumes have current backups.

## Updates and rollback

Before updating, take a database backup and record the currently deployed Git
commit or image digest. Pull the desired revision, rebuild, and run the
verification steps above. To roll back code, redeploy the last known-good
revision; only restore a database backup when the data change requires it.

## Database migration limitation

The API currently creates tables at startup and contains a small compatibility
upgrade for existing profile columns. It does **not** yet use versioned database
migrations. Before introducing a schema change in a production environment,
add Alembic (or an equivalent migration system), create an upgrade and downgrade
path, test it from a production-like backup, and document it in the release.

## Operational ownership

Monitor container restarts, API errors, disk/volume usage, database connections,
and backup completion. Rotate `JWT_SECRET` only with a planned session
invalidation process. Review access to the deployment host, GitHub repository,
and backup destination regularly.
