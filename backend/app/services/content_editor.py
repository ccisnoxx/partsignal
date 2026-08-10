"""Content Editor 的单请求一致读模型。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.ai_generation import GenerationJob
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.content_editor import (
    ContentEditorContext,
    ContentEditorGenerationLineage,
    ContentEditorHumanizationLineage,
    ContentEditorLineage,
    ContentEditorPromptIdentity,
    ContentEditorSnapshotChannel,
    ContentEditorSnapshotModel,
)
from app.schemas.content_task_detail import ContentTaskDetailGeneration, ContentTaskDetailTask
from app.services.content_lineage import ContentAILineage, resolve_content_ai_lineage
from app.services.content_task_detail import content_task_source_out
from app.services.projections import content_diff, content_tasks_out, content_version_out


def _optional_uuid(snapshot: dict[str, Any], key: str) -> uuid.UUID | None:
    value = snapshot.get(key)
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as error:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "生成快照身份字段无效", 409) from error


def _optional_text(snapshot: dict[str, Any], key: str) -> str | None:
    value = snapshot.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise AppError("GENERATION_SNAPSHOT_INVALID", "生成快照摘要字段无效", 409)
    return value


def _snapshot_channel(snapshot: dict[str, Any]) -> ContentEditorSnapshotChannel:
    return ContentEditorSnapshotChannel(
        id=_optional_uuid(snapshot, "id"),
        name=_optional_text(snapshot, "name"),
        protocol_type=_optional_text(snapshot, "protocol_type"),
    )


def _snapshot_model(snapshot: dict[str, Any]) -> ContentEditorSnapshotModel:
    return ContentEditorSnapshotModel(
        id=_optional_uuid(snapshot, "id"),
        display_name=_optional_text(snapshot, "display_name"),
        model_id=_optional_text(snapshot, "model_id"),
    )


def _lineage_out(lineage: ContentAILineage | None) -> ContentEditorLineage | None:
    if lineage is None:
        return None
    generation = lineage.generation_snapshot
    prompt = getattr(generation, "platform_prompt", None)
    return ContentEditorLineage(
        generation=ContentEditorGenerationLineage(
            job_id=lineage.generation_job.id,
            contract_version=generation.contract_version,
            channel=_snapshot_channel(generation.channel),
            model=_snapshot_model(generation.model),
            platform_prompt=(
                ContentEditorPromptIdentity(
                    id=prompt.id,
                    name=prompt.name,
                    revision=prompt.revision,
                )
                if prompt is not None
                else None
            ),
        ),
        humanizations=[
            ContentEditorHumanizationLineage(
                job_id=item.job.id,
                source_content_version_id=item.snapshot.source_content.id,
                contract_version=item.snapshot.contract_version,
                channel=_snapshot_channel(item.snapshot.channel),
                model=_snapshot_model(item.snapshot.model),
                prompt_revision=item.snapshot.humanization_prompt.revision,
            )
            for item in lineage.humanizations
        ],
    )


def content_editor_context_out(
    db: Session,
    task_id: uuid.UUID,
    *,
    actor: User,
) -> ContentEditorContext:
    """按任务当前指针投影 Editor 首屏，禁止按版本顺序替代主线。"""
    task = db.get(ContentTask, task_id)
    if task is None:
        raise not_found("内容任务")
    task_projection = content_tasks_out(
        db,
        [task],
        can_permanently_delete=actor.account_type == "ADMIN",
    )[0]
    context = db.execute(
        select(Product, FactVersion)
        .join(FactVersion, FactVersion.product_id == Product.id)
        .where(Product.id == task.product_id, FactVersion.id == task.fact_version_id)
    ).one_or_none()
    if context is None:
        raise AppError("EDITOR_CONTEXT_INCOMPLETE", "内容编辑器绑定的产品或事实不完整", 409)
    product, fact = context
    current = (
        db.get(ContentVersion, task.current_content_version_id)
        if task.current_content_version_id is not None
        else None
    )
    if task.current_content_version_id is not None and (
        current is None
        or current.task_id != task.id
        or current.fact_version_id != task.fact_version_id
    ):
        raise AppError("EDITOR_CONTEXT_INCOMPLETE", "内容任务当前主线指针无效", 409)

    comparison = None
    if current is not None:
        comparison = (
            db.get(ContentVersion, current.based_on_id)
            if current.based_on_id is not None
            else db.scalar(
                select(ContentVersion)
                .where(
                    ContentVersion.task_id == task.id,
                    ContentVersion.version < current.version,
                )
                .order_by(ContentVersion.version.desc())
                .limit(1)
            )
        )
        if comparison is not None and comparison.task_id != task.id:
            raise AppError("EDITOR_CONTEXT_INCOMPLETE", "内容比较基线不属于当前任务", 409)

    generation = db.scalar(
        select(GenerationJob)
        .where(GenerationJob.content_task_id == task.id)
        .order_by(GenerationJob.created_at.desc(), GenerationJob.id.desc())
        .limit(1)
    )
    lineage = resolve_content_ai_lineage(db, current) if current is not None else None
    return ContentEditorContext.model_validate(
        {
            "task": {
                field: getattr(task_projection, field)
                for field in ContentTaskDetailTask.model_fields
            },
            "product": {
                "id": product.id,
                "brand": product.brand,
                "part_number": product.part_number,
                "category": product.category,
                "status": product.status,
            },
            "platform": task_projection.platform,
            "locked_fact_version": {
                "id": fact.id,
                "version": fact.version,
                "status": fact.status,
                "classification": fact.classification,
                "body_markdown": fact.body_markdown,
            },
            "current_content": content_version_out(db, current) if current is not None else None,
            "comparison_content": (
                {
                    "id": comparison.id,
                    "version": comparison.version,
                    "source_type": comparison.source_type,
                    "status": comparison.status,
                    "title": comparison.title,
                }
                if comparison is not None
                else None
            ),
            "diff": (
                content_diff(comparison, current)
                if comparison is not None and current is not None
                else None
            ),
            "latest_generation": (
                ContentTaskDetailGeneration.model_validate(generation)
                if generation is not None
                else None
            ),
            "current_lineage": _lineage_out(lineage),
            "source": content_task_source_out(db, task),
        }
    )
