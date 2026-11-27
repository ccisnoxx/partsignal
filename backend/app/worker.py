"""Celery Worker 入口；Redis 仅传递作业/Run UUID。"""

from __future__ import annotations

import uuid

from celery import Celery

from app.config import settings
from app.geo_ops_health import worker_heartbeat  # noqa: F401
from app.services.file_records import cleanup_file_records
from app.services.generation import process_generation_job
from app.services.generation_dispatch import (
    fail_expired_generation_jobs,
    redispatch_pending_generation_jobs,
)
from app.services.geo_analysis_dispatch import (
    dispatch_collected_run,
    recover_expired_analysis_revisions,
    redispatch_pending_analysis_revisions,
)
from app.services.geo_analysis_runs import process_analysis_revision, process_analysis_run
from app.services.geo_dispatch import (
    recover_expired_collection_runs,
    redispatch_pending_collection_runs,
)
from app.services.geo_opportunity_scheduler import evaluate_due_opportunities
from app.services.geo_ops_runtime import observe
from app.services.geo_plan_scheduler import create_due_plan_batches
from app.services.geo_retention import cleanup_geo_artifacts
from app.services.geo_runs import process_collection_run
from app.services.page_health_scheduler import run_due_public_page_health_checks_scheduled
from app.services.semantic_quality_worker import (
    fail_expired_semantic_quality_check_jobs,
    process_semantic_quality_check_job,
    redispatch_pending_semantic_quality_check_jobs,
)

celery_app = Celery("partsignal", broker=settings.redis_url)
celery_app.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    worker_concurrency=settings.celery_concurrency,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"socket_connect_timeout": 5, "socket_timeout": 5},
    beat_scheduler="app.geo_ops_health:GeoHealthScheduler",
    beat_max_loop_interval=30,
    beat_schedule={
        "evaluate-due-geo-opportunities": {
            "task": "partsignal.evaluate_due_geo_opportunities",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "create-due-geo-plan-batches": {
            "task": "partsignal.create_due_geo_plan_batches",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "redispatch-pending-geo-analyses": {
            "task": "partsignal.redispatch_pending_geo_analyses",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "recover-expired-geo-analyses": {
            "task": "partsignal.recover_expired_geo_analyses",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "recover-expired-generation-leases": {
            "task": "partsignal.recover_expired_generation_jobs",
            "schedule": float(settings.generation_recovery_scan_seconds),
        },
        "redispatch-pending-generation-jobs": {
            "task": "partsignal.redispatch_pending_generation_jobs",
            "schedule": float(settings.generation_recovery_scan_seconds),
        },
        "recover-expired-geo-leases": {
            "task": "partsignal.recover_expired_geo_runs",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "redispatch-pending-geo-runs": {
            "task": "partsignal.redispatch_pending_geo_runs",
            "schedule": float(settings.geo_recovery_scan_seconds),
        },
        "cleanup-geo-artifacts": {
            "task": "partsignal.geo_cleanup_artifacts",
            "schedule": 3600.0,
        },
        "cleanup-platform-logo-files": {
            "task": "partsignal.cleanup_platform_logo_files",
            "schedule": 3600.0,
        },
        "recover-expired-semantic-quality-checks": {
            "task": "partsignal.recover_expired_semantic_quality_checks",
            "schedule": float(settings.generation_recovery_scan_seconds),
        },
        "redispatch-pending-semantic-quality-checks": {
            "task": "partsignal.redispatch_pending_semantic_quality_checks",
            "schedule": float(settings.generation_recovery_scan_seconds),
        },
        "run-due-public-page-health-checks": {
            "task": "partsignal.run_due_public_page_health_checks",
            "schedule": 900.0,
        },
    },
)


@celery_app.task(name="partsignal.generate_content")  # type: ignore[untyped-decorator]
def generate_content(job_id: str) -> None:
    """Celery 消息只携带作业 UUID，全部输入重新从 PostgreSQL 加载。"""
    process_generation_job(uuid.UUID(job_id))


@celery_app.task(name="partsignal.recover_expired_generation_jobs")  # type: ignore[untyped-decorator]
def recover_expired_generation_jobs() -> None:
    """把过期租约标记失败，禁止同一作业自动发起第二次外部调用。"""
    fail_expired_generation_jobs()


@celery_app.task(name="partsignal.redispatch_pending_generation_jobs")  # type: ignore[untyped-decorator]
def redispatch_pending_jobs() -> None:
    """仅补投递超龄 PENDING Job，Redis 消息继续只携带 UUID。"""
    redispatch_pending_generation_jobs(generate_content.delay)


@celery_app.task(name="partsignal.cleanup_platform_logo_files")  # type: ignore[untyped-decorator]
def cleanup_platform_logos() -> None:
    """按 PostgreSQL 权威状态清理全部到期且无引用的文件。"""
    cleanup_file_records()


@celery_app.task(name="partsignal.run_semantic_quality_check")  # type: ignore[untyped-decorator]
def run_semantic_quality_check(job_id: str) -> None:
    """Slice 3B：仅按作业 UUID 执行异步 AI 语义质量检查。"""
    process_semantic_quality_check_job(uuid.UUID(job_id))


@celery_app.task(name="partsignal.recover_expired_semantic_quality_checks")  # type: ignore[untyped-decorator]
def recover_expired_semantic_quality_checks() -> None:
    """把超租约的 RUNNING 语义质量检查作业标记失败。"""
    fail_expired_semantic_quality_check_jobs()


@celery_app.task(name="partsignal.redispatch_pending_semantic_quality_checks")  # type: ignore[untyped-decorator]
def redispatch_pending_semantic_quality_checks() -> None:
    """补投递滞留 PENDING 语义质量检查作业，消息只携带 UUID。"""
    redispatch_pending_semantic_quality_check_jobs(run_semantic_quality_check.delay)


@celery_app.task(name="partsignal.collect_geo_run")  # type: ignore[untyped-decorator]
@observe("collect_task", "COLLECTION", scrub_worker_error=True)
def collect_geo_run(run_id: str) -> None:
    """消息只有 Run UUID；数据库重新裁决执行资格和 lease。"""
    process_collection_run(uuid.UUID(run_id))
    dispatch_collected_run(uuid.UUID(run_id), analyze_geo_run.delay)


@celery_app.task(name="partsignal.analyze_geo_run")  # type: ignore[untyped-decorator]
@observe("analyze_task", "ANALYSIS", scrub_worker_error=True)
def analyze_geo_run(run_id: str) -> None:
    process_analysis_run(uuid.UUID(run_id))


@celery_app.task(name="partsignal.analyze_geo_revision")  # type: ignore[untyped-decorator]
@observe("analyze_task", "ANALYSIS", scrub_worker_error=True)
def analyze_geo_revision(analysis_id: str) -> None:
    process_analysis_revision(uuid.UUID(analysis_id))


@celery_app.task(name="partsignal.redispatch_pending_geo_analyses")  # type: ignore[untyped-decorator]
@observe("analysis_dispatch", "ANALYSIS", scrub_worker_error=True)
def redispatch_pending_geo_analyses() -> None:
    redispatch_pending_analysis_revisions(analyze_geo_revision.delay)


@celery_app.task(name="partsignal.recover_expired_geo_analyses")  # type: ignore[untyped-decorator]
@observe("analysis_recovery", "ANALYSIS", scrub_worker_error=True)
def recover_expired_geo_analyses() -> None:
    recover_expired_analysis_revisions()


@celery_app.task(name="partsignal.redispatch_pending_geo_runs")  # type: ignore[untyped-decorator]
@observe("collection_dispatch", "COLLECTION", scrub_worker_error=True)
def redispatch_pending_geo_runs() -> None:
    redispatch_pending_collection_runs(collect_geo_run.delay)


@celery_app.task(name="partsignal.recover_expired_geo_runs")  # type: ignore[untyped-decorator]
@observe("collection_recovery", "COLLECTION", scrub_worker_error=True)
def recover_expired_geo_runs() -> None:
    recover_expired_collection_runs()


@celery_app.task(name="partsignal.geo_cleanup_artifacts")  # type: ignore[untyped-decorator]
@observe("retention", "RETENTION", scrub_worker_error=True)
def cleanup_geo_materials() -> None:
    """只触发限批 PG 扫描，Redis 不携带正文、文件路径或策略参数。"""
    cleanup_geo_artifacts()


@celery_app.task(name="partsignal.create_due_geo_plan_batches")  # type: ignore[untyped-decorator]
def create_due_geo_plan_batches() -> None:
    """数据库登记和窗口是权威；重复beat消息不重复创建批次。"""
    create_due_plan_batches()


@celery_app.task(name="partsignal.evaluate_due_geo_opportunities")  # type: ignore[untyped-decorator]
def evaluate_due_geo_opportunities() -> None:
    """读取数据库授权和周期窗口，最多执行最近一个到期评估。"""
    evaluate_due_opportunities()


@celery_app.task(name="partsignal.run_due_public_page_health_checks")  # type: ignore[untyped-decorator]
def run_due_public_page_health_checks_task() -> None:
    """Slice 3D：仅对启用健康检查的平台执行到期公开页面只读巡检。"""
    run_due_public_page_health_checks_scheduled()
