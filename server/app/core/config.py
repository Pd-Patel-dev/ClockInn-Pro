from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Union
import json
from pathlib import Path


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str
    
    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS
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
    
    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    LOGIN_ATTEMPTS_LIMIT: int = 5
    PIN_ATTEMPTS_LIMIT: int = 5
    LOCKOUT_DURATION_MINUTES: int = 10
    
    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent.parent / ".env",
        env_file_encoding='utf-8',
        case_sensitive=True,
        extra='ignore'  # Ignore extra environment variables (like POSTGRES_USER, POSTGRES_DB, etc.)
    )


settings = Settings()

