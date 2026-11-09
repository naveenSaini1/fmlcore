"""Database overrides for a small set of runtime-managed settings."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemSetting

REQUIRED_POSTS = "same_sky_required_posts"
REQUIRED_CONFESSIONS = "same_sky_required_confessions"
RETRY_MINUTES = "same_sky_retry_minutes"
AI_PROVIDER = "same_sky_ai_provider"
AI_PROVIDER_VALUES = {"gemini": 1, "groq": 2}
DEFAULT_THEME = "default_theme"
DEFAULT_THEME_VALUES = {
    "acid-lime": 1,
    "electric-purple": 2,
    "chaos-coral": 3,
    "midnight": 4,
    "classic-paper": 5,
}


def same_sky_rules(db: Session) -> dict[str, int]:
    stored = dict(db.execute(select(SystemSetting.key, SystemSetting.value)).all())
    return {
        REQUIRED_POSTS: int(stored.get(REQUIRED_POSTS, settings.same_sky_required_posts)),
        REQUIRED_CONFESSIONS: int(stored.get(REQUIRED_CONFESSIONS, settings.same_sky_required_confessions)),
        RETRY_MINUTES: int(stored.get(RETRY_MINUTES, settings.same_sky_retry_minutes)),
    }


def same_sky_ai_provider(db: Session) -> str:
    stored = db.scalar(select(SystemSetting.value).where(SystemSetting.key == AI_PROVIDER))
    return "groq" if stored == AI_PROVIDER_VALUES["groq"] else "gemini"


def default_theme(db: Session) -> str:
    stored = db.scalar(select(SystemSetting.value).where(SystemSetting.key == DEFAULT_THEME))
    return next((theme for theme, value in DEFAULT_THEME_VALUES.items() if value == stored), "acid-lime")
