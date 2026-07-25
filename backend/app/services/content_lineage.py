"""解析不可变内容版本链上的原始生成与自然化作业。"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.ai_generation import GenerationJob
from app.models.content import ContentVersion
from app.schemas.content import (
    GenerationSnapshot,
    HumanizationSnapshot,
    LegacyGenerationSnapshot,
    LegacyHumanizationSnapshot,
)

GenerationSnapshotRead = LegacyGenerationSnapshot | GenerationSnapshot
HumanizationSnapshotRead = LegacyHumanizationSnapshot | HumanizationSnapshot


@dataclass(frozen=True)
class HumanizationLineageItem:
    """版本链中的一次自然化作业及其严格快照。"""

    job: GenerationJob
    snapshot: HumanizationSnapshotRead


@dataclass(frozen=True)
class ContentAILineage:
    """一个内容版本可追溯到的完整 AI 调用链。"""

    generation_job: GenerationJob
    generation_snapshot: GenerationSnapshotRead
    humanizations: tuple[HumanizationLineageItem, ...]


def resolve_content_ai_lineage(db: Session, content: ContentVersion) -> ContentAILineage | None:
    """沿 `based_on_id` 解析 AI 调用链；纯人工链返回空。"""
    current = content
    visited: set[object] = set()
    generation_job: GenerationJob | None = None
    generation_snapshot: GenerationSnapshotRead | None = None
    humanizations: list[HumanizationLineageItem] = []
    while True:
        if current.id in visited:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "内容修订链存在循环", 409)
        visited.add(current.id)
        if current.task_id != content.task_id or current.fact_version_id != content.fact_version_id:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "内容修订链跨越了任务或事实版本", 409)
        if current.source_job_id is not None:
            job = db.get(GenerationJob, current.source_job_id)
            if job is None or job.content_task_id != content.task_id:
                raise AppError("GENERATION_SNAPSHOT_INVALID", "内容源作业不存在或任务不一致", 409)
            try:
                if job.job_type == "GENERATE":
                    if generation_job is not None or job.source_content_version_id is not None:
                        raise AppError(
                            "GENERATION_SNAPSHOT_INVALID", "内容链包含无效的原始生成作业", 409
                        )
                    contract_version = job.input_snapshot.get("contract_version")
                    if contract_version == "chat-json-v1":
                        generation_snapshot = LegacyGenerationSnapshot.model_validate(
                            job.input_snapshot
                        )
                    elif contract_version == "content-markdown-v2":
                        generation_snapshot = GenerationSnapshot.model_validate(job.input_snapshot)
                    else:
                        raise AppError(
                            "GENERATION_SNAPSHOT_INVALID", "原始生成快照版本不受支持", 409
                        )
                    generation_job = job
                elif job.job_type == "HUMANIZE":
                    contract_version = job.input_snapshot.get("contract_version")
                    if contract_version == "humanization-json-v1":
                        snapshot: HumanizationSnapshotRead = (
                            LegacyHumanizationSnapshot.model_validate(job.input_snapshot)
                        )
                    elif contract_version == "humanization-markdown-v2":
                        snapshot = HumanizationSnapshot.model_validate(job.input_snapshot)
                    else:
                        raise AppError("GENERATION_SNAPSHOT_INVALID", "自然化快照版本不受支持", 409)
                    if (
                        current.based_on_id is None
                        or job.source_content_version_id != current.based_on_id
                        or snapshot.source_content.id != current.based_on_id
                    ):
                        raise AppError(
                            "GENERATION_SNAPSHOT_INVALID", "自然化作业与内容修订来源不一致", 409
                        )
                    humanizations.append(HumanizationLineageItem(job=job, snapshot=snapshot))
                else:
                    raise AppError("GENERATION_SNAPSHOT_INVALID", "内容源作业类型无效", 409)
            except ValidationError as error:
                raise AppError(
                    "GENERATION_SNAPSHOT_INVALID", "内容源作业快照结构无效", 409
                ) from error
        if current.based_on_id is None:
            break
        parent = db.get(ContentVersion, current.based_on_id)
        if parent is None:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "内容修订链不完整", 409)
        current = parent
    if generation_job is None and generation_snapshot is None and not humanizations:
        return None
    if generation_job is None or generation_snapshot is None:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "内容版本缺少原始生成快照", 409)
    humanizations.reverse()
    return ContentAILineage(
        generation_job=generation_job,
        generation_snapshot=generation_snapshot,
        humanizations=tuple(humanizations),
    )
