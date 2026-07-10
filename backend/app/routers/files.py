"""文件上传意图、HEAD 完成校验和限时下载接口。"""

from __future__ import annotations

import mimetypes
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.audit import append_audit
from app.config import settings
from app.deps import CsrfProtected, CurrentUser, DbSession, require_roles
from app.errors import AppError, not_found
from app.models import FileRecord, User
from app.schemas import (
    FileRecordOut,
    RoleName,
    SignedUrl,
    UploadInstruction,
    UploadIntent,
    UploadIntentCreate,
)
from app.services.storage import StorageObjectMissing, StorageUnavailable, get_evidence_storage

router = APIRouter(prefix="/api/v1", tags=["files"])
UploadUser = Annotated[
    User,
    Depends(
        require_roles(
            RoleName.PRODUCT_EDITOR,
            RoleName.CONTENT_EDITOR,
            RoleName.ANALYST,
            RoleName.SYSTEM_ADMIN,
        )
    ),
]

MAX_SIZES = {
    "EVIDENCE": 50 * 1024 * 1024,
    "OPERATION_SCREENSHOT": 10 * 1024 * 1024,
    "PUBLICATION_ASSET": 20 * 1024 * 1024,
}
ALLOWED_TYPES = {
    "EVIDENCE": {"application/pdf", "image/png", "image/jpeg", "text/plain"},
    "OPERATION_SCREENSHOT": {"image/png", "image/jpeg", "image/webp"},
    "PUBLICATION_ASSET": {"image/png", "image/jpeg", "image/webp", "application/pdf"},
}


def file_out(file: FileRecord) -> FileRecordOut:
    return FileRecordOut.model_validate(file)


def authorize_file(user: User, file: FileRecord) -> None:
    """受限文件只允许相关业务角色读取，上传者始终可读取。"""
    if file.access_level != "RESTRICTED" or file.uploader_id == user.id:
        return
    roles = {role.name for role in user.roles}
    allowed = {
        "SYSTEM_ADMIN",
        "PRODUCT_EDITOR",
        "PRODUCT_REVIEWER",
        "CONTENT_REVIEWER",
    }
    if not roles.intersection(allowed):
        raise AppError("PERMISSION_DENIED", "没有读取受限文件的权限", 403)


@router.post(
    "/files/upload-intents",
    response_model=UploadIntent,
    status_code=status.HTTP_201_CREATED,
    operation_id="createFileUploadIntent",
)
def create_upload_intent(
    payload: UploadIntentCreate,
    request: Request,
    db: DbSession,
    uploader: UploadUser,
    _csrf: CsrfProtected,
) -> UploadIntent:
    """校验类别、类型和大小后签发浏览器直传 URL。"""
    if payload.size > MAX_SIZES[payload.category]:
        raise AppError("VALIDATION_ERROR", "文件大小超过该类别限制", 422)
    if payload.content_type not in ALLOWED_TYPES[payload.category]:
        raise AppError("VALIDATION_ERROR", "文件类型不在该类别允许范围内", 422)
    suffix = Path(payload.original_filename).suffix.casefold()
    if not suffix or len(suffix) > 12:
        guessed = mimetypes.guess_extension(payload.content_type) or ""
        suffix = guessed
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
        uploader_id=uploader.id,
        upload_expires_at=expires_at,
    )
    db.add(file)
    append_audit(
        db,
        actor_id=uploader.id,
        action="file.upload_intent_created",
        target_type="FileRecord",
        target_id=file.id,
        request_id=request.state.request_id,
        details={"category": file.category, "size": file.size},
    )
    db.commit()
    return UploadIntent(
        file=file_out(file),
        upload=UploadInstruction(
            method="PUT",
            url=authorization.url,
            headers=authorization.headers,
            fields={},
            expires_at=expires_at,
        ),
    )


@router.post(
    "/files/{file_id}/complete", response_model=FileRecordOut, operation_id="completeFileUpload"
)
def complete_file_upload(
    file_id: uuid.UUID,
    request: Request,
    db: DbSession,
    uploader: UploadUser,
    _csrf: CsrfProtected,
) -> FileRecordOut:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != uploader.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以确认上传", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以确认", 409)
    head_expires = datetime.now(UTC) + timedelta(seconds=60)
    try:
        metadata = get_evidence_storage().head(file.object_key, head_expires)
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
    append_audit(
        db,
        actor_id=uploader.id,
        action="file.verified",
        target_type="FileRecord",
        target_id=file.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return file_out(file)


@router.get("/files/{file_id}", response_model=FileRecordOut, operation_id="getFileRecord")
def get_file_record(file_id: uuid.UUID, db: DbSession, user: CurrentUser) -> FileRecordOut:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    authorize_file(user, file)
    return file_out(file)


@router.post("/files/{file_id}/abort", response_model=FileRecordOut, operation_id="abortFileUpload")
def abort_file_upload(
    file_id: uuid.UUID,
    request: Request,
    db: DbSession,
    uploader: UploadUser,
    _csrf: CsrfProtected,
) -> FileRecordOut:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    if file.uploader_id != uploader.id:
        raise AppError("PERMISSION_DENIED", "只有上传意图创建者可以中止上传", 403)
    if file.status != "PENDING":
        raise AppError("INVALID_STATE_TRANSITION", "只有 PENDING 文件可以中止", 409)
    file.status = "ABORTED"
    append_audit(
        db,
        actor_id=uploader.id,
        action="file.aborted",
        target_type="FileRecord",
        target_id=file.id,
        request_id=request.state.request_id,
    )
    db.commit()
    return file_out(file)


@router.get(
    "/files/{file_id}/download-url", response_model=SignedUrl, operation_id="getFileDownloadUrl"
)
def get_file_download_url(file_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SignedUrl:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    authorize_file(user, file)
    if file.status != "VERIFIED":
        raise AppError("FILE_INTEGRITY_FAILED", "只有 VERIFIED 文件可以下载", 409)
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    return SignedUrl(
        url=get_evidence_storage().download_url(file.object_key, expires_at),
        expires_at=expires_at,
    )
