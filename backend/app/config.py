from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://fmlcore:fmlcore@localhost:5433/fmlcore"
    jwt_secret: str = "dev-only-change-before-any-real-deploy"
    jwt_ttl_days: int = 14
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
    app_env: Literal["development", "production", "test"] = "development"
    cookie_secure: bool | None = None
    admin_emails: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_embedding_version: str = "gemini-embedding-001"
    gemini_paid_service_confirmed: bool = False
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"
    same_sky_gemini_request_gap_seconds: float = Field(default=7.0, ge=0, le=60)
    same_sky_groq_request_gap_seconds: float = Field(default=2.0, ge=0, le=60)
    same_sky_hash_secret: str = ""
    same_sky_embedding_dimensions: int = Field(default=768, ge=128, le=3072)
    same_sky_required_posts: int = Field(default=3, ge=1, le=100)
    same_sky_required_confessions: int = Field(default=3, ge=1, le=100)
    same_sky_retry_minutes: int = Field(default=1440, ge=1, le=43200)
    same_sky_job_poll_seconds: float = Field(default=2.0, ge=0.5, le=60)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def use_secure_cookies(self) -> bool:
        # HTTPS is required for a production session cookie.  Local development
        # remains usable over HTTP without any extra configuration.
        return self.cookie_secure if self.cookie_secure is not None else self.is_production

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def same_sky_gemini_ready(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_paid_service_confirmed)

    @property
    def same_sky_ai_ready(self) -> bool:
        # Gemini remains required for embeddings even when Groq is selected
        # for story analysis.
        return self.same_sky_gemini_ready

    @property
    def same_sky_fingerprint_secret(self) -> str:
        return self.same_sky_hash_secret or self.jwt_secret


settings = Settings()
