"""Celery Worker 入口；Redis 仅传递生成作业 UUID。"""

from __future__ import annotations

import uuid

from celery import Celery

from app.config import settings
from app.services.generation import process_generation_job
from app.services.generation_dispatch import (
    fail_expired_generation_jobs,
    redispatch_pending_generation_jobs,
)

celery_app = Celery("partsignal", broker=settings.redis_url)
celery_app.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "recover-expired-generation-leases": {
            "task": "partsignal.recover_expired_generation_jobs",
            "schedule": float(settings.generation_recovery_scan_seconds),
        },
        "redispatch-pending-generation-jobs": {
            "task": "partsignal.redispatch_pending_generation_jobs",
            "schedule": float(settings.generation_recovery_scan_seconds),
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
