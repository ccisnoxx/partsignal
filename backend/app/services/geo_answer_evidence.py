"""原始答案文件的批量完整性检查和受控签名；Run与机会共用。"""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.schemas.common import SignedUrl
from app.schemas.geo_read_models import GeoRunEvidenceFile
from app.services.geo_read_projections import incomplete
from app.services.storage import StorageUnavailable, get_evidence_storage


def answer_evidence_files(
    db: Session, answers: Sequence[GeoAnswerSnapshot], as_of: datetime
) -> dict[UUID, list[GeoRunEvidenceFile]]:
    bindings: dict[UUID, list[tuple[UUID, Literal["SCREENSHOT", "RAW_PAYLOAD"]]]] = {
        answer.id: [
            (identity, cast(Literal["SCREENSHOT", "RAW_PAYLOAD"], kind))
            for identity, kind in (
                (answer.screenshot_file_id, "SCREENSHOT"),
                (answer.raw_payload_file_id, "RAW_PAYLOAD"),
            )
            if identity is not None
        ]
        for answer in answers
    }
    ids = {identity for values in bindings.values() for identity, _ in values}
    files = {
        row.id: row
        for row in db.scalars(
            select(FileRecord)
            .where(FileRecord.id.in_(ids))
            .execution_options(populate_existing=True)
        )
    }
    if set(files) != ids:
        raise incomplete()
    expires_at = as_of + timedelta(seconds=settings.download_url_ttl_seconds)
    result: dict[UUID, list[GeoRunEvidenceFile]] = {answer.id: [] for answer in answers}
    if not ids:
        return result
    storage = get_evidence_storage()
    for answer_id, values in bindings.items():
        for identity, kind in sorted(values, key=lambda value: value[1]):
            file = files[identity]
            if (
                file.status != "VERIFIED"
                or file.verified_at is None
                or file.access_level not in {"INTERNAL", "RESTRICTED"}
            ):
                raise AppError("FILE_INTEGRITY_FAILED", "原始证据文件当前不可安全访问", 409)
            try:
                download = SignedUrl(
                    url=storage.download_url(file.object_key, expires_at), expires_at=expires_at
                )
            except StorageUnavailable as error:
                raise AppError("DEPENDENCY_UNAVAILABLE", "证据签名暂时不可用", 503) from error
            result[answer_id].append(
                GeoRunEvidenceFile(
                    id=file.id,
                    kind=kind,
                    content_type=file.content_type,
                    size=file.size,
                    sha256=file.sha256,
                    access_level=file.access_level,
                    download=download,
                )
            )
    return result
