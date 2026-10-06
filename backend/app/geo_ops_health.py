"""本机进程健康：活跃循环、PG、Broker与注册目录，不用业务低表现裁决健康。"""

import json
import os
import socket
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import Any, Literal

from celery import signals
from celery.beat import PersistentScheduler
from redis import Redis
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.collectors.registry import collector_registry
from app.config import settings
from app.models.geo_observability import GeoOperationHealth
from app.services.geo_ops_logging import OpsError, geo_event
from app.services.geo_ops_runtime import observability_engine, record_operation

HEARTBEAT_SECONDS = 30
HEALTH_MAX_AGE_SECONDS = 90
type Component = Literal["worker", "scheduler"]


def heartbeat_file(component: Component) -> Path:
    return Path(f"/tmp/partsignal-{component}-heartbeat.json")


def _local_heartbeat(component: Component) -> None:
    path = heartbeat_file(component)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    try:
        # monotonic仅用于同机存活检测；PG UTC时间用于跨进程指标。
        temporary.write_text(json.dumps({"pid": os.getpid(), "monotonic": monotonic()}))
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


@signals.heartbeat_sent.connect(weak=False)  # type: ignore[untyped-decorator]
def worker_heartbeat(sender: Any = None, **kwargs: Any) -> None:
    if sender is None:
        return
    now = monotonic()
    if now - getattr(sender, "_geo_last_observed", float("-inf")) < HEARTBEAT_SECONDS:
        return
    sender._geo_last_observed = now
    if record_operation("worker_heartbeat", succeeded=True):
        try:
            _local_heartbeat("worker")
        except OSError:
            geo_event(
                event="observation_write_failed",
                stage="OBSERVABILITY",
                status="FAILED",
                error_code=OpsError.OBSERVABILITY_WRITE_FAILED,
            )


class GeoHealthScheduler(PersistentScheduler):  # type: ignore[misc]
    """实际tick与publish分别观测；不新增计划扫描或机会评估任务。"""

    _last_observed = float("-inf")

    def _ensure_connected(self) -> Any:
        def fixed_error(_error: Any, _interval: Any) -> None:
            geo_event(
                event="scheduler_publish",
                stage="SCHEDULER",
                status="FAILED",
                error_code=OpsError.BROKER_UNAVAILABLE,
            )

        # 保留Celery的retry目录/次数；回调不打印Broker异常正文。
        return self.connection.ensure_connection(
            fixed_error, self.app.conf.broker_connection_max_retries
        )

    def tick(self, *args: Any, **kwargs: Any) -> float:
        try:
            delay: float = super().tick(*args, **kwargs)
        except Exception:
            # producer在进入apply_entry之前建立连接；该路径也必须去掉原始异常链。
            record_operation("scheduler_tick", succeeded=False)
            geo_event(
                event="scheduler_publish",
                stage="SCHEDULER",
                status="FAILED",
                error_code=OpsError.BROKER_UNAVAILABLE,
            )
            raise RuntimeError("GEO Scheduler循环失败，按稳定运维事件排障") from None
        now = monotonic()
        if now - self._last_observed >= HEARTBEAT_SECONDS:
            self._last_observed = now
            if record_operation("scheduler_tick", succeeded=True):
                try:
                    _local_heartbeat("scheduler")
                except OSError:
                    geo_event(
                        event="observation_write_failed",
                        stage="OBSERVABILITY",
                        status="FAILED",
                        error_code=OpsError.OBSERVABILITY_WRITE_FAILED,
                    )
        return min(delay, float(HEARTBEAT_SECONDS))

    def apply_entry(self, entry: Any, producer: Any = None) -> None:
        started = monotonic()
        succeeded = False
        try:
            self.apply_async(entry, producer=producer, advance=False)
            succeeded = True
        except Exception:
            # Celery默认apply_entry会打印SchedulingError正文和链；可能含Broker凭据。
            # 保持它的捕获语义与schedule推进，只改变安全日志。
            geo_event(
                event="scheduler_publish",
                stage="SCHEDULER",
                status="FAILED",
                error_code=OpsError.BROKER_UNAVAILABLE,
            )
        finally:
            record_operation(
                "scheduler_publish",
                succeeded=succeeded,
                duration_ms=max(0, int((monotonic() - started) * 1000)),
            )


def component_health(component: Component) -> dict[str, object]:
    """每项失败固定代码；绝不输出连接URL、异常或配置值。"""
    checks: dict[str, bool] = {}
    try:
        local = json.loads(heartbeat_file(component).read_text())
        pid = int(
            Path(
                f"/tmp/partsignal-{'beat' if component == 'scheduler' else 'worker'}.pid"
            ).read_text()
        )
        os.kill(pid, 0)
        age = monotonic() - local["monotonic"]
        checks["local_heartbeat"] = local["pid"] == pid and 0 <= age <= HEALTH_MAX_AGE_SECONDS
    except (OSError, ValueError, KeyError, TypeError):
        checks["local_heartbeat"] = False
    engine = None
    try:
        engine = observability_engine()
        with Session(bind=engine) as db:
            db.execute(text("SET LOCAL statement_timeout = '2s'"))
            db.execute(text("SELECT 1"))
            row = db.get(
                GeoOperationHealth,
                "scheduler_tick" if component == "scheduler" else "worker_heartbeat",
            )
            clock = db.scalar(select(func.clock_timestamp()))
            assert isinstance(clock, datetime)
            checks["postgres"] = True
            checks["observed_heartbeat"] = (
                row is not None
                and row.last_success_at is not None
                and 0 <= (clock - row.last_success_at).total_seconds() <= HEALTH_MAX_AGE_SECONDS
            )
    except Exception:
        checks["postgres"] = checks["observed_heartbeat"] = False
    finally:
        if engine is not None:
            engine.dispose()
    try:
        with Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        ) as redis:
            checks["redis"] = bool(redis.ping())
    except Exception:
        checks["redis"] = False
    try:
        collector_registry.resolve("manual")
        collector_registry.resolve("openai-compatible-chat")
        checks["collector_registry"] = True
    except LookupError:
        checks["collector_registry"] = False
    if component == "worker":
        try:
            from app.worker import celery_app

            name = f"celery@{socket.gethostname()}"
            reply = celery_app.control.inspect(destination=[name], timeout=2).ping()
            checks["celery_ping"] = bool(reply and reply.get(name, {}).get("ok") == "pong")
        except Exception:
            checks["celery_ping"] = False
    return {
        "component": component,
        "status": "ok" if all(checks.values()) else "unhealthy",
        "checks": checks,
    }
