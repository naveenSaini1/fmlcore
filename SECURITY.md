# Security policy

## Supported branch

Security fixes are made against the repository's current default branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the repository
owner privately through GitHub instead. Include a clear description, affected
path or endpoint, reproduction steps, potential impact, and any suggested fix.
Do not include live credentials, session tokens, or personal user data.

## Deployment baseline

Before exposing an instance publicly, use HTTPS, a unique strong `JWT_SECRET`,
an explicit public `CORS_ORIGINS` value, `APP_ENV=production`, and protected
database backups. The production Compose configuration sets secure cookies and
uses persistent database/upload volumes, but a reverse proxy and TLS are still
the deployer's responsibility.
