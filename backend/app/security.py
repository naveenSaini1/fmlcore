from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt
from fastapi import HTTPException, Request

from app.config import settings

COOKIE = "fml_session"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def make_token(user_id: UUID) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.jwt_ttl_days)
    return jwt.encode(
        {"sub": str(user_id), "exp": expires},
        settings.jwt_secret,
        algorithm="HS256",
    )


def read_user_id(request: Request) -> UUID:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Log in first.")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Log in again.")


def cookie_kwargs(token: str) -> dict:
    return {
        "key": COOKIE,
        "value": token,
        "httponly": True,
        "samesite": "lax",
        "secure": False,
        "max_age": settings.jwt_ttl_days * 24 * 60 * 60,
        "path": "/",
    }
