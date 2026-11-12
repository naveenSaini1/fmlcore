# FMLCore production server runbook

Last updated: 12 November 2026. This describes the deployment actually running
on the server. Read this alongside [DEPLOYMENT.md](DEPLOYMENT.md) and
[ADMIN_CONSOLE.md](ADMIN_CONSOLE.md). Keep this file current whenever the server,
deployment process, authentication, storage, or operational checks change.

## Addresses and access

- Public app: https://fmlcore.com
- Admin console: https://admin.fmlcore.com
- `www.fmlcore.com` redirects to the public app.
- Server IPv4: `34.131.221.150`; SSH user: `fmlcore`.
- SSH from the development machine:

  ```bash
  ssh -i ~/.ssh/fmlcore fmlcore@34.131.221.150
  ```

The temporary address `https://fmlcore.34-131-221-150.sslip.io` currently also
serves the app. It uses IP-based DNS without a domain registration. The deployer preserves it as an alias for this server. Use `fmlcore.com` for permanent links.

DNS records at the domain provider:

- `A`, host `@`, value `34.131.221.150`.
- `CNAME`, host `www`, value `fmlcore.com`.
- `A`, host `admin`, value `34.131.221.150`.

Caddy obtains and renews trusted Let's Encrypt certificates. HTTP redirects to
HTTPS. Ports 80 and 443 must remain reachable. PostgreSQL and the API have no
public host ports. Admin port 3001 binds only to loopback; public admin traffic
passes through Caddy and the backend's admin authorization checks.

## Server layout

The host is Debian 13 with Docker Engine and the Compose plugin. Python and
Node dependencies are installed inside images rather than in host virtualenvs.
Docker and containerd start on boot; application containers use
`restart: unless-stopped`. Reboot recovery has not been explicitly tested.

- `/opt/fmlcore/repository/`: Git checkout used by the deployer.
- `/opt/fmlcore/releases/`: source directories for individual deployments.
- `/opt/fmlcore/current`: symlink to the active release.
- `/opt/fmlcore/compose.json`: active Compose configuration, including secrets.
- `/opt/fmlcore/production-secrets.json`: generated, persistent database/session/
  fingerprint/OTP and Web Push keys. Preserve this file across deployments.
- `/opt/fmlcore/backups/`: database and uploaded-file backups.
- `/opt/fmlcore/last-deployment.txt`: Git revision and source-overlay details.
- `/home/fmlcore/deploy/`: private operator script, configuration, archives, notes.

These private files are not safe to commit or print in logs. File permissions
restrict access; deploy commands use `umask 077`. Git credentials are passed to
a temporary askpass helper and are not needed in a repository URL.

Six Compose services run under project name `fmlcore`: `db` (PostgreSQL 16 with
pgvector), `api`, `same-sky-worker`, `web`, `admin-web`, and `proxy` (Caddy).
Browser `/api/*` requests are forwarded to the internal API without `/api`;
`/ws` forwards directly to the API with WebSocket upgrade support.

## Storage

The original boot disk is 10 GB. A separate empty 20 GB disk was attached,
formatted as ext4, and mounted at `/mnt/fmlcore-data`.

- `/etc/fstab` mounts the application disk by filesystem UUID.
- `/etc/docker/daemon.json` sets `data-root` to `/mnt/fmlcore-data/docker`.
- `/etc/containerd/config.toml` sets `root` to `/mnt/fmlcore-data/containerd`.
- Both services have a `RequiresMountsFor=/mnt/fmlcore-data` systemd override.
- Database/uploads and Caddy certificate volumes live in Docker's new data root.

This is 30 GB total attached capacity, not a 20 GB boot disk. Original
`/var/lib/docker` and `/var/lib/containerd` copies are retained as pre-move
recovery copies. They are inactive and do not contain subsequent writes.
Do not format the application disk again during a fresh server installation.

Check actual storage and service paths:

```bash
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
findmnt /mnt/fmlcore-data
df -h / /mnt/fmlcore-data
sudo docker info --format '{{.DockerRootDir}}'
sudo systemctl status docker containerd --no-pager
```

## Authentication and external configuration

`ADMIN_EMAILS` in the private deployment config is the admin allowlist. Use an
existing FMLCore account whose email is listed. There is no shared/default admin
password. Google-only users use Continue with Google in the admin console;
Google identity is verified by the backend before `/admin/me` authorizes access.
A public admin URL never grants permissions by itself.

The existing Google OAuth **Web application** client must have these exact
Authorized JavaScript origins:

```text
https://fmlcore.com
https://www.fmlcore.com
https://admin.fmlcore.com
```

Retain required localhost origins for development. The app uses Google Identity
Services popup callbacks, so this implementation needs no redirect URI. The
operator reported saving all production origins. Successful real Google sign-in
to the admin console still needs operator confirmation.

`CORS_ORIGINS` includes both public and admin HTTPS origins. Cookies are secure,
HTTP-only, and host-scoped: signing into the public app does not sign the browser
into the admin subdomain automatically. Configure email/Google/AI credentials in
private `deploy.conf`; never put them in public frontend variables or Git.
Email transport and AI keys were transferred, but real delivery/provider calls
were not certified by deployment checks. Keep billing confirmation explicit.

## Deploying from GitHub

The repository now includes the [server deployer](../scripts/deploy.sh) and a
[configuration template](../scripts/deploy.conf.example). Production fonts,
standalone Docker builds, portable logo assets, same-origin WebSockets, and the
frozen initial migration are part of the tracked source. This release can be
built directly from its Git commit.

On an existing server, replace the private operator copy of the script with the
tracked version before deploying. Keep the live configuration in
`/home/fmlcore/deploy/deploy.conf` with mode 600. On a new server, copy the
template to that path and fill in its private values. The configuration is
executed as shell code, so keep it writable only by a trusted operator.

There is no automatic GitHub-to-server deployment. Review, commit, and push the
intended branch, then set `BRANCH` in the server's private config to that branch.
This release is published on `codex/home-space-profile-skins`. Use
`DOMAIN=fmlcore.com`, `ADMIN_DOMAIN=admin.fmlcore.com`, and
`STAGING_ONLY=false` for public production.

```bash
sudo bash /home/fmlcore/deploy/deploy.sh
sudo cat /opt/fmlcore/last-deployment.txt
```

The script fetches GitHub, builds all images, validates Caddy, and backs up
PostgreSQL and uploads before replacing the API and worker. The API applies
Alembic migrations on startup. The deployer preserves volumes, database/session
secrets, and Web Push keys. It records the deployed Git commit and verifies
public HTTPS health.

The older `working-tree-current.tar.gz` and `font-overlay/` in the private
bundle describe an earlier release. Keep them for recovery if needed. Passing an
old archive to `--source-archive` can overwrite current code.

The 0901 migration contains the frozen, clean-database baseline previously
applied by the private deployer. Existing versioned databases keep their schema
and apply only pending revisions. Fresh databases run the whole chain. The
baseline rejects existing unversioned tables.

Local verification for a release:

```bash
cd front-end
npm ci
npm test
docker build -t fmlcore-web:verify .
cd ../backend-front-end
npm ci
node --test tests/*.test.mjs
docker build -t fmlcore-admin:verify .
cd ../backend
.venv/bin/alembic upgrade head
.venv/bin/python -m unittest discover -s tests
```

Point `DATABASE_URL` at a disposable PostgreSQL 16 database with pgvector
available before the migration and backend test commands. The tests write test
records and exercise committed changes. Keep this database separate from
production.

## Live leaderboard and browser notifications

Migration `20261111_0917` adds the vote invalidation triggers and the browser push
subscription and delivery tables. The public SSE stream is
`/api/leaderboard/events`. It carries only a change signal. Each browser fetches
its ranking through the usual visibility filters. Keep reverse proxy streaming
enabled for this route. Reconnecting refreshes the ranking, and a visible tab
uses a periodic refresh if the stream is unavailable.

The website uses the native browser prompt on the first trusted click
or tap after sign-in when push is configured and permission is undecided.
A session flag prevents repeated requests. Users manage permission in their
browser's site settings. The service worker at `/sw.js` can display
alerts with the tab closed when the browser and operating system allow delivery.
Alerts for votes, comments, matches, and messages use generic text and open the
relevant inbox. The server checks blocks, mutes, and read state before delivery.
Logout attempts to remove the device subscription, and disabling notifications
unsubscribes this browser. Other devices keep their own settings.

The deployer generates a P-256 Web Push key pair once and stores it in
`/opt/fmlcore/production-secrets.json`. Preserve both keys across deployments and
restores. Rotating them requires browsers to subscribe again. For plain Compose,
supply `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in the
private environment file. The subject is a contact URI such as
`mailto:admin@fmlcore.com`. The public config endpoint returns only the public
key and enabled state.

PostgreSQL queues deliveries when activity commits. The API delivery task sends
them using Web Push and retries transient failures. It drops expired endpoints
and suppresses alerts that were read, muted, or blocked before delivery. Chrome
push uses its FCM endpoint, and the backend only accepts approved HTTPS push
services. A real device check needs the user to grant permission and a second
account to generate activity.

Verify the smiley favicon and search/share assets at `/icon.svg`, `/robots.txt`,
`/sitemap.xml`, and `/opengraph-image`. The public sitemap includes the home,
Explore, leaderboard, and About pages. Profile settings, chat, inbox, and the
admin console carry crawler restrictions.

## Daily checks and diagnosing failures

Run on the server:

```bash
sudo docker compose -p fmlcore -f /opt/fmlcore/compose.json ps
sudo docker compose -p fmlcore -f /opt/fmlcore/compose.json logs --tail=100 api web admin-web same-sky-worker proxy
curl -fsS https://fmlcore.com/api/health
curl -fsS https://admin.fmlcore.com/api/health
```

Localhost port 8080 supports an operator preview. Use the public domains for routine checks.

If DNS is changing, compare the authoritative A/CNAME records with your local
resolver. To test the correct server without bypassing certificate validation:

```bash
curl --resolve fmlcore.com:443:34.131.221.150 https://fmlcore.com/api/health
curl --resolve admin.fmlcore.com:443:34.131.221.150 https://admin.fmlcore.com/api/health
```

Check home, login, public image assets, and admin login after a release.
Anonymous `/api/admin/me` and `/api/admin/overview` should return JSON `401`.
An authenticated allowlisted account should receive `200` JSON for overview,
worker status, and the user list; a normal account should receive `403`.

### Admin Internal Server Error / JSON.parse

On 11 November the authenticated overview crashed because worker status called
`pgrep`, unavailable in the slim API container. The worker is a separate service,
so API-container PIDs also cannot establish its status correctly.

The fix uses `SAME_SKY_WORKER_MANAGED=true` in production. The worker names its
persistent PostgreSQL listener `fmlcore-same-sky-worker`; the API checks
`pg_stat_activity` in the same database. Local process mode also tolerates a
missing `pgrep`. A managed worker's start/stop controls are disabled in the UI,
and their API routes reject process-management attempts with `409`. Operators
start/stop the service through Compose; Process Backlog remains available.
During worker startup/backlog drain or reconnect it can temporarily show stopped
until the named listener connects. If an operator intentionally stops it, use
Compose to start it again; `unless-stopped` preserves an explicit stop.

Both admin API wrappers now handle plain-text/HTML server failures with a readable
message instead of exposing a JSON parser exception. Fix the server-side cause
as well; hiding the parser error alone does not restore the dashboard.

## Backups and rollback

An initial SQL backup exists at
`/opt/fmlcore/backups/initial-deployment.sql.gz`. Full deploy-script updates also
back up database and uploads before migrations. Targeted frontend/API fixes do
not necessarily run that full backup sequence; no database migration was needed
for the admin fixes. Backups currently remain on this server. Scheduled/off-server
backups and a restore rehearsal are still pending.

Take a database and uploads backup together before schema/data updates. Stop
API/worker writers during a consistent snapshot. Use `pg_dump` for database and
a tar archive of `uploads_data`, keeping files private. Securely copy backups
off-host, and retain deployment/config/secret recovery material separately.

For a code-only rollback with a compatible schema, restore the previous source
and image configuration and start the services using the same named volumes.
Record the image/release before upgrades. Never use `docker compose down -v` as
an update or rollback command. Schema rollback is not automatic: restore the
matching database/uploads backup only through a deliberate maintenance plan,
first rehearsed against an empty isolated database. Do not import a plain SQL
backup over existing production tables without a reviewed restore procedure.

## Verified state and remaining work

Verified: all six services run; this release targets schema `20261111_0917`; pgvector is
installed; public home/logo/API endpoints work over trusted HTTPS; admin Google
code is deployed; anonymous admin access is rejected; an authenticated admin
request returns `200` JSON for overview, worker status and users, and detects the
running separate worker. Three worker regression tests, two response-parser tests,
Python compilation and the production admin build passed for this repair.

Pending: operator completion of real admin Google login, full production user
flows/provider delivery, scheduled off-host backups, reboot/restore rehearsal,
and the remaining chat safety/production work in PROGRESS.md. Verify actual OS
notification delivery on a browser that has opted in.
