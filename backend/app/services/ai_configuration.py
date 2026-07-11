"""AI 配置在持久化与外部调用之间的共享业务边界。"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import AIChannel, AIChannelHeader
from app.services.credentials import CredentialCipher


def request_credentials(
    db: Session,
    channel: AIChannel,
    *,
    sensitive_header_names: Sequence[str] | None = None,
) -> tuple[str, dict[str, str]]:
    """仅在外部调用边界解密渠道凭据；生成作业只读取快照锁定的敏感 Header。"""
    cipher = CredentialCipher(settings.ai_credential_encryption_key)
    api_key = cipher.decrypt(
        channel.api_key_ciphertext, associated_data=f"ai_channel:{channel.id}:api_key"
    )
    query = select(AIChannelHeader).where(AIChannelHeader.channel_id == channel.id)
    expected_names: set[str] | None = None
    if sensitive_header_names is not None:
        expected_names = {name.casefold() for name in sensitive_header_names}
        if not expected_names:
            return api_key, {}
        query = query.where(
            AIChannelHeader.is_sensitive.is_(True),
            AIChannelHeader.normalized_name.in_(expected_names),
        )
    headers: dict[str, str] = {}
    found_names: set[str] = set()
    for item in db.scalars(query):
        found_names.add(item.normalized_name)
        if item.is_sensitive:
            if item.encrypted_value is None:
                raise AppError("CREDENTIAL_DECRYPTION_FAILED", "敏感 Header 未配置", 409)
            value = cipher.decrypt(
                item.encrypted_value,
                associated_data=f"ai_channel_header:{item.id}:value",
            )
        else:
            if item.plain_value is None:
                raise AppError("INVALID_HEADER", "普通 Header 未配置", 409)
            value = item.plain_value
        headers[item.name] = value
    if expected_names is not None and found_names != expected_names:
        raise AppError(
            "AI_CONFIGURATION_DELETED",
            "作业快照引用的敏感 Header 已删除或已改为普通 Header",
            409,
        )
    return api_key, headers


def build_snapshot_request_headers(
    plain_headers: dict[str, str],
    sensitive_header_names: Sequence[str],
    current_sensitive_headers: dict[str, str],
) -> dict[str, str]:
    """以快照名称组装 Header，避免配置变更改变旧作业的请求边界。"""
    current_by_normalized = {
        name.casefold(): value for name, value in current_sensitive_headers.items()
    }
    headers = dict(plain_headers)
    for name in sensitive_header_names:
        value = current_by_normalized.get(name.casefold())
        if value is None:
            raise AppError(
                "AI_CONFIGURATION_DELETED",
                "作业快照引用的敏感 Header 当前不可用",
                409,
            )
        headers[name] = value
    return headers
