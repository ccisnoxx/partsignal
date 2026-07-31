"""复用既有删除成功探针，验证 13 个 DELETE 路由的同目标双请求。"""

from __future__ import annotations

import importlib.util
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Lock
from typing import Any

from fastapi.testclient import TestClient as StarletteTestClient
from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOURCE = (
    PROJECT_ROOT
    / "artifacts"
    / "full-project-acceptance"
    / "E2E-FULL-20260731-02"
    / "delete-success-repeat-probe.py"
)
REQUEST_ID_PATTERN = re.compile(r"delete-success-\d{2}")


def load_success_probe() -> Any:
    """加载既有目标构造、删除断言和精确隔离数据库清理逻辑。"""
    spec = importlib.util.spec_from_file_location("delete_success_repeat_probe", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载既有删除成功探针")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = load_success_probe()
session_factory: Any = None


def capture_sessionmaker(*args: Any, **kwargs: Any):
    """暴露既有探针的隔离会话工厂，用于核对并发成功审计数量。"""
    global session_factory
    session_factory = probe.original_sessionmaker(*args, **kwargs)
    return session_factory


class ConcurrentDeleteClient(StarletteTestClient):
    """仅把既有探针的首次 DELETE 改成两个同时到达的独立请求。"""

    results: list[tuple[str, int, int, int, int]] = []
    results_lock = Lock()

    def delete(self, url: str, **kwargs: Any):  # type: ignore[no-untyped-def]
        headers = kwargs.get("headers") or {}
        request_id = headers.get("X-Request-ID", "")
        if not REQUEST_ID_PATTERN.fullmatch(request_id):
            return super().delete(url, **kwargs)

        barrier = Barrier(2)

        def issue_request():  # type: ignore[no-untyped-def]
            barrier.wait()
            with StarletteTestClient(probe.app) as peer:
                return peer.delete(url, **kwargs)

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _index: issue_request(), range(2)))

        ordered = sorted(responses, key=lambda response: response.status_code)
        statuses = [response.status_code for response in ordered]
        assert session_factory is not None
        with session_factory() as db:
            success_audit_count = int(
                db.scalar(
                    select(func.count(probe.AuditLog.id)).where(
                        probe.AuditLog.request_id == request_id,
                        probe.AuditLog.outcome == "SUCCESS",
                    )
                )
                or 0
            )
            failed_audit_count = int(
                db.scalar(
                    select(func.count(probe.AuditLog.id)).where(
                        probe.AuditLog.request_id == request_id,
                        probe.AuditLog.outcome != "SUCCESS",
                    )
                )
                or 0
            )
        with self.results_lock:
            self.results.append(
                (url, statuses[0], statuses[1], success_audit_count, failed_audit_count)
            )
        success = next((response for response in ordered if response.status_code == 204), None)
        assert success is not None, (url, statuses, [response.text for response in ordered])
        return success


def main() -> None:
    """运行既有完整断言，并补充逐接口并发结果汇总。"""
    probe.original_sessionmaker = probe.sessionmaker
    probe.sessionmaker = capture_sessionmaker
    probe.TestClient = ConcurrentDeleteClient
    probe.main()
    assert len(ConcurrentDeleteClient.results) == 13, ConcurrentDeleteClient.results
    print("路径,并发成功,并发落后请求,成功审计数,失败审计数")
    for row in ConcurrentDeleteClient.results:
        print(",".join(str(value) for value in row))
    failures = [
        row
        for row in ConcurrentDeleteClient.results
        if row[1:4] != (204, 404, 1)
    ]
    assert not failures, f"同目标双请求结果偏离合同：{failures}"
    print("PASS: 13/13 DELETE 同目标双请求均为单一 204、单一 404")


if __name__ == "__main__":
    main()
