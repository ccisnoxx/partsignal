"""Celery Worker 入口；Redis 仅传递生成作业 UUID。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from celery import Celery
from sqlalchemy import select

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
    """从 PostgreSQL 查找过期租约并重新投递，避免 Worker 崩溃后永久卡住。"""
    with SessionLocal() as db:
        job_ids = list(
            db.scalars(
                select(GenerationJob.id).where(
                    GenerationJob.status == "RUNNING",
                    GenerationJob.lease_expires_at <= datetime.now(UTC),
                )
            )
        )
    for job_id in job_ids:
        generate_content.delay(str(job_id))
