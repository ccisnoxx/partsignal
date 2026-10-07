"""GEO 恢复集合的受保护文件与流式认证加密；备份密钥不进入集合。"""

from __future__ import annotations

import base64
import hashlib
import os
import stat
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"PSGEO903\x01"
CHUNK = 1024 * 1024


class RecoveryError(Exception):
    """只携带固定错误码，避免底层路径、连接串和秘密进入报告。"""


def private_file(path: Path) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_mode & 0o077
            or info.st_size > 1024 * 1024
        ):
            raise RecoveryError("PRIVATE_FILE_REQUIRED")
        return handle.read()


def backup_key(path: Path) -> bytes:
    value = base64.b64decode(private_file(path).strip(), validate=True)
    if len(value) != 32:
        raise RecoveryError("BACKUP_KEY_INVALID")
    return value


def private_directory(path: Path) -> None:
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.geteuid()
        or info.st_mode & 0o077
    ):
        raise RecoveryError("PRIVATE_DIRECTORY_REQUIRED")


def write_private(path: Path, value: bytes) -> None:
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())


def file_digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest()


def seal(source: Path, destination: Path, key: bytes, aad: str) -> None:
    nonce = os.urandom(12)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(aad.encode("ascii"))
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        os.fchmod(outgoing.fileno(), 0o600)
        outgoing.write(MAGIC + nonce)
        while chunk := incoming.read(CHUNK):
            outgoing.write(encryptor.update(chunk))
        outgoing.write(encryptor.finalize() + encryptor.tag)
        outgoing.flush()
        os.fsync(outgoing.fileno())


def unseal(source: Path, destination: Path, key: bytes, aad: str) -> None:
    """认证完成前仅写隔离临时文件；调用方不得使用未认证内容。"""
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    created = False
    try:
        with os.fdopen(descriptor, "rb") as incoming:
            outgoing = destination.open("xb")
            created = True
            with outgoing:
                _unseal_stream(incoming, outgoing, key, aad)
    except Exception:
        if created:
            destination.unlink(missing_ok=True)
        raise RecoveryError("BUNDLE_AUTHENTICATION_FAILED") from None


def _unseal_stream(incoming, outgoing, key: bytes, aad: str) -> None:
    os.fchmod(outgoing.fileno(), 0o600)
    info = os.fstat(incoming.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_size < len(MAGIC) + 28:
        raise RecoveryError("BUNDLE_INVALID")
    if incoming.read(len(MAGIC)) != MAGIC:
        raise RecoveryError("BUNDLE_INVALID")
    nonce = incoming.read(12)
    incoming.seek(-16, os.SEEK_END)
    tag = incoming.read(16)
    incoming.seek(len(MAGIC) + 12)
    remaining = info.st_size - len(MAGIC) - 28
    decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
    decryptor.authenticate_additional_data(aad.encode("ascii"))
    while remaining:
        chunk = incoming.read(min(CHUNK, remaining))
        if not chunk:
            raise RecoveryError("BUNDLE_INVALID")
        remaining -= len(chunk)
        outgoing.write(decryptor.update(chunk))
    outgoing.write(decryptor.finalize())
