from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.schemas import UserOut


def sniff_image(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def find_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower()))


def find_by_username(db: Session, username: str) -> User | None:
    return db.scalar(select(User).where(User.username_lower == username.lower()))


def to_public(user: User) -> UserOut:
    avatar_url = f"/media/avatars/{user.avatar_file}" if user.avatar_file else None
    return UserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        bio=user.bio or "",
        profile_color=user.profile_color,
        profile_sticker=user.profile_sticker,
        theme=user.theme,
        avatar_url=avatar_url,
        joined_at=user.created_at,
    )


def remove_file(path: Path) -> None:
    if path.exists() and path.is_file():
        path.unlink()
