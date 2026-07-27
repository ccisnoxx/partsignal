"""开发对象存储签名协议与 EvidenceStorage 适配器。"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import quote

import httpx
import oss2

from app.config import settings


def sign_storage_request(operation: str, object_key: str, expires: int) -> str:
    """签署开发对象存储的单一对象、操作和过期时间。"""
    message = f"{operation}\n{object_key}\n{expires}".encode()
    return hmac.new(
        settings.development_storage_signing_key.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def signed_storage_url(
    operation: str, object_key: str, expires_at: datetime, *, internal: bool = False
) -> str:
    """构造开发服务限时 URL，不冒充阿里云 OSS。"""
    expires = int(expires_at.timestamp())
    signature = sign_storage_request(operation, object_key, expires)
    base_url = (
        settings.development_storage_internal_url
        if internal
        else settings.development_storage_public_url
    )
    return (
        f"{base_url}/objects/{quote(object_key, safe='/')}"
        f"?operation={operation}&expires={expires}&signature={signature}"
    )


@dataclass(frozen=True)
class ObjectMetadata:
    """HEAD 校验所需的可信对象元数据。"""

    size: int
    sha256: str
    content_type: str


@dataclass(frozen=True)
class UploadAuthorization:
    """浏览器直传需要的限时 URL 和强制请求头。"""

    url: str
    headers: dict[str, str]


class EvidenceStorage(Protocol):
    """开发存储和阿里云 OSS 共同遵循的最小边界。"""

    def authorize_upload(
        self,
        object_key: str,
        expires_at: datetime,
        *,
        content_type: str,
        sha256: str,
    ) -> UploadAuthorization: ...

    def head(self, object_key: str, expires_at: datetime) -> ObjectMetadata: ...

    def download_url(self, object_key: str, expires_at: datetime) -> str: ...

    def put(
        self,
        object_key: str,
        data: bytes,
        *,
        content_type: str,
        sha256: str,
    ) -> None: ...

    def delete(self, object_key: str) -> None: ...


class StorageObjectMissing(Exception):
    """对象存储明确确认目标对象不存在。"""


class StorageUnavailable(Exception):
    """对象存储发生可重试的网络、鉴权或服务端故障。"""


class DevelopmentEvidenceStorage:
    """通过独立开发服务执行对象读写，文件字节不经过业务 API。"""

    def authorize_upload(
        self,
        object_key: str,
        expires_at: datetime,
        *,
        content_type: str,
        sha256: str,
    ) -> UploadAuthorization:
        return UploadAuthorization(
            url=signed_storage_url("upload", object_key, expires_at),
            headers={"content-type": content_type, "x-meta-sha256": sha256},
        )

    def head(self, object_key: str, expires_at: datetime) -> ObjectMetadata:
        url = signed_storage_url("head", object_key, expires_at, internal=True)
        try:
            response = httpx.head(url, timeout=5)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 404:
                raise StorageObjectMissing("开发对象存储中不存在该对象") from error
            raise StorageUnavailable("开发对象存储 HEAD 请求失败") from error
        except httpx.RequestError as error:
            raise StorageUnavailable("开发对象存储暂时不可用") from error
        return ObjectMetadata(
            size=int(response.headers["x-object-size"]),
            sha256=response.headers["x-meta-sha256"],
            content_type=response.headers["content-type"].split(";", 1)[0],
        )

    def download_url(self, object_key: str, expires_at: datetime) -> str:
        return signed_storage_url("download", object_key, expires_at)

    def put(
        self,
        object_key: str,
        data: bytes,
        *,
        content_type: str,
        sha256: str,
    ) -> None:
        """通过内部签名 URL 保存服务端已经校验的对象。"""
        expires_at = datetime.now(UTC) + timedelta(seconds=60)
        url = signed_storage_url("upload", object_key, expires_at, internal=True)
        try:
            response = httpx.put(
                url,
                content=data,
                headers={"content-type": content_type, "x-meta-sha256": sha256},
                timeout=10,
            )
            response.raise_for_status()
        except (httpx.HTTPStatusError, httpx.RequestError) as error:
            raise StorageUnavailable("开发对象存储 PUT 请求失败") from error

    def delete(self, object_key: str) -> None:
        """幂等删除开发对象及其元数据。"""
        expires_at = datetime.now(UTC) + timedelta(seconds=60)
        url = signed_storage_url("delete", object_key, expires_at, internal=True)
        try:
            response = httpx.delete(url, timeout=10)
            if response.status_code != 404:
                response.raise_for_status()
        except (httpx.HTTPStatusError, httpx.RequestError) as error:
            raise StorageUnavailable("开发对象存储 DELETE 请求失败") from error


class AliyunOssEvidenceStorage:
    """使用最小权限 RAM 凭据签发 OSS 直传和下载 URL。"""

    def __init__(self) -> None:
        required = {
            "OSS_ENDPOINT": settings.oss_endpoint,
            "OSS_BUCKET": settings.oss_bucket,
            "OSS_ACCESS_KEY_ID": settings.oss_access_key_id,
            "OSS_ACCESS_KEY_SECRET": settings.oss_access_key_secret,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"阿里云 OSS 配置不完整：{', '.join(missing)}")
        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        self.bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket)

    @staticmethod
    def _expires_in(expires_at: datetime) -> int:
        return max(1, int((expires_at - datetime.now(UTC)).total_seconds()))

    def authorize_upload(
        self,
        object_key: str,
        expires_at: datetime,
        *,
        content_type: str,
        sha256: str,
    ) -> UploadAuthorization:
        headers = {"Content-Type": content_type, "x-oss-meta-sha256": sha256}
        url = str(
            self.bucket.sign_url(
                "PUT",
                object_key,
                self._expires_in(expires_at),
                headers=headers,
                slash_safe=True,
            )
        )
        return UploadAuthorization(url=url, headers=headers)

    def head(self, object_key: str, expires_at: datetime) -> ObjectMetadata:
        del expires_at
        try:
            result = self.bucket.head_object(object_key)
        except oss2.exceptions.NoSuchKey as error:
            raise StorageObjectMissing("阿里云 OSS 中不存在该对象") from error
        except oss2.exceptions.OssError as error:
            raise StorageUnavailable("阿里云 OSS HEAD 请求失败") from error
        headers = {key.casefold(): value for key, value in result.headers.items()}
        return ObjectMetadata(
            size=int(headers["content-length"]),
            sha256=headers.get("x-oss-meta-sha256", ""),
            content_type=headers.get("content-type", "").split(";", 1)[0],
        )

    def download_url(self, object_key: str, expires_at: datetime) -> str:
        return str(
            self.bucket.sign_url(
                "GET", object_key, self._expires_in(expires_at), slash_safe=True
            )
        )

    def put(
        self,
        object_key: str,
        data: bytes,
        *,
        content_type: str,
        sha256: str,
    ) -> None:
        """保存后端已经校验的对象字节与完整性元数据。"""
        try:
            self.bucket.put_object(
                object_key,
                data,
                headers={"Content-Type": content_type, "x-oss-meta-sha256": sha256},
            )
        except oss2.exceptions.OssError as error:
            raise StorageUnavailable("阿里云 OSS PUT 请求失败") from error

    def delete(self, object_key: str) -> None:
        """幂等删除 OSS 对象；目标不存在同样视为成功。"""
        try:
            self.bucket.delete_object(object_key)
        except oss2.exceptions.NoSuchKey:
            return
        except oss2.exceptions.OssError as error:
            raise StorageUnavailable("阿里云 OSS DELETE 请求失败") from error


def get_evidence_storage() -> EvidenceStorage:
    """按显式配置选择存储；未知值直接失败，不回退到开发服务。"""
    if settings.object_storage_backend == "development":
        return DevelopmentEvidenceStorage()
    if settings.object_storage_backend == "aliyun_oss":
        return AliyunOssEvidenceStorage()
    raise RuntimeError(f"未知 OBJECT_STORAGE_BACKEND：{settings.object_storage_backend}")


def storage_request_valid(operation: str, object_key: str, expires: int, signature: str) -> bool:
    """验证签名和期限，失败时不回退到匿名访问。"""
    if expires < int(datetime.now(UTC).timestamp()):
        return False
    expected = sign_storage_request(operation, object_key, expires)
    return hmac.compare_digest(expected, signature)
