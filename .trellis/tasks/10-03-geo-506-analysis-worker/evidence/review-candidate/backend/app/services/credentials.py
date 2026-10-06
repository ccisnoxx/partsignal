"""AI 渠道凭据的认证加密边界。"""

from __future__ import annotations

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.errors import AppError


class CredentialCipher:
    """使用 AES-256-GCM 和记录关联数据保护短期凭据。"""

    def __init__(self, encoded_key: str) -> None:
        try:
            key = base64.b64decode(encoded_key, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("AI_CREDENTIAL_ENCRYPTION_KEY 必须是 Base64") from error
        if len(key) != 32:
            raise ValueError("AI_CREDENTIAL_ENCRYPTION_KEY 解码后必须为 32 字节")
        self._cipher = AESGCM(key)

    def encrypt(self, value: str, *, associated_data: str) -> str:
        """加密非空凭据并把记录身份绑定到认证标签。"""
        if not value:
            raise AppError("VALIDATION_ERROR", "凭据不能为空", 422)
        nonce = os.urandom(12)
        ciphertext = self._cipher.encrypt(
            nonce, value.encode("utf-8"), associated_data.encode("utf-8")
        )
        return "v1." + base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")

    def decrypt(self, value: str, *, associated_data: str) -> str:
        """解密凭据；格式、密钥或记录绑定错误均显式失败。"""
        try:
            version, encoded = value.split(".", 1)
            if version != "v1":
                raise ValueError
            payload = base64.urlsafe_b64decode(encoded.encode("ascii"))
            if len(payload) <= 12:
                raise ValueError
            plaintext = self._cipher.decrypt(
                payload[:12], payload[12:], associated_data.encode("utf-8")
            )
            return plaintext.decode("utf-8")
        except (ValueError, UnicodeError, binascii.Error, InvalidTag) as error:
            raise AppError("CREDENTIAL_DECRYPTION_FAILED", "AI 渠道凭据无法解密", 409) from error
