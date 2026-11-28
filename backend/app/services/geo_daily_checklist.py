"""Slice 1C：今日待监测清单查询、CORE_BASELINE 幂等生成与单条直录/历史补录服务。"""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.articles import Article, ArticlePublication
from app.models.geo_analysis import GeoEntityMention
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_batch_creation import GeoBatchCreationRequest
from app.models.geo_catalog import GeoSubject
from app.models.geo_citation_links import GeoCitationPublicationLink
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.schemas.geo_daily_checklist import (
    GeoDailyChecklistEnsureOut,
    GeoDailyChecklistEnsureRequest,
    GeoDailyChecklistItem,
    GeoDailyChecklistOption,
    GeoDailyChecklistOut,
    GeoDailyChecklistSummary,
)
from app.schemas.geo_prompt_variants import GeoPromptCategory
from app.schemas.geo_runs import GeoRunEntryKind, GeoRunStatus
from app.services.geo_batches import freeze_batch
from app.services.geo_plan_locks import command, lock_plan


def _day_bounds(target_date: date, tz_name: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(tz_name)
    start_local = datetime.combine(target_date, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def get_daily_checklist(
    db: Session,
    *,
    target_date: date | None = None,
    tz_name: str = "Asia/Shanghai",
    assignee_id: UUID | None = None,
    status: GeoRunStatus | None = None,
    category: GeoPromptCategory | None = None,
) -> GeoDailyChecklistOut:
    """单次一致读模型返回今日待监测清单、状态摘要及前端友好下拉选项（零 UUID 录入）。"""
    tz = ZoneInfo(tz_name)
    day = target_date or datetime.now(tz).date()
    start_utc, end_utc = _day_bounds(day, tz_name)
    effective_col = func.coalesce(GeoObservationRun.collected_at, GeoObservationRun.created_at)

    query = (
        select(
            GeoObservationRun,
            GeoObservationBatch.plan_id,
            GeoMonitoringPlan.name,
            GeoPromptVariant.prompt_category,
            GeoPromptVariant.priority,
            GeoAnswerSnapshot.id,
            GeoAnswerSnapshot.query_modified,
        )
        .join(GeoObservationBatch, GeoObservationBatch.id == GeoObservationRun.batch_id)
        .outerjoin(GeoMonitoringPlan, GeoMonitoringPlan.id == GeoObservationBatch.plan_id)
        .join(GeoPromptVariant, GeoPromptVariant.id == GeoObservationRun.prompt_variant_id)
        .outerjoin(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == GeoObservationRun.id)
        .where(
            GeoObservationRun.input_snapshot["profile"]["collection_mode"].astext == "MANUAL",
            effective_col >= start_utc,
            effective_col < end_utc,
        )
        .order_by(effective_col.desc(), GeoObservationRun.id.desc())
    )
    if assignee_id is not None:
        query = query.where(GeoObservationRun.assignee_id == assignee_id)
    if status is not None:
        query = query.where(GeoObservationRun.status == status.value)
    if category is not None:
        query = query.where(GeoPromptVariant.prompt_category == category.value)

    rows = db.execute(query).all()
    run_ids = [r[0].id for r in rows]
    assignee_ids = {r[0].assignee_id for r in rows if r[0].assignee_id is not None}
    user_names = (
        {
            uid: name
            for uid, name in db.execute(
                select(User.id, User.display_name).where(User.id.in_(assignee_ids))
            ).all()
        }
        if assignee_ids
        else {}
    )

    # 批量聚合命中与引用归因计数
    analysis_ids = [
        r[0].current_analysis_revision_id
        for r in rows
        if r[0].current_analysis_revision_id is not None
    ]
    mentioned_analysis: set[UUID] = set()
    if analysis_ids:
        mentioned_analysis = set(
            db.scalars(
                select(GeoEntityMention.analysis_revision_id)
                .join(GeoSubject, GeoSubject.id == GeoEntityMention.subject_id)
                .where(
                    GeoEntityMention.analysis_revision_id.in_(analysis_ids),
                    GeoSubject.subject_type.in_(["OWN_BRAND", "OWN_PRODUCT"]),
                )
            )
        )
    answer_ids = [r[5] for r in rows if r[5] is not None]
    linked_counts: dict[UUID, int] = {}
    candidate_counts: dict[UUID, int] = {}
    if answer_ids:
        link_rows = db.execute(
            select(
                GeoAnswerCitation.answer_snapshot_id,
                GeoCitationPublicationLink.link_status,
                func.count(),
            )
            .join(
                GeoCitationPublicationLink,
                GeoCitationPublicationLink.citation_id == GeoAnswerCitation.id,
            )
            .where(GeoAnswerCitation.answer_snapshot_id.in_(answer_ids))
            .group_by(
                GeoAnswerCitation.answer_snapshot_id,
                GeoCitationPublicationLink.link_status,
            )
        ).all()
        for aid, lstatus, cnt in link_rows:
            if lstatus in {"AUTO_EXACT", "CONFIRMED"}:
                linked_counts[aid] = linked_counts.get(aid, 0) + int(cnt)
            elif lstatus == "CANDIDATE":
                candidate_counts[aid] = candidate_counts.get(aid, 0) + int(cnt)

    items: list[GeoDailyChecklistItem] = []
    summary = GeoDailyChecklistSummary()
    for run, plan_id, plan_name, prompt_cat, prompt_prio, answer_id, q_mod in rows:
        summary.planned_total += 1
        if run.status == "COMPLETED":
            summary.completed_count += 1
        elif run.status == "PENDING":
            summary.pending_count += 1
        elif run.status == "NEEDS_REVIEW":
            summary.needs_review_count += 1
        elif run.status == "FAILED":
            summary.failed_count += 1
        elif run.status == "CANCELLED":
            summary.cancelled_count += 1

        prompt_snap = run.input_snapshot["prompt"]
        profile_snap = run.input_snapshot["profile"]
        surface_snap = profile_snap["surface"]
        has_mention: bool | None = None
        if run.current_analysis_revision_id is not None:
            has_mention = run.current_analysis_revision_id in mentioned_analysis
        items.append(
            GeoDailyChecklistItem(
                run_id=run.id,
                batch_id=run.batch_id,
                plan_id=plan_id,
                plan_name=plan_name,
                prompt_variant_id=run.prompt_variant_id,
                prompt_text=prompt_snap["prompt_text"],
                prompt_category=GeoPromptCategory(prompt_cat),
                prompt_priority=prompt_prio,
                collection_profile_id=run.collection_profile_id,
                profile_name=profile_snap["name"],
                platform_name=surface_snap["name"],
                web_search_policy=profile_snap["web_search_policy"],
                require_screenshot=bool(profile_snap["settings"].get("require_screenshot", True)),
                status=GeoRunStatus(run.status),
                revision=run.revision,
                entry_kind=GeoRunEntryKind(run.entry_kind),
                is_backfill=run.is_backfill,
                backfill_source=run.backfill_source,
                assignee_id=run.assignee_id,
                assignee_name=user_names.get(run.assignee_id) if run.assignee_id else None,
                target_article_publication_id=run.target_article_publication_id,
                effective_at=run.collected_at or run.created_at,
                collected_at=run.collected_at,
                query_modified=bool(q_mod),
                error_code=run.error_code,
                error_summary=run.error_summary,
                has_answer=answer_id is not None,
                has_brand_or_product_mention=has_mention,
                linked_article_count=linked_counts.get(answer_id, 0) if answer_id else 0,
                pending_candidate_link_count=(
                    candidate_counts.get(answer_id, 0) if answer_id else 0
                ),
            )
        )

    # 下拉选项（零 UUID 日常录入）
    core_plans = [
        GeoDailyChecklistOption(id=pid, label=pname, meta=prole)
        for pid, pname, prole in db.execute(
            select(GeoMonitoringPlan.id, GeoMonitoringPlan.name, GeoMonitoringPlan.plan_role)
            .where(GeoMonitoringPlan.status == "ACTIVE")
            .order_by(GeoMonitoringPlan.plan_role.asc(), GeoMonitoringPlan.name.asc())
        ).all()
    ]
    profiles = [
        GeoDailyChecklistOption(id=pid, label=f"{sname} · {pname}", meta=policy)
        for pid, pname, sname, policy in db.execute(
            select(
                GeoCollectionProfile.id,
                GeoCollectionProfile.name,
                GeoEngineSurface.name,
                GeoCollectionProfile.web_search_policy,
            )
            .join(GeoEngineSurface, GeoEngineSurface.id == GeoCollectionProfile.engine_surface_id)
            .where(
                GeoCollectionProfile.collection_mode == "MANUAL",
                GeoCollectionProfile.is_active.is_(True),
            )
            .order_by(GeoEngineSurface.name.asc(), GeoCollectionProfile.name.asc())
        ).all()
    ]
    prompts = [
        GeoDailyChecklistOption(id=vid, label=ptext, meta=f"{pcat}:{pprio}")
        for vid, ptext, pcat, pprio in db.execute(
            select(
                GeoPromptVariant.id,
                GeoPromptVariant.prompt_text,
                GeoPromptVariant.prompt_category,
                GeoPromptVariant.priority,
            )
            .where(GeoPromptVariant.is_active.is_(True))
            .order_by(GeoPromptVariant.prompt_category.asc(), GeoPromptVariant.updated_at.desc())
            .limit(200)
        ).all()
    ]
    users = [
        GeoDailyChecklistOption(id=uid, label=dname, meta=atype)
        for uid, dname, atype in db.execute(
            select(User.id, User.display_name, User.account_type)
            .where(User.is_active.is_(True), User.account_type.in_(["ADMIN", "ENGINEER"]))
            .order_by(User.display_name.asc())
        ).all()
    ]
    pubs = [
        GeoDailyChecklistOption(
            id=pub_id,
            label=f"[{plat}] {ptitle}",
            meta=f"{art_title} · {furl}",
        )
        for pub_id, plat, ptitle, art_title, furl in db.execute(
            select(
                ArticlePublication.id,
                ArticlePublication.platform_name_snapshot,
                ArticlePublication.actual_title,
                Article.title,
                ArticlePublication.final_url,
            )
            .join(Article, Article.id == ArticlePublication.article_id)
            .where(ArticlePublication.registration_status == "REGISTERED")
            .order_by(ArticlePublication.published_at.desc())
            .limit(200)
        ).all()
    ]

    _ = run_ids  # 保留查询顺序语义
    return GeoDailyChecklistOut(
        target_date=day,
        timezone=tz_name,
        summary=summary,
        items=items,
        core_plans=core_plans,
        profiles=profiles,
        prompts=prompts,
        users=users,
        publications=pubs,
    )


def ensure_daily_checklist(
    db: Session,
    *,
    payload: GeoDailyChecklistEnsureRequest,
    actor: User,
    request_id: str,
) -> GeoDailyChecklistEnsureOut:
    """幂等确保指定日期的核心人工监测清单已生成（团队共享幂等键，重复点击零重复 Run）。"""
    day = payload.target_date or datetime.now(ZoneInfo("Asia/Shanghai")).date()
    created_batches: list[UUID] = []
    reused_batches: list[UUID] = []
    created_runs = 0

    with command(db, actor) as current:
        plan_query = select(GeoMonitoringPlan).where(GeoMonitoringPlan.status == "ACTIVE")
        if payload.plan_id is not None:
            plan_query = plan_query.where(GeoMonitoringPlan.id == payload.plan_id)
        else:
            plan_query = plan_query.where(GeoMonitoringPlan.plan_role == "CORE_BASELINE")
        target_plans = list(db.scalars(plan_query.order_by(GeoMonitoringPlan.id.asc())))
        if not target_plans:
            raise AppError(
                "GEO_CORE_PLAN_NOT_FOUND",
                "未找到已激活的核心基线监测计划（CORE_BASELINE），请先在设置中激活或指定计划",
                409,
            )

        for target in target_plans:
            identity = hashlib.sha256(
                f"geo-daily-checklist:{target.id}:{day.isoformat()}".encode()
            ).hexdigest()
            lock_key = int.from_bytes(bytes.fromhex(identity)[:8], "big", signed=True)
            db.execute(select(func.pg_advisory_xact_lock(lock_key)))
            existing_req = db.get(GeoBatchCreationRequest, identity, populate_existing=True)
            if existing_req is not None:
                reused_batches.append(existing_req.batch_id)
                continue
            plan, value = lock_plan(db, target.id, target.revision)
            batch = freeze_batch(
                db,
                value,
                plan=plan,
                actor=current,
                scheduled_for=None,
                identity=None,
                request_id=request_id,
            )
            if plan.default_assignee_id is not None:
                db.execute(
                    update(GeoObservationRun)
                    .where(GeoObservationRun.batch_id == batch.id)
                    .values(
                        assignee_id=plan.default_assignee_id,
                        revision=GeoObservationRun.revision + 1,
                    )
                    .execution_options(synchronize_session=False)
                )
            db.add(
                GeoBatchCreationRequest(
                    identity_hash=identity,
                    request_hash=identity,
                    batch_id=batch.id,
                )
            )
            db.flush()
            created_batches.append(batch.id)
            created_runs += batch.requested_run_count

        if created_batches:
            append_audit(
                db,
                AuditEntry(
                    actor_id=current.id,
                    business_module=AuditModule.GEO_OBSERVATION,
                    action="geo_daily_checklist.ensured",
                    target_type="GeoObservationBatch",
                    target_id=created_batches[0],
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="已幂等生成当日人工监测清单",
                    details={
                        "facts": {
                            "target_date": day.isoformat(),
                            "created_run_count": created_runs,
                        }
                    },
                ),
            )
        db.commit()
    return GeoDailyChecklistEnsureOut(
        target_date=day,
        created_batch_ids=created_batches,
        reused_batch_ids=reused_batches,
        created_run_count=created_runs,
    )
