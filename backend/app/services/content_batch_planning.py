"""Slice 2C：批量内容任务规划矩阵（REPEATABLE READ 预览与全量原子幂等提交）。"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignPlatform,
    ContentCampaignProduct,
    ContentCampaignTopic,
)
from app.models.configuration import PlatformProfile, QueryTopic
from app.models.content import ContentTask, ContentTaskBatchRequest
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
)
from app.schemas.common import AccountType
from app.schemas.content import ContentTaskTarget
from app.schemas.content_batch import (
    ContentTaskBatchCellInput,
    ContentTaskBatchCreateRequest,
    ContentTaskBatchCreateResponse,
    ContentTaskBatchDiagnostic,
    ContentTaskBatchPreviewCell,
    ContentTaskBatchPreviewRequest,
    ContentTaskBatchPreviewResponse,
)
from app.services.content_planning import add_locked_content_task
from app.services.current_actor import current_actor_command
from app.services.product_facts import db_utc_now
from app.services.projections import content_tasks_out

_RECENT_PUBLISHED_WINDOW_DAYS = 30


def _normalize_angle(angle: str) -> str:
    """规范化内容角度用于同批次重复判定。"""
    return " ".join(angle.strip().split()).casefold()


def _sha256_hex(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _batch_request_sha256(
    campaign_id: uuid.UUID | None,
    cells: list[ContentTaskBatchCellInput],
) -> str:
    """计算规范化批量创建载荷摘要（不含 acknowledge_warnings）。"""
    canonical = {
        "campaign_id": str(campaign_id) if campaign_id is not None else None,
        "cells": [
            {
                "product_id": str(cell.product_id),
                "query_topic_id": str(cell.query_topic_id),
                "platform_profile_id": str(cell.platform_profile_id),
                "fact_version_id": str(cell.fact_version_id) if cell.fact_version_id else None,
                "brief": cell.brief.model_dump(mode="json", exclude_none=True),
            }
            for cell in cells
        ],
    }
    return _sha256_hex(
        json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    )


def _is_batch_idempotency_integrity_error(error: IntegrityError) -> bool:
    original = error.orig
    return (
        getattr(original, "sqlstate", None) == "23505"
        and getattr(getattr(original, "diag", None), "constraint_name", None)
        == "uq_content_task_batch_requests_actor_key"
    )


def _evaluate_batch_cells(
    db: Session,
    *,
    campaign_id: uuid.UUID | None,
    cells: list[ContentTaskBatchCellInput],
    lock: bool,
) -> tuple[ContentTaskBatchPreviewResponse, dict[int, tuple[PlatformProfile, FactVersion]]]:
    """按统一规则评估所有矩阵单元格；写路径在调用方持身份锁后按全局无死锁序加锁重验。"""
    platform_ids = sorted({cell.platform_profile_id for cell in cells})
    product_ids = sorted({cell.product_id for cell in cells})
    topic_ids = sorted({cell.query_topic_id for cell in cells})
    explicit_fact_ids = sorted(
        {cell.fact_version_id for cell in cells if cell.fact_version_id is not None}
    )

    platform_stmt = select(PlatformProfile).where(PlatformProfile.id.in_(platform_ids))
    if lock:
        platform_stmt = (
            platform_stmt.order_by(PlatformProfile.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
    platforms = {row.id: row for row in db.scalars(platform_stmt)}

    product_stmt = select(Product).where(Product.id.in_(product_ids))
    if lock:
        product_stmt = (
            product_stmt.order_by(Product.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
    products = {row.id: row for row in db.scalars(product_stmt)}

    fact_filter = (FactVersion.product_id.in_(product_ids)) & (FactVersion.status == "APPROVED")
    if explicit_fact_ids:
        fact_filter = fact_filter | FactVersion.id.in_(explicit_fact_ids)
    fact_stmt = select(FactVersion).where(fact_filter)
    if lock:
        fact_stmt = (
            fact_stmt.order_by(FactVersion.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
    facts_list = list(db.scalars(fact_stmt))
    facts_by_id = {row.id: row for row in facts_list}
    latest_approved_by_product: dict[uuid.UUID, FactVersion] = {}
    for row in facts_list:
        if row.status != "APPROVED" or not row.body_markdown.strip():
            continue
        current = latest_approved_by_product.get(row.product_id)
        if current is None or row.version > current.version:
            latest_approved_by_product[row.product_id] = row

    topic_stmt = select(QueryTopic).where(QueryTopic.id.in_(topic_ids))
    if lock:
        topic_stmt = (
            topic_stmt.order_by(QueryTopic.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
    topics = {row.id: row for row in db.scalars(topic_stmt)}

    campaign: ContentCampaign | None = None
    camp_products: set[uuid.UUID] = set()
    camp_topics: set[uuid.UUID] = set()
    camp_platforms: set[uuid.UUID] = set()
    if campaign_id is not None:
        camp_stmt = select(ContentCampaign).where(ContentCampaign.id == campaign_id)
        if lock:
            camp_stmt = camp_stmt.execution_options(populate_existing=True).with_for_update(
                key_share=True
            )
        campaign = db.scalar(camp_stmt)
        if campaign is not None:
            camp_products = set(
                db.scalars(
                    select(ContentCampaignProduct.product_id).where(
                        ContentCampaignProduct.campaign_id == campaign.id
                    )
                )
            )
            camp_topics = set(
                db.scalars(
                    select(ContentCampaignTopic.query_topic_id).where(
                        ContentCampaignTopic.campaign_id == campaign.id
                    )
                )
            )
            camp_platforms = set(
                db.scalars(
                    select(ContentCampaignPlatform.platform_profile_id).where(
                        ContentCampaignPlatform.campaign_id == campaign.id
                    )
                )
            )

    db_now = db_utc_now(db)
    recent_cutoff = db_now - timedelta(days=_RECENT_PUBLISHED_WINDOW_DAYS)

    existing_active_triples: set[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = {
        (pid, tid, plid)
        for pid, tid, plid in db.execute(
            select(
                ContentTask.product_id,
                ContentTask.query_topic_id,
                ContentTask.platform_profile_id,
            )
            .where(
                ContentTask.status == "OPEN",
                ContentTask.archived_at.is_(None),
                ContentTask.product_id.in_(product_ids),
                ContentTask.query_topic_id.in_(topic_ids),
                ContentTask.platform_profile_id.in_(platform_ids),
            )
            .distinct()
        ).tuples()
        if tid is not None and plid is not None
    }

    recent_published_triples: set[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = {
        (pid, tid, plid)
        for pid, tid, plid in db.execute(
            select(
                ContentTask.product_id,
                ContentTask.query_topic_id,
                ContentTask.platform_profile_id,
            )
            .join(PublicationWork, PublicationWork.content_task_id == ContentTask.id)
            .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
            .join(
                PublicationVerification,
                PublicationVerification.id == PublishedArticle.verification_id,
            )
            .where(
                PublicationVerification.created_at >= recent_cutoff,
                ContentTask.product_id.in_(product_ids),
                ContentTask.query_topic_id.in_(topic_ids),
                ContentTask.platform_profile_id.in_(platform_ids),
            )
            .distinct()
        ).tuples()
        if tid is not None and plid is not None
    }

    seen_batch_keys: dict[tuple[uuid.UUID, uuid.UUID, str, uuid.UUID], int] = {}
    preview_cells: list[ContentTaskBatchPreviewCell] = []
    resolved_targets: dict[int, tuple[PlatformProfile, FactVersion]] = {}
    blocker_cell_count = 0
    warning_cell_count = 0

    for index, cell in enumerate(cells):
        blockers: list[ContentTaskBatchDiagnostic] = []
        warnings: list[ContentTaskBatchDiagnostic] = []

        product = products.get(cell.product_id)
        if product is None:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="PRODUCT_NOT_FOUND",
                    message="所选产品不存在",
                )
            )
        elif product.status != "ACTIVE":
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="PRODUCT_INACTIVE",
                    message=f"产品“{product.brand} {product.part_number}”已停用，不能创建新任务",
                )
            )

        resolved_fact: FactVersion | None = None
        if cell.fact_version_id is not None:
            explicit = facts_by_id.get(cell.fact_version_id)
            if explicit is None:
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="FACT_NOT_FOUND",
                        message="指定的产品事实版本不存在",
                    )
                )
            elif explicit.product_id != cell.product_id:
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="FACT_PRODUCT_MISMATCH",
                        message="指定的产品事实版本不属于所选产品",
                    )
                )
            elif explicit.status != "APPROVED" or not explicit.body_markdown.strip():
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="FACT_NOT_APPROVED",
                        message="内容任务只能绑定非空的已批准事实版本",
                    )
                )
            else:
                resolved_fact = explicit
        elif product is not None:
            latest = latest_approved_by_product.get(product.id)
            if latest is None:
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="NO_APPROVED_FACT",
                        message=(
                            f"产品“{product.brand} {product.part_number}”"
                            "缺少非空已批准事实版本"
                        ),
                    )
                )
            else:
                resolved_fact = latest

        platform = platforms.get(cell.platform_profile_id)
        if platform is None:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="PLATFORM_NOT_FOUND",
                    message="所选目标平台不存在",
                )
            )
        elif not platform.is_active:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="PLATFORM_DISABLED",
                    message=f"目标平台“{platform.name}”已停用",
                )
            )
        elif platform.platform_prompt_id is None:
            warnings.append(
                ContentTaskBatchDiagnostic(
                    severity="WARNING",
                    code="PLATFORM_MISSING_PROMPT",
                    message=f"平台“{platform.name}”尚未绑定 Prompt，创建后仅支持人工首稿",
                )
            )

        topic = topics.get(cell.query_topic_id)
        if topic is None:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="QUERY_TOPIC_NOT_FOUND",
                    message="所选目标问题主题不存在",
                )
            )
        elif not topic.is_active:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="QUERY_TOPIC_INACTIVE",
                    message=f"问题主题“{topic.canonical_question}”已停用",
                )
            )

        if campaign_id is not None:
            if campaign is None:
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="CAMPAIGN_NOT_FOUND",
                        message="所选内容活动不存在",
                    )
                )
            elif campaign.status not in {"DRAFT", "ACTIVE"}:
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="CAMPAIGN_NOT_ELIGIBLE",
                        message="仅草稿或进行中的内容活动允许批量创建关联任务",
                    )
                )
            elif (
                cell.product_id not in camp_products
                or cell.query_topic_id not in camp_topics
                or cell.platform_profile_id not in camp_platforms
            ):
                blockers.append(
                    ContentTaskBatchDiagnostic(
                        severity="BLOCKER",
                        code="CAMPAIGN_SCOPE_MISMATCH",
                        message="当前单元格的产品、问题主题或目标平台不在活动规划范围内",
                    )
                )

        batch_key = (
            cell.product_id,
            cell.query_topic_id,
            _normalize_angle(cell.brief.content_angle),
            cell.platform_profile_id,
        )
        first_index = seen_batch_keys.get(batch_key)
        if first_index is not None:
            blockers.append(
                ContentTaskBatchDiagnostic(
                    severity="BLOCKER",
                    code="DUPLICATE_IN_BATCH",
                    message=(
                        f"与第 {first_index + 1} 项的产品、问题主题、"
                        "内容角度和目标平台完全重复"
                    ),
                )
            )
        else:
            seen_batch_keys[batch_key] = index

        if (
            product is not None
            and product.next_review_at is not None
            and product.next_review_at <= db_now
        ):
            warnings.append(
                ContentTaskBatchDiagnostic(
                    severity="WARNING",
                    code="FACT_OVERDUE",
                    message=(
                        f"产品“{product.brand} {product.part_number}”事实复核已到期，"
                        "建议先复核事实新鲜度或确认后继续"
                    ),
                )
            )

        triple = (cell.product_id, cell.query_topic_id, cell.platform_profile_id)
        if triple in existing_active_triples:
            warnings.append(
                ContentTaskBatchDiagnostic(
                    severity="WARNING",
                    code="EXISTING_ACTIVE_TASK",
                    message="同产品、同问题主题与同平台已存在未归档开放任务，请确认内容角度已差异化",
                )
            )
        if triple in recent_published_triples:
            warnings.append(
                ContentTaskBatchDiagnostic(
                    severity="WARNING",
                    code="RECENT_PUBLISHED_ARTICLE",
                    message=(
                        f"同产品、同问题主题与同平台近 {_RECENT_PUBLISHED_WINDOW_DAYS} "
                        "天已有已核验发布文章，请注意避免同质化重复"
                    ),
                )
            )

        if blockers:
            status = "BLOCKED"
            blocker_cell_count += 1
        elif warnings:
            status = "WARNING"
            warning_cell_count += 1
        else:
            status = "READY"

        if not blockers and platform is not None and resolved_fact is not None:
            resolved_targets[index] = (platform, resolved_fact)

        preview_cells.append(
            ContentTaskBatchPreviewCell(
                index=index,
                product_id=cell.product_id,
                query_topic_id=cell.query_topic_id,
                platform_profile_id=cell.platform_profile_id,
                resolved_fact_version_id=resolved_fact.id if resolved_fact is not None else None,
                resolved_fact_version=resolved_fact.version if resolved_fact is not None else None,
                content_angle=cell.brief.content_angle,
                status=status,
                blockers=blockers,
                warnings=warnings,
            )
        )

    total_cells = len(cells)
    creatable_count = total_cells - blocker_cell_count
    can_commit = blocker_cell_count == 0
    requires_warning_acknowledgement = can_commit and warning_cell_count > 0

    return (
        ContentTaskBatchPreviewResponse(
            campaign_id=campaign_id,
            total_cells=total_cells,
            creatable_count=creatable_count,
            blocker_cell_count=blocker_cell_count,
            warning_cell_count=warning_cell_count,
            can_commit=can_commit,
            requires_warning_acknowledgement=requires_warning_acknowledgement,
            cells=preview_cells,
        ),
        resolved_targets,
    )


def preview_content_task_batch(
    *,
    db: Session,
    payload: ContentTaskBatchPreviewRequest,
) -> ContentTaskBatchPreviewResponse:
    """在 REPEATABLE READ 快照下返回只读批量任务规划诊断。"""
    preview, _targets = _evaluate_batch_cells(
        db,
        campaign_id=payload.campaign_id,
        cells=payload.cells,
        lock=False,
    )
    return preview


def _replay_batch_receipt(
    db: Session,
    *,
    receipt: ContentTaskBatchRequest,
    expected_sha256: str,
    can_permanently_delete: bool,
) -> ContentTaskBatchCreateResponse:
    if receipt.request_sha256 != expected_sha256:
        raise AppError("IDEMPOTENCY_CONFLICT", "批量创建幂等键已用于另一规划请求", 409)
    tasks_by_id = {
        task.id: task
        for task in db.scalars(select(ContentTask).where(ContentTask.id.in_(receipt.task_ids)))
    }
    ordered_tasks = [tasks_by_id[tid] for tid in receipt.task_ids if tid in tasks_by_id]
    return ContentTaskBatchCreateResponse(
        batch_request_id=receipt.id,
        replayed=True,
        campaign_id=receipt.campaign_id,
        created_count=len(receipt.task_ids),
        tasks=content_tasks_out(
            db,
            ordered_tasks,
            can_permanently_delete=can_permanently_delete,
        ),
    )


def create_content_task_batch(
    *,
    db: Session,
    payload: ContentTaskBatchCreateRequest,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> ContentTaskBatchCreateResponse:
    """按批量幂等键全量原子创建内容任务与不可变 Brief 快照。"""
    key_sha256 = _sha256_hex(idempotency_key)
    payload_sha256 = _batch_request_sha256(payload.campaign_id, payload.cells)

    with current_actor_command(
        db,
        actor,
        allowed=(AccountType.ADMIN, AccountType.ENGINEER),
    ) as current_actor:
        can_permanently_delete = current_actor.account_type == "ADMIN"
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"content-task-batch:{current_actor.id}:{key_sha256}"},
        )
        existing = db.scalar(
            select(ContentTaskBatchRequest).where(
                ContentTaskBatchRequest.created_by == current_actor.id,
                ContentTaskBatchRequest.request_key_sha256 == key_sha256,
            )
        )
        if existing is not None:
            return _replay_batch_receipt(
                db,
                receipt=existing,
                expected_sha256=payload_sha256,
                can_permanently_delete=can_permanently_delete,
            )

        preview, resolved_targets = _evaluate_batch_cells(
            db,
            campaign_id=payload.campaign_id,
            cells=payload.cells,
            lock=True,
        )
        if preview.blocker_cell_count > 0:
            raise AppError(
                "BATCH_PLANNING_BLOCKED",
                "批量规划存在硬阻断项，本次未创建任何内容任务",
                409,
                details={"preview": preview.model_dump(mode="json")},
            )
        if preview.warning_cell_count > 0 and not payload.acknowledge_warnings:
            raise AppError(
                "BATCH_WARNINGS_UNACKNOWLEDGED",
                "批量规划存在软告警项，请先确认告警后再提交",
                409,
                details={"preview": preview.model_dump(mode="json")},
            )

        now = db_utc_now(db)
        created_tasks: list[ContentTask] = []
        try:
            for index, cell in enumerate(payload.cells):
                profile, resolved_fact = resolved_targets[index]
                task = add_locked_content_task(
                    db=db,
                    payload=ContentTaskTarget(
                        product_id=cell.product_id,
                        fact_version_id=resolved_fact.id,
                        platform_profile_id=profile.id,
                    ),
                    profile=profile,
                    actor=current_actor,
                    idempotency_key=None,
                    query_topic_id=cell.query_topic_id,
                    campaign_id=payload.campaign_id,
                    brief=cell.brief,
                )
                created_tasks.append(task)

            receipt = ContentTaskBatchRequest(
                created_by=current_actor.id,
                request_key_sha256=key_sha256,
                request_sha256=payload_sha256,
                campaign_id=payload.campaign_id,
                task_ids=[task.id for task in created_tasks],
                created_at=now,
            )
            db.add(receipt)
            db.flush()

            facts: dict[str, object] = {
                "created_count": len(created_tasks),
                "acknowledged_warnings": payload.acknowledge_warnings,
                "warning_cell_count": preview.warning_cell_count,
            }
            if payload.campaign_id is not None:
                facts["campaign_id"] = str(payload.campaign_id)
            append_audit(
                db,
                AuditEntry(
                    actor_id=current_actor.id,
                    business_module=AuditModule.CONTENT_PLANNING,
                    action="content_task.batch_created",
                    target_type="ContentTaskBatchRequest",
                    target_id=receipt.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message=f"已批量创建 {len(created_tasks)} 个内容任务",
                    details={"facts": facts},
                ),
            )
            db.commit()
        except IntegrityError as error:
            if not _is_batch_idempotency_integrity_error(error):
                raise
            db.rollback()
            winner = db.scalar(
                select(ContentTaskBatchRequest).where(
                    ContentTaskBatchRequest.created_by == current_actor.id,
                    ContentTaskBatchRequest.request_key_sha256 == key_sha256,
                )
            )
            if winner is None:
                raise error
            return _replay_batch_receipt(
                db,
                receipt=winner,
                expected_sha256=payload_sha256,
                can_permanently_delete=can_permanently_delete,
            )

        return ContentTaskBatchCreateResponse(
            batch_request_id=receipt.id,
            replayed=False,
            campaign_id=receipt.campaign_id,
            created_count=len(created_tasks),
            tasks=content_tasks_out(
                db,
                created_tasks,
                can_permanently_delete=can_permanently_delete,
            ),
        )
