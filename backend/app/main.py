"""FastAPI 应用入口与跨模块基础设施。"""

from __future__ import annotations

import logging
import time
import uuid
from copy import deepcopy
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from redis import Redis
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db import engine
from app.errors import (
    AppError,
    app_error_handler,
    error_response,
    error_responses,
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
from app.routers.workbench import router as workbench_router
from app.schemas.common import HealthResponse

logger = logging.getLogger("partsignal.api")

REQUEST_ID_HEADER_NAME = "X-Request-ID"
REQUEST_ID_MIN_LENGTH = 1
REQUEST_ID_MAX_LENGTH = 100
REQUEST_ID_PATTERN = r"^[\x20-\x7E]+$"

_OPENAPI_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
_REQUEST_ID_PARAMETER_COMPONENT = "RequestIdHeader"
_REQUEST_ID_RESPONSE_HEADER_COMPONENT = "RequestIdResponseHeader"
_ERROR_RESPONSE_COMPONENT = "ErrorResponse"


def _request_id_schema() -> dict[str, Any]:
    return {
        "type": "string",
        "minLength": REQUEST_ID_MIN_LENGTH,
        "maxLength": REQUEST_ID_MAX_LENGTH,
        "pattern": REQUEST_ID_PATTERN,
    }


def _request_context_components() -> dict[str, dict[str, Any]]:
    """集中定义 request-context 的公共 OpenAPI machine metadata。"""
    return {
        "parameters": {
            _REQUEST_ID_PARAMETER_COMPONENT: {
                "name": REQUEST_ID_HEADER_NAME,
                "in": "header",
                "required": False,
                "schema": _request_id_schema(),
            }
        },
        "headers": {
            _REQUEST_ID_RESPONSE_HEADER_COMPONENT: {
                "required": True,
                "schema": _request_id_schema(),
            }
        },
        "responses": {
            _ERROR_RESPONSE_COMPONENT: {
                "description": "业务或校验错误",
                "headers": {
                    REQUEST_ID_HEADER_NAME: {
                        "$ref": (
                            "#/components/headers/"
                            f"{_REQUEST_ID_RESPONSE_HEADER_COMPONENT}"
                        )
                    }
                },
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/ErrorEnvelope"}
                    }
                },
            }
        },
    }


def _local_component(document: dict[str, Any], reference: str) -> dict[str, Any] | None:
    """解析本地 component ref；无法解析时返回 None 供冲突检查显式失败。"""
    prefix = "#/components/"
    if not reference.startswith(prefix):
        return None
    path = reference[len(prefix) :].split("/")
    if len(path) != 2:
        return None
    components = document.get("components")
    if not isinstance(components, dict):
        return None
    section = components.get(path[0])
    if not isinstance(section, dict):
        return None
    value = section.get(path[1])
    return value if isinstance(value, dict) else None


def _resolved_parameter(document: dict[str, Any], parameter: Any) -> dict[str, Any] | None:
    if not isinstance(parameter, dict):
        return None
    if "$ref" in parameter:
        reference = parameter["$ref"]
        if not isinstance(reference, str):
            return None
        return _local_component(document, reference)
    return parameter


def _resolved_response(document: dict[str, Any], response: Any) -> dict[str, Any] | None:
    if not isinstance(response, dict):
        return None
    if "$ref" in response:
        reference = response["$ref"]
        if not isinstance(reference, str):
            return None
        return _local_component(document, reference)
    return response


def _ensure_component(
    document: dict[str, Any], section_name: str, component_name: str, expected: dict[str, Any]
) -> None:
    components = document.setdefault("components", {})
    if not isinstance(components, dict):
        raise RuntimeError("OpenAPI components 必须是 mapping")
    section = components.setdefault(section_name, {})
    if not isinstance(section, dict):
        raise RuntimeError(f"OpenAPI components.{section_name} 必须是 mapping")
    existing = section.get(component_name)
    if existing is not None and existing != expected:
        raise RuntimeError(f"OpenAPI component 冲突: {section_name}/{component_name}")
    section[component_name] = deepcopy(expected)


def _merge_request_context_metadata(document: dict[str, Any]) -> None:
    """向 FastAPI 原始 route document 追加跨切面 metadata，不重写业务声明。"""
    components = _request_context_components()
    _ensure_component(
        document,
        "parameters",
        _REQUEST_ID_PARAMETER_COMPONENT,
        components["parameters"][_REQUEST_ID_PARAMETER_COMPONENT],
    )
    _ensure_component(
        document,
        "headers",
        _REQUEST_ID_RESPONSE_HEADER_COMPONENT,
        components["headers"][_REQUEST_ID_RESPONSE_HEADER_COMPONENT],
    )
    _ensure_component(
        document,
        "responses",
        _ERROR_RESPONSE_COMPONENT,
        components["responses"][_ERROR_RESPONSE_COMPONENT],
    )

    request_parameter_ref = {"$ref": f"#/components/parameters/{_REQUEST_ID_PARAMETER_COMPONENT}"}
    response_header_ref = {
        "$ref": f"#/components/headers/{_REQUEST_ID_RESPONSE_HEADER_COMPONENT}"
    }
    error_response_ref = {"$ref": f"#/components/responses/{_ERROR_RESPONSE_COMPONENT}"}

    for path_item in document.get("paths", {}).values():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in _OPENAPI_METHODS or not isinstance(operation, dict):
                continue
            parameters = operation.setdefault("parameters", [])
            if not isinstance(parameters, list):
                raise RuntimeError(f"OpenAPI operation.parameters 必须是 list: {method}")
            matching_parameters: list[dict[str, Any]] = []
            for parameter in parameters:
                resolved_parameter = _resolved_parameter(document, parameter)
                if (
                    resolved_parameter is not None
                    and resolved_parameter.get("name") == REQUEST_ID_HEADER_NAME
                    and resolved_parameter.get("in") == "header"
                ):
                    matching_parameters.append(resolved_parameter)
            if matching_parameters:
                expected_parameter = components["parameters"][_REQUEST_ID_PARAMETER_COMPONENT]
                if any(parameter != expected_parameter for parameter in matching_parameters):
                    raise RuntimeError(f"OpenAPI request Header 冲突: {method}")
            else:
                parameters.append(deepcopy(request_parameter_ref))

            responses = operation.get("responses")
            if not isinstance(responses, dict):
                raise RuntimeError(f"OpenAPI operation.responses 必须是 mapping: {method}")
            existing_400 = responses.get("400")
            if existing_400 is None:
                responses["400"] = deepcopy(error_response_ref)
            else:
                resolved_400 = _resolved_response(document, existing_400)
                expected_error = components["responses"][_ERROR_RESPONSE_COMPONENT]
                if resolved_400 != expected_error:
                    raise RuntimeError(f"OpenAPI 400 response 冲突: {method}")

            for response in responses.values():
                resolved_response = _resolved_response(document, response)
                if resolved_response is None:
                    raise RuntimeError(f"OpenAPI response ref 无法解析: {method}")
                headers = resolved_response.setdefault("headers", {})
                if not isinstance(headers, dict):
                    raise RuntimeError(f"OpenAPI response.headers 必须是 mapping: {method}")
                existing_header = next(
                    (
                        value
                        for name, value in headers.items()
                        if isinstance(name, str) and name.lower() == REQUEST_ID_HEADER_NAME.lower()
                    ),
                    None,
                )
                if existing_header is not None and existing_header != response_header_ref:
                    resolved_existing_header = (
                        _local_component(document, existing_header["$ref"])
                        if isinstance(existing_header, dict) and "$ref" in existing_header
                        and isinstance(existing_header["$ref"], str)
                        else existing_header
                    )
                    expected_header = components["headers"][_REQUEST_ID_RESPONSE_HEADER_COMPONENT]
                    if resolved_existing_header != expected_header:
                        raise RuntimeError(f"OpenAPI response Header 冲突: {method}")
                else:
                    headers[REQUEST_ID_HEADER_NAME] = deepcopy(response_header_ref)


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
    started = time.monotonic()
    supplied_request_id = request.headers.get(REQUEST_ID_HEADER_NAME)
    request.state.request_id = str(uuid.uuid4())
    if supplied_request_id is not None and (
        not REQUEST_ID_MIN_LENGTH
        <= len(supplied_request_id)
        <= REQUEST_ID_MAX_LENGTH
        or not supplied_request_id.isascii()
        or not supplied_request_id.isprintable()
    ):
        response = error_response(
            request,
            AppError(
                "VALIDATION_ERROR",
                "X-Request-ID 必须是 1-100 个可打印 ASCII 字符",
                400,
            ),
        )
    else:
        if supplied_request_id is not None:
            request.state.request_id = supplied_request_id
        response = await call_next(request)
    response.headers[REQUEST_ID_HEADER_NAME] = request.state.request_id
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
    responses=error_responses(503),
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
app.include_router(workbench_router)
app.include_router(files_router)


def _custom_openapi() -> dict[str, Any]:
    if app.openapi_schema is None:
        schema = get_openapi(
            title=app.title,
            version=app.version,
            routes=app.routes,
        )
        _merge_request_context_metadata(schema)
        app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _custom_openapi  # type: ignore[method-assign]
