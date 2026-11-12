"""Purpose-bound, browser-bound, single-use verification; no plaintext codes in DB."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
import uuid

from fastapi import HTTPException, Request, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.email_service import EmailDeliveryError, email_sender, verification_email
from app.models import AuthChallenge, EmailDeliveryQuota

FLOW_COOKIE = "fml_auth_flow"
EMAIL_PURPOSES = {"signup", "login", "google_link", "google_signup"}


def now():
    return datetime.now(timezone.utc)


def digest(value: str) -> str:
    return hmac.new((settings.email_otp_secret or settings.jwt_secret).encode(), value.encode(), hashlib.sha256).hexdigest()


def bind_browser(request: Request, response: Response) -> str:
    # Reuse a valid browser binding so concurrent Google/email starts cannot
    # overwrite each other's cookie and strand the verification form.
    token = request.cookies.get(FLOW_COOKIE, "")
    if len(token) != 43 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in token):
        token = secrets.token_urlsafe(32)
    response.set_cookie(FLOW_COOKIE, token, max_age=1800, httponly=True, secure=settings.use_secure_cookies, samesite="lax", path="/")
    return digest("browser:" + token)


def get_challenge(db: Session, request: Request, challenge_id: uuid.UUID, *, allow_expired=False) -> AuthChallenge:
    challenge = db.scalar(select(AuthChallenge).where(AuthChallenge.id == challenge_id).with_for_update())
    token = request.cookies.get(FLOW_COOKIE, "")
    if (challenge is None or challenge.consumed_at is not None or not token
        or not hmac.compare_digest(challenge.browser_digest, digest("browser:" + token))
        or (not allow_expired and challenge.expires_at <= now())
        or challenge.created_at <= now() - timedelta(minutes=30)):
        raise HTTPException(400, "This sign-in expired. Please start again.")
    return challenge


def send_code(db: Session, challenge: AuthChallenge) -> None:
    if challenge.purpose not in EMAIL_PURPOSES or not challenge.email:
        raise HTTPException(400, "Start a new sign-in to request a code.")
    recipient_key = digest("recipient:" + challenge.email)
    # Serialize requests across API workers, including first inserts and resends.
    lock_id = int(recipient_key[:15], 16)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    quota = db.get(EmailDeliveryQuota, recipient_key)
    timestamp = now()
    if quota and (timestamp - quota.last_sent_at).total_seconds() < settings.email_otp_resend_seconds:
        raise HTTPException(429, "Please wait a minute before requesting another code.")
    if quota is None:
        quota = EmailDeliveryQuota(recipient_digest=recipient_key, window_started_at=timestamp, last_sent_at=timestamp, count=0)
        db.add(quota)
    elif (timestamp - quota.window_started_at).total_seconds() >= 3600:
        quota.window_started_at = timestamp
        quota.count = 0
    if quota.count >= settings.email_max_per_hour:
        raise HTTPException(429, "Too many email requests. Please try again later.")
    quota.last_sent_at = timestamp
    quota.count += 1
    previous_digest = challenge.code_digest
    while True:
        code = f"{secrets.randbelow(1_000_000):06d}"
        next_digest = digest(f"otp:{challenge.id}:{challenge.purpose}:{code}")
        if next_digest != previous_digest:
            break
    challenge.code_digest = next_digest
    challenge.attempts = 0
    challenge.expires_at = timestamp + timedelta(seconds=settings.email_otp_ttl_seconds)
    try:
        email_sender.send(verification_email(challenge.email, code, challenge.purpose))
    except EmailDeliveryError:
        db.rollback()
        raise HTTPException(503, "We couldn't send your verification email. Please try again later.") from None


def new_email_challenge(db: Session, request: Request, response: Response, *, email: str, purpose: str, payload: dict, user_id=None):
    challenge = AuthChallenge(id=uuid.uuid4(), purpose=purpose, email=email, user_id=user_id,
        browser_digest=bind_browser(request, response), payload=payload, attempts=0,
        expires_at=now() + timedelta(seconds=settings.email_otp_ttl_seconds))
    db.add(challenge)
    db.flush()
    send_code(db, challenge)
    db.commit()
    return challenge


def challenge_out(challenge: AuthChallenge):
    local, _, domain = (challenge.email or "").partition("@")
    return {"requires_verification": True, "challenge_id": str(challenge.id),
        "email_hint": f"{local[:1]}***@{domain}", "expires_in": settings.email_otp_ttl_seconds,
        "resend_after": settings.email_otp_resend_seconds}


def verify_code(db: Session, challenge: AuthChallenge, code: str):
    if challenge.purpose not in EMAIL_PURPOSES or challenge.attempts >= settings.email_otp_max_attempts:
        raise HTTPException(400, "Too many attempts. Request a new code.")
    expected = digest(f"otp:{challenge.id}:{challenge.purpose}:{code}")
    if not challenge.code_digest or not hmac.compare_digest(challenge.code_digest, expected):
        challenge.attempts += 1
        db.commit()  # Keep failed guesses even though the request fails.
        raise HTTPException(400, "That code is incorrect. Please try again.")
    # Caller consumes and commits atomically with account/session changes.
