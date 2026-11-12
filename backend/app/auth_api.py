"""Authentication boundary. Sessions are issued only after required verification."""
from datetime import timedelta
import hmac
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.email_verification import (FLOW_COOKIE, bind_browser, challenge_out, digest,
    get_challenge, new_email_challenge, now, send_code, verify_code)
from app.limiter import limit
from app.models import AuthChallenge, User
from app.schemas import LoginIn, SignupIn, USERNAME
from app.security import cookie_kwargs, hash_password, make_token, verify_password
from app.system_settings import default_theme
from app.users import find_by_email, find_by_username, to_public


def check_origin(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("origin")
    if request.method == "POST" and origin and origin not in settings.cors_origin_list:
        raise HTTPException(403, "This sign-in request is not allowed.")


router = APIRouter(prefix="/auth", tags=["authentication"], dependencies=[Depends(check_origin)])
AUTH_EMAIL_PURPOSES = {"signup", "google_signup", "login", "google_link"}


class VerifyIn(BaseModel):
    challenge_id: uuid.UUID
    code: str = Field(pattern=r"^[0-9]{6}$")


class ChallengeIn(BaseModel):
    challenge_id: uuid.UUID


class GoogleIn(ChallengeIn):
    credential: str = Field(min_length=1, max_length=16384)


class GoogleCompleteIn(ChallengeIn):
    username: str
    age_confirmed: bool

    @field_validator("username")
    @classmethod
    def username_ok(cls, value):
        return SignupIn.username_ok(value)

    @field_validator("age_confirmed")
    @classmethod
    def age_ok(cls, value):
        return SignupIn.age_ok(value)


def finish(db: Session, response: Response, user: User, challenge: AuthChallenge | None = None):
    if challenge:
        challenge.consumed_at = now()
        challenge.code_digest = None
        challenge.payload = {}  # Erase temporary hashes/identity data after success.
    user.last_login_at = now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That email or Google account is already connected. Please start again.") from None
    db.refresh(user)
    response.set_cookie(**cookie_kwargs(make_token(user.id)))
    response.delete_cookie(FLOW_COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return to_public(user)


def new_user(db: Session, *, email: str, username: str, password_hash=None, google_subject=None):
    if find_by_email(db, email) or find_by_username(db, username):
        raise HTTPException(409, "That email or username is already used. Please sign in or choose another username.")
    user = User(email=email, username=username, username_lower=username.lower(), password_hash=password_hash,
        google_subject=google_subject, email_verified_at=now(), bio="", theme=default_theme(db))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That email or username is already used.") from None
    return user


@router.get("/options")
def auth_options(request: Request, response: Response):
    # Initialize binding before the UI starts either Google or email, so their
    # first requests cannot race to replace an unset browser cookie.
    bind_browser(request, response)
    response.headers["Cache-Control"] = "no-store"
    return {"google_enabled": bool(settings.google_client_id), "email_enabled": settings.email_ready,
        "email_otp_every_login": settings.email_otp_every_login}


@router.get("/username-availability")
def username_availability(username: str, request: Request, db: Session = Depends(get_db)):
    limit(request, "username_availability", max_hits=120, window_seconds=60)
    cleaned = username.strip()
    if not USERNAME.fullmatch(cleaned):
        return {"available": False, "message": "Use 3–20 letters, numbers, or underscores."}
    return {"available": find_by_username(db, cleaned) is None}


@router.post("/signup")
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "signup", max_hits=8, window_seconds=600)
    email = str(body.email).lower()
    if find_by_email(db, email):
        raise HTTPException(409, "That email already has an account. Please log in.")
    if find_by_username(db, body.username):
        raise HTTPException(409, "That username is taken.")
    challenge = new_email_challenge(db, request, response, email=email, purpose="signup",
        payload={"username": body.username, "password_hash": hash_password(body.password)})
    return challenge_out(challenge)


# A fixed dummy hash makes unknown-account password checks comparable in cost.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(24))


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "login", max_hits=10, window_seconds=300)
    user = find_by_email(db, str(body.email).lower())
    valid = verify_password(body.password, user.password_hash if user and user.password_hash else _DUMMY_HASH)
    if not user or not user.password_hash or not valid:
        raise HTTPException(401, "Email or password is wrong.")
    if not settings.email_otp_every_login:
        return finish(db, response, user)
    challenge = new_email_challenge(db, request, response, email=user.email, purpose="login", payload={}, user_id=user.id)
    return challenge_out(challenge)


@router.post("/email/verify")
def verify_email(body: VerifyIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "verify_email", max_hits=30, window_seconds=300)
    challenge = get_challenge(db, request, body.challenge_id)
    if challenge.purpose not in AUTH_EMAIL_PURPOSES:
        raise HTTPException(400, "This code cannot be used to sign in.")
    verify_code(db, challenge, body.code)
    if challenge.purpose in {"signup", "google_signup"}:
        user = new_user(db, email=challenge.email, username=challenge.payload["username"],
            password_hash=challenge.payload.get("password_hash"), google_subject=challenge.payload.get("google_subject"))
    else:
        user = db.scalar(select(User).where(User.id == challenge.user_id).with_for_update())
        if user is None or user.email != challenge.email:
            raise HTTPException(400, "This account changed. Please start again.")
        if challenge.purpose == "google_link":
            subject = challenge.payload["google_subject"]
            existing = db.scalar(select(User).where(User.google_subject == subject))
            if (existing and existing.id != user.id) or (user.google_subject and user.google_subject != subject):
                raise HTTPException(409, "That Google account is already connected to another profile.")
            user.google_subject = subject
        user.email_verified_at = user.email_verified_at or now()
    return finish(db, response, user, challenge)


@router.post("/email/resend")
def resend_email(body: ChallengeIn, request: Request, db: Session = Depends(get_db)):
    limit(request, "resend_email", max_hits=10, window_seconds=600)
    challenge = get_challenge(db, request, body.challenge_id, allow_expired=True)
    if challenge.purpose not in AUTH_EMAIL_PURPOSES:
        raise HTTPException(400, "Start a new sign-in to request a code.")
    send_code(db, challenge)
    db.commit()
    return challenge_out(challenge)


@router.post("/google/start")
def google_start(request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "google_start", max_hits=30, window_seconds=600)
    if not settings.google_client_id:
        raise HTTPException(503, "Google sign-in is currently unavailable.")
    nonce = secrets.token_urlsafe(32)
    challenge = AuthChallenge(id=uuid.uuid4(), purpose="google", browser_digest=bind_browser(request, response),
        code_digest=digest("nonce:" + nonce), payload={}, attempts=0, expires_at=now() + timedelta(minutes=10))
    db.add(challenge)
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"client_id": settings.google_client_id, "nonce": nonce, "challenge_id": str(challenge.id)}


class BoundedGoogleRequest(GoogleRequest):
    def __call__(self, *args, **kwargs):
        kwargs["timeout"] = 10
        return super().__call__(*args, **kwargs)


def verify_google_credential(credential: str):
    try:
        claims = id_token.verify_oauth2_token(credential, BoundedGoogleRequest(), settings.google_client_id)
    except Exception:
        raise HTTPException(401, "Google sign-in could not be verified. Please try again.") from None
    if claims.get("azp") and claims["azp"] != settings.google_client_id:
        raise HTTPException(401, "Google sign-in was issued for another app.")
    if not isinstance(claims.get("sub"), str) or not 1 <= len(claims["sub"]) <= 255 or claims.get("email_verified") is not True or not claims.get("email"):
        raise HTTPException(401, "Use a Google account with a verified email address.")
    # Validate syntax and normalize exactly as password signup does.
    from pydantic import TypeAdapter, ValidationError
    try:
        claims["email"] = str(TypeAdapter(EmailStr).validate_python(claims["email"])).lower()
    except ValidationError:
        raise HTTPException(401, "Google did not provide a valid email address.") from None
    return claims


@router.post("/google")
def google_signin(body: GoogleIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "google_verify", max_hits=20, window_seconds=300)
    if not settings.google_client_id:
        raise HTTPException(503, "Google sign-in is currently unavailable.")
    challenge = get_challenge(db, request, body.challenge_id)
    if challenge.purpose != "google":
        raise HTTPException(400, "Please start Google sign-in again.")
    claims = verify_google_credential(body.credential)
    if not hmac.compare_digest(challenge.code_digest or "", digest("nonce:" + str(claims.get("nonce", "")))):
        raise HTTPException(401, "Google sign-in expired. Please try again.")
    subject, email = claims["sub"], claims["email"]
    user = db.scalar(select(User).where(User.google_subject == subject).with_for_update())
    if user:
        # Subject is the identity; a Google email change never moves accounts.
        return finish(db, response, user, challenge)
    existing = find_by_email(db, email)
    challenge.email = email
    challenge.code_digest = None  # The Google nonce is single-use.
    challenge.payload = {"google_subject": subject}
    if existing:
        if existing.google_subject and existing.google_subject != subject:
            raise HTTPException(409, "This email belongs to a different Google sign-in.")
        # Never silently merge Google and password accounts by matching email.
        challenge.purpose = "google_link"
        challenge.user_id = existing.id
        send_code(db, challenge)
        db.commit()
        return challenge_out(challenge)
    challenge.purpose = "google_profile"
    challenge.payload = {"google_subject": subject,
        "email_needs_otp": not (email.endswith("@gmail.com") or bool(claims.get("hd")))}
    db.commit()
    return {"requires_username": True, "challenge_id": str(challenge.id), "email": email}


@router.post("/google/complete")
def google_complete(body: GoogleCompleteIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "google_complete", max_hits=10, window_seconds=300)
    challenge = get_challenge(db, request, body.challenge_id)
    if challenge.purpose != "google_profile":
        raise HTTPException(400, "Please start Google sign-in again.")
    if find_by_username(db, body.username):
        raise HTTPException(409, "That username is taken.")
    if challenge.payload.get("email_needs_otp"):
        challenge.purpose = "google_signup"
        challenge.payload = {"google_subject": challenge.payload["google_subject"], "username": body.username}
        send_code(db, challenge)
        db.commit()
        return challenge_out(challenge)
    user = new_user(db, email=challenge.email, username=body.username, google_subject=challenge.payload["google_subject"])
    return finish(db, response, user, challenge)
