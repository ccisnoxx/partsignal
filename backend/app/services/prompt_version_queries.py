"""Slice 3A：Prompt 不可变版本读模型、平台绑定查询与按版本效果实时聚合。"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import exists, func, select, text
from sqlalchemy.orm import Session, aliased

from app.errors import not_found
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.content import ContentReviewRecord, ContentVersion
from app.models.geo_files import (
    GeoObservation,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.publication import PublicationWork, PublishedArticle
from app.schemas.configuration import PlatformPromptBoundPlatform
from app.schemas.prompt_versioning import (
    PlatformPromptBindingOut,
    PlatformPromptVersionList,
    PlatformPromptVersionMetrics,
    PlatformPromptVersionOption,
    PlatformPromptVersionOut,
)

PLATFORM_PROMPT_BINDING_LOCK = "platform-prompt-bindings"


def lock_platform_prompt_bindings_shared(db: Session) -> None:
    """串行化平台与 Prompt 版本的绑定、发布与删除操作。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": PLATFORM_PROMPT_BINDING_LOCK},
    )


def latest_published_prompt_version(
    db: Session, prompt_id: uuid.UUID
) -> PlatformPromptVersion | None:
    """读取指定 Prompt 最新已发布的不可变版本。"""
    return db.scalar(
        select(PlatformPromptVersion)
        .where(
            PlatformPromptVersion.prompt_id == prompt_id,
            PlatformPromptVersion.status == "PUBLISHED",
        )
        .order_by(PlatformPromptVersion.version.desc(), PlatformPromptVersion.id.desc())
        .limit(1)
    )


def resolve_bound_prompt_version(
    db: Session,
    profile: PlatformProfile,
    prompt: PlatformPrompt,
) -> PlatformPromptVersion | None:
    """解析平台当前生效的不可变 Prompt 版本（优先显式绑定，缺省回退至最新已发布版本）。"""
    if profile.platform_prompt_version_id is not None:
        bound = db.get(PlatformPromptVersion, profile.platform_prompt_version_id)
        if bound is not None and bound.prompt_id == prompt.id and bound.status == "PUBLISHED":
            return bound
        return None
    return latest_published_prompt_version(db, prompt.id)


def prompt_has_any_version(db: Session, prompt_id: uuid.UUID) -> bool:
    """判断 Prompt 模板是否已纳入不可变版本表。"""
    return bool(
        db.scalar(select(exists().where(PlatformPromptVersion.prompt_id == prompt_id)))
    )


def _version_metrics_by_id(
    db: Session, version_ids: list[uuid.UUID]
) -> dict[uuid.UUID, PlatformPromptVersionMetrics]:
    """基于 PostgreSQL 源事实在常数条 SQL 内实时聚合各 Prompt 版本效果指标。"""
    if not version_ids:
        return {}
    jobs = db.execute(
        select(
            GenerationJob.id,
            GenerationJob.platform_prompt_version_id,
            GenerationJob.status,
            GenerationJob.content_task_id,
            GenerationJob.content_version_id,
        ).where(
            GenerationJob.job_type == "GENERATE",
            GenerationJob.platform_prompt_version_id.in_(version_ids),
        )
    ).all()

    total_jobs: dict[uuid.UUID, int] = defaultdict(int)
    succeeded_jobs: dict[uuid.UUID, int] = defaultdict(int)
    version_root_content_ids: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    job_to_prompt_version: dict[uuid.UUID, uuid.UUID] = {}
    all_root_content_ids: set[uuid.UUID] = set()
    all_task_ids: set[uuid.UUID] = set()

    for job_id, ver_id, job_status, task_id, content_version_id in jobs:
        if ver_id is None:
            continue
        total_jobs[ver_id] += 1
        if job_status == "SUCCEEDED":
            succeeded_jobs[ver_id] += 1
            job_to_prompt_version[job_id] = ver_id
            all_task_ids.add(task_id)
            if content_version_id is not None:
                version_root_content_ids[ver_id].add(content_version_id)
                all_root_content_ids.add(content_version_id)

    # 1. 首次审核结果：按时间顺序取各 AI 生成初稿的首个 approve / request-changes 记录
    first_review_outcome: dict[uuid.UUID, str] = {}
    if all_root_content_ids:
        review_rows = db.execute(
            select(ContentReviewRecord.content_version_id, ContentReviewRecord.action)
            .where(
                ContentReviewRecord.content_version_id.in_(all_root_content_ids),
                ContentReviewRecord.action.in_(("approve", "request-changes")),
            )
            .order_by(ContentReviewRecord.created_at.asc(), ContentReviewRecord.id.asc())
        ).all()
        for cv_id, review_action in review_rows:
            if cv_id not in first_review_outcome:
                first_review_outcome[cv_id] = review_action

    # 2. 按 ContentVersion 血缘（based_on_id / source_job_id）精确归因人工修订与已发布文章，
    # 避免同一任务废弃重生成后把后续版本的修订/发布误算到已废弃的 Prompt 版本。
    cv_to_root_cv: dict[uuid.UUID, uuid.UUID] = {}
    cv_to_prompt_version: dict[uuid.UUID, uuid.UUID] = {}
    human_revisions_by_root: dict[uuid.UUID, int] = defaultdict(int)
    if all_task_ids:
        all_cvs = db.execute(
            select(
                ContentVersion.id,
                ContentVersion.source_job_id,
                ContentVersion.based_on_id,
                ContentVersion.source_type,
            ).where(ContentVersion.task_id.in_(all_task_ids))
        ).all()
        cv_map = {
            cv_id: (source_job_id, based_on_id, source_type)
            for cv_id, source_job_id, based_on_id, source_type in all_cvs
        }
        for cv_id in cv_map:
            curr: uuid.UUID | None = cv_id
            visited: set[uuid.UUID] = set()
            origin_ver: uuid.UUID | None = None
            origin_root: uuid.UUID | None = None
            while curr is not None and curr not in visited and curr in cv_map:
                visited.add(curr)
                src_job_id, parent_id, _src_type = cv_map[curr]
                if src_job_id is not None and src_job_id in job_to_prompt_version:
                    origin_ver = job_to_prompt_version[src_job_id]
                    origin_root = curr
                    break
                curr = parent_id
            if origin_ver is not None and origin_root is not None:
                cv_to_prompt_version[cv_id] = origin_ver
                cv_to_root_cv[cv_id] = origin_root
                if cv_map[cv_id][2] == "HUMAN":
                    human_revisions_by_root[origin_root] += 1

    # 3. 按发布工作实际绑定的 content_version_id 归因已发布文章与有效（未更正）GEO 观测
    articles_by_version: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    all_article_ids: set[uuid.UUID] = set()
    if cv_to_prompt_version:
        article_rows = db.execute(
            select(PublicationWork.content_version_id, PublishedArticle.id)
            .join(PublishedArticle, PublishedArticle.id == PublicationWork.id)
            .where(PublicationWork.content_version_id.in_(set(cv_to_prompt_version.keys())))
        ).all()
        for cv_id, article_id in article_rows:
            ver_id = cv_to_prompt_version.get(cv_id)
            if ver_id is not None:
                articles_by_version[ver_id].add(article_id)
                all_article_ids.add(article_id)

    geo_stats_by_article: dict[uuid.UUID, tuple[int, int, int]] = {}
    if all_article_ids:
        newer_obs = aliased(GeoObservation)
        superseded_exists = exists(
            select(1).where(newer_obs.supersedes_id == GeoObservation.id)
        )
        pub_obs_rows = db.execute(
            select(
                GeoObservationPublication.observation_id,
                GeoObservationPublication.published_article_id,
                func.coalesce(GeoObservationPublication.mentioned, GeoObservation.mentioned),
            )
            .join(GeoObservation, GeoObservation.id == GeoObservationPublication.observation_id)
            .where(
                GeoObservationPublication.published_article_id.in_(all_article_ids),
                ~superseded_exists,
            )
        ).all()
        active_obs_ids = {obs_id for obs_id, _art_id, _mentioned in pub_obs_rows}
        cited_pairs = (
            {
                (obs_id, art_id)
                for obs_id, art_id in db.execute(
                    select(
                        GeoObservationCitation.observation_id,
                        GeoObservationCitation.published_article_id,
                    ).where(
                        GeoObservationCitation.observation_id.in_(active_obs_ids),
                        GeoObservationCitation.published_article_id.in_(all_article_ids),
                    )
                ).tuples()
                if art_id is not None
            }
            if active_obs_ids
            else set()
        )
        totals: dict[uuid.UUID, int] = defaultdict(int)
        mentions: dict[uuid.UUID, int] = defaultdict(int)
        citations: dict[uuid.UUID, int] = defaultdict(int)
        for obs_id, art_id, mentioned in pub_obs_rows:
            totals[art_id] += 1
            if mentioned:
                mentions[art_id] += 1
            if (obs_id, art_id) in cited_pairs:
                citations[art_id] += 1
        for art_id, total_obs in totals.items():
            geo_stats_by_article[art_id] = (total_obs, mentions[art_id], citations[art_id])

    result: dict[uuid.UUID, PlatformPromptVersionMetrics] = {}
    for ver_id in version_ids:
        root_cv_ids = version_root_content_ids.get(ver_id, set())
        reviewed = [
            first_review_outcome[cid] for cid in root_cv_ids if cid in first_review_outcome
        ]
        first_pass_total = len(reviewed)
        first_pass_approved = sum(1 for act in reviewed if act == "approve")

        avg_human = (
            round(
                sum(human_revisions_by_root.get(cid, 0) for cid in root_cv_ids)
                / len(root_cv_ids),
                2,
            )
            if root_cv_ids
            else None
        )

        art_ids = articles_by_version.get(ver_id, set())
        geo_total = sum(geo_stats_by_article.get(aid, (0, 0, 0))[0] for aid in art_ids)
        geo_mentions = sum(geo_stats_by_article.get(aid, (0, 0, 0))[1] for aid in art_ids)
        geo_citations = sum(geo_stats_by_article.get(aid, (0, 0, 0))[2] for aid in art_ids)

        result[ver_id] = PlatformPromptVersionMetrics(
            generation_job_count=total_jobs.get(ver_id, 0),
            succeeded_job_count=succeeded_jobs.get(ver_id, 0),
            first_pass_review_total=first_pass_total,
            first_pass_approved_count=first_pass_approved,
            first_pass_approval_rate=(
                round(first_pass_approved / first_pass_total, 4) if first_pass_total > 0 else None
            ),
            avg_human_revisions=avg_human,
            published_article_count=len(art_ids),
            geo_observation_count=geo_total,
            geo_mention_rate=round(geo_mentions / geo_total, 4) if geo_total > 0 else None,
            geo_citation_rate=round(geo_citations / geo_total, 4) if geo_total > 0 else None,
        )
    return result


def project_prompt_versions(
    db: Session, versions: list[PlatformPromptVersion]
) -> list[PlatformPromptVersionOut]:
    """投影不可变 Prompt 版本详情、当前绑定平台及按版本效果指标。"""
    if not versions:
        return []
    version_ids = [item.id for item in versions]
    bound_rows = list(
        db.scalars(
            select(PlatformProfile)
            .where(PlatformProfile.platform_prompt_version_id.in_(version_ids))
            .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
        )
    )
    bound_by_version: dict[uuid.UUID, list[PlatformPromptBoundPlatform]] = defaultdict(list)
    for profile in bound_rows:
        if profile.platform_prompt_version_id is not None:
            bound_by_version[profile.platform_prompt_version_id].append(
                PlatformPromptBoundPlatform(
                    id=profile.id,
                    name=profile.name,
                    slug=profile.slug,
                )
            )
    metrics_by_id = _version_metrics_by_id(db, version_ids)
    projected: list[PlatformPromptVersionOut] = []
    for item in versions:
        bound = bound_by_version.get(item.id, [])
        actions: list[str] = []
        if item.status == "DRAFT":
            actions.extend(["UPDATE_DRAFT", "PUBLISH"])
        elif item.status == "PUBLISHED":
            if not bound:
                actions.append("ARCHIVE")
        elif item.status == "ARCHIVED":
            actions.append("RESTORE")
        projected.append(
            PlatformPromptVersionOut.model_validate(
                {
                    "id": item.id,
                    "prompt_id": item.prompt_id,
                    "version": item.version,
                    "status": item.status,
                    "template_markdown": item.template_markdown,
                    "template_sha256": item.template_sha256,
                    "change_summary": item.change_summary,
                    "revision": item.revision,
                    "published_at": item.published_at,
                    "published_by": item.published_by,
                    "created_by": item.created_by,
                    "created_at": item.created_at,
                    "updated_at": item.updated_at,
                    "bound_platform_count": len(bound),
                    "bound_platforms": bound,
                    "available_actions": actions,
                    "metrics": metrics_by_id[item.id],
                }
            )
        )
    return projected


def list_platform_prompt_versions(
    db: Session, platform_prompt_id: uuid.UUID
) -> PlatformPromptVersionList:
    """在单次一致快照内返回 Prompt 全部不可变版本及按版本效果指标。"""
    prompt = db.get(PlatformPrompt, platform_prompt_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    versions = list(
        db.scalars(
            select(PlatformPromptVersion)
            .where(PlatformPromptVersion.prompt_id == prompt.id)
            .order_by(PlatformPromptVersion.version.desc(), PlatformPromptVersion.id.desc())
        )
    )
    latest_pub = next((v.id for v in versions if v.status == "PUBLISHED"), None)
    return PlatformPromptVersionList(
        prompt_id=prompt.id,
        prompt_name=prompt.name,
        latest_published_version_id=latest_pub,
        items=project_prompt_versions(db, versions),
    )


def get_platform_prompt_binding(
    db: Session, platform_profile_id: uuid.UUID
) -> PlatformPromptBindingOut:
    """读取平台当前显式绑定的 Prompt 版本及全部可供切换/回滚的已发布版本。"""
    profile = db.get(PlatformProfile, platform_profile_id)
    if profile is None:
        raise not_found("平台")
    bound_prompt = (
        db.get(PlatformPrompt, profile.platform_prompt_id)
        if profile.platform_prompt_id is not None
        else None
    )
    published_rows = db.execute(
        select(PlatformPromptVersion, PlatformPrompt.name)
        .join(PlatformPrompt, PlatformPrompt.id == PlatformPromptVersion.prompt_id)
        .where(PlatformPromptVersion.status == "PUBLISHED")
        .order_by(
            func.lower(PlatformPrompt.name),
            PlatformPrompt.id,
            PlatformPromptVersion.version.desc(),
            PlatformPromptVersion.id.desc(),
        )
    ).all()
    options = [
        PlatformPromptVersionOption(
            id=ver.id,
            prompt_id=ver.prompt_id,
            prompt_name=prompt_name,
            version=ver.version,
            change_summary=ver.change_summary,
            published_at=ver.published_at,
            is_current=profile.platform_prompt_version_id == ver.id,
        )
        for ver, prompt_name in published_rows
    ]
    bound_version = next((item for item in options if item.is_current), None)
    return PlatformPromptBindingOut(
        platform_profile_id=profile.id,
        platform_revision=profile.revision,
        platform_prompt_id=profile.platform_prompt_id,
        platform_prompt_name=bound_prompt.name if bound_prompt is not None else None,
        bound_version=bound_version,
        available_versions=options,
    )
