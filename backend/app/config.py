"""集中管理后端环境配置。"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_SESSION_SECRET = "development-only-change-me-32-bytes"


class Settings(BaseSettings):
    """仅从环境变量读取可部署配置，避免代码内保存凭据。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(
        "development", validation_alias=AliasChoices("APP_ENV", "PARTSIGNAL_ENVIRONMENT")
    )
    database_url: str = Field(
        "postgresql+psycopg://partsignal:partsignal@localhost:5432/partsignal",
        validation_alias=AliasChoices("DATABASE_URL", "PARTSIGNAL_DATABASE_URL"),
    )
    redis_url: str = Field(
        "redis://localhost:6379/0",
        validation_alias=AliasChoices("REDIS_URL", "PARTSIGNAL_REDIS_URL"),
    )
    session_secret: str = Field(
        DEVELOPMENT_SESSION_SECRET,
        validation_alias=AliasChoices("SESSION_SECRET", "PARTSIGNAL_SESSION_SECRET"),
        min_length=32,
    )
    session_cookie_name: str = "partsignal_session"
    csrf_cookie_name: str = "partsignal_csrf"
    session_ttl_seconds: int = 8 * 60 * 60
    cookie_secure: bool = Field(
        False,
        validation_alias=AliasChoices("SESSION_COOKIE_SECURE", "PARTSIGNAL_COOKIE_SECURE"),
    )
    allowed_origins: str = Field(
        "http://localhost:5173",
        validation_alias=AliasChoices("CORS_ALLOWED_ORIGINS", "PARTSIGNAL_ALLOWED_ORIGINS"),
    )
    development_storage_internal_url: str = Field(
        "http://localhost:9000",
        validation_alias=AliasChoices(
            "OBJECT_STORAGE_ENDPOINT", "PARTSIGNAL_DEVELOPMENT_STORAGE_INTERNAL_URL"
        ),
    )
    development_storage_public_url: str = Field(
        "http://localhost:19001",
        validation_alias=AliasChoices(
            "OBJECT_STORAGE_PUBLIC_ENDPOINT", "PARTSIGNAL_DEVELOPMENT_STORAGE_PUBLIC_URL"
        ),
    )
    development_storage_path: str = Field(
        "/data",
        validation_alias=AliasChoices("OBJECT_STORAGE_PATH", "PARTSIGNAL_DEVELOPMENT_STORAGE_PATH"),
    )
    development_storage_signing_key: str = Field(
        "partsignal-development-only-storage-key",
        validation_alias=AliasChoices(
            "UPLOAD_SIGNING_SECRET", "PARTSIGNAL_DEVELOPMENT_STORAGE_SIGNING_KEY"
        ),
    )
    object_storage_backend: str = Field(
        "development", validation_alias=AliasChoices("OBJECT_STORAGE_BACKEND")
    )
    oss_endpoint: str = Field("", validation_alias=AliasChoices("OSS_ENDPOINT"))
    oss_bucket: str = Field("", validation_alias=AliasChoices("OSS_BUCKET"))
    oss_access_key_id: str = Field("", validation_alias=AliasChoices("OSS_ACCESS_KEY_ID"))
    oss_access_key_secret: str = Field(
        "", validation_alias=AliasChoices("OSS_ACCESS_KEY_SECRET")
    )
    upload_intent_ttl_seconds: int = 600
    download_url_ttl_seconds: int = 300
    generation_eager: bool = False
    generation_lease_seconds: int = 600

    @model_validator(mode="after")
    def validate_production_boundaries(self) -> Settings:
        """生产环境禁止开发密钥、非安全 Cookie 和开发对象存储。"""
        if self.environment != "production":
            return self
        if self.session_secret == DEVELOPMENT_SESSION_SECRET:
            raise ValueError("生产环境必须设置独立 SESSION_SECRET")
        if not self.cookie_secure:
            raise ValueError("生产环境必须启用 SESSION_COOKIE_SECURE")
        if self.object_storage_backend != "aliyun_oss":
            raise ValueError("生产环境必须显式使用 aliyun_oss 对象存储")
        missing = [
            name
            for name, value in {
                "OSS_ENDPOINT": self.oss_endpoint,
                "OSS_BUCKET": self.oss_bucket,
                "OSS_ACCESS_KEY_ID": self.oss_access_key_id,
                "OSS_ACCESS_KEY_SECRET": self.oss_access_key_secret,
            }.items()
            if not value
        ]
        if missing:
            raise ValueError(f"生产 OSS 配置不完整：{', '.join(missing)}")
        return self


@lru_cache
def get_settings() -> Settings:
    """返回进程级不可变配置实例。"""
    return Settings()


settings = get_settings()
