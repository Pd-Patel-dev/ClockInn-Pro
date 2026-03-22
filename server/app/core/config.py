from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator, model_validator
from typing import List, Union, Optional
import json
from pathlib import Path


class Settings(BaseSettings):
    # Runtime mode: set to production or prod in production (generic API errors, HTTPS redirect in main.py).
    ENVIRONMENT: str = Field(
        default="",
        description='Empty or development = verbose errors where applicable; use "production" or "prod" in prod.',
    )

    # Database
    DATABASE_URL: str
    
    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"  # HS256 is fine; for very high security consider RS256 with key rotation
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7   # Sliding: each refresh token valid this long from issue
    REFRESH_TOKEN_ABSOLUTE_MAX_DAYS: int = 30  # Session ends at latest after this many days from first login

    # Auth cookie (refresh token). When True, cookie is only sent over HTTPS.
    COOKIE_SECURE: bool = False  # Set True in production (HTTPS)
    COOKIE_SAMESITE: str = "lax"  # "lax" | "strict" | "none"
    REFRESH_TOKEN_COOKIE_NAME: str = "refresh_token"
    # If set, must match on set_cookie and delete_cookie (e.g. .example.com for subdomains).
    COOKIE_DOMAIN: Optional[str] = None
    
    # CORS: must be explicit origin(s), not "*", when allow_credentials=True (see main.py)
    FRONTEND_URL: str = "http://localhost:3000"
    CORS_ORIGINS: Union[str, List[str]] = "http://localhost:3000"

    @field_validator('CORS_ORIGINS', mode='before')
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            # Try to parse as JSON first
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
            # If not JSON, split by comma
            return [origin.strip() for origin in v.split(',') if origin.strip()]
        return v

    @field_validator('CORS_ORIGINS', mode='after')
    @classmethod
    def reject_cors_wildcard_with_credentials(cls, v: List[str]) -> List[str]:
        """Reject '*' because allow_credentials=True; browsers disallow CORS with origin '*' and credentials."""
        if not v or (len(v) == 1 and v[0].strip() == '*') or '*' in [o.strip() for o in v]:
            raise ValueError(
                "CORS_ORIGINS cannot be '*'; use exact origin(s) when credentials are allowed (e.g. https://app.example.com)."
            )
        return v

    @model_validator(mode="after")
    def cors_origins_trusted_in_production(self) -> "Settings":
        """
        In production, only allow https:// origins except localhost / 127.0.0.1 (dev-style URLs).
        Ensures CORS_ORIGINS lists real trusted front-end bases, not accidental http:// production URLs.
        """
        env = (self.ENVIRONMENT or "").strip().lower()
        if env not in ("prod", "production"):
            return self
        for origin in self.CORS_ORIGINS:
            o = origin.strip()
            if not o:
                continue
            lower = o.lower()
            if not (lower.startswith("http://") or lower.startswith("https://")):
                raise ValueError(
                    f"CORS_ORIGINS entries must be absolute origins (http:// or https://). Invalid: {origin!r}"
                )
            if lower.startswith("https://"):
                continue
            # http:// allowed only for local development hosts
            if lower.startswith("http://") and (
                "localhost" in lower or lower.startswith("http://127.0.0.1")
            ):
                continue
            raise ValueError(
                "In production (ENVIRONMENT=production), CORS_ORIGINS must use https:// for every "
                f"non-localhost origin. Only list trusted front-end URLs (e.g. https://app.example.com). Offending entry: {origin!r}"
            )
        return self
    
    # Rate Limiting (global middleware by IP; see app.middleware.rate_limit)
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = Field(
        default=60,
        description="Max requests per IP per rolling 60s window for most API routes.",
    )
    RATE_LIMIT_AUTH_KIOSK_PER_MINUTE: int = Field(
        default=30,
        description="Stricter cap for /api/v1/auth/* and /api/v1/kiosk/*. Login also has per-email lockout.",
    )
    LOGIN_ATTEMPTS_LIMIT: int = 5
    PIN_ATTEMPTS_LIMIT: int = 5
    LOCKOUT_DURATION_MINUTES: int = 10
    # Shared login lockout (see app.core.login_attempts). When set, failed attempts are stored in Redis.
    REDIS_URL: Optional[str] = Field(
        default=None,
        description="e.g. redis://localhost:6379/0 — enables Redis-backed login lockout across API instances.",
    )
    LOGIN_LOCKOUT_USE_IP: bool = Field(
        default=False,
        description="If True, lockout key is email + client IP (requires passing IP from auth endpoint).",
    )
    LOGIN_LOCKOUT_REDIS_ATTEMPT_TTL_SECONDS: int = Field(
        default=86400,
        description="Redis TTL for keys that track failed attempts before lockout (sliding window).",
    )

    # Shift assignment: roles that can be assigned shifts (add new roles here or via env without code change)
    SHIFT_ELIGIBLE_ROLES: Union[str, List[str]] = "MAINTENANCE,FRONTDESK,HOUSEKEEPING"

    @field_validator('SHIFT_ELIGIBLE_ROLES', mode='before')
    @classmethod
    def parse_shift_eligible_roles(cls, v):
        if isinstance(v, str):
            return [r.strip() for r in v.split(',') if r.strip()]
        return v
    
    # Gmail API (for email verification)
    GMAIL_CREDENTIALS_JSON: Optional[str] = None  # JSON string of OAuth credentials
    GMAIL_TOKEN_JSON: Optional[str] = None  # JSON string of OAuth token
    GMAIL_SENDER_EMAIL: str = "no-reply.clockinpro@gmail.com"
    
    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent.parent / ".env",
        env_file_encoding='utf-8',
        case_sensitive=True,
        extra='ignore'  # Ignore extra environment variables (like POSTGRES_USER, POSTGRES_DB, etc.)
    )


settings = Settings()

