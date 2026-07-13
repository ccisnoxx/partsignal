"""文件上传意图、HEAD 完成校验和限时下载接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, status

from app.config import settings
from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, not_found
from app.models.geo_files import FileRecord
from app.schemas.geo_files import SignedUrl, UploadIntent, UploadIntentCreate
from app.schemas.publication import FileRecordOut
from app.services.file_records import (
    abort_file_upload as abort_file_upload_command,
)
from app.services.file_records import (
    complete_file_upload as complete_file_upload_command,
)
from app.services.file_records import (
    create_upload_intent as create_upload_intent_command,
)
from app.services.storage import get_evidence_storage

router = APIRouter(prefix="/api/v1", tags=["files"])
UploadUser = EngineerUser

def file_out(file: FileRecord) -> FileRecordOut:
    return FileRecordOut.model_validate(file)


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
    return create_upload_intent_command(
        db=db, payload=payload, actor=uploader, request_id=request.state.request_id
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
    file = complete_file_upload_command(
        db=db, file_id=file_id, actor=uploader, request_id=request.state.request_id
    )
    return file_out(file)


@router.get("/files/{file_id}", response_model=FileRecordOut, operation_id="getFileRecord")
def get_file_record(file_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> FileRecordOut:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    return file_out(file)


@router.post("/files/{file_id}/abort", response_model=FileRecordOut, operation_id="abortFileUpload")
def abort_file_upload(
    file_id: uuid.UUID,
    request: Request,
    db: DbSession,
    uploader: UploadUser,
    _csrf: CsrfProtected,
) -> FileRecordOut:
    file = abort_file_upload_command(
        db=db, file_id=file_id, actor=uploader, request_id=request.state.request_id
    )
    return file_out(file)


@router.get(
    "/files/{file_id}/download-url", response_model=SignedUrl, operation_id="getFileDownloadUrl"
)
def get_file_download_url(file_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> SignedUrl:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    if file.status != "VERIFIED":
        raise AppError("FILE_INTEGRITY_FAILED", "只有 VERIFIED 文件可以下载", 409)
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.download_url_ttl_seconds)
    return SignedUrl(
        url=get_evidence_storage().download_url(file.object_key, expires_at),
        expires_at=expires_at,
    )
