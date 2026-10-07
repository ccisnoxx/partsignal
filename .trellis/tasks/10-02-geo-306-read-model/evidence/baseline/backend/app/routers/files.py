"""文件上传意图、后端中转、HEAD 完成校验和限时下载接口。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response, status
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from app.config import settings
from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import AppError, error_responses, not_found
from app.models.geo_files import FileRecord
from app.schemas.common import SignedUrl
from app.schemas.geo_files import UploadIntent, UploadIntentCreate
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
from app.services.file_records import prepare_file_upload
from app.services.file_records import (
    upload_file_content as upload_file_content_command,
)
from app.services.storage import get_evidence_storage

router = APIRouter(prefix="/api/v1", tags=["files"])
UploadUser = EngineerUser
UPLOAD_RECEIVE_TIMEOUT_SECONDS = 120


def file_out(file: FileRecord) -> FileRecordOut:
    return FileRecordOut.model_validate(file)


@router.post(
    "/files/upload-intents",
    response_model=UploadIntent,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(401, 403, 422),
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


@router.put(
    "/files/{file_id}/content",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=error_responses(401, 403, 404, 408, 409, 413, 422, 503),
    operation_id="uploadFileContent",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            },
        }
    },
)
async def upload_file_content(
    file_id: uuid.UUID,
    request: Request,
    db: DbSession,
    uploader: UploadUser,
    _csrf: CsrfProtected,
) -> Response:
    size_limit = await run_in_threadpool(
        prepare_file_upload, db=db, file_id=file_id, actor=uploader
    )
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
    if content_type != "application/octet-stream":
        raise AppError("VALIDATION_ERROR", "传输类型必须为 application/octet-stream", 422)
    data = bytearray()
    try:
        async with asyncio.timeout(UPLOAD_RECEIVE_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(data) + len(chunk) > size_limit:
                    raise AppError("VALIDATION_ERROR", "实际文件大小超过上传意图或类别限制", 413)
                data.extend(chunk)
    except TimeoutError as error:
        raise AppError("VALIDATION_ERROR", "文件接收超过 120 秒，请重新上传", 408) from error
    except ClientDisconnect as error:
        raise AppError("FILE_INTEGRITY_FAILED", "文件传输中断，字节未完整接收", 422) from error
    await run_in_threadpool(
        upload_file_content_command,
        db=db,
        file_id=file_id,
        actor=uploader,
        data=bytes(data),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/files/{file_id}/complete",
    response_model=FileRecordOut,
    responses=error_responses(401, 403, 404, 409, 422, 503),
    operation_id="completeFileUpload",
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


@router.get(
    "/files/{file_id}",
    response_model=FileRecordOut,
    responses=error_responses(401, 403, 404, 422),
    operation_id="getFileRecord",
)
def get_file_record(file_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> FileRecordOut:
    file = db.get(FileRecord, file_id)
    if file is None:
        raise not_found("文件记录")
    return file_out(file)


@router.post(
    "/files/{file_id}/abort",
    response_model=FileRecordOut,
    responses=error_responses(401, 403, 404, 409, 422),
    operation_id="abortFileUpload",
)
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
    "/files/{file_id}/download-url",
    response_model=SignedUrl,
    responses=error_responses(401, 403, 404, 409, 422),
    operation_id="getFileDownloadUrl",
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
