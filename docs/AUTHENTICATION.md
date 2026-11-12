# Google sign-in and verified email

The login and signup screens support Google Identity Services and email/password
with a six-digit email code. Email accounts are created only after verification;
verified accounts use their password directly on later logins. The default is
`EMAIL_OTP_EVERY_LOGIN=false` (signup-only). Existing accounts log in normally,
without a verification backfill or changes to existing data. New email/password
accounts cannot log in until their signup code is verified. Existing sessions
are not forcibly revoked. Repeated login OTP is an optional configuration only.

## Enable delivery and Google sign-in

The implementation is present, but live delivery and Google sign-in remain
disabled until configured. Add values to the ignored `backend/.env`, using
`backend/.env.example` as the reference. Never put SMTP passwords in frontend
environment variables, source control, chat, or screenshots.

Email configuration:

```dotenv
SMTP_HOST=your-provider-smtp-host
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USERNAME=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=your-verified-sender@example.com
SMTP_FROM_NAME=FMLCore
EMAIL_OTP_SECRET=use-a-separate-long-random-secret
EMAIL_OTP_EVERY_LOGIN=false
```

Use `ssl` with port 465 if required by the provider. `plain` is permitted only
outside production for a local test mail server. Sender/domain verification
must be completed with your email provider. A delivery failure returns an error;
the API never exposes a code or falls back to a fake successful send.

Google configuration:

1. Create a Web application OAuth client in your Google Cloud project and
   configure its consent/branding screen.
2. Authorize the frontend origins, such as `http://localhost:3000` and your
   production HTTPS origin. Add `http://127.0.0.1:3000` only if you use it.
3. Set `GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com` in backend
   `.env`. This integration uses Google Identity Services' ID-token popup flow;
   it does not require a client secret or an OAuth redirect callback.
4. Add your frontend origins to `CORS_ORIGINS`, restart the API, and reload the
   login page. Allow `accounts.google.com` if you configure a content policy.

Google setup and token validation follow the
[Google Identity documentation](https://developers.google.com/identity/openid-connect/openid-connect).

Before using the updated API with an existing database:

```bash
cd backend
.venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
```

Migration `20261110_0913` adds verification timestamps, unique Google subjects,
temporary challenges, and durable email throttles. It preserves existing users,
passwords, usernames, content, and preferences. Google-only users have no password;
password login cannot authenticate them with an empty or arbitrary password.

## Account rules

- Usernames use 3–20 ASCII letters, numbers, or underscores. Availability is
  checked in the UI and again at account creation. Database constraints enforce
  case-insensitive uniqueness even when requests race. Google users choose a
  username and confirm they are 18+ before creation.
- Email addresses are validated and normalized consistently with existing
  accounts. OTP delivery and a successful code verify mailbox ownership;
  syntactic validation alone does not establish ownership.
- Google tokens are checked server-side by `google-auth` for signature,
  audience, issuer, expiry, verified email, authorized party (when present), and
  a browser-bound nonce. Accounts are identified by Google's stable `sub`.
- Google sign-in matching an existing email requires an emailed code before
  linking to that account. It preserves the same user ID, password, and content.
- For new Google users with a non-Gmail, non-Workspace email, an email code is
  also required because Google may not establish current mailbox ownership.
- Codes expire in ten minutes, allow five guesses, and are single-use. Resends
  invalidate the previous code, wait sixty seconds, and share a ten-per-hour
  recipient quota across workers. The API also limits requests by IP.
- A challenge belongs to one browser and one purpose. Successful verification,
  account creation/linking, and challenge consumption commit together before
  the existing HttpOnly session cookie is issued. No OTP is stored in plaintext.

## Reusing email functionality

- `app/email_service.py`: `OutboundEmail`, `SMTPEmailSender.send()`, and HTML/text
  templates. Future notification or password-reset code can send through the
  same transport without duplicating SMTP configuration.
- `app/email_verification.py`: browser binding, purpose-specific code digests,
  expiration, attempt limits, and database-backed delivery quotas. Extend the
  internal purpose registry with a dedicated verified action; do not expose a
  public arbitrary-purpose OTP or arbitrary-recipient messaging endpoint.
- `app/auth_api.py`: authentication-specific decisions and session creation.
  The general email transport does not create sessions or decide access rights.

Temporary challenges include pending password hashes until consumed/expired.
Schedule `python -m app.auth_cleanup` in your deployment maintenance system to
remove expired challenges and stale delivery quotas after 24 hours. It never
deletes users or content. Delivery is synchronous with a ten-second SMTP timeout;
future bulk notifications should use a queue around the same sender interface.

## Endpoints and verification

`GET /auth/options`, `GET /auth/username-availability`, `POST /auth/signup`,
`POST /auth/login`, `POST /auth/email/verify`, `POST /auth/email/resend`,
`POST /auth/google/start`, `POST /auth/google`, and `POST /auth/google/complete`.
Existing `/auth/me` and `/auth/logout` remain. The admin console also handles the
email-code login step; it does not bypass verification.

Run `pip install -r requirements-dev.txt` and
`python -m unittest discover -s tests -v` from `backend/` with a test PostgreSQL
database. Tests use rolled-back transactions, captured email, and mocked Google
token verification. They do not send real emails or prove a live Google login.
CI creates the current model schema for these tests. The historical Alembic
bootstrap imports current models and cannot currently replay the whole legacy
migration chain into an empty database (`same_sky_entries` is missing at 0902).
That pre-existing bootstrap issue is separate from the verified 0912→0913 upgrade.

Manual live acceptance still requires a real delivery provider and Google client:
verify inbox receipt, rejection of an incorrect/expired code, resend, Google new
account creation, existing-account linking, login, logout, and admin access.
