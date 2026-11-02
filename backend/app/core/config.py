from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "MediCare QA Lab"
    app_version: str = "1.0.0"
    environment: str = "local"

    database_url: str = "postgresql+psycopg://medicare:medicare@localhost:5432/medicare"

    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60

    # Bug Lab master switch. When false, no injected defect can ever fire.
    demo_bugs_enabled: bool = True

    cors_origins: str = "http://localhost:5173"
    # Path to the built SPA. When set, FastAPI serves the frontend from the same origin.
    frontend_dist: str = ""

    log_retention_days: int = 14
    login_attempts_per_minute: int = 5
    # Persist request logs to the database (disabled in some unit tests).
    db_logging: bool = True

    @field_validator("database_url")
    @classmethod
    def normalize_driver(cls, v: str) -> str:
        # Hosting providers hand out postgres:// or postgresql:// URLs; we use the psycopg 3 driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
