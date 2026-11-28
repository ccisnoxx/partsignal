"""Slice 1B：统一 1:N 发布台账命令、列表与既有 PublishedArticle 单向桥接。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.geo_citation_urls import normalize_citation_url
from app.models.articles import (
    Article,
    ArticlePublication,
    ArticlePublicationEvent,
    ArticleRevision,
)
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import FileRecord
from app.models.identity import User
from app.models.publication import PlatformAccount, PublicationVerification, PublicationWork
from app.schemas.articles import (
    ArticlePublicationCreateRequest,
    ArticlePublicationList,
    ArticlePublicationOut,
    ArticlePublicationRegistrationStatus,
    ArticlePublicationUpdateRequest,
    ArticlePublicationVerificationStatus,
)
from app.schemas.common import AccountType
from app.services.articles import (
    _product_labels,
    _publication_out,
    _user_names,
    article_content_hash,
)
from app.services.current_actor import current_actor_command


def _is_active_url_conflict(error: IntegrityError) -> bool:
    orig = error.orig
    return (
        getattr(orig, "sqlstate", None) == "23505"
        and getattr(getattr(orig, "diag", None), "constraint_name", None)
        == "uq_article_publications_active_url"
    )


def list_article_publications(
    db: Session,
    *,
    article_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    platform_profile_id: uuid.UUID | None = None,
    registration_status: ArticlePublicationRegistrationStatus | None = None,
    verification_status: ArticlePublicationVerificationStatus | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> ArticlePublicationList:
    query = select(ArticlePublication, Article).join(
        Article, Article.id == ArticlePublication.article_id
    )
    if article_id is not None:
        query = query.where(ArticlePublication.article_id == article_id)
    if product_id is not None:
        query = query.where(Article.product_id == product_id)
    if platform_profile_id is not None:
        query = query.where(ArticlePublication.platform_profile_id == platform_profile_id)
    if registration_status is not None:
        query = query.where(ArticlePublication.registration_status == registration_status.value)
    if verification_status is not None:
        query = query.where(ArticlePublication.verification_status == verification_status.value)
    if q and q.strip():
        pat = f"%{q.strip()}%"
        query = query.where(
            ArticlePublication.actual_title.ilike(pat)
            | ArticlePublication.final_url.ilike(pat)
            | ArticlePublication.platform_name_snapshot.ilike(pat)
        )
    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = db.execute(
        query.order_by(ArticlePublication.published_at.desc(), ArticlePublication.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    uids = {pub.registered_by for pub, _ in rows}
    pids = {art.product_id for _, art in rows}
    names = _user_names(db, uids)
    labels = _product_labels(db, pids)
    return ArticlePublicationList(
        items=[
            _publication_out(
                pub,
                user_names=names,
                article_title=art.title,
                product_id=art.product_id,
                product_label=labels.get(art.product_id),
            )
            for pub, art in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


def create_article_publication(
    db: Session,
    *,
    article_id: uuid.UUID,
    payload: ArticlePublicationCreateRequest,
    actor: User,
    request_id: str,
) -> ArticlePublicationOut:
    url_info = normalize_citation_url(payload.final_url)
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        article = db.scalar(select(Article).where(Article.id == article_id).with_for_update())
        if article is None:
            raise not_found("文章")
        latest_rev = db.scalar(
            select(ArticleRevision).where(
                ArticleRevision.article_id == article.id,
                ArticleRevision.revision_no == article.current_revision,
            )
        )
        if latest_rev is None:
            raise AppError("ARTICLE_REVISION_MISSING", "文章缺少当前版本快照", 409)
        platform_name = payload.platform_name
        platform_id = payload.platform_profile_id
        if platform_id is not None:
            profile = db.get(PlatformProfile, platform_id)
            if profile is None:
                raise not_found("发布平台")
            platform_name = profile.name
        if not platform_name:
            raise AppError("VALIDATION_ERROR", "请选择发布平台或填写平台名称", 422)
        account_label = payload.platform_account_label
        if payload.platform_account_id is not None:
            account = db.get(PlatformAccount, payload.platform_account_id)
            if account is None:
                raise not_found("平台账号")
            account_label = account.label
        if payload.screenshot_file_id is not None:
            shot = db.get(FileRecord, payload.screenshot_file_id)
            if shot is None or shot.status != "VERIFIED" or shot.category != "OPERATION_SCREENSHOT":
                raise AppError(
                    "VALIDATION_ERROR", "发布截图必须是已校验的 OPERATION_SCREENSHOT", 422
                )
        now = datetime.now(UTC)
        pub = ArticlePublication(
            article_id=article.id,
            article_revision_id=latest_rev.id,
            platform_profile_id=platform_id,
            platform_name_snapshot=platform_name,
            platform_account_id=payload.platform_account_id,
            platform_account_label_snapshot=account_label,
            actual_title=payload.actual_title,
            final_url=url_info.original_url,
            normalized_url=url_info.normalized_url,
            hostname=url_info.hostname,
            published_at=payload.published_at.astimezone(UTC),
            registration_status="REGISTERED",
            # 人工登记绝不自动等同于核验通过。
            verification_status="UNVERIFIED",
            verified_at=None,
            verified_by=None,
            screenshot_file_id=payload.screenshot_file_id,
            notes=payload.notes,
            revision=0,
            registered_by=cur.id,
            created_at=now,
            updated_at=now,
        )
        db.add(pub)
        try:
            db.flush()
        except IntegrityError as error:
            if _is_active_url_conflict(error):
                db.rollback()
                raise AppError(
                    "ARTICLE_PUBLICATION_URL_EXISTS",
                    "该发布 URL 已在活跃发布台账中登记，请勿重复登记",
                    409,
                ) from error
            raise
        if article.status in {"DRAFT", "READY"}:
            article.status = "PUBLISHED"
            article.updated_by = cur.id
            article.updated_at = now
            article.revision += 1
        db.add(
            ArticlePublicationEvent(
                article_publication_id=pub.id,
                action="REGISTERED",
                snapshot_payload={
                    "actual_title": pub.actual_title,
                    "final_url": pub.final_url,
                    "platform_name": pub.platform_name_snapshot,
                    "verification_status": pub.verification_status,
                },
                comment=payload.notes,
                actor_id=cur.id,
                created_at=now,
            )
        )
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.PUBLICATION,
                action="article_publication.registered",
                target_type="ArticlePublication",
                target_id=pub.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已登记文章发布位置（未核验）",
                details={
                    "facts": {
                        "article_id": str(article.id),
                        "hostname": pub.hostname,
                        "verification_status": pub.verification_status,
                    }
                },
            ),
        )
        db.commit()
        names = _user_names(db, {cur.id})
        labels = _product_labels(db, {article.product_id})
        return _publication_out(
            pub,
            user_names=names,
            article_title=article.title,
            product_id=article.product_id,
            product_label=labels.get(article.product_id),
        )


def update_article_publication(
    db: Session,
    *,
    publication_id: uuid.UUID,
    payload: ArticlePublicationUpdateRequest,
    actor: User,
    request_id: str,
) -> ArticlePublicationOut:
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN, AccountType.ENGINEER)) as cur:
        pub = db.scalar(
            select(ArticlePublication)
            .where(ArticlePublication.id == publication_id)
            .with_for_update()
        )
        if pub is None:
            raise not_found("文章发布记录")
        if pub.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "发布记录已被其他请求更新，请刷新后重试", 409)
        if payload.actual_title is not None:
            pub.actual_title = payload.actual_title
        if payload.notes is not None:
            pub.notes = payload.notes
        if payload.screenshot_file_id is not None:
            shot = db.get(FileRecord, payload.screenshot_file_id)
            if shot is None or shot.status != "VERIFIED" or shot.category != "OPERATION_SCREENSHOT":
                raise AppError(
                    "VALIDATION_ERROR", "发布截图必须是已校验的 OPERATION_SCREENSHOT", 422
                )
            pub.screenshot_file_id = payload.screenshot_file_id
        event_action = "UPDATED"
        audit_action = "article_publication.updated"
        if (
            payload.registration_status is not None
            and payload.registration_status.value != pub.registration_status
        ):
            pub.registration_status = payload.registration_status.value
            if pub.registration_status == "REMOVED":
                event_action = "MARKED_REMOVED"
                audit_action = "article_publication.removed"
        now = datetime.now(UTC)
        pub.updated_at = now
        pub.revision += 1
        try:
            db.flush()
        except IntegrityError as error:
            if _is_active_url_conflict(error):
                db.rollback()
                raise AppError(
                    "ARTICLE_PUBLICATION_URL_EXISTS",
                    "该发布 URL 已存在其他有效发布记录",
                    409,
                ) from error
            raise
        db.add(
            ArticlePublicationEvent(
                article_publication_id=pub.id,
                action=event_action,
                snapshot_payload={
                    "actual_title": pub.actual_title,
                    "registration_status": pub.registration_status,
                    "verification_status": pub.verification_status,
                },
                comment=payload.comment,
                actor_id=cur.id,
                created_at=now,
            )
        )
        append_audit(
            db,
            AuditEntry(
                actor_id=cur.id,
                business_module=AuditModule.PUBLICATION,
                action=audit_action,
                target_type="ArticlePublication",
                target_id=pub.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已更新文章发布台账记录",
                details={
                    "facts": {
                        "registration_status": pub.registration_status,
                        "revision": pub.revision,
                    }
                },
            ),
        )
        db.commit()
        article = db.get(Article, pub.article_id)
        names = _user_names(db, {pub.registered_by})
        labels = _product_labels(db, {article.product_id} if article else set())
        return _publication_out(
            pub,
            user_names=names,
            article_title=article.title if article else None,
            product_id=article.product_id if article else None,
            product_label=labels.get(article.product_id) if article else None,
        )


def sync_verified_publication_to_ledger(
    db: Session,
    *,
    work: PublicationWork,
    task: ContentTask,
    verification: PublicationVerification,
    actor: User,
) -> ArticlePublication:
    """在首次核验 PASSED 同事务内单向同步至统一文章与发布台账（调用方负责 commit）。"""
    assert work.actual_title and work.final_url and work.published_at
    url_info = normalize_citation_url(work.final_url)
    now = verification.created_at or datetime.now(UTC)

    article = db.scalar(select(Article).where(Article.source_content_task_id == task.id))
    version = db.get(ContentVersion, work.content_version_id)
    assert version is not None
    if article is None:
        origin = "SYSTEM_AI" if version.source_type != "HUMAN" else "HUMAN"
        article = Article(
            product_id=task.product_id,
            title=version.title,
            summary=version.summary,
            body_markdown=version.body_markdown,
            target_keywords=list(version.tags),
            origin_type=origin,
            external_model_name=None,
            status="PUBLISHED",
            current_revision=1,
            revision=0,
            owner_id=task.assignee_id or task.created_by,
            created_by=task.created_by,
            updated_by=actor.id,
            source_content_task_id=task.id,
            source_content_version_id=version.id,
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
            change_summary="来自内容任务核验发布自动同步",
            created_by=actor.id,
            created_at=now,
        )
        db.add(rev)
        db.flush()
    else:
        existing_rev = db.scalar(
            select(ArticleRevision).where(
                ArticleRevision.article_id == article.id,
                ArticleRevision.revision_no == article.current_revision,
            )
        )
        assert existing_rev is not None
        rev = existing_rev

    existing = db.scalar(
        select(ArticlePublication).where(
            (ArticlePublication.source_published_article_id == work.id)
            | (
                (ArticlePublication.normalized_url == url_info.normalized_url)
                & (ArticlePublication.registration_status == "REGISTERED")
            )
        )
    )
    if existing is not None:
        existing.verification_status = "VERIFIED"
        existing.verified_at = now
        existing.verified_by = actor.id
        existing.source_published_article_id = work.id
        existing.actual_title = work.actual_title
        existing.updated_at = now
        existing.revision += 1
        pub = existing
    else:
        pub = ArticlePublication(
            article_id=article.id,
            article_revision_id=rev.id,
            platform_profile_id=work.platform_profile_id,
            platform_name_snapshot=work.platform_profile_name_snapshot,
            platform_account_id=work.platform_account_id,
            platform_account_label_snapshot=work.platform_account_label_snapshot,
            actual_title=work.actual_title,
            final_url=url_info.original_url,
            normalized_url=url_info.normalized_url,
            hostname=url_info.hostname,
            published_at=work.published_at,
            registration_status="REGISTERED",
            verification_status="VERIFIED",
            verified_at=now,
            verified_by=actor.id,
            source_published_article_id=work.id,
            notes="",
            revision=0,
            registered_by=actor.id,
            created_at=now,
            updated_at=now,
        )
        db.add(pub)
        db.flush()
    db.add(
        ArticlePublicationEvent(
            article_publication_id=pub.id,
            action="VERIFIED_SYNCED",
            snapshot_payload={
                "source_published_article_id": str(work.id),
                "verification_id": str(verification.id),
                "final_url": pub.final_url,
            },
            comment=verification.comment or "首次核验通过同步",
            actor_id=actor.id,
            created_at=now,
        )
    )
    return pub
