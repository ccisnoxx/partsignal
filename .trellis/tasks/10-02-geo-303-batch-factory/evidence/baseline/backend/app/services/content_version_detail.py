"""Content Version 只读详情的紧凑一致读投影。"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.errors import AppError, not_found
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.schemas.content import (
    ActorSummary,
    ContentVersionDetail,
    ContentVersionDetailContent,
    ContentVersionFactSummary,
    ContentVersionGenerationLineage,
    ContentVersionLineageStep,
    ContentVersionPromptSnapshot,
    GenerationSnapshot,
    HumanizationSnapshot,
    LegacyGenerationSnapshot,
    LegacyHumanizationSnapshot,
    MarkdownGenerationSnapshotV2,
)
from app.services.content_lineage import ContentAILineage, resolve_content_ai_lineage
from app.services.review import content_review_history


def _prompt_snapshot(
    snapshot: (
        LegacyGenerationSnapshot
        | MarkdownGenerationSnapshotV2
        | GenerationSnapshot
        | LegacyHumanizationSnapshot
        | HumanizationSnapshot
    ),
) -> ContentVersionPromptSnapshot:
    if isinstance(snapshot, GenerationSnapshot):
        return ContentVersionPromptSnapshot(
            kind="PLATFORM",
            id=snapshot.platform_prompt.id,
            name=snapshot.platform_prompt.name,
            revision=snapshot.platform_prompt.revision,
            template_markdown=None,
            system_message=snapshot.system_message,
            user_message=snapshot.user_message,
        )
    if isinstance(snapshot, (LegacyHumanizationSnapshot, HumanizationSnapshot)):
        return ContentVersionPromptSnapshot(
            kind="HUMANIZATION",
            id=None,
            name=None,
            revision=snapshot.humanization_prompt.revision,
            template_markdown=snapshot.humanization_prompt.template_markdown,
            system_message=snapshot.system_message,
            user_message=snapshot.user_message,
        )
    return ContentVersionPromptSnapshot(
        kind="LEGACY",
        id=None,
        name=None,
        revision=None,
        template_markdown=(
            snapshot.user_prompt_markdown
            if isinstance(snapshot, LegacyGenerationSnapshot)
            else None
        ),
        system_message=snapshot.system_message,
        user_message=snapshot.user_message,
    )


def _lineage_step(
    *,
    job_id: uuid.UUID,
    job_type: str,
    source_content_version_id: uuid.UUID | None,
    snapshot: (
        LegacyGenerationSnapshot
        | MarkdownGenerationSnapshotV2
        | GenerationSnapshot
        | LegacyHumanizationSnapshot
        | HumanizationSnapshot
    ),
) -> ContentVersionLineageStep:
    return ContentVersionLineageStep(
        job_id=job_id,
        job_type=job_type,
        source_content_version_id=source_content_version_id,
        contract_version=snapshot.contract_version,
        channel=snapshot.channel,
        model=snapshot.model,
        prompt=_prompt_snapshot(snapshot),
    )


def _generation_lineage(lineage: ContentAILineage | None) -> ContentVersionGenerationLineage | None:
    if lineage is None:
        return None
    return ContentVersionGenerationLineage(
        original_generation=_lineage_step(
            job_id=lineage.generation_job.id,
            job_type="GENERATE",
            source_content_version_id=None,
            snapshot=lineage.generation_snapshot,
        ),
        humanizations=[
            _lineage_step(
                job_id=item.job.id,
                job_type="HUMANIZE",
                source_content_version_id=item.job.source_content_version_id,
                snapshot=item.snapshot,
            )
            for item in lineage.humanizations
        ],
    )


def get_content_version_detail(db: Session, content_version_id: uuid.UUID) -> ContentVersionDetail:
    """按精确版本返回页面实际消费的只读快照。"""
    content = db.get(ContentVersion, content_version_id)
    if content is None:
        raise not_found("内容版本")
    task = db.get(ContentTask, content.task_id)
    fact = db.get(FactVersion, content.fact_version_id)
    creator = db.get(User, content.created_by)
    if (
        task is None
        or fact is None
        or creator is None
        or task.fact_version_id != fact.id
        or content.task_id != task.id
    ):
        raise AppError("CONTENT_VERSION_DETAIL_INCOMPLETE", "内容版本归属信息不完整", 409)
    try:
        lineage = resolve_content_ai_lineage(db, content)
    except AppError as error:
        raise AppError(
            "CONTENT_VERSION_DETAIL_INCOMPLETE", "内容版本生成追溯链不完整", 409
        ) from error
    timeline = content_review_history(db, content)
    result = next((item for item in reversed(timeline) if item.target_id == content.id), None)
    return ContentVersionDetail(
        content=ContentVersionDetailContent(
            id=content.id,
            task_id=content.task_id,
            fact_version_id=content.fact_version_id,
            source_job_id=content.source_job_id,
            based_on_id=content.based_on_id,
            version=content.version,
            source_type=content.source_type,
            status=content.status,
            is_current=task.current_content_version_id == content.id,
            title=content.title,
            summary=content.summary,
            body_markdown=content.body_markdown,
            tags=content.tags,
            content_hash=content.content_hash,
            change_summary=content.change_summary,
            creator=ActorSummary(
                id=creator.id,
                username=creator.username,
                display_name=creator.display_name,
            ),
            created_at=content.created_at,
            updated_at=content.updated_at,
        ),
        fact_version=ContentVersionFactSummary(
            id=fact.id,
            product_id=fact.product_id,
            version=fact.version,
            status=fact.status,
            classification=fact.classification,
        ),
        generation_lineage=_generation_lineage(lineage),
        review_result=result,
        review_timeline=timeline,
    )
