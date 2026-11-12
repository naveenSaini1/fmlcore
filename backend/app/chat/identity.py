"""Viewer-specific identity. Never expose a hidden user's public account ID."""
import hashlib
import hmac
from uuid import UUID
from sqlalchemy import select
from app.config import settings
from app.models import ChatParticipant


def anonymous_id(scope_id, user_id):
    digest = hmac.new(settings.jwt_secret.encode(), f"same-sky:{scope_id}:{user_id}".encode(), hashlib.sha256).digest()
    return UUID(bytes=digest[:16], version=4)


def anonymous_name(scope_id, user_id):
    token = anonymous_id(scope_id, user_id)
    adjectives = ("Quiet", "Gentle", "Silver", "Misty", "Brave", "Amber", "Wandering", "Little")
    nouns = ("Comet", "Moon", "Cloud", "Star", "Aurora", "Orbit", "Sky", "Meteor")
    return f"{adjectives[token.bytes[0] % 8]} {nouns[token.bytes[1] % 8]} {token.hex[:4].upper()}"


def participant_identity(db, conversation_id, subject_id, viewer_id):
    from app.chat.schemas import ChatParticipantOut
    from app.websocket.manager import ws_manager
    from fastapi import HTTPException
    from app.safety import relationship_blocked
    parts = db.scalars(select(ChatParticipant).where(ChatParticipant.conversation_id == conversation_id)).all()
    subject = next((p for p in parts if p.user_id == subject_id), None)
    viewer = next((p for p in parts if p.user_id == viewer_id), None)
    if not subject or not viewer:
        raise HTTPException(403, "You do not have access to this conversation.")
    other = next((p for p in parts if p.user_id != viewer_id), None)
    if other and relationship_blocked(db, other.user_id, viewer_id):
        raise HTTPException(403, "This connection is unavailable.")
    user = subject.user
    scope = subject.conversation.same_sky_match_id or conversation_id
    own = subject_id == viewer_id
    revealed = own or (bool(subject.profile_revealed) and not relationship_blocked(db, subject_id, viewer_id))
    alias = anonymous_name(scope, subject_id)
    nickname = viewer.nickname if not own else None
    return ChatParticipantOut(
        user_id=subject_id if own else anonymous_id(scope, subject_id),
        username=(nickname or user.username) if revealed else (nickname or alias),
        alias=alias, nickname=nickname, is_revealed=revealed,
        profile_username=user.username if revealed else None,
        avatar_url=f"/media/avatars/{user.avatar_file}" if revealed and user.avatar_file else None,
        profile_color=user.profile_color if revealed else "lime",
        profile_sticker=user.profile_sticker if revealed else "star",
        bio=(user.bio or "") if revealed else "",
        is_online=ws_manager.is_user_online(subject_id), last_read_at=subject.last_read_at,
    )
