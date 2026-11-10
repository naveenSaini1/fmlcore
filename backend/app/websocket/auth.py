import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import WebSocket

from app.config import settings
from app.db import SessionLocal
from app.models import User
from app.security import COOKIE

logger = logging.getLogger(__name__)


def create_ws_ticket(user_id: UUID, ttl_seconds: int = 120) -> str:
    """Create a short-lived ticket for establishing a WebSocket connection.

    Can be used by the frontend if browser cookies cannot be sent across ports.
    """
    expires = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    payload = {
        "sub": str(user_id),
        "type": "ws_ticket",
        "exp": expires,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_ws_token(token: str) -> UUID | None:
    """Decode and validate a session JWT or WebSocket ticket."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        sub = payload.get("sub")
        if not sub:
            return None
        return UUID(sub)
    except (jwt.PyJWTError, ValueError, KeyError) as err:
        logger.debug("Failed to decode WebSocket token: %s", err)
        return None


def authenticate_websocket_handshake(websocket: WebSocket) -> UUID | None:
    """Extract and validate the user identity during the WebSocket handshake.

    Checks in order:
    1. HTTP-only session cookie (fml_session).
    2. Ticket from query parameter (?ticket=... or ?token=...).
    3. Cookie header string parsing fallback.
    """
    # 1. Direct cookie map
    cookie_token = websocket.cookies.get(COOKIE)
    if cookie_token:
        user_id = decode_ws_token(cookie_token)
        if user_id:
            return user_id

    # 2. Query param ticket / token fallback
    query_token = websocket.query_params.get("ticket") or websocket.query_params.get("token")
    if query_token:
        user_id = decode_ws_token(query_token)
        if user_id:
            return user_id

    # 3. Raw headers fallback
    raw_cookie = websocket.headers.get("cookie")
    if raw_cookie:
        for part in raw_cookie.split(";"):
            part = part.strip()
            if part.startswith(f"{COOKIE}="):
                val = part[len(COOKIE) + 1:]
                user_id = decode_ws_token(val)
                if user_id:
                    return user_id

    return None


def verify_user_exists(user_id: UUID) -> bool:
    """Verify that the user actually exists in the database."""
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return user is not None
