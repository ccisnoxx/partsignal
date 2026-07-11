"""Celery Worker 入口；Redis 仅传递生成作业 UUID。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from celery import Celery
from sqlalchemy import update

from app.config import settings
from app.db import SessionLocal
from app.models import GenerationJob
from app.services.generation import process_generation_job

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
            "schedule": 60.0,
        }
    },
)


@celery_app.task(name="partsignal.generate_content")  # type: ignore[untyped-decorator]
def generate_content(job_id: str) -> None:
    """Celery 消息只携带作业 UUID，全部输入重新从 PostgreSQL 加载。"""
    process_generation_job(uuid.UUID(job_id))


@celery_app.task(name="partsignal.recover_expired_generation_jobs")  # type: ignore[untyped-decorator]
def recover_expired_generation_jobs() -> None:
    """把过期租约标记失败，禁止同一作业自动发起第二次外部调用。"""
    with SessionLocal.begin() as db:
        db.execute(
            update(GenerationJob)
            .where(
                GenerationJob.status == "RUNNING",
                GenerationJob.lease_expires_at <= datetime.now(UTC),
            )
            .values(
                status="FAILED",
                error_code="WORKER_LOST",
                error_summary="Worker 租约过期，需显式创建重试作业",
                finished_at=datetime.now(UTC),
                lease_expires_at=None,
            )
        )
