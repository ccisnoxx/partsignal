"""文件记录完整性相关的跨用例业务规则。"""

from __future__ import annotations

import mimetypes
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.geo_files import FileRecord
from app.models.identity import User
from app.schemas.geo_files import UploadInstruction, UploadIntent, UploadIntentCreate
from app.schemas.publication import FileRecordOut
from app.services.platform_logo_files import UNCONFIRMED_RETENTION
from app.services.storage import StorageObjectMissing, StorageUnavailable, get_evidence_storage

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
    """校验类别、类型和大小后持久化上传意图并签发直传 URL。"""
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
    authorization = get_evidence_storage().authorize_upload(
        object_key,
        expires_at,
        content_type=payload.content_type,
        sha256=payload.sha256,
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
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.FILE_MANAGEMENT,
            action="file.upload_intent_created",
            target_type="FileRecord",
            target_id=file.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="文件上传意图已创建",
            details={
                "facts": {
                    "category": file.category,
                    "size": file.size,
                    "status": file.status,
                }
            },
        ),
    )
    db.commit()
    return UploadIntent(
        file=FileRecordOut.model_validate(file),
        upload=UploadInstruction(
            method="PUT",
            url=authorization.url,
            headers=authorization.headers,
            fields={},
            expires_at=expires_at,
        ),
    )


def complete_file_upload(
    *, db: Session, file_id: uuid.UUID, actor: User, request_id: str
) -> FileRecord:
    """校验上传者与对象元数据后转换文件状态。"""
    file = db.get(FileRecord, file_id)
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
    previous_status = file.status
    file.status = "VERIFIED"
    file.verified_at = datetime.now(UTC)
    if file.category == "PLATFORM_LOGO":
        file.cleanup_after = file.verified_at + UNCONFIRMED_RETENTION
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.FILE_MANAGEMENT,
            action="file.verified",
            target_type="FileRecord",
            target_id=file.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="文件完整性校验已通过",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": file.status,
                    }
                ]
            },
        ),
    )
    db.commit()
    return file


def abort_file_upload(
    *, db: Session, file_id: uuid.UUID, actor: User, request_id: str
) -> FileRecord:
    """只允许上传意图创建者中止 PENDING 文件。"""
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != actor.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以中止上传", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以中止", 409)
    previous_status = file.status
    file.status = "ABORTED"
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.FILE_MANAGEMENT,
            action="file.aborted",
            target_type="FileRecord",
            target_id=file.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="文件上传已中止",
            details={
                "changes": [
                    {
                        "field": "status",
                        "before": previous_status,
                        "after": file.status,
                    }
                ]
            },
        ),
    )
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
