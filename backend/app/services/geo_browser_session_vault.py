"""专用加密卷；API 仅持 RSA 公钥，不具备恢复会话明文的能力。"""

from __future__ import annotations

import base64
import binascii
import errno
import hashlib
import hmac
import json
import os
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.errors import AppError
from app.services.geo_browser_storage_state import MAX_STORAGE_STATE_BYTES

MAX_ENVELOPE_BYTES = 256 * 1024
_ALGORITHM = "RSA-OAEP-SHA256+A256GCM"
_FIELDS = {
    "version",
    "algorithm",
    "reference",
    "profile_id",
    "expires_at",
    "aad",
    "wrapped_key",
    "nonce",
    "ciphertext",
}


def _unavailable() -> AppError:
    return AppError("DEPENDENCY_UNAVAILABLE", "浏览器会话加密存储不可用", 503)


def _unreadable() -> AppError:
    return AppError("GEO_BROWSER_SESSION_UNREADABLE", "浏览器会话密文无法读取", 409)


@contextmanager
def _directory(path: str) -> Iterator[int]:
    """逐级 nofollow 打开目录，后续操作只使用固定目录描述符。"""
    descriptor = -1
    try:
        absolute = Path(os.path.abspath(path))
        descriptor = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for part in absolute.parts[1:]:
            following = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
            )
            os.close(descriptor)
            descriptor = following
        yield descriptor
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _filename(reference: UUID) -> str:
    if not isinstance(reference, UUID):
        raise _unavailable()
    return f"{reference}.json"


def _read_bounded(descriptor: int, maximum: int) -> bytes:
    chunks: list[bytes] = []
    length = 0
    while length <= maximum:
        chunk = os.read(descriptor, min(64 * 1024, maximum + 1 - length))
        if not chunk:
            break
        chunks.append(chunk)
        length += len(chunk)
    return b"".join(chunks)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _check_envelope(value: str, reference: UUID) -> None:
    envelope = json.loads(value, object_pairs_hook=_unique_object)
    if (
        not isinstance(envelope, dict)
        or set(envelope) != _FIELDS
        or type(envelope["version"]) is not int
        or envelope["version"] != 1
        or envelope["algorithm"] != _ALGORITHM
        or envelope["reference"] != str(reference)
        or any(not isinstance(envelope[field], str) for field in _FIELDS - {"version"})
    ):
        raise ValueError
    if str(UUID(envelope["profile_id"])) != envelope["profile_id"]:
        raise ValueError
    expiry = datetime.fromisoformat(envelope["expires_at"])
    if (
        expiry.utcoffset() is None
        or expiry.astimezone(UTC).isoformat(timespec="microseconds") != envelope["expires_at"]
    ):
        raise ValueError
    aad = (
        f"partsignal:geo-browser-session:v1:{reference}:"
        f"{envelope['profile_id']}:{envelope['expires_at']}"
    )
    if envelope["aad"] != aad:
        raise ValueError
    for field in ("wrapped_key", "nonce", "ciphertext"):
        decoded = base64.b64decode(envelope[field], validate=True)
        if base64.b64encode(decoded).decode("ascii") != envelope[field]:
            raise ValueError
        if (
            (field == "wrapped_key" and len(decoded) < 384)
            or (field == "nonce" and len(decoded) != 12)
            or (field == "ciphertext" and not 16 < len(decoded) <= MAX_STORAGE_STATE_BYTES + 16)
        ):
            raise ValueError


class BrowserSessionVault:
    """创建不可覆盖的 UUID 密文对象；PG 引用与撤销由应用服务仲裁。"""

    def __init__(self, root: str, public_key_file: str) -> None:
        self._root = root
        try:
            if not root or not public_key_file:
                raise ValueError
            with self._root_directory():
                pass
            key_path = Path(public_key_file)
            with _directory(str(key_path.parent)) as directory:
                descriptor = os.open(
                    key_path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory
                )
                try:
                    metadata = os.fstat(descriptor)
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 16 * 1024:
                        raise ValueError
                    payload = _read_bounded(descriptor, 16 * 1024)
                    if len(payload) != metadata.st_size:
                        raise ValueError
                    key = serialization.load_pem_public_key(payload)
                finally:
                    os.close(descriptor)
            if not isinstance(key, rsa.RSAPublicKey) or key.key_size < 3072:
                raise ValueError
            self._public_key = key
        except (OSError, ValueError, TypeError, UnsupportedAlgorithm):
            raise _unavailable() from None

    @contextmanager
    def _root_directory(self) -> Iterator[int]:
        with _directory(self._root) as descriptor:
            if os.fstat(descriptor).st_mode & 0o007:
                raise _unavailable()
            yield descriptor

    def write(self, reference: UUID, profile_id: UUID, expires_at: datetime, plaintext: str) -> str:
        """密文完成 fsync 后以无覆盖链接发布；失败不得发布数据库引用。"""
        filename = _filename(reference)
        temporary = f".{reference}.{uuid4()}.tmp"
        try:
            if not isinstance(profile_id, UUID) or expires_at.utcoffset() is None:
                raise ValueError
            encoded = plaintext.encode("utf-8")
            if not 0 < len(encoded) <= MAX_STORAGE_STATE_BYTES:
                raise ValueError
            expiry = expires_at.astimezone(UTC).isoformat(timespec="microseconds")
            aad = f"partsignal:geo-browser-session:v1:{reference}:{profile_id}:{expiry}"
            key = AESGCM.generate_key(bit_length=256)
            nonce = os.urandom(12)
            encrypted = AESGCM(key).encrypt(nonce, encoded, aad.encode("utf-8"))
            wrapped = self._public_key.encrypt(
                key,
                padding.OAEP(
                    mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None
                ),
            )
            envelope = json.dumps(
                {
                    "version": 1,
                    "algorithm": _ALGORITHM,
                    "reference": str(reference),
                    "profile_id": str(profile_id),
                    "expires_at": expiry,
                    "aad": aad,
                    "wrapped_key": base64.b64encode(wrapped).decode("ascii"),
                    "nonce": base64.b64encode(nonce).decode("ascii"),
                    "ciphertext": base64.b64encode(encrypted).decode("ascii"),
                },
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
            if len(envelope) > MAX_ENVELOPE_BYTES:
                raise ValueError
            with self._root_directory() as directory:
                descriptor = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=directory,
                )
                try:
                    with os.fdopen(descriptor, "wb") as handle:
                        os.fchmod(handle.fileno(), 0o600)
                        handle.write(envelope)
                        handle.flush()
                        os.fsync(handle.fileno())
                    os.link(
                        temporary,
                        filename,
                        src_dir_fd=directory,
                        dst_dir_fd=directory,
                        follow_symlinks=False,
                    )
                finally:
                    os.unlink(temporary, dir_fd=directory)
                os.fsync(directory)
            return hashlib.sha256(envelope).hexdigest()
        except (OSError, ValueError, TypeError, AttributeError):
            raise _unavailable() from None

    def read(self, reference: UUID, expected_sha256: str) -> str:
        """验证完整对象与数据库哈希，不解密或推断远端登录健康。"""
        filename = _filename(reference)
        try:
            with self._root_directory() as directory:
                try:
                    descriptor = os.open(
                        filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory
                    )
                except FileNotFoundError:
                    raise AppError(
                        "GEO_BROWSER_SESSION_MISSING", "浏览器会话密文不存在", 409
                    ) from None
                except OSError as error:
                    if error.errno == errno.ELOOP:
                        raise _unreadable() from None
                    raise
                try:
                    metadata = os.fstat(descriptor)
                    if (
                        not stat.S_ISREG(metadata.st_mode)
                        or stat.S_IMODE(metadata.st_mode) != 0o600
                        or not 0 < metadata.st_size <= MAX_ENVELOPE_BYTES
                    ):
                        raise _unreadable()
                    payload = _read_bounded(descriptor, MAX_ENVELOPE_BYTES)
                finally:
                    os.close(descriptor)
            if len(payload) != metadata.st_size or not hmac.compare_digest(
                hashlib.sha256(payload).hexdigest(), expected_sha256
            ):
                raise ValueError
            result = payload.decode("utf-8")
            _check_envelope(result, reference)
            return result
        except (ValueError, TypeError, binascii.Error, RecursionError):
            raise _unreadable() from None
        except OSError:
            raise _unavailable() from None

    def delete(self, reference: UUID) -> None:
        """撤销墓碑提交后删除对象；不存在幂等，IO 失败由服务记录清理待办。"""
        filename = _filename(reference)
        try:
            with self._root_directory() as directory:
                try:
                    os.unlink(filename, dir_fd=directory)
                except FileNotFoundError:
                    return
                os.fsync(directory)
        except OSError:
            raise _unavailable() from None
