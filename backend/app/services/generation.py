"""Markdown 生成门禁、内容哈希与 PostgreSQL 作业执行器。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError
from app.models.ai_generation import (
    AIChannel,
    AIModel,
    GenerationJob,
)
from app.models.content import (
    ContentTask,
    ContentVersion,
)
from app.models.product_facts import (
    FactVersion,
    Product,
)
from app.schemas.content import (
    GenerationFactSnapshot,
    GenerationSnapshot,
    HumanizationSnapshot,
    QualityIssue,
)
from app.schemas.geo_files import GeneratedDraft
from app.services.ai_configuration import (
    build_snapshot_request_headers,
    request_credentials,
    require_supported_protocol,
)
from app.services.content_lineage import resolve_content_ai_lineage
from app.services.openai_client import CompletionResult, OpenAICompatibleClient

logger = logging.getLogger("partsignal.worker")
GENERATION_CONTRACT_VERSION: Literal["content-markdown-v2"] = "content-markdown-v2"
HUMANIZATION_CONTRACT_VERSION: Literal["humanization-markdown-v2"] = "humanization-markdown-v2"
TEXT_CHARACTER_PATTERN = re.compile(r"[\W_]+", re.UNICODE)
NEAR_DUPLICATE_THRESHOLD = 0.85


def ensure_third_party_egress_allowed(
    generation_input: dict[str, Any],
) -> GenerationSnapshot:
    """第三方模型只接收明确标记为 PUBLIC 的冻结事实 Markdown。"""
    try:
        snapshot = GenerationSnapshot.model_validate(generation_input)
    except ValidationError as error:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "生成作业快照结构无效", 409) from error
    if snapshot.fact_version.classification.value != "PUBLIC":
        raise AppError(
            "AI_DATA_CLASSIFICATION_FORBIDDEN",
            "第三方模型只允许处理已明确分级为 PUBLIC 的事实版本",
            409,
        )
    return snapshot


def ensure_humanization_egress_allowed(
    humanization_input: dict[str, Any],
) -> HumanizationSnapshot:
    """自然化快照必须保留明确的 PUBLIC 事实版本依据。"""
    try:
        snapshot = HumanizationSnapshot.model_validate(humanization_input)
    except ValidationError as error:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "自然化作业快照结构无效", 409) from error
    if snapshot.fact_version.classification.value != "PUBLIC":
        raise AppError(
            "AI_DATA_CLASSIFICATION_FORBIDDEN",
            "第三方模型只允许处理已明确分级为 PUBLIC 的事实版本",
            409,
        )
    return snapshot


def ensure_generation_sources_public(fact: FactVersion) -> None:
    """在创建第三方作业前校验 PostgreSQL 事实版本分级与正文。"""
    if fact.classification != "PUBLIC":
        raise AppError(
            "AI_DATA_CLASSIFICATION_FORBIDDEN",
            "第三方模型只允许处理已明确分级为 PUBLIC 的事实版本",
            409,
        )
    if not fact.body_markdown.strip():
        raise AppError("FACT_BODY_REQUIRED", "事实版本 Markdown 不能为空白", 409)


class ContentGenerator(Protocol):
    """测试注入生成器遵循的严格结构化输出边界。"""

    def generate(self, generation_input: dict[str, Any]) -> GeneratedDraft: ...


def content_hash(title: str, summary: str, body_markdown: str, tags: list[str]) -> str:
    """对全部可发布正文数据计算稳定哈希。"""
    encoded = json.dumps(
        {"title": title, "summary": summary, "body_markdown": body_markdown, "tags": tags},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def text_similarity(left: str, right: str) -> float:
    """使用字符三元组比较中英文正文，避免分词依赖和语言偏差。"""

    def trigrams(value: str) -> set[str]:
        normalized = TEXT_CHARACTER_PATTERN.sub("", value.casefold())
        if len(normalized) < 3:
            return {normalized} if normalized else set()
        return {normalized[index : index + 3] for index in range(len(normalized) - 2)}

    left_tokens = trigrams(left)
    right_tokens = trigrams(right)
    if not left_tokens and not right_tokens:
        return 1.0
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def add_near_duplicate_warning(
    db: Session,
    task: ContentTask,
    draft: GeneratedDraft,
    issues: list[dict[str, str]],
) -> None:
    """对同产品同平台的其他任务提示近重复内容，不阻断草稿创建。"""
    candidate_text = "\n".join((draft.title, draft.summary, draft.body_markdown))
    existing_versions = db.execute(
        select(ContentVersion.title, ContentVersion.summary, ContentVersion.body_markdown)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .where(
            ContentTask.product_id == task.product_id,
            ContentTask.platform_profile_id == task.platform_profile_id,
            ContentTask.id != task.id,
        )
    ).all()
    highest_similarity = max(
        (
            text_similarity(candidate_text, "\n".join((title, summary, body_markdown)))
            for title, summary, body_markdown in existing_versions
        ),
        default=0.0,
    )
    if highest_similarity >= NEAR_DUPLICATE_THRESHOLD:
        issues.append(
            QualityIssue(
                code="NEAR_DUPLICATE_CONTENT",
                severity="WARNING",
                message=f"与同产品同平台既有内容相似度为 {highest_similarity:.0%}",
            ).model_dump()
        )


def validate_generation_context(
    db: Session, job: GenerationJob, *, lock_task: bool = False
) -> ContentTask:
    """校验作业执行时仍满足任务、事实和产品不变量。"""
    query = select(ContentTask).where(ContentTask.id == job.content_task_id)
    if lock_task:
        query = query.with_for_update()
    task = db.scalar(query)
    if task is None:
        raise AppError("INVALID_STATE_TRANSITION", "生成作业关联的内容任务不可执行", 409)
    fact = db.get(FactVersion, task.fact_version_id)
    product = db.get(Product, task.product_id)
    if job.job_type == "HUMANIZE":
        snapshot = ensure_humanization_egress_allowed(job.input_snapshot)
        ensure_generation_eligible(task, fact, product, snapshot.fact_version)
        if fact is None:
            raise AppError("FACT_NOT_APPROVED", "自然化作业绑定的事实已失效", 409)
        ensure_generation_sources_public(fact)
        source_query = select(ContentVersion).where(
            ContentVersion.id == job.source_content_version_id
        )
        if lock_task:
            source_query = source_query.with_for_update()
        source = db.scalar(source_query)
        if (
            source is None
            or source.id != snapshot.source_content.id
            or source.task_id != task.id
            or source.fact_version_id != task.fact_version_id
            or source.source_type != "AI"
            or source.status not in {"DRAFT", "CHANGES_REQUESTED"}
            or source.content_hash != snapshot.source_content.content_hash
            or source.version != snapshot.source_content.version
            or source.title != snapshot.source_content.title
            or source.summary != snapshot.source_content.summary
            or source.body_markdown != snapshot.source_content.body_markdown
            or source.tags != snapshot.source_content.tags
            or content_hash(source.title, source.summary, source.body_markdown, source.tags)
            != source.content_hash
        ):
            raise AppError("HUMANIZATION_SOURCE_INVALID", "自然化源版本已失效或发生变化", 409)
        lineage = resolve_content_ai_lineage(db, source)
        if lineage is None or lineage.generation_job.id != snapshot.source_generation_job_id:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "自然化快照的原始生成追溯不一致", 409)
        return task
    if job.job_type != "GENERATE":
        raise AppError("GENERATION_SNAPSHOT_INVALID", "AI 作业类型无效", 409)
    generation_snapshot = ensure_third_party_egress_allowed(job.input_snapshot)
    ensure_generation_eligible(task, fact, product, generation_snapshot.fact_version)
    if fact is not None:
        ensure_generation_sources_public(fact)
    return task


def ensure_generation_eligible(
    task: ContentTask,
    fact: FactVersion | None,
    product: Product | None,
    snapshot_fact: GenerationFactSnapshot,
) -> None:
    """在 API 入队之外再次执行 Worker 的事实有效性不变量。"""
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "生成作业关联的内容任务不可执行", 409)
    if (
        fact is None
        or fact.status != "APPROVED"
        or fact.product_id != task.product_id
        or product is None
        or product.status != "ACTIVE"
        or fact.id != snapshot_fact.id
        or fact.product_id != snapshot_fact.product_id
        or fact.version != snapshot_fact.version
        or fact.classification != snapshot_fact.classification.value
    ):
        raise AppError("FACT_NOT_APPROVED", "生成作业绑定的事实或产品已失效", 409)


def generate_for_job(
    db: Session,
    job: GenerationJob,
    generation_input: dict[str, Any],
    generator: ContentGenerator | None,
) -> tuple[GeneratedDraft, CompletionResult | None]:
    """按作业冻结的适配器执行，不允许重试时切换生成方式。"""
    if job.job_type == "GENERATE":
        snapshot: GenerationSnapshot | HumanizationSnapshot = ensure_third_party_egress_allowed(
            generation_input
        )
    elif job.job_type == "HUMANIZE":
        snapshot = ensure_humanization_egress_allowed(generation_input)
    else:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "AI 作业类型无效", 409)
    if generator is not None:
        return generator.generate(generation_input), None
    if snapshot.adapter_name != "openai-compatible-chat-completions":
        raise AppError("GENERATION_ADAPTER_INVALID", "生成作业适配器无效", 409)
    if job.adapter_name != snapshot.adapter_name:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "作业适配器与快照不一致", 409)
    channel = db.get(AIChannel, job.ai_channel_id) if job.ai_channel_id else None
    model = db.get(AIModel, job.ai_model_id) if job.ai_model_id else None
    if channel is None or model is None:
        raise AppError("AI_CONFIGURATION_DELETED", "作业关联的渠道或模型已删除", 409)
    if not channel.is_enabled or not model.is_enabled or model.test_status != "PASSED":
        raise AppError("AI_CONFIGURATION_DISABLED", "作业关联的渠道或模型当前不可用", 409)
    require_supported_protocol(channel.protocol_type)
    if channel.protocol_type != snapshot.adapter_name:
        raise AppError("AI_CONFIGURATION_CHANGED", "作业快照协议与当前渠道不一致", 409)
    if str(channel.id) != snapshot.channel.get("id") or str(model.id) != snapshot.model.get("id"):
        raise AppError("GENERATION_SNAPSHOT_INVALID", "作业配置引用与快照不一致", 409)
    sensitive_header_names = list(snapshot.channel.get("sensitive_header_names", []))
    api_key, current_headers = request_credentials(
        db,
        channel,
        sensitive_header_names=sensitive_header_names,
    )
    headers = build_snapshot_request_headers(
        dict(snapshot.channel.get("plain_headers", {})),
        sensitive_header_names,
        current_headers,
    )
    result = OpenAICompatibleClient(allow_local_http=settings.ai_allow_local_http).complete(
        base_url=str(snapshot.channel["base_url"]),
        api_key=api_key,
        headers=headers,
        timeout_seconds=int(snapshot.channel["timeout_seconds"]),
        model_id=str(snapshot.model["model_id"]),
        request_parameters=dict(snapshot.model["request_parameters"]),
        system_message=snapshot.system_message,
        user_message=snapshot.user_message,
    )
    return result.draft, result


def generation_timeout_seconds(
    generation_input: dict[str, Any], *, job_type: str = "GENERATE"
) -> int:
    """从不可变快照读取合法供应商超时，不使用进程级固定租约。"""
    try:
        snapshot: GenerationSnapshot | HumanizationSnapshot
        if job_type == "GENERATE":
            snapshot = GenerationSnapshot.model_validate(generation_input)
        elif job_type == "HUMANIZE":
            snapshot = HumanizationSnapshot.model_validate(generation_input)
        else:
            raise AppError("GENERATION_SNAPSHOT_INVALID", "AI 作业类型无效", 409)
    except ValidationError as error:
        raise AppError("GENERATION_SNAPSHOT_INVALID", "生成作业快照结构无效", 409) from error
    timeout_seconds = snapshot.channel.get("timeout_seconds")
    if (
        not isinstance(timeout_seconds, int)
        or isinstance(timeout_seconds, bool)
        or not 10 <= timeout_seconds <= 600
    ):
        raise AppError("GENERATION_SNAPSHOT_INVALID", "生成作业快照超时无效", 409)
    return timeout_seconds


def process_generation_job(job_id: uuid.UUID, generator: ContentGenerator | None = None) -> None:
    """执行一个数据库作业；重复投递不会创建第二个内容版本。"""
    with SessionLocal() as db:
        job = db.scalar(select(GenerationJob).where(GenerationJob.id == job_id).with_for_update())
        if job is None:
            logger.error("生成作业不存在 job_id=%s", job_id)
            return
        if job.status == "SUCCEEDED":
            return
        now = datetime.now(UTC)
        if job.status == "RUNNING":
            # Celery 重投不得触发第二次供应商调用；过期租约由 Beat 标记失败。
            return
        if job.status != "PENDING":
            return
        existing = db.scalar(select(ContentVersion).where(ContentVersion.source_job_id == job.id))
        if existing is not None:
            job.status = "SUCCEEDED"
            job.content_version_id = existing.id
            job.finished_at = datetime.now(UTC)
            job.lease_expires_at = None
            db.commit()
            return
        try:
            timeout_seconds = generation_timeout_seconds(job.input_snapshot, job_type=job.job_type)
        except AppError as error:
            job.status = "FAILED"
            job.error_code = error.code
            job.error_summary = error.message
            job.finished_at = now
            job.lease_expires_at = None
            db.commit()
            logger.error("生成作业快照无效 job_id=%s error_code=%s", job.id, error.code)
            return
        job.status = "RUNNING"
        job.attempt_count += 1
        job.started_at = now
        job.lease_expires_at = now + timedelta(
            seconds=timeout_seconds + settings.generation_finalize_grace_seconds
        )
        db.commit()
        try:
            generation_input = job.input_snapshot
            validate_generation_context(db, job)
            db.commit()
            draft, completion = generate_for_job(db, job, generation_input, generator)
            quality_issues: list[dict[str, str]] = []
            db.expire_all()
            job = db.scalar(
                select(GenerationJob).where(GenerationJob.id == job_id).with_for_update()
            )
            if job is None:
                raise AppError("GENERATION_FAILED", "生成作业不存在", 409)
            if job.status != "RUNNING":
                # 租约恢复器可能已把超时调用标记失败；迟到结果不能覆盖该终态。
                return
            # 锁定任务后再次校验，防止模型调用期间事实被停用或并发分配相同版本号。
            task = validate_generation_context(db, job, lock_task=True)
            add_near_duplicate_warning(db, task, draft, quality_issues)
            source_version_id: uuid.UUID | None = None
            change_summary = "AI 生成作业创建的草稿"
            if job.job_type == "HUMANIZE":
                humanization_snapshot = HumanizationSnapshot.model_validate(generation_input)
                source_version_id = humanization_snapshot.source_content.id
                fact_version_id = humanization_snapshot.fact_version.id
                change_summary = "AI 自然化作业创建的草稿"
            else:
                generation_snapshot = GenerationSnapshot.model_validate(generation_input)
                fact_version_id = generation_snapshot.fact_version.id
            next_version = (
                int(
                    db.scalar(
                        select(func.coalesce(func.max(ContentVersion.version), 0)).where(
                            ContentVersion.task_id == job.content_task_id
                        )
                    )
                    or 0
                )
                + 1
            )
            content = ContentVersion(
                task_id=job.content_task_id,
                fact_version_id=fact_version_id,
                source_job_id=job.id,
                based_on_id=source_version_id,
                version=next_version,
                source_type="AI",
                title=draft.title,
                summary=draft.summary,
                body_markdown=draft.body_markdown,
                tags=draft.tags,
                content_hash=content_hash(
                    draft.title, draft.summary, draft.body_markdown, draft.tags
                ),
                status="DRAFT",
                quality_issues=quality_issues,
                change_summary=change_summary,
                created_by=job.created_by,
            )
            db.add(content)
            db.flush()
            job.status = "SUCCEEDED"
            job.content_version_id = content.id
            job.finished_at = datetime.now(UTC)
            job.lease_expires_at = None
            job.error_code = None
            job.error_summary = None
            if completion is not None:
                job.provider_request_id = completion.provider_request_id
                job.response_duration_ms = completion.duration_ms
                job.prompt_tokens = completion.prompt_tokens
                job.completion_tokens = completion.completion_tokens
                job.total_tokens = completion.total_tokens
            db.commit()
            logger.info(
                "AI 作业完成 job_id=%s job_type=%s source_content_version_id=%s "
                "status=SUCCEEDED content_version_id=%s provider_duration_ms=%s",
                job.id,
                job.job_type,
                job.source_content_version_id,
                content.id,
                job.response_duration_ms,
            )
        except Exception as error:
            db.rollback()
            failed = db.get(GenerationJob, job_id)
            if failed is not None:
                failed.status = "FAILED"
                failed.error_code = (
                    error.code if isinstance(error, AppError) else "GENERATION_FAILED"
                )
                failed.error_summary = (
                    error.message if isinstance(error, AppError) else "生成作业执行失败"
                )[:1000]
                failed.finished_at = datetime.now(UTC)
                failed.lease_expires_at = None
                db.commit()
            logger.error(
                "AI 作业失败 job_id=%s job_type=%s source_content_version_id=%s "
                "status=FAILED error_code=%s error_type=%s",
                job_id,
                failed.job_type if failed is not None else "UNKNOWN",
                failed.source_content_version_id if failed is not None else None,
                failed.error_code if failed is not None else "GENERATION_FAILED",
                type(error).__name__,
            )
