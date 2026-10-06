"""独立短事务记录有界运维事实；不提交或更改调用者业务事务。"""

from collections.abc import Callable
from functools import wraps
from time import monotonic
from typing import ParamSpec, TypeVar

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.config import settings
from app.errors import AppError
from app.models.geo_observability import OPERATIONS
from app.services.geo_ops_logging import OpsError, Stage, geo_event

P = ParamSpec("P")
T = TypeVar("T")


def observability_engine(bind: Engine | None = None) -> Engine:
    # 独立连接池边界使观测不能耗尽业务pool；连接/SQL均有短超时。
    return create_engine(
        bind.url if bind is not None else settings.database_url,
        poolclass=NullPool,
        connect_args={
            "connect_timeout": 2,
            "options": "-c statement_timeout=2000 -c lock_timeout=1000",
        },
    )


def record_operation(
    operation: str, *, succeeded: bool, duration_ms: int = 0, bind: Engine | None = None
) -> bool:
    """单行原子累计；故障显式记录但不把已提交业务回执改成失败。"""
    if operation not in OPERATIONS or type(duration_ms) is not int or duration_ms < 0:
        raise ValueError("运维记录的operation或耗时无效")
    engine = None
    try:
        engine = observability_engine(bind)
        with Session(bind=engine) as db, db.begin():
            db.execute(text("SET LOCAL lock_timeout = '1s'"))
            db.execute(text("SET LOCAL statement_timeout = '2s'"))
            db.execute(
                text("""INSERT INTO geo_operation_health AS h
                    (operation,last_attempt_at,last_success_at,last_failure_at,
                     success_count,failure_count,duration_ms,duration_total_ms)
                    SELECT :operation,observed_at,
                        CASE WHEN :succeeded THEN observed_at END,
                        CASE WHEN NOT :succeeded THEN observed_at END,
                        :success,:failure,:duration,:duration
                    FROM (SELECT clock_timestamp() AS observed_at) AS clock
                    ON CONFLICT (operation) DO UPDATE SET
                        last_attempt_at=greatest(h.last_attempt_at,excluded.last_attempt_at),
                        last_success_at=greatest(h.last_success_at,excluded.last_success_at),
                        last_failure_at=greatest(h.last_failure_at,excluded.last_failure_at),
                        success_count=h.success_count+excluded.success_count,
                        failure_count=h.failure_count+excluded.failure_count,
                        duration_ms=CASE WHEN excluded.last_attempt_at >= h.last_attempt_at
                            THEN excluded.duration_ms ELSE h.duration_ms END,
                        duration_total_ms=h.duration_total_ms+excluded.duration_total_ms
                """),
                dict(
                    operation=operation,
                    succeeded=succeeded,
                    success=int(succeeded),
                    failure=int(not succeeded),
                    duration=duration_ms,
                ),
            )
        return True
    except Exception:
        # SQL/连接异常可能携带凭据或业务值，不打印异常对象或traceback。
        geo_event(
            event="observation_write_failed",
            stage="OBSERVABILITY",
            status="FAILED",
            error_code=OpsError.OBSERVABILITY_WRITE_FAILED,
        )
        return False
    finally:
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                geo_event(event="observation_write_failed", stage="OBSERVABILITY",
                          status="FAILED", error_code=OpsError.OBSERVABILITY_WRITE_FAILED)


def observe(
    operation: str, stage: Stage, *, scrub_worker_error: bool = False
) -> Callable[[Callable[P, T]], Callable[P, T]]:
    """运维边界计时；业务拒绝独立记录，不当成系统故障告警。"""
    if operation not in OPERATIONS:
        raise ValueError("未登记的GEO运维边界")

    def decorate(function: Callable[P, T]) -> Callable[P, T]:
        @wraps(function)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> T:
            started = monotonic()
            succeeded = False
            rejected = False
            session = kwargs.get("db")
            if session is None and args and isinstance(args[0], Session):
                session = args[0]
            bind = session.get_bind() if isinstance(session, Session) else None
            engine = bind if isinstance(bind, Engine) else bind.engine if bind is not None else None
            try:
                result = function(*args, **kwargs)
                succeeded = True
                return result
            except Exception as error:
                rejected = isinstance(error, AppError) and error.status_code < 500
                if scrub_worker_error:
                    # Celery异常边界不得序列化原始SQL/provider错误与链；失败仍失败。
                    raise RuntimeError("GEO任务执行失败，按稳定运维事件和数据库状态排障") from None
                raise
            finally:
                elapsed = max(0, int((monotonic() - started) * 1000))
                if not rejected:
                    record_operation(
                        operation, succeeded=succeeded, duration_ms=elapsed, bind=engine
                    )
                geo_event(
                    event="operation_finished",
                    stage=stage,
                    status="REJECTED" if rejected else "SUCCEEDED" if succeeded else "FAILED",
                    duration_ms=elapsed,
                    error_code=OpsError.OPERATION_REJECTED
                    if rejected
                    else None
                    if succeeded
                    else OpsError.OPERATION_FAILED,
                )

        return wrapped

    return decorate
