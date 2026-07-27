"""平台 Logo 的导入、业务引用与清理生命周期。"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from io import BytesIO
from time import monotonic
from urllib.parse import quote

import httpx
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.db import SessionLocal
from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.geo_files import FileRecord, GeoObservationAttachment
from app.models.identity import User
from app.models.publication import PublicationAttachment
from app.schemas.common import SignedUrl
from app.schemas.configuration import (
    PlatformLogoCandidate,
    PlatformLogoInput,
    normalize_platform_domain,
)
from app.services.storage import (
    EvidenceStorage,
    StorageObjectMissing,
    StorageUnavailable,
    get_evidence_storage,
)

ICON_HORSE_ORIGIN = "https://icon.horse"
MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_LOGO_PIXELS = 16_777_216
MAX_LOGO_DOWNLOAD_SECONDS = 10
UNCONFIRMED_RETENTION = timedelta(hours=24)
DETACHED_RETENTION = timedelta(days=7)
LOGO_CLEANUP_BATCH_SIZE = 100
_ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
}
_IMAGE_FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
    "ICO": ("image/x-icon", ".ico"),
}

logger = logging.getLogger("partsignal.worker")


@dataclass(frozen=True)
class LogoCleanupResult:
    """单轮 Logo 清理的非敏感执行结果。"""

    selected: int
    deleted: int
    retry: int
    failed: int


def _candidate_invalid(message: str) -> AppError:
    return AppError("LOGO_CANDIDATE_INVALID", message, 422)


def _download_candidate(
    hostname: str,
    *,
    client: httpx.Client | None = None,
) -> tuple[bytes, str, str]:
    """从固定 Icon Horse 上游下载单个受限候选。"""
    if client is None:
        timeout = httpx.Timeout(connect=3, read=8, write=5, pool=3)
        with httpx.Client(follow_redirects=False, timeout=timeout) as owned_client:
            return _download_candidate(hostname, client=owned_client)

    url = f"{ICON_HORSE_ORIGIN}/icon/{quote(hostname, safe='')}"
    started_at = monotonic()
    try:
        with client.stream(
            "GET",
            url,
            headers={"accept": "image/*"},
            follow_redirects=False,
        ) as response:
            if monotonic() - started_at > MAX_LOGO_DOWNLOAD_SECONDS:
                raise AppError(
                    "LOGO_DISCOVERY_UNAVAILABLE",
                    "Icon Horse 下载超时，请稍后重试",
                    503,
                )
            if response.status_code >= 500:
                raise AppError(
                    "LOGO_DISCOVERY_UNAVAILABLE",
                    "Icon Horse 暂时不可用，请稍后重试",
                    503,
                )
            if response.status_code != 200:
                raise _candidate_invalid("Icon Horse 未返回可用 Logo，请改用手工上传")

            content_type = response.headers.get("content-type", "").split(";", 1)[0].casefold()
            if content_type not in _ALLOWED_CONTENT_TYPES:
                raise _candidate_invalid("候选不是支持的 PNG、JPEG、WebP 或 ICO")
            content_length = response.headers.get("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > MAX_LOGO_BYTES:
                        raise _candidate_invalid("候选文件超过 2 MiB，请改用手工上传")
                except ValueError as error:
                    raise _candidate_invalid("Icon Horse 返回了无效的文件长度") from error

            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if monotonic() - started_at > MAX_LOGO_DOWNLOAD_SECONDS:
                    raise AppError(
                        "LOGO_DISCOVERY_UNAVAILABLE",
                        "Icon Horse 下载超时，请稍后重试",
                        503,
                    )
                if len(data) > MAX_LOGO_BYTES:
                    raise _candidate_invalid("候选文件超过 2 MiB，请改用手工上传")
    except AppError:
        raise
    except httpx.RequestError as error:
        raise AppError(
            "LOGO_DISCOVERY_UNAVAILABLE",
            "Icon Horse 网络请求失败，请稍后重试",
            503,
        ) from error

    try:
        with Image.open(BytesIO(data)) as image:
            image_format = image.format or ""
            width, height = image.size
            if image_format not in _IMAGE_FORMATS:
                raise _candidate_invalid("候选不是支持的 PNG、JPEG、WebP 或 ICO")
            if width <= 0 or height <= 0 or width * height > MAX_LOGO_PIXELS:
                raise _candidate_invalid("候选图片尺寸无效或像素数量过大")
            image.verify()
    except AppError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise _candidate_invalid("候选图片内容损坏，请改用手工上传") from error

    canonical_type, suffix = _IMAGE_FORMATS[image_format]
    return bytes(data), canonical_type, suffix


def _mark_candidate_failed(db: Session, file_id: uuid.UUID) -> None:
    """把已持久化但未成功写入对象存储的候选交给下一轮清理。"""
    db.rollback()
    file = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
    if file is not None and file.status == "PENDING":
        file.status = "FAILED"
        db.commit()


def create_platform_logo_candidate(
    *,
    db: Session,
    website_url: str,
    actor: User,
    request_id: str,
    client: httpx.Client | None = None,
    storage: EvidenceStorage | None = None,
) -> PlatformLogoCandidate:
    """下载并校验 Icon Horse 的单一候选，再暂存为 24 小时可确认文件。"""
    parsed_url = httpx.URL(website_url)
    if parsed_url.host is None:
        raise AppError("VALIDATION_ERROR", "平台官网地址缺少有效主机名", 422)
    hostname = normalize_platform_domain(parsed_url.host.removesuffix("."))
    data, content_type, suffix = _download_candidate(hostname, client=client)
    digest = hashlib.sha256(data).hexdigest()
    now = datetime.now(UTC)
    file_id = uuid.uuid4()
    object_key = (
        f"{settings.environment}/platform_logo/{now.year}/{now.month:02d}/"
        f"{file_id}{suffix}"
    )
    file = FileRecord(
        id=file_id,
        category="PLATFORM_LOGO",
        original_filename=f"{hostname}{suffix}",
        object_key=object_key,
        content_type=content_type,
        size=len(data),
        sha256=digest,
        access_level="PUBLIC",
        status="PENDING",
        uploader_id=actor.id,
        upload_expires_at=now + timedelta(seconds=settings.upload_intent_ttl_seconds),
    )
    db.add(file)
    db.commit()

    object_storage = storage or get_evidence_storage()
    try:
        object_storage.put(
            object_key,
            data,
            content_type=content_type,
            sha256=digest,
        )
        metadata = object_storage.head(object_key, now + timedelta(seconds=60))
        if (
            metadata.size != len(data)
            or metadata.sha256 != digest
            or metadata.content_type != content_type
        ):
            raise StorageUnavailable("候选对象元数据与已校验内容不一致")
    except (StorageObjectMissing, StorageUnavailable) as error:
        _mark_candidate_failed(db, file_id)
        raise AppError(
            "DEPENDENCY_UNAVAILABLE",
            "对象存储暂时不可用，请稍后重试",
            503,
        ) from error

    persisted_file = db.scalar(
        select(FileRecord).where(FileRecord.id == file_id).with_for_update()
    )
    if persisted_file is None or persisted_file.status != "PENDING":
        raise AppError("FILE_INTEGRITY_FAILED", "Logo 候选文件状态异常", 409)
    verified_at = datetime.now(UTC)
    persisted_file.status = "VERIFIED"
    persisted_file.verified_at = verified_at
    persisted_file.cleanup_after = verified_at + UNCONFIRMED_RETENTION
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_logo.candidate_imported",
            target_type="FileRecord",
            target_id=persisted_file.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台官网 Logo 候选已导入",
            details={
                "facts": {
                    "provider": "ICON_HORSE",
                    "hostname": hostname,
                    "content_type": content_type,
                    "size": len(data),
                }
            },
        ),
    )
    db.commit()
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    return PlatformLogoCandidate(
        file_id=persisted_file.id,
        preview=SignedUrl(
            url=object_storage.download_url(persisted_file.object_key, expires_at),
            expires_at=expires_at,
        ),
    )


def lock_platform_logo_change(
    db: Session,
    *,
    current_file_id: uuid.UUID | None,
    logo: PlatformLogoInput | None,
) -> uuid.UUID | None:
    """按稳定顺序锁定旧、新文件，并返回可写入平台的 Logo 文件 ID。"""
    target_file_id = logo.file_id if logo is not None else None
    file_ids = sorted(
        {file_id for file_id in (current_file_id, target_file_id) if file_id is not None},
        key=str,
    )
    files = list(
        db.scalars(
            select(FileRecord)
            .where(FileRecord.id.in_(file_ids))
            .order_by(FileRecord.id)
            .with_for_update()
        )
    )
    files_by_id = {file.id: file for file in files}
    if target_file_id is None:
        return None
    target = files_by_id.get(target_file_id)
    if target is None or target.status != "VERIFIED":
        raise AppError("FILE_INTEGRITY_FAILED", "平台 Logo 必须是已校验文件", 422)
    if target.category != "PLATFORM_LOGO" or target.access_level != "PUBLIC":
        raise AppError("VALIDATION_ERROR", "平台 Logo 必须使用 PLATFORM_LOGO 类别并公开上传", 422)
    target.cleanup_after = None
    return target.id


def _platform_logo_is_referenced(db: Session, file_id: uuid.UUID) -> bool:
    """实时检查当前 head 中全部 FileRecord 外键。"""
    return any(
        db.scalar(select(func.count()).select_from(model).where(column == file_id))
        for model, column in (
            (PlatformProfile, PlatformProfile.logo_file_id),
            (PublicationAttachment, PublicationAttachment.file_id),
            (GeoObservationAttachment, GeoObservationAttachment.file_id),
        )
    )


def schedule_detached_platform_logo(
    db: Session,
    file_id: uuid.UUID | None,
    *,
    now: datetime | None = None,
) -> None:
    """最后一个引用解除后，从当前事务起保留旧 Logo 七天。"""
    if file_id is None:
        return
    file = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
    if (
        file is not None
        and file.category == "PLATFORM_LOGO"
        and file.status == "VERIFIED"
        and not _platform_logo_is_referenced(db, file_id)
    ):
        file.cleanup_after = (now or datetime.now(UTC)) + DETACHED_RETENTION


def _claim_logo_cleanup(
    db: Session,
    *,
    now: datetime,
    batch_size: int,
) -> list[tuple[uuid.UUID, str]]:
    """限批次声明无引用的到期 Logo，返回待删对象。"""
    due_files = list(
        db.scalars(
            select(FileRecord)
            .where(
                FileRecord.category == "PLATFORM_LOGO",
                or_(
                    FileRecord.status == "DELETING",
                    (
                        (FileRecord.status == "PENDING")
                        & (FileRecord.upload_expires_at <= now)
                    ),
                    FileRecord.status.in_(("FAILED", "ABORTED")),
                    (
                        (FileRecord.status == "VERIFIED")
                        & (FileRecord.cleanup_after.is_not(None))
                        & (FileRecord.cleanup_after <= now)
                    ),
                ),
            )
            .order_by(
                func.coalesce(
                    FileRecord.cleanup_after,
                    FileRecord.upload_expires_at,
                    FileRecord.created_at,
                ),
                FileRecord.id,
            )
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
    )
    claimed: list[tuple[uuid.UUID, str]] = []
    for file in due_files:
        if _platform_logo_is_referenced(db, file.id):
            if file.status == "VERIFIED":
                file.cleanup_after = None
            continue
        if file.status != "DELETING":
            file.status = "DELETING"
        claimed.append((file.id, file.object_key))
    return claimed


def cleanup_platform_logo_files(
    *,
    now: datetime | None = None,
    storage: EvidenceStorage | None = None,
    batch_size: int = LOGO_CLEANUP_BATCH_SIZE,
) -> LogoCleanupResult:
    """先提交删除声明，再幂等删除对象并保留数据库墓碑。"""
    scan_time = now or datetime.now(UTC)
    with SessionLocal.begin() as db:
        claimed = _claim_logo_cleanup(db, now=scan_time, batch_size=batch_size)

    object_storage = storage or get_evidence_storage()
    deleted = 0
    retry = 0
    for file_id, object_key in claimed:
        try:
            object_storage.delete(object_key)
        except StorageUnavailable:
            retry += 1
            logger.warning("平台 Logo 对象删除失败，保留重试 file_id=%s", file_id)
            continue
        with SessionLocal.begin() as db:
            file = db.scalar(
                select(FileRecord).where(FileRecord.id == file_id).with_for_update()
            )
            if file is None or file.status != "DELETING":
                logger.error("平台 Logo 删除状态异常 file_id=%s", file_id)
                continue
            file.status = "DELETED"
            file.deleted_at = datetime.now(UTC)
            file.cleanup_after = None
        deleted += 1

    result = LogoCleanupResult(
        selected=len(claimed),
        deleted=deleted,
        retry=retry,
        failed=len(claimed) - deleted - retry,
    )
    logger.info(
        "平台 Logo 清理完成 selected=%s deleted=%s retry=%s failed=%s",
        result.selected,
        result.deleted,
        result.retry,
        result.failed,
    )
    return result
