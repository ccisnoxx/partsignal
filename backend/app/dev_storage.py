"""仅用于本地验收的独立对象存储服务。

该服务实现限时 PUT、HEAD、GET 和 DELETE，不连接或模拟成功调用生产 OSS。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import settings
from app.services.storage import storage_request_valid

app = FastAPI(title="PartSignal Development Object Storage", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()
    ],
    allow_methods=["GET", "HEAD", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "x-meta-sha256"],
)


def resolve_object_path(object_key: str) -> Path:
    """确保对象 Key 不能逃逸开发存储根目录。"""
    root = Path(settings.development_storage_path).resolve()
    path = (root / object_key).resolve()
    if root not in path.parents:
        raise HTTPException(status_code=400, detail="对象 Key 非法")
    return path


def metadata_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.metadata.json")


@app.put("/objects/{object_key:path}", status_code=204)
async def put_object(
    object_key: str,
    request: Request,
    operation: str = Query(),
    expires: int = Query(),
    signature: str = Query(),
    x_meta_sha256: str = Header(alias="x-meta-sha256"),
) -> Response:
    """校验签名、长度和哈希后保存浏览器直传字节。"""
    if operation != "upload" or not storage_request_valid(
        operation, object_key, expires, signature
    ):
        raise HTTPException(status_code=403, detail="上传签名无效或已过期")
    data = await request.body()
    digest = hashlib.sha256(data).hexdigest()
    if digest != x_meta_sha256:
        raise HTTPException(status_code=422, detail="对象 SHA-256 不匹配")
    path = resolve_object_path(object_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    metadata_path(path).write_text(
        json.dumps(
            {
                "sha256": digest,
                "size": len(data),
                "content_type": request.headers.get("content-type", "application/octet-stream"),
            }
        ),
        encoding="utf-8",
    )
    return Response(status_code=204)


@app.head("/objects/{object_key:path}")
def head_object(
    object_key: str,
    operation: str = Query(),
    expires: int = Query(),
    signature: str = Query(),
) -> Response:
    """向业务 API 返回对象服务实际保存的元数据。"""
    if operation != "head" or not storage_request_valid(operation, object_key, expires, signature):
        raise HTTPException(status_code=403, detail="HEAD 签名无效或已过期")
    path = resolve_object_path(object_key)
    meta_path = metadata_path(path)
    if not path.is_file() or not meta_path.is_file():
        raise HTTPException(status_code=404, detail="对象不存在")
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    return Response(
        headers={
            "x-object-size": str(metadata["size"]),
            "x-meta-sha256": metadata["sha256"],
            "content-type": metadata["content_type"],
        }
    )


@app.get("/objects/{object_key:path}")
def get_object(
    object_key: str,
    operation: str = Query(),
    expires: int = Query(),
    signature: str = Query(),
) -> FileResponse:
    """通过短期下载签名读取已保存对象。"""
    if operation != "download" or not storage_request_valid(
        operation, object_key, expires, signature
    ):
        raise HTTPException(status_code=403, detail="下载签名无效或已过期")
    path = resolve_object_path(object_key)
    meta_path = metadata_path(path)
    if not path.is_file() or not meta_path.is_file():
        raise HTTPException(status_code=404, detail="对象不存在")
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    return FileResponse(path, media_type=metadata["content_type"])


@app.delete("/objects/{object_key:path}", status_code=204)
def delete_object(
    object_key: str,
    operation: str = Query(),
    expires: int = Query(),
    signature: str = Query(),
) -> Response:
    """幂等删除对象及其元数据；任一文件缺失不影响结果。"""
    if operation != "delete" or not storage_request_valid(
        operation, object_key, expires, signature
    ):
        raise HTTPException(status_code=403, detail="删除签名无效或已过期")
    path = resolve_object_path(object_key)
    path.unlink(missing_ok=True)
    metadata_path(path).unlink(missing_ok=True)
    return Response(status_code=204)
