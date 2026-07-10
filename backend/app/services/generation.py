"""确定性开发生成器、质量检查与 PostgreSQL 作业执行器。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError
from app.models import ContentTask, ContentVersion, FactVersion, GenerationJob, Product
from app.schemas import GeneratedDraft, ProductFactsBody, QualityIssue

logger = logging.getLogger("partsignal.worker")
PROMPT_TEMPLATE_VERSION = "development-v1"
NUMBER_PATTERN = re.compile(r"(?<![\w])[-+]?\d+(?:\.\d+)?")
URL_PATTERN = re.compile(r"https?://\S+")
TEXT_CHARACTER_PATTERN = re.compile(r"[\W_]+", re.UNICODE)
NEAR_DUPLICATE_THRESHOLD = 0.85


def number_tokens(text: str) -> set[str]:
    """归一化数字字面量，避免把 `5` 与 `5.0` 错判为不同事实。"""
    return {format(Decimal(token).normalize(), "f") for token in NUMBER_PATTERN.findall(text)}


class ContentGenerator(Protocol):
    """真实模型和开发生成器共同遵循的结构化输出边界。"""

    name: str

    def generate(self, generation_input: dict[str, Any]) -> GeneratedDraft: ...


class DevelopmentContentGenerator:
    """只重组已批准事实的确定性开发适配器，不补充任何未知参数。"""

    name = "development-deterministic"

    def generate(self, generation_input: dict[str, Any]) -> GeneratedDraft:
        facts = ProductFactsBody.model_validate(generation_input["facts"])
        task = generation_input["task"]
        product = generation_input["product"]
        approved_claims = [item for item in facts.claims if item.type == "APPROVED"]
        disclosures = [item for item in facts.claims if item.type == "REQUIRED_DISCLOSURE"]
        if not facts.parameters and not facts.replacement_relations and not approved_claims:
            raise AppError("GENERATION_FAILED", "批准事实快照没有可用于生成的事实", 422)
        sections = [
            f"# {product['part_number']}：{task['content_angle']}",
            "",
            f"目标问题：{generation_input['query_topic']['canonical_question']}",
            "",
        ]
        if facts.parameters:
            sections.extend(["## 已批准参数", ""])
            for parameter in facts.parameters:
                value = parameter.text_value
                if parameter.value_type == "NUMERIC":
                    value = f"{parameter.typical_value:g} {parameter.unit}".strip()
                elif parameter.value_type == "RANGE":
                    bounds = [
                        f"最小 {parameter.min_value:g}"
                        if parameter.min_value is not None
                        else None,
                        f"典型 {parameter.typical_value:g}"
                        if parameter.typical_value is not None
                        else None,
                        f"最大 {parameter.max_value:g}"
                        if parameter.max_value is not None
                        else None,
                    ]
                    value = "、".join(value for value in bounds if value) + f" {parameter.unit}"
                sections.append(
                    f"- {parameter.name}：{value}；测试条件：{parameter.test_conditions}"
                )
        if facts.replacement_relations:
            references = {item.client_key: item for item in facts.reference_parts}
            sections.extend(["", "## 替代边界", ""])
            for relation in facts.replacement_relations:
                reference = references[relation.reference_part_key]
                sections.append(
                    f"- 对 {reference.manufacturer} {reference.part_number} 的证据等级为 "
                    f"{relation.replacement_level.value}。适用条件：{relation.conditions}。"
                    f"排除场景：{relation.exclusions}。"
                )
        if approved_claims:
            sections.extend(["", "## 已批准说明", ""])
            sections.extend(f"- {claim.text}" for claim in approved_claims)
        if disclosures:
            sections.extend(["", "## 必要披露", ""])
            sections.extend(f"- {claim.text}" for claim in disclosures)
        sections.extend(["", f"详情：{task['canonical_url']}"])
        body = "\n".join(sections)
        title = f"{product['part_number']} {task['content_angle']}"
        question = generation_input["query_topic"]["canonical_question"]
        summary = f"围绕“{question}”整理已批准事实和替代边界。"
        used_evidence_ids = {
            key for parameter in facts.parameters for key in parameter.evidence_keys
        }
        used_evidence_ids.update(
            key for relation in facts.replacement_relations for key in relation.evidence_keys
        )
        used_evidence_ids.update(key for claim in facts.claims for key in claim.evidence_keys)
        used_fact_ids = [item.client_key for item in facts.parameters]
        used_fact_ids.extend(item.client_key for item in facts.replacement_relations)
        used_fact_ids.extend(item.client_key for item in facts.claims)
        return GeneratedDraft(
            title=title,
            summary=summary,
            body_markdown=body,
            tags=[product["part_number"], generation_input["query_topic"]["intent_type"]],
            used_fact_ids=used_fact_ids,
            used_evidence_ids=sorted(used_evidence_ids),
            required_disclosure_ids=[item.client_key for item in disclosures],
            review_warnings=[],
        )


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
            ContentTask.platform_profile_version_id == task.platform_profile_version_id,
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
    ensure_generation_eligible(
        task,
        fact,
        product,
        str(job.input_snapshot.get("fact_version_id")),
    )
    return task


def ensure_generation_eligible(
    task: ContentTask,
    fact: FactVersion | None,
    product: Product | None,
    snapshot_fact_version_id: str,
) -> None:
    """在 API 入队之外再次执行 Worker 的事实有效性不变量。"""
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "生成作业关联的内容任务不可执行", 409)
    if (
        fact is None
        or fact.status != "APPROVED"
        or product is None
        or product.status != "ACTIVE"
        or str(fact.id) != snapshot_fact_version_id
    ):
        raise AppError("FACT_NOT_APPROVED", "生成作业绑定的事实或产品已失效", 409)


def run_quality_checks(
    draft: GeneratedDraft, generation_input: dict[str, Any]
) -> list[dict[str, str]]:
    """执行确定性、可解释且不依赖模型判断的质量规则。"""
    issues: list[QualityIssue] = []
    rules = generation_input["platform_rules"]
    if not rules["title_min"] <= len(draft.title) <= rules["title_max"]:
        issues.append(
            QualityIssue(code="TITLE_LENGTH", severity="WARNING", message="标题长度不符合平台建议")
        )
    if not rules["body_min"] <= len(draft.body_markdown) <= rules["body_max"]:
        issues.append(
            QualityIssue(code="BODY_LENGTH", severity="WARNING", message="正文长度不符合平台建议")
        )
    for phrase in rules["prohibited_phrases"]:
        if phrase and phrase in draft.body_markdown:
            issues.append(
                QualityIssue(
                    code="PROHIBITED_PHRASE",
                    severity="BLOCKING",
                    message=f"正文包含平台禁用表达：{phrase}",
                )
            )
    facts = ProductFactsBody.model_validate(generation_input["facts"])
    # 正文中的独立数字必须能在已批准事实或锁定的产品/问题身份中找到。
    # URL 会包含路径编号，但它不是参数陈述，因此先从正文中移除。
    approved_text = json.dumps(
        {
            "facts": facts.model_dump(mode="json"),
            "product": generation_input["product"],
            "query_topic": generation_input["query_topic"],
        },
        ensure_ascii=False,
    )
    approved_numbers = number_tokens(approved_text)
    body_without_urls = URL_PATTERN.sub("", draft.body_markdown)
    unknown_numbers = sorted(number_tokens(body_without_urls) - approved_numbers)
    if unknown_numbers:
        issues.append(
            QualityIssue(
                code="UNKNOWN_NUMERIC_FACT",
                severity="BLOCKING",
                message=f"正文包含事实快照未批准的数字：{', '.join(unknown_numbers)}",
            )
        )
    disclosures = {
        item.client_key: item.text for item in facts.claims if item.type == "REQUIRED_DISCLOSURE"
    }
    for disclosure_id, text in disclosures.items():
        if disclosure_id not in draft.required_disclosure_ids or text not in draft.body_markdown:
            issues.append(
                QualityIssue(
                    code="REQUIRED_DISCLOSURE_MISSING",
                    severity="BLOCKING",
                    message="正文缺少事实快照要求的披露语句",
                )
            )
    known_fact_ids = {item.client_key for item in facts.parameters}
    known_fact_ids.update(item.client_key for item in facts.replacement_relations)
    known_fact_ids.update(item.client_key for item in facts.claims)
    if not set(draft.used_fact_ids).issubset(known_fact_ids):
        issues.append(
            QualityIssue(
                code="UNKNOWN_FACT_REFERENCE",
                severity="BLOCKING",
                message="生成结果引用了事实快照之外的事实",
            )
        )
    known_evidence_ids = {item.client_key for item in facts.evidences}
    if not set(draft.used_evidence_ids).issubset(known_evidence_ids):
        issues.append(
            QualityIssue(
                code="UNKNOWN_EVIDENCE_REFERENCE",
                severity="BLOCKING",
                message="生成结果引用了事实快照之外的证据",
            )
        )
    return [issue.model_dump() for issue in issues]


def process_generation_job(job_id: uuid.UUID, generator: ContentGenerator | None = None) -> None:
    """执行一个数据库作业；重复投递不会创建第二个内容版本。"""
    generator = generator or DevelopmentContentGenerator()
    with SessionLocal() as db:
        job = db.scalar(select(GenerationJob).where(GenerationJob.id == job_id).with_for_update())
        if job is None:
            logger.error("生成作业不存在 job_id=%s", job_id)
            return
        if job.status == "SUCCEEDED":
            return
        now = datetime.now(UTC)
        if job.status == "RUNNING" and job.lease_expires_at and job.lease_expires_at > now:
            return
        if job.status not in {"PENDING", "RUNNING"}:
            return
        existing = db.scalar(select(ContentVersion).where(ContentVersion.source_job_id == job.id))
        if existing is not None:
            job.status = "SUCCEEDED"
            job.content_version_id = existing.id
            job.finished_at = datetime.now(UTC)
            job.lease_expires_at = None
            db.commit()
            return
        job.status = "RUNNING"
        job.attempt_count += 1
        job.started_at = now
        job.lease_expires_at = now + timedelta(seconds=settings.generation_lease_seconds)
        db.commit()
        try:
            generation_input = job.input_snapshot
            validate_generation_context(db, job)
            db.commit()
            draft = generator.generate(generation_input)
            quality_issues = run_quality_checks(draft, generation_input)
            db.expire_all()
            job = db.get(GenerationJob, job_id)
            if job is None:
                raise AppError("GENERATION_FAILED", "生成作业不存在", 409)
            # 锁定任务后再次校验，防止模型调用期间事实被停用或并发分配相同版本号。
            task = validate_generation_context(db, job, lock_task=True)
            add_near_duplicate_warning(db, task, draft, quality_issues)
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
                fact_version_id=uuid.UUID(generation_input["fact_version_id"]),
                source_job_id=job.id,
                version=next_version,
                source_type="AI",
                title=draft.title,
                summary=draft.summary,
                body_markdown=draft.body_markdown,
                tags=draft.tags,
                used_fact_ids=draft.used_fact_ids,
                used_evidence_ids=draft.used_evidence_ids,
                required_disclosure_ids=draft.required_disclosure_ids,
                content_hash=content_hash(
                    draft.title, draft.summary, draft.body_markdown, draft.tags
                ),
                status="DRAFT",
                quality_issues=quality_issues,
                change_summary="确定性开发生成器创建的草稿",
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
            db.commit()
            logger.info("生成作业完成 job_id=%s content_version_id=%s", job.id, content.id)
        except Exception as error:
            db.rollback()
            failed = db.get(GenerationJob, job_id)
            if failed is not None:
                failed.status = "FAILED"
                failed.error_code = (
                    error.code if isinstance(error, AppError) else "GENERATION_FAILED"
                )
                failed.error_summary = str(error)[:1000]
                failed.finished_at = datetime.now(UTC)
                failed.lease_expires_at = None
                db.commit()
            logger.exception("生成作业失败 job_id=%s", job_id)
