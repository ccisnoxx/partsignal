"""FastAPI 应用入口与跨模块基础设施。"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import engine
from app.errors import (
    AppError,
    app_error_handler,
    integrity_error_handler,
    validation_error_handler,
)
from app.routers.configuration import router as configuration_router
from app.routers.files import router as files_router
from app.routers.identity import router as identity_router
from app.routers.observation import router as observation_router
from app.routers.planning import router as planning_router
from app.routers.product_facts import router as product_facts_router
from app.routers.production import router as production_router
from app.routers.publication import router as publication_router
from app.schemas import HealthResponse

logger = logging.getLogger("partsignal.api")

app = FastAPI(title="PartSignal API", version="0.1.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key", "X-Request-ID"],
)
app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(IntegrityError, integrity_error_handler)  # type: ignore[arg-type]


@app.middleware("http")
async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
    """为每个请求分配请求 ID，并输出不含敏感载荷的访问日志。"""
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    logger.info(
        "请求完成 request_id=%s method=%s path=%s status=%s elapsed_ms=%.1f",
        request.state.request_id,
        request.method,
        request.url.path,
        response.status_code,
        (time.monotonic() - started) * 1000,
    )
    return response


@app.get(
    "/api/health/live",
    response_model=HealthResponse,
    tags=["health"],
    operation_id="getLiveHealth",
)
def live_health() -> HealthResponse:
    """只反映 API 进程本身是否可响应。"""
    return HealthResponse(status="ok")


@app.get(
    "/api/health/ready",
    response_model=HealthResponse,
    tags=["health"],
    operation_id="getReadyHealth",
)
def ready_health() -> HealthResponse:
    """验证 PostgreSQL 与仅作 Celery Broker 的 Redis。"""
    checks: dict[str, str] = {}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["postgresql"] = "ok"
        Redis.from_url(settings.redis_url, socket_connect_timeout=1).ping()
        checks["redis"] = "ok"
    except Exception as error:
        raise AppError("DEPENDENCY_UNAVAILABLE", "必要依赖未就绪", 503) from error
    return HealthResponse(status="ok", checks=checks)


app.include_router(identity_router)
app.include_router(configuration_router)
app.include_router(product_facts_router)
app.include_router(planning_router)
app.include_router(production_router)
app.include_router(publication_router)
app.include_router(observation_router)
app.include_router(files_router)
