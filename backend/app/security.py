"""密码、会话令牌和 CSRF 令牌的安全原语。"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

from app.config import settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """使用 Argon2id 保存内部账号密码。"""
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """校验密码，任何格式或密码错误均返回失败。"""
    try:
        return password_hasher.verify(password_hash, password)
    except VerificationError:
        return False


def generate_token() -> str:
    """生成具有足够熵的浏览器会话或 CSRF 明文令牌。"""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """使用部署密钥生成令牌摘要，数据库不保存可直接使用的明文。"""
    return hmac.new(
        settings.session_secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256
    ).hexdigest()
