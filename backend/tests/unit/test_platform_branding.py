"""验证平台 Logo 输入只落入一个可信来源。"""

import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.identity import User
from app.schemas.configuration import (
    PlatformLogoUploadInput,
    PlatformProfileCreate,
    PlatformProfileUpdate,
)
from app.schemas.geo_files import UploadIntentCreate
from app.services import file_records
from app.services.file_records import complete_file_upload, create_upload_intent
from app.services.platform_logo_files import lock_platform_logo_change
from app.services.storage import EvidenceStorage, ObjectMetadata


def test_uploaded_platform_logo_requires_verified_public_logo_file() -> None:
    """上传来源必须同时满足类别、完整性状态和公开级别。"""
    file_id = uuid.uuid4()
    valid = SimpleNamespace(
        id=file_id,
        status="VERIFIED",
        category="PLATFORM_LOGO",
        access_level="PUBLIC",
        cleanup_after=object(),
    )
    valid_db = Mock(spec=Session)
    valid_db.scalars.return_value = [valid]
    assert (
        lock_platform_logo_change(
            valid_db,
            current_file_id=None,
            logo=PlatformLogoUploadInput(source="UPLOAD", file_id=file_id),
        )
        == file_id
    )
    lock_sql = str(
        valid_db.scalars.call_args.args[0].compile(dialect=postgresql.dialect())
    )
    assert "ORDER BY file_records.id" in lock_sql
    assert "FOR UPDATE" in lock_sql
    assert valid.cleanup_after is None

    invalid = SimpleNamespace(
        id=file_id,
        status="VERIFIED",
        category="PUBLICATION_ASSET",
        access_level="PUBLIC",
        cleanup_after=None,
    )
    invalid_db = Mock(spec=Session)
    invalid_db.scalars.return_value = [invalid]
    with pytest.raises(AppError, match="PLATFORM_LOGO") as error:
        lock_platform_logo_change(
            invalid_db,
            current_file_id=None,
            logo=PlatformLogoUploadInput(source="UPLOAD", file_id=file_id),
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
        db.scalars.return_value = [db.get.return_value]
        lock_platform_logo_change(
            db,
            current_file_id=None,
            logo=PlatformLogoUploadInput(source="UPLOAD", file_id=file_id),
        )
    assert error.value.code == expected_code


def test_platform_logo_input_rejects_external_source() -> None:
    """新写入契约拒绝外链来源，旧外链只保留读取投影。"""
    with pytest.raises(ValidationError):
        PlatformProfileCreate.model_validate(
            {
                "name": "工程师社区",
                "slug": "engineer-community",
                "allowed_domains": ["community.example.invalid"],
                "platform_type_id": str(uuid.uuid4()),
                "platform_prompt_id": None,
                "logo": {
                    "source": "EXTERNAL",
                    "url": "https://cdn.example.invalid/logo.png",
                },
            }
        )


def test_platform_profile_update_distinguishes_omitted_and_explicit_null_logo() -> None:
    """PATCH 省略 Logo 时保留旧值，显式 null 才表示清空。"""
    common = {
        "expected_revision": 0,
        "name": "工程师社区",
        "allowed_domains": ["example.invalid"],
        "platform_type_id": uuid.uuid4(),
        "platform_prompt_id": None,
        "website_url": None,
    }
    omitted = PlatformProfileUpdate.model_validate(common)
    cleared = PlatformProfileUpdate.model_validate({**common, "logo": None})
    assert "logo" not in omitted.model_fields_set
    assert "logo" in cleared.model_fields_set


def test_platform_profile_create_and_update_share_normalization() -> None:
    """创建与更新共用名称、官网和 IDNA 域名规范化边界。"""
    platform_type_id = uuid.uuid4()
    created = PlatformProfileCreate(
        name="  工程师社区  ",
        slug="engineer-community",
        allowed_domains=["例子.测试."],
        platform_type_id=platform_type_id,
        platform_prompt_id=None,
        website_url="https://example.invalid",
    )
    updated = PlatformProfileUpdate(
        expected_revision=0,
        name="  工程师社区  ",
        allowed_domains=["例子.测试."],
        platform_type_id=platform_type_id,
        platform_prompt_id=None,
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
            platform_prompt_id=None,
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


def test_manual_platform_logo_verification_starts_24_hour_retention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """手工上传与官网候选使用同一未确认保留窗口。"""
    actor = User(
        id=uuid.uuid4(),
        username="manual-logo",
        display_name="手工 Logo",
        password_hash="not-used",
        account_type="ADMIN",
    )
    file = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=actor.id,
        status="PENDING",
        object_key="test/platform_logo/manual.png",
        size=4,
        sha256="a" * 64,
        content_type="image/png",
        category="PLATFORM_LOGO",
        verified_at=None,
        cleanup_after=None,
    )
    db = Mock(spec=Session)
    db.get.return_value = file
    storage = Mock(spec=EvidenceStorage)
    storage.head.return_value = ObjectMetadata(
        size=file.size,
        sha256=file.sha256,
        content_type=file.content_type,
    )
    monkeypatch.setattr(file_records, "get_evidence_storage", lambda: storage)
    complete_file_upload(
        db=db,
        file_id=file.id,
        actor=actor,
        request_id="manual-platform-logo",
    )
    assert file.status == "VERIFIED"
    assert file.cleanup_after - file.verified_at == timedelta(hours=24)
