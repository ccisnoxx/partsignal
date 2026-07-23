"""验证平台 Logo 输入只落入一个可信来源。"""

import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.identity import User
from app.schemas.configuration import (
    PlatformLogoExternalInput,
    PlatformLogoUploadInput,
    PlatformProfileCreate,
    PlatformProfileUpdate,
)
from app.schemas.geo_files import UploadIntentCreate
from app.services.file_records import create_upload_intent, platform_logo_storage_values


def test_external_platform_logo_does_not_read_file_record() -> None:
    """外链 Logo 直接保存规范 URL，不伪造上传文件。"""
    db = Mock(spec=Session)
    file_id, external_url = platform_logo_storage_values(
        db,
        PlatformLogoExternalInput(source="EXTERNAL", url="https://cdn.example.invalid/logo.png"),
    )
    db.get.assert_not_called()
    assert file_id is None
    assert external_url == "https://cdn.example.invalid/logo.png"


def test_uploaded_platform_logo_requires_verified_public_logo_file() -> None:
    """上传来源必须同时满足类别、完整性状态和公开级别。"""
    file_id = uuid.uuid4()
    valid = SimpleNamespace(
        id=file_id,
        status="VERIFIED",
        category="PLATFORM_LOGO",
        access_level="PUBLIC",
    )
    valid_db = Mock(spec=Session)
    valid_db.get.return_value = valid
    assert platform_logo_storage_values(
        valid_db, PlatformLogoUploadInput(source="UPLOAD", file_id=file_id)
    ) == (file_id, None)

    invalid = SimpleNamespace(
        id=file_id,
        status="VERIFIED",
        category="PUBLICATION_ASSET",
        access_level="PUBLIC",
    )
    invalid_db = Mock(spec=Session)
    invalid_db.get.return_value = invalid
    with pytest.raises(AppError, match="PLATFORM_LOGO") as error:
        platform_logo_storage_values(
            invalid_db,
            PlatformLogoUploadInput(source="UPLOAD", file_id=file_id),
        )
    assert error.value.code == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("status", "category", "access_level", "expected_code"),
    [
        ("PENDING", "PLATFORM_LOGO", "PUBLIC", "FILE_INTEGRITY_FAILED"),
        ("VERIFIED", "PLATFORM_LOGO", "INTERNAL", "VALIDATION_ERROR"),
    ],
)
def test_uploaded_platform_logo_rejects_unverified_or_non_public_files(
    status: str, category: str, access_level: str, expected_code: str
) -> None:
    """上传 Logo 的完整性状态和公开级别分别受服务端强制约束。"""
    file_id = uuid.uuid4()
    db = Mock(spec=Session)
    db.get.return_value = SimpleNamespace(
        id=file_id,
        status=status,
        category=category,
        access_level=access_level,
    )
    with pytest.raises(AppError) as error:
        platform_logo_storage_values(
            db,
            PlatformLogoUploadInput(source="UPLOAD", file_id=file_id),
        )
    assert error.value.code == expected_code


def test_platform_logo_input_rejects_mixed_sources() -> None:
    """判别联合拒绝同时提交上传文件和外链，避免两套 Logo 来源并存。"""
    with pytest.raises(ValidationError):
        PlatformProfileCreate.model_validate(
            {
                "name": "工程师社区",
                "slug": "engineer-community",
                "allowed_domains": ["community.example.invalid"],
                "platform_type_id": str(uuid.uuid4()),
                "logo": {
                    "source": "UPLOAD",
                    "file_id": str(uuid.uuid4()),
                    "url": "https://cdn.example.invalid/logo.png",
                },
            }
        )


def test_platform_profile_create_and_update_share_normalization() -> None:
    """创建与更新共用名称、官网和 IDNA 域名规范化边界。"""
    platform_type_id = uuid.uuid4()
    created = PlatformProfileCreate(
        name="  工程师社区  ",
        slug="engineer-community",
        allowed_domains=["例子.测试."],
        platform_type_id=platform_type_id,
        website_url="https://example.invalid",
    )
    updated = PlatformProfileUpdate(
        expected_revision=0,
        name="  工程师社区  ",
        allowed_domains=["例子.测试."],
        platform_type_id=platform_type_id,
        website_url="https://example.invalid",
        logo=None,
    )
    assert created.name == updated.name == "工程师社区"
    assert created.allowed_domains == updated.allowed_domains == ["xn--fsqu00a.xn--0zwm56d"]
    assert str(created.website_url) == str(updated.website_url) == "https://example.invalid/"


@pytest.mark.parametrize(
    "domains",
    [
        ["EXAMPLE.invalid.", "example.invalid"],
        ["https://example.invalid"],
        ["example.invalid:443"],
        ["*.example.invalid"],
        ["-invalid.example"],
    ],
)
def test_platform_profile_domain_validation_rejects_ambiguous_hosts(
    domains: list[str],
) -> None:
    """规范化后重复或带非主机组成部分的允许域名必须失败。"""
    with pytest.raises(ValidationError):
        PlatformProfileCreate(
            name="工程师社区",
            slug="engineer-community",
            allowed_domains=domains,
            platform_type_id=uuid.uuid4(),
        )


@pytest.mark.parametrize(
    ("content_type", "size"),
    [("image/svg+xml", 1024), ("image/png", 2 * 1024 * 1024 + 1)],
)
def test_platform_logo_upload_policy_rejects_unsafe_type_or_oversize(
    content_type: str, size: int
) -> None:
    """平台 Logo 上传意图在持久化前拒绝 SVG 和超过 2 MiB 的文件。"""
    payload = UploadIntentCreate(
        category="PLATFORM_LOGO",
        original_filename="logo.svg" if content_type == "image/svg+xml" else "logo.png",
        content_type=content_type,
        size=size,
        sha256="a" * 64,
        access_level="PUBLIC",
    )
    with pytest.raises(AppError) as error:
        create_upload_intent(
            db=Mock(spec=Session),
            payload=payload,
            actor=User(
                username="platform-logo-policy",
                display_name="平台 Logo 策略测试",
                password_hash="not-used",
                account_type="ADMIN",
            ),
            request_id="platform-logo-policy",
        )
    assert error.value.code == "VALIDATION_ERROR"
