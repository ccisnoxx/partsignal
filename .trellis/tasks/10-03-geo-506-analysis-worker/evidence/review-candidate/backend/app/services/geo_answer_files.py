"""回答证据关联资格；调用方持 Run 锁并拥有整个提交事务。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.geo_files import FileRecord
from app.services.storage import (
    EvidenceStorage,
    ObjectMetadata,
    StorageIntegrityError,
    StorageObjectMissing,
    StorageUnavailable,
    get_evidence_storage,
    verify_stored_object,
)


def lock_answer_evidence_files(
    db: Session,
    *,
    uploader_id: UUID,
    screenshot_file_id: UUID | None,
    raw_payload_file_id: UUID | None,
    storage: EvidenceStorage | None = None,
) -> None:
    """稳定排序锁文件并重验归属/HEAD；无 commit、状态推进或对象写入。"""
    ids = [v for v in (screenshot_file_id, raw_payload_file_id) if v is not None]
    if len(ids) != len(set(ids)):
        raise AppError("FILE_INTEGRITY_FAILED", "截图与原始载荷不能使用同一文件", 422)
    if not ids:
        return
    files = list(
        db.scalars(
            select(FileRecord)
            .where(FileRecord.id.in_(ids))
            .order_by(FileRecord.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if len(files) != len(ids):
        raise AppError("FILE_INTEGRITY_FAILED", "原始证据文件不存在", 422)
    for file in files:
        if file.uploader_id != uploader_id:
            raise AppError("PERMISSION_DENIED", "只能关联当前提交者上传的证据文件", 403)
        screenshot = file.id == screenshot_file_id
        types = {"image/png", "image/jpeg", "image/webp"} if screenshot else {"text/plain"}
        category = "OPERATION_SCREENSHOT" if screenshot else "EVIDENCE"
        limit = 10485760 if screenshot else 52428800
        if (
            file.status != "VERIFIED"
            or file.verified_at is None
            or file.access_level not in {"INTERNAL", "RESTRICTED"}
            or file.category != category
            or file.content_type not in types
            or not 1 <= file.size <= limit
        ):
            raise AppError(
                "FILE_INTEGRITY_FAILED", "证据必须是已验证的内部文件且类别和类型正确", 422
            )
        try:
            verify_stored_object(
                storage or get_evidence_storage(),
                file.object_key,
                ObjectMetadata(
                    size=file.size,
                    sha256=file.sha256,
                    content_type=file.content_type,
                ),
            )
        except (StorageObjectMissing, StorageIntegrityError) as error:
            raise AppError(
                "FILE_INTEGRITY_FAILED", "原始证据对象缺失或完整性校验失败", 422
            ) from error
        except StorageUnavailable as error:
            raise AppError(
                "DEPENDENCY_UNAVAILABLE", "对象存储暂时不可用，请稍后重试", 503
            ) from error
        file.cleanup_after = None
