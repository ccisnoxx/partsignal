"""Slice 1B：基于产品 PUBLIC 资料的一键复制提示词包与系统内轻量 AI 生成草稿。"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.ai_generation import AIChannel, AIModel
from app.models.articles import Article, ArticleAiGenerationSnapshot, ArticleRevision
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.articles import (
    ArticleDetail,
    ArticleGenerateDraftRequest,
    ProductPromptCopyBundleOut,
    ProductPromptCopyBundleRequest,
)
from app.schemas.common import AccountType
from app.schemas.geo_files import GeneratedDraft
from app.services.ai_configuration import (
    build_snapshot_request_headers,
    request_credentials,
    require_supported_protocol,
)
from app.services.ai_provider import AIProvider
from app.services.articles import article_content_hash, get_article_detail
from app.services.cost_accounting import compute_frozen_ai_cost
from app.services.current_actor import current_actor_command

_DEFAULT_SYSTEM_PROMPT = (
    "你是电子元器件与工业产品的技术内容编辑。请严格依据提供的公开产品资料撰写清晰、准确、可读的"
    " Markdown 技术文章；严禁编造资料中未出现的技术参数、认证或替代承诺。"
)


def _require_public_product_material(product: Product) -> str:
    """强制 PUBLIC 外发分级门禁：严禁将 INTERNAL/RESTRICTED 或内部溯源字段外发/复制给外部模型。"""
    if product.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "已停用产品不能用于 AI 内容生成或复制", 409)
    if product.facts_classification != "PUBLIC":
        raise AppError(
            "AI_DATA_CLASSIFICATION_FORBIDDEN",
            "仅标记为 PUBLIC 的产品资料允许外发给系统 AI 或一键复制到外部 AI",
            409,
        )
    body = product.facts_body_markdown.strip()
    if not body:
        raise AppError(
            "VALIDATION_ERROR",
            "请先填写产品资料 Markdown 后再使用提示词组合或生成",
            422,
        )
    return body


def _resolve_prompt_template(
    db: Session,
    *,
    prompt_version_id: uuid.UUID | None,
    platform_profile_id: uuid.UUID | None,
) -> tuple[uuid.UUID | None, str | None, int | None, str]:
    if prompt_version_id is not None:
        version = db.get(PlatformPromptVersion, prompt_version_id)
        if version is None:
            raise not_found("提示词版本")
        prompt = db.get(PlatformPrompt, version.prompt_id)
        return (
            version.id,
            prompt.name if prompt else None,
            version.version,
            version.template_markdown,
        )
    if platform_profile_id is not None:
        profile = db.get(PlatformProfile, platform_profile_id)
        if profile is None:
            raise not_found("目标平台")
        if profile.platform_prompt_version_id is not None:
            version = db.get(PlatformPromptVersion, profile.platform_prompt_version_id)
            if version is not None:
                prompt = db.get(PlatformPrompt, version.prompt_id)
                return (
                    version.id,
                    prompt.name if prompt else profile.name,
                    version.version,
                    version.template_markdown,
                )
        if profile.platform_prompt_id is not None:
            prompt = db.get(PlatformPrompt, profile.platform_prompt_id)
            if prompt is not None:
                return None, prompt.name, None, prompt.template_markdown
    return None, None, None, _DEFAULT_SYSTEM_PROMPT


def _build_public_user_prompt(
    product: Product,
    *,
    facts_markdown: str,
    writing_goal: str,
    target_audience: str,
    target_question: str,
) -> str:
    """只组装公开产品资料与写作上下文，绝不包含 source_owner 等内部溯源字段。"""
    sections: list[str] = [
        f"## 产品标识\n- 品牌：{product.brand}\n- 型号：{product.part_number}"
        f"\n- 类别：{product.category}"
    ]
    if product.summary.strip():
        sections.append(f"## 产品简介\n{product.summary.strip()}")
    if product.datasheet_url:
        sections.append(f"## 公开数据手册链接\n{product.datasheet_url}")
    if product.facts_applicable_region:
        sections.append(f"## 适用区域\n{product.facts_applicable_region}")
    if product.facts_approved_claims_summary:
        sections.append(f"## 可公开核心卖点\n{product.facts_approved_claims_summary}")
    if product.facts_content_restrictions:
        sections.append(f"## 内容表述约束\n{product.facts_content_restrictions}")
    sections.append(f"## 产品公开资料（PUBLIC）\n{facts_markdown}")
    task_lines: list[str] = []
    if writing_goal.strip():
        task_lines.append(f"- 写作目的：{writing_goal.strip()}")
    if target_audience.strip():
        task_lines.append(f"- 目标受众：{target_audience.strip()}")
    if target_question.strip():
        task_lines.append(f"- 要回答的核心问题：{target_question.strip()}")
    if task_lines:
        sections.append("## 本次写作要求\n" + "\n".join(task_lines))
    sections.append(
        "## 合规边界\n仅使用以上公开资料中的事实；"
        "未知参数与未提及认证必须省略或说明未提供，严禁杜撰。"
    )
    return "\n\n".join(sections)


def build_product_prompt_copy_bundle(
    db: Session,
    *,
    product_id: uuid.UUID,
    payload: ProductPromptCopyBundleRequest,
) -> ProductPromptCopyBundleOut:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("产品")
    facts_markdown = _require_public_product_material(product)
    _, prompt_name, prompt_ver, system_prompt = _resolve_prompt_template(
        db,
        prompt_version_id=payload.platform_prompt_version_id,
        platform_profile_id=payload.platform_profile_id,
    )
    user_prompt = _build_public_user_prompt(
        product,
        facts_markdown=facts_markdown,
        writing_goal=payload.writing_goal,
        target_audience=payload.target_audience,
        target_question=payload.target_question,
    )
    combined = (
        f"# 写作指令（System）\n\n{system_prompt}\n\n---\n\n"
        f"# 产品公开资料与写作任务（User）\n\n{user_prompt}"
    )
    return ProductPromptCopyBundleOut(
        product_id=product.id,
        product_label=f"{product.brand} {product.part_number}",
        facts_classification="PUBLIC",
        prompt_template_name=prompt_name,
        prompt_version_number=prompt_ver,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        combined_copy_text=combined,
    )


def generate_article_draft_from_product(
    db: Session,
    *,
    payload: ArticleGenerateDraftRequest,
    actor: User,
    idempotency_key: str,
    request_id: str,
    provider: AIProvider | None = None,
) -> ArticleDetail:
    """基于产品 PUBLIC 工作区资料直接调用系统 AI 生成草稿并自动冻结后台追溯快照。"""
    existing_snap = db.scalar(
        select(ArticleAiGenerationSnapshot).where(
            ArticleAiGenerationSnapshot.idempotency_key == idempotency_key
        )
    )
    if existing_snap is not None:
        return get_article_detail(db, existing_snap.article_id)

    product = db.get(Product, payload.product_id)
    if product is None:
        raise not_found("产品")
    facts_markdown = _require_public_product_material(product)
    prompt_ver_id, _, _, system_prompt = _resolve_prompt_template(
        db,
        prompt_version_id=payload.platform_prompt_version_id,
        platform_profile_id=payload.platform_profile_id,
    )
    model = db.get(AIModel, payload.ai_model_id)
    if model is None:
        raise not_found("AI 模型")
    channel = db.get(AIChannel, model.channel_id)
    if (
        channel is None
        or not channel.is_enabled
        or not model.is_enabled
        or model.test_status != "PASSED"
    ):
        raise AppError("AI_CONFIGURATION_DISABLED", "所选 AI 渠道或模型当前未启用或未通过测试", 409)
    require_supported_protocol(channel.protocol_type)

    user_prompt = (
        _build_public_user_prompt(
            product,
            facts_markdown=facts_markdown,
            writing_goal=payload.writing_goal,
            target_audience=payload.target_audience,
            target_question=payload.target_question,
        )
        + "\n\n请仅输出单个 JSON 对象，包含字段："
        '{"title": "...", "summary": "...", "body_markdown": "...", "tags": ["..."]}。'
    )

    api_key, current_headers = request_credentials(db, channel, sensitive_header_names=None)
    headers = build_snapshot_request_headers({}, [], current_headers)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    client = provider or AIProvider(allow_local_http=settings.ai_allow_local_http)
    completion = client.chat_completion(
        base_url=channel.base_url,
        api_key=api_key,
        headers=headers,
        timeout_seconds=channel.timeout_seconds,
        model_id=model.model_id,
        request_parameters=dict(model.request_parameters),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    try:
        parsed_raw = json.loads(completion.content)
        draft = GeneratedDraft.model_validate(parsed_raw)
    except (json.JSONDecodeError, ValidationError):
        raise AppError(
            "AI_RESPONSE_INVALID", "模型响应不符合严格四字段 JSON 草稿格式", 502
        ) from None

    cost_amount, cost_currency = compute_frozen_ai_cost(
        model,
        prompt_tokens=completion.prompt_tokens,
        completion_tokens=completion.completion_tokens,
    )
    keywords = list(dict.fromkeys([*payload.target_keywords, *draft.tags]))[:50]

    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        replay = db.scalar(
            select(ArticleAiGenerationSnapshot).where(
                ArticleAiGenerationSnapshot.idempotency_key == idempotency_key
            )
        )
        if replay is not None:
            db.rollback()
            return get_article_detail(db, replay.article_id)
        now = datetime.now(UTC)
        article = Article(
            product_id=product.id,
            title=draft.title.strip(),
            summary=draft.summary.strip(),
            body_markdown=draft.body_markdown,
            target_keywords=keywords,
            origin_type="SYSTEM_AI",
            external_model_name=None,
            status="DRAFT",
            current_revision=1,
            revision=0,
            owner_id=cur.id,
            created_by=cur.id,
            updated_by=cur.id,
            created_at=now,
            updated_at=now,
        )
        db.add(article)
        db.flush()
        rev = ArticleRevision(
            article_id=article.id,
            revision_no=1,
            title=article.title,
            summary=article.summary,
            body_markdown=article.body_markdown,
            content_hash=article_content_hash(
                article.title, article.summary, article.body_markdown
            ),
            change_summary="系统 AI 基于 PUBLIC 产品资料生成草稿",
            created_by=cur.id,
            created_at=now,
        )
        db.add(rev)
        db.flush()
        snap = ArticleAiGenerationSnapshot(
            article_id=article.id,
            article_revision_id=rev.id,
            product_id=product.id,
            idempotency_key=idempotency_key,
            product_facts_classification="PUBLIC",
            product_facts_markdown_snapshot=facts_markdown,
            prompt_template_version_id=prompt_ver_id,
            rendered_messages_snapshot=messages,
            ai_channel_id=channel.id,
            ai_model_id=model.id,
            provider_model_snapshot=model.model_id,
            cost_amount=cost_amount,
            cost_currency=cost_currency,
            created_by=cur.id,
            created_at=now,
        )
        db.add(snap)
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.CONTENT_PRODUCTION,
                action="article.ai_draft_generated",
                target_type="Article",
                target_id=article.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已通过系统 AI 生成轻量文章草稿并保存追溯快照",
                details={
                    "facts": {
                        "product_id": str(product.id),
                        "model_id": model.model_id,
                        "snapshot_id": str(snap.id),
                    }
                },
            ),
        )
        db.commit()
        article_id = article.id
    return get_article_detail(db, article_id)
