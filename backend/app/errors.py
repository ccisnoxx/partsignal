"""统一业务错误和 API 错误信封。"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class AppError(Exception):
    """携带稳定错误码和 HTTP 状态的可预期业务错误。"""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def error_response(request: Request, error: AppError) -> JSONResponse:
    """将业务错误转换为冻结契约规定的统一信封。"""
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
                "request_id": getattr(request.state, "request_id", "unknown"),
            }
        },
    )


async def app_error_handler(request: Request, error: AppError) -> JSONResponse:
    """处理明确的领域错误。"""
    return error_response(request, error)


async def validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    """保留结构化校验位置，但不向客户端暴露内部堆栈。"""
    return error_response(
        request,
        AppError(
            "VALIDATION_ERROR",
            "请求数据不符合接口契约",
            422,
            {"errors": error.errors()},
        ),
    )


async def integrity_error_handler(request: Request, error: IntegrityError) -> JSONResponse:
    """数据库唯一性和约束冲突统一显式返回，不伪装成功。"""
    return error_response(request, AppError("REVISION_CONFLICT", "数据约束冲突", 409))


def not_found(resource: str) -> AppError:
    """生成一致的资源不存在错误。"""
    return AppError("NOT_FOUND", f"{resource}不存在", 404)


def in_use(code: str, resource: str, references: list[tuple[str, str, int]]) -> AppError:
    """用稳定机器类型和真实数量报告全部直接阻断引用。"""
    existing = [(type_name, label, count) for type_name, label, count in references if count]
    summary = "、".join(f"{label}（{count}）" for _, label, count in existing)
    return AppError(
        code,
        f"{resource}仍被以下对象引用：{summary}",
        409,
        {"references": [{"type": type_name, "count": count} for type_name, _, count in existing]},
    )
