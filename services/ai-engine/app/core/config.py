"""Settings, validated once at import.

The Node services validate their environment with Zod and exit on failure; this
does the same with pydantic-settings. A service that boots with a half-configured
environment and fails on the first request is far harder to diagnose than one
that refuses to start.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # The repository-root .env, five levels up from this file. One file
        # configures every service; there is no per-service .env to drift.
        env_file=("../../.env", ".env"),
        env_prefix="",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = Field(
        default="development", alias="NODE_ENV"
    )
    log_level: Literal["debug", "info", "warning", "error"] = Field(
        default="info", alias="LOG_LEVEL"
    )

    host: str = Field(default="0.0.0.0", alias="AI_ENGINE_HOST")
    port: int = Field(default=8000, alias="AI_ENGINE_PORT")

    #: Shared secret the BFF and worker present on every call. The engine is not
    #: internet-facing, but "internal network" is a deployment assumption, not a
    #: security control — an unauthenticated scoring endpoint is an open oracle.
    api_key: str | None = Field(default=None, alias="AI_ENGINE_API_KEY")

    #: Fraction of nominal factor weight that must be scoreable before the engine
    #: will return a number at all. Below it, /v1/score answers 422 with the
    #: reason each factor was omitted. Scoring on 10% coverage is guessing with
    #: extra steps.
    minimum_coverage: float = Field(default=0.25, alias="AI_ENGINE_MIN_COVERAGE")

    #: Identifies the ruleset that produced a score, stored alongside it so a past
    #: recommendation can be attributed after the weights change.
    engine_version: str = Field(default="0.1.0-scaffold", alias="AI_ENGINE_VERSION")

    #: Must match the major of @atlas/core's CONTRACT_VERSION.
    contract_version: str = "1.0.0"

    @field_validator("api_key", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: str | None) -> str | None:
        """Treat an empty or placeholder value as unset.

        `.env.example` ships `AI_ENGINE_API_KEY=` so the variable is discoverable,
        and dotenv reads that as `""` rather than absent. Without this, copying the
        template and changing nothing configures a secret of empty string — every
        request then fails 401 against a key nobody set, and the error points at
        authentication rather than at the blank line that caused it.
        """
        if value is None:
            return None
        stripped = value.strip()
        if not stripped or stripped.startswith(("your-", "your_", "<")):
            return None
        return stripped


@lru_cache
def get_settings() -> Settings:
    """Cached so every request does not re-read and re-validate the environment."""
    return Settings()
