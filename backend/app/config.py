from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://fmlcore:fmlcore@localhost:5433/fmlcore"
    jwt_secret: str = "dev-only-change-before-any-real-deploy"
    jwt_ttl_days: int = 14
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    app_env: Literal["development", "production", "test"] = "development"
    cookie_secure: bool | None = None

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


settings = Settings()
