"""Icon Horse 单候选下载与暂存边界测试。"""

from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from io import BytesIO
from unittest.mock import Mock

import httpx
import pytest
from PIL import Image
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.identity import User
from app.services import platform_logo_files
from app.services.platform_logo_files import (
    MAX_LOGO_BYTES,
    _download_candidate,
    create_platform_logo_candidate,
)
from app.services.storage import EvidenceStorage, ObjectMetadata, StorageUnavailable


def png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGBA", (32, 32), (0, 120, 212, 255)).save(output, format="PNG")
    return output.getvalue()


def test_icon_horse_candidate_accepts_verified_png_without_conversion() -> None:
    """有效 PNG 保持原字节，下载目标只能是固定 Icon Horse 域名。"""
    content = png_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://icon.horse/icon/xn--fsqu00a.xn--0zwm56d"
        return httpx.Response(200, headers={"content-type": "image/png"}, content=content)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        data, content_type, suffix = _download_candidate(
            "xn--fsqu00a.xn--0zwm56d",
            client=client,
        )
    assert data == content
    assert (content_type, suffix) == ("image/png", ".png")


@pytest.mark.parametrize(
    ("status_code", "content_type", "content"),
    [
        (302, "image/png", b""),
        (200, "image/svg+xml", b"<svg/>"),
        (200, "text/html", b"<html/>"),
        (200, "image/png", b"not-an-image"),
    ],
)
def test_icon_horse_candidate_rejects_redirect_or_invalid_content(
    status_code: int,
    content_type: str,
    content: bytes,
) -> None:
    """重定向、不支持格式和伪造图片都明确失败，不产生回退候选。"""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            headers={"content-type": content_type},
            content=content,
        )

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(AppError) as error,
    ):
        _download_candidate("example.invalid", client=client)
    assert error.value.code == "LOGO_CANDIDATE_INVALID"


def test_icon_horse_candidate_maps_timeout_and_server_failure_to_retryable_error() -> None:
    """上游超时和服务端故障保持 503，不伪装成无候选。"""

    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("test")

    for transport in (
        httpx.MockTransport(timeout),
        httpx.MockTransport(lambda _request: httpx.Response(503)),
    ):
        with (
            httpx.Client(transport=transport) as client,
            pytest.raises(AppError) as error,
        ):
            _download_candidate("example.invalid", client=client)
        assert error.value.code == "LOGO_DISCOVERY_UNAVAILABLE"
        assert error.value.status_code == 503


def test_icon_horse_candidate_rejects_declared_oversize_before_decode() -> None:
    """Content-Length 超过 2 MiB 时不继续接收候选正文。"""
    with (
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    headers={
                        "content-type": "image/png",
                        "content-length": str(MAX_LOGO_BYTES + 1),
                    },
                )
            )
        ) as client,
        pytest.raises(AppError) as error,
    ):
        _download_candidate("example.invalid", client=client)
    assert error.value.code == "LOGO_CANDIDATE_INVALID"


def test_icon_horse_candidate_enforces_streamed_size_without_content_length() -> None:
    """上游省略长度时仍按实际流式字节执行 2 MiB 硬上限。"""

    class OversizeStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b"x" * (MAX_LOGO_BYTES + 1)

    with (
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    headers={"content-type": "image/png"},
                    stream=OversizeStream(),
                )
            )
        ) as client,
        pytest.raises(AppError) as error,
    ):
        _download_candidate("example.invalid", client=client)
    assert error.value.code == "LOGO_CANDIDATE_INVALID"


def test_icon_horse_candidate_enforces_total_download_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """持续返回字节也不能绕过候选下载总时长门禁。"""
    times = iter((0.0, 0.1, 10.1))
    monkeypatch.setattr(platform_logo_files, "monotonic", lambda: next(times))

    class SlowStream(httpx.SyncByteStream):
        def __iter__(self):
            yield png_bytes()

    with (
        httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    headers={"content-type": "image/png"},
                    stream=SlowStream(),
                )
            )
        ) as client,
        pytest.raises(AppError) as error,
    ):
        _download_candidate("example.invalid", client=client)
    assert error.value.code == "LOGO_DISCOVERY_UNAVAILABLE"
    assert error.value.status_code == 503


def test_platform_logo_candidate_is_verified_and_retained_for_24_hours() -> None:
    """成功候选写入自有存储后才进入 VERIFIED，并返回同一文件的预览。"""
    content = png_bytes()
    db = Mock(spec=Session)
    holder: dict[str, object] = {}
    db.add.side_effect = lambda value: holder.setdefault("file", value)
    db.scalar.side_effect = lambda _query: holder["file"]

    storage = Mock(spec=EvidenceStorage)
    storage.head.return_value = ObjectMetadata(
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        content_type="image/png",
    )
    storage.download_url.return_value = "https://objects.example.invalid/logo.png"
    actor = User(
        id=uuid.uuid4(),
        username="logo-admin",
        display_name="Logo 管理员",
        password_hash="not-used",
        account_type="ADMIN",
    )
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                headers={"content-type": "image/png"},
                content=content,
            )
        )
    ) as client:
        candidate = create_platform_logo_candidate(
            db=db,
            website_url="https://例子.测试/",
            actor=actor,
            request_id="logo-candidate-test",
            client=client,
            storage=storage,
        )

    file = holder["file"]
    assert candidate.file_id == file.id
    assert file.status == "VERIFIED"
    assert file.cleanup_after - file.verified_at == timedelta(hours=24)
    storage.put.assert_called_once()
    assert db.commit.call_count == 2


def test_storage_failure_marks_persisted_candidate_failed() -> None:
    """对象存储失败时保留 FAILED 记录，供下一轮清理重试。"""
    content = png_bytes()
    db = Mock(spec=Session)
    holder: dict[str, object] = {}
    db.add.side_effect = lambda value: holder.setdefault("file", value)
    db.scalar.side_effect = lambda _query: holder["file"]
    storage = Mock(spec=EvidenceStorage)
    storage.put.side_effect = StorageUnavailable("test")
    actor = User(
        id=uuid.uuid4(),
        username="logo-admin-failure",
        display_name="Logo 管理员",
        password_hash="not-used",
        account_type="ADMIN",
    )
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                headers={"content-type": "image/png"},
                content=content,
            )
        )
    ) as client, pytest.raises(AppError) as error:
        create_platform_logo_candidate(
            db=db,
            website_url="https://example.invalid/",
            actor=actor,
            request_id="logo-candidate-storage-failure",
            client=client,
            storage=storage,
        )
    assert error.value.code == "DEPENDENCY_UNAVAILABLE"
    assert holder["file"].status == "FAILED"
