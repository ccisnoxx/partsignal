"""文件记录完整性相关的跨用例业务规则。"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_files import FileRecord, GeoObservationAttachment
from app.models.geo_manual_collection import GeoManualDraft
from app.models.identity import User
from app.models.publication import PublicationAttachment
from app.schemas.geo_files import UploadInstruction, UploadIntent, UploadIntentCreate
from app.schemas.publication import FileRecordOut
from app.services.storage import (
    EvidenceStorage,
    StorageObjectMissing,
    StorageUnavailable,
    get_evidence_storage,
)

UNCONFIRMED_RETENTION = timedelta(hours=24)
DETACHED_RETENTION = timedelta(days=7)
FILE_CLEANUP_BATCH_SIZE = 100

logger = logging.getLogger("partsignal.worker")


@dataclass(frozen=True)
class FileCleanupResult:
    """单轮文件清理的非敏感执行结果。"""

    selected: int
    deleted: int
    retry: int
    failed: int

MAX_SIZES = {
    "EVIDENCE": 50 * 1024 * 1024,
    "OPERATION_SCREENSHOT": 10 * 1024 * 1024,
    "PUBLICATION_ASSET": 20 * 1024 * 1024,
    "PLATFORM_LOGO": 2 * 1024 * 1024,
}
ALLOWED_TYPES = {
    "EVIDENCE": {"application/pdf", "image/png", "image/jpeg", "text/plain"},
    "OPERATION_SCREENSHOT": {"image/png", "image/jpeg", "image/webp"},
    "PUBLICATION_ASSET": {"image/png", "image/jpeg", "image/webp", "application/pdf"},
    "PLATFORM_LOGO": {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
    },
}


def create_upload_intent(
    *, db: Session, payload: UploadIntentCreate, actor: User, request_id: str
) -> UploadIntent:
    """校验类别、类型和大小后持久化意图，返回应用内传输路径。"""
    if payload.size > MAX_SIZES[payload.category]:
        raise AppError("VALIDATION_ERROR", "文件大小超过该类别限制", 422)
    if payload.content_type not in ALLOWED_TYPES[payload.category]:
        raise AppError("VALIDATION_ERROR", "文件类型不在该类别允许范围内", 422)
    suffix = Path(payload.original_filename).suffix.casefold()
    if not suffix or len(suffix) > 12:
        suffix = mimetypes.guess_extension(payload.content_type) or ""
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.upload_intent_ttl_seconds)
    file_id = uuid.uuid4()
    object_key = (
        f"{settings.environment}/{payload.category.casefold()}/{now.year}/{now.month:02d}/"
        f"{file_id}{suffix}"
    )
    file = FileRecord(
        id=file_id,
        category=payload.category,
        original_filename=payload.original_filename,
        object_key=object_key,
        content_type=payload.content_type,
        size=payload.size,
        sha256=payload.sha256,
        access_level=payload.access_level.value,
        uploader_id=actor.id,
        upload_expires_at=expires_at,
    )
    db.add(file)
    db.commit()
    return UploadIntent(
        file=FileRecordOut.model_validate(file),
        upload=UploadInstruction(
            method="PUT",
            url=f"/api/v1/files/{file_id}/content",
            headers={"Content-Type": "application/octet-stream"},
            fields={},
            expires_at=expires_at,
        ),
    )


def _pending_upload(file: FileRecord | None, actor: User) -> FileRecord:
    """传输入口与写入边界共用创建者、状态和有效期守卫。"""
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != actor.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以传输文件", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以传输", 409)
    if file.upload_expires_at <= datetime.now(UTC):
        raise AppError("INVALID_STATE_TRANSITION", "上传意图已过期", 409)
    return file


def prepare_file_upload(*, db: Session, file_id: uuid.UUID, actor: User) -> int:
    """先授权，再释放认证事务；慢速接收期间不持有数据库连接或行锁。"""
    file = _pending_upload(db.get(FileRecord, file_id), actor)
    size_limit = min(file.size, MAX_SIZES[file.category])
    db.commit()
    return size_limit


def upload_file_content(
    *, db: Session, file_id: uuid.UUID, actor: User, data: bytes
) -> None:
    """持行锁复核意图、校验实际字节并写入存储，仍由 HEAD complete 确认。"""
    file = _pending_upload(
        db.scalar(
            select(FileRecord)
            .where(FileRecord.id == file_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ),
        actor,
    )
    if len(data) > min(file.size, MAX_SIZES[file.category]):
        raise AppError("VALIDATION_ERROR", "实际文件大小超过上传意图或类别限制", 413)
    if len(data) != file.size or hashlib.sha256(data).hexdigest() != file.sha256:
        raise AppError("FILE_INTEGRITY_FAILED", "实际文件大小或哈希与上传意图不一致", 422)
    try:
        # PUT 全程持有此锁，使 complete、abort 和 SKIP LOCKED 清理不能复活已删除对象。
        get_evidence_storage().put(
            file.object_key,
            data,
            content_type=file.content_type,
            sha256=file.sha256,
        )
    except StorageUnavailable as error:
        raise AppError("DEPENDENCY_UNAVAILABLE", "对象存储暂时不可用，请稍后重试", 503) from error
    db.commit()


def complete_file_upload(
    *, db: Session, file_id: uuid.UUID, actor: User, request_id: str
) -> FileRecord:
    """校验上传者与对象元数据后转换文件状态。"""
    file = db.scalar(
        select(FileRecord)
        .where(FileRecord.id == file_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != actor.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以确认上传", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以确认", 409)
    try:
        metadata = get_evidence_storage().head(
            file.object_key, datetime.now(UTC) + timedelta(seconds=60)
        )
    except StorageObjectMissing as error:
        file.status = "FAILED"
        db.commit()
        raise AppError("FILE_INTEGRITY_FAILED", "对象存储中不存在待确认文件", 422) from error
    except StorageUnavailable as error:
        raise AppError("DEPENDENCY_UNAVAILABLE", "对象存储暂时不可用，请稍后重试", 503) from error
    if (
        metadata.size != file.size
        or metadata.sha256 != file.sha256
        or metadata.content_type != file.content_type
    ):
        file.status = "FAILED"
        db.commit()
        raise AppError("FILE_INTEGRITY_FAILED", "对象大小、哈希或类型与上传意图不一致", 422)
    file.status = "VERIFIED"
    file.verified_at = datetime.now(UTC)
    if file.category == "PLATFORM_LOGO":
        file.cleanup_after = file.verified_at + UNCONFIRMED_RETENTION
    db.commit()
    return file


def abort_file_upload(
    *, db: Session, file_id: uuid.UUID, actor: User, request_id: str
) -> FileRecord:
    """只允许上传意图创建者中止 PENDING 文件。"""
    file = db.scalar(
        select(FileRecord)
        .where(FileRecord.id == file_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != actor.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以中止上传", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以中止", 409)
    file.status = "ABORTED"
    db.commit()
    return file


def verified_files(db: Session, file_ids: list[uuid.UUID]) -> list[FileRecord]:
    """返回全部已校验附件；重复、缺失或未完成校验时显式失败。"""
    if len(file_ids) != len(set(file_ids)):
        raise AppError("VALIDATION_ERROR", "附件文件 ID 重复", 422)
    files = (
        list(db.scalars(select(FileRecord).where(FileRecord.id.in_(file_ids)))) if file_ids else []
    )
    if len(files) != len(file_ids) or any(file.status != "VERIFIED" for file in files):
        raise AppError("FILE_INTEGRITY_FAILED", "附件必须全部处于 VERIFIED 状态", 422)
    return files


def file_is_referenced(db: Session, file_id: uuid.UUID) -> bool:
    """实时检查当前 Schema 中全部 FileRecord 外键。"""
    return any(
        db.scalar(select(func.count()).select_from(model).where(column == file_id))
        for model, column in (
            (PlatformProfile, PlatformProfile.logo_file_id),
            (PublicationAttachment, PublicationAttachment.file_id),
            (GeoObservationAttachment, GeoObservationAttachment.file_id),
            (GeoAnswerSnapshot, GeoAnswerSnapshot.raw_payload_file_id),
            (GeoAnswerSnapshot, GeoAnswerSnapshot.screenshot_file_id),
            (GeoManualDraft, GeoManualDraft.raw_payload_file_id),
            (GeoManualDraft, GeoManualDraft.screenshot_file_id),
        )
    )


def schedule_unreferenced_file(
    db: Session,
    file_id: uuid.UUID | None,
    *,
    cleanup_after: datetime,
) -> None:
    """仅在最后一个实际外键解除后安排已验证文件清理。"""
    if file_id is None:
        return
    file = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
    if file is not None and file.status == "VERIFIED" and not file_is_referenced(db, file_id):
        file.cleanup_after = cleanup_after


def _claim_file_cleanup(
    db: Session,
    *,
    now: datetime,
    batch_size: int,
) -> list[tuple[uuid.UUID, str]]:
    """限批次声明无引用的到期文件，返回待删对象。"""
    due_files = list(
        db.scalars(
            select(FileRecord)
            .where(
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
                )
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
        if file_is_referenced(db, file.id):
            if file.status == "VERIFIED":
                file.cleanup_after = None
            continue
        if file.status != "DELETING":
            file.status = "DELETING"
        claimed.append((file.id, file.object_key))
    return claimed


def cleanup_file_records(
    *,
    now: datetime | None = None,
    storage: EvidenceStorage | None = None,
    batch_size: int = FILE_CLEANUP_BATCH_SIZE,
) -> FileCleanupResult:
    """先提交删除声明，再幂等删除对象并保留数据库墓碑。"""
    scan_time = now or datetime.now(UTC)
    with SessionLocal.begin() as db:
        claimed = _claim_file_cleanup(db, now=scan_time, batch_size=batch_size)

    object_storage = storage or get_evidence_storage()
    deleted = 0
    retry = 0
    for file_id, object_key in claimed:
        try:
            object_storage.delete(object_key)
        except StorageUnavailable:
            retry += 1
            logger.warning("文件对象删除失败，保留重试 file_id=%s", file_id)
            continue
        with SessionLocal.begin() as db:
            file = db.scalar(
                select(FileRecord).where(FileRecord.id == file_id).with_for_update()
            )
            if file is None or file.status != "DELETING":
                logger.error("文件删除状态异常 file_id=%s", file_id)
                continue
            file.status = "DELETED"
            file.deleted_at = datetime.now(UTC)
            file.cleanup_after = None
        deleted += 1

    result = FileCleanupResult(
        selected=len(claimed),
        deleted=deleted,
        retry=retry,
        failed=len(claimed) - deleted - retry,
    )
    logger.info(
        "文件清理完成 selected=%s deleted=%s retry=%s failed=%s",
        result.selected,
        result.deleted,
        result.retry,
        result.failed,
    )
    return result
