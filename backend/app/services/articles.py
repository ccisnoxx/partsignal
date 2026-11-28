"""Slice 1B：统一文章台账 CRUD、正文版本历史与产品资料附件管理。"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.articles import (
    Article,
    ArticleAiGenerationSnapshot,
    ArticlePublication,
    ArticleRevision,
)
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.articles import (
    ArticleAiGenerationSnapshotOut,
    ArticleCreateRequest,
    ArticleDetail,
    ArticleList,
    ArticleOriginType,
    ArticleOut,
    ArticlePublicationOut,
    ArticlePublicationRegistrationStatus,
    ArticlePublicationVerificationStatus,
    ArticleRevisionOut,
    ArticleStatus,
    ArticleUpdateRequest,
)
from app.schemas.common import AccountType
from app.services.current_actor import current_actor_command


def article_content_hash(title: str, summary: str, body_markdown: str) -> str:
    payload = f"{title}\n---\n{summary}\n---\n{body_markdown}".encode()
    return hashlib.sha256(payload).hexdigest()


def _user_names(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(select(User.id, User.display_name).where(User.id.in_(user_ids))).all()
    return {uid: name for uid, name in rows}


def _product_labels(db: Session, product_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(Product.id, Product.brand, Product.part_number).where(Product.id.in_(product_ids))
    ).all()
    return {pid: f"{brand} {part}" for pid, brand, part in rows}


def _publication_out(
    row: ArticlePublication,
    *,
    user_names: dict[uuid.UUID, str],
    article_title: str | None = None,
    product_id: uuid.UUID | None = None,
    product_label: str | None = None,
) -> ArticlePublicationOut:
    return ArticlePublicationOut(
        id=row.id,
        article_id=row.article_id,
        article_title=article_title,
        product_id=product_id,
        product_label=product_label,
        article_revision_id=row.article_revision_id,
        platform_profile_id=row.platform_profile_id,
        platform_name_snapshot=row.platform_name_snapshot,
        platform_account_id=row.platform_account_id,
        platform_account_label_snapshot=row.platform_account_label_snapshot,
        actual_title=row.actual_title,
        final_url=row.final_url,
        normalized_url=row.normalized_url,
        hostname=row.hostname,
        published_at=row.published_at,
        registration_status=ArticlePublicationRegistrationStatus(row.registration_status),
        verification_status=ArticlePublicationVerificationStatus(row.verification_status),
        verified_at=row.verified_at,
        verified_by=row.verified_by,
        source_published_article_id=row.source_published_article_id,
        screenshot_file_id=row.screenshot_file_id,
        notes=row.notes,
        revision=row.revision,
        registered_by=row.registered_by,
        registered_by_name=user_names.get(row.registered_by),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _article_out(
    article: Article,
    *,
    product_labels: dict[uuid.UUID, str],
    user_names: dict[uuid.UUID, str],
    pub_counts: dict[uuid.UUID, tuple[int, int]],
) -> ArticleOut:
    total_pub, verified_pub = pub_counts.get(article.id, (0, 0))
    return ArticleOut(
        id=article.id,
        product_id=article.product_id,
        product_label=product_labels.get(article.product_id, str(article.product_id)),
        parent_article_id=article.parent_article_id,
        title=article.title,
        summary=article.summary,
        body_markdown=article.body_markdown,
        target_keywords=list(article.target_keywords),
        origin_type=ArticleOriginType(article.origin_type),
        external_model_name=article.external_model_name,
        status=ArticleStatus(article.status),
        current_revision=article.current_revision,
        revision=article.revision,
        owner_id=article.owner_id,
        owner_name=user_names.get(article.owner_id, ""),
        created_by=article.created_by,
        updated_by=article.updated_by,
        source_content_task_id=article.source_content_task_id,
        source_content_version_id=article.source_content_version_id,
        publication_count=total_pub,
        verified_publication_count=verified_pub,
        created_at=article.created_at,
        updated_at=article.updated_at,
    )


def _pub_counts(db: Session, article_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    if not article_ids:
        return {}
    rows = db.execute(
        select(
            ArticlePublication.article_id,
            func.count(ArticlePublication.id).filter(
                ArticlePublication.registration_status == "REGISTERED"
            ),
            func.count(ArticlePublication.id).filter(
                ArticlePublication.registration_status == "REGISTERED",
                ArticlePublication.verification_status == "VERIFIED",
            ),
        )
        .where(ArticlePublication.article_id.in_(article_ids))
        .group_by(ArticlePublication.article_id)
    ).all()
    return {aid: (int(total), int(verified)) for aid, total, verified in rows}


def list_articles(
    db: Session,
    *,
    product_id: uuid.UUID | None = None,
    origin_type: ArticleOriginType | None = None,
    status: ArticleStatus | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> ArticleList:
    query = select(Article)
    if product_id is not None:
        query = query.where(Article.product_id == product_id)
    if origin_type is not None:
        query = query.where(Article.origin_type == origin_type.value)
    if status is not None:
        query = query.where(Article.status == status.value)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(Article.title.ilike(pattern) | Article.summary.ilike(pattern))
    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list(
        db.scalars(
            query.order_by(Article.updated_at.desc(), Article.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    pids = {r.product_id for r in rows}
    uids = {r.owner_id for r in rows}
    aids = [r.id for r in rows]
    labels = _product_labels(db, pids)
    names = _user_names(db, uids)
    counts = _pub_counts(db, aids)
    return ArticleList(
        items=[
            _article_out(r, product_labels=labels, user_names=names, pub_counts=counts)
            for r in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


def get_article_detail(db: Session, article_id: uuid.UUID) -> ArticleDetail:
    article = db.get(Article, article_id)
    if article is None:
        raise not_found("文章")
    revisions = list(
        db.scalars(
            select(ArticleRevision)
            .where(ArticleRevision.article_id == article.id)
            .order_by(ArticleRevision.revision_no.desc())
        )
    )
    publications = list(
        db.scalars(
            select(ArticlePublication)
            .where(ArticlePublication.article_id == article.id)
            .order_by(ArticlePublication.published_at.desc(), ArticlePublication.id.desc())
        )
    )
    snapshots = list(
        db.scalars(
            select(ArticleAiGenerationSnapshot)
            .where(ArticleAiGenerationSnapshot.article_id == article.id)
            .order_by(ArticleAiGenerationSnapshot.created_at.desc())
        )
    )
    uids = (
        {article.owner_id, article.created_by, article.updated_by}
        | {r.created_by for r in revisions}
        | {p.registered_by for p in publications}
    )
    names = _user_names(db, uids)
    labels = _product_labels(db, {article.product_id})
    counts = _pub_counts(db, [article.id])
    base = _article_out(article, product_labels=labels, user_names=names, pub_counts=counts)
    return ArticleDetail(
        **base.model_dump(),
        revisions=[
            ArticleRevisionOut(
                id=rev.id,
                article_id=rev.article_id,
                revision_no=rev.revision_no,
                title=rev.title,
                summary=rev.summary,
                body_markdown=rev.body_markdown,
                content_hash=rev.content_hash,
                change_summary=rev.change_summary,
                created_by=rev.created_by,
                created_by_name=names.get(rev.created_by),
                created_at=rev.created_at,
            )
            for rev in revisions
        ],
        publications=[
            _publication_out(
                pub,
                user_names=names,
                article_title=article.title,
                product_id=article.product_id,
                product_label=labels.get(article.product_id),
            )
            for pub in publications
        ],
        ai_generation_snapshots=[
            ArticleAiGenerationSnapshotOut(
                id=snap.id,
                article_revision_id=snap.article_revision_id,
                product_facts_classification="PUBLIC",
                prompt_template_version_id=snap.prompt_template_version_id,
                provider_model_snapshot=snap.provider_model_snapshot,
                cost_amount=snap.cost_amount,
                cost_currency=snap.cost_currency,
                created_by=snap.created_by,
                created_at=snap.created_at,
            )
            for snap in snapshots
        ],
    )


def create_article(
    db: Session,
    *,
    payload: ArticleCreateRequest,
    actor: User,
    request_id: str,
) -> ArticleDetail:
    if payload.origin_type == ArticleOriginType.SYSTEM_AI:
        raise AppError(
            "VALIDATION_ERROR",
            "人工录稿不得伪造 SYSTEM_AI 来源，请使用系统 AI 生稿入口",
            422,
        )
    if payload.origin_type != ArticleOriginType.EXTERNAL_AI and payload.external_model_name:
        raise AppError("VALIDATION_ERROR", "仅 EXTERNAL_AI 来源允许填写外部模型名称", 422)
    if not payload.body_markdown.strip():
        raise AppError("VALIDATION_ERROR", "文章正文不能为空", 422)
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        product = db.scalar(
            select(Product).where(Product.id == payload.product_id).with_for_update(read=True)
        )
        if product is None or product.status != "ACTIVE":
            raise not_found("有效产品")
        if payload.parent_article_id is not None:
            parent = db.get(Article, payload.parent_article_id)
            if parent is None:
                raise not_found("同源主文章")
        now = datetime.now(UTC)
        article = Article(
            product_id=product.id,
            parent_article_id=payload.parent_article_id,
            title=payload.title,
            summary=payload.summary,
            body_markdown=payload.body_markdown,
            target_keywords=list(payload.target_keywords),
            origin_type=payload.origin_type.value,
            external_model_name=payload.external_model_name,
            status=payload.status.value,
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
            change_summary=payload.change_summary or "初始录入",
            created_by=cur.id,
            created_at=now,
        )
        db.add(rev)
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.CONTENT_PRODUCTION,
                action="article.created",
                target_type="Article",
                target_id=article.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="文章已录入统一台账",
                details={
                    "facts": {
                        "origin_type": article.origin_type,
                        "status": article.status,
                        "product_id": str(article.product_id),
                    }
                },
            ),
        )
        db.commit()
    return get_article_detail(db, article.id)


def update_article(
    db: Session,
    *,
    article_id: uuid.UUID,
    payload: ArticleUpdateRequest,
    actor: User,
    request_id: str,
) -> ArticleDetail:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        article = db.scalar(select(Article).where(Article.id == article_id).with_for_update())
        if article is None:
            raise not_found("文章")
        if article.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "文章已被其他请求更新，请刷新后重试", 409)
        content_changed = False
        if payload.title is not None and payload.title != article.title:
            article.title = payload.title
            content_changed = True
        if payload.summary is not None and payload.summary != article.summary:
            article.summary = payload.summary
            content_changed = True
        if payload.body_markdown is not None:
            if not payload.body_markdown.strip():
                raise AppError("VALIDATION_ERROR", "文章正文不能为空", 422)
            if payload.body_markdown != article.body_markdown:
                article.body_markdown = payload.body_markdown
                content_changed = True
        if payload.target_keywords is not None:
            article.target_keywords = list(payload.target_keywords)
        if payload.status is not None:
            article.status = payload.status.value
        now = datetime.now(UTC)
        if content_changed:
            article.current_revision += 1
            db.add(
                ArticleRevision(
                    article_id=article.id,
                    revision_no=article.current_revision,
                    title=article.title,
                    summary=article.summary,
                    body_markdown=article.body_markdown,
                    content_hash=article_content_hash(
                        article.title, article.summary, article.body_markdown
                    ),
                    change_summary=payload.change_summary or "正文修订",
                    created_by=cur.id,
                    created_at=now,
                )
            )
        article.updated_by = cur.id
        article.updated_at = now
        article.revision += 1
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.CONTENT_PRODUCTION,
                action="article.updated",
                target_type="Article",
                target_id=article.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="文章已更新",
                details={
                    "facts": {
                        "status": article.status,
                        "current_revision": article.current_revision,
                        "revision": article.revision,
                    }
                },
            ),
        )
        db.commit()
    return get_article_detail(db, article_id)
