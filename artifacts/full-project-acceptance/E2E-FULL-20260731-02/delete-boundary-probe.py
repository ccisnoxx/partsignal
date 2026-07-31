"""在隔离 PostgreSQL 中验证 13 个 DELETE 路由的认证、角色与 CSRF 边界。"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_db  # noqa: E402
from app.deps import get_current_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models.identity import User  # noqa: E402
from app.security import hash_token  # noqa: E402


def load_temporary_database():
    """复用现有集成测试的隔离数据库契约，不建立第二套清理逻辑。"""
    source = (
        BACKEND_ROOT
        / "tests"
        / "integration"
        / "test_publication_review_closure.py"
    )
    spec = importlib.util.spec_from_file_location("publication_review_tests", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载隔离数据库测试工具")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.temporary_database


def main() -> None:
    """执行边界矩阵；任何状态偏离合同都以断言失败退出。"""
    target = uuid.uuid4()
    routes = [
        ("用户", f"/api/v1/users/{target}", False),
        ("产品", f"/api/v1/products/{target}", False),
        ("事实版本", f"/api/v1/fact-versions/{target}", False),
        ("内容任务", f"/api/v1/content-tasks/{target}", True),
        ("发布账号", f"/api/v1/platform-accounts/{target}", False),
        ("发布记录", f"/api/v1/publication-records/{target}", True),
        ("GEO 人工观测链", f"/api/v1/geo-observations/{target}", False),
        ("平台类型", f"/api/v1/platform-types/{target}", False),
        (
            "平台 Prompt",
            f"/api/v1/platform-prompts/{target}?expected_revision=0",
            False,
        ),
        ("平台", f"/api/v1/platform-profiles/{target}", False),
        ("AI 渠道", f"/api/v1/ai-channels/{target}", False),
        ("AI 请求 Header", f"/api/v1/ai-channel-headers/{target}", False),
        ("AI 模型", f"/api/v1/ai-models/{target}", False),
    ]
    csrf_token = "delete-boundary-csrf-token-more-than-32-characters"
    temporary_database = load_temporary_database()

    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            admin = User(
                username=f"boundary-admin-{uuid.uuid4().hex[:8]}",
                display_name="删除边界管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            engineer = User(
                username=f"boundary-engineer-{uuid.uuid4().hex[:8]}",
                display_name="删除边界工程师",
                password_hash="not-used",
                account_type="ENGINEER",
            )
            db.add_all([admin, engineer])
            db.commit()

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        client = TestClient(app)
        session = SimpleNamespace(
            user=engineer,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        rows: list[tuple[str, int, int, int, int, int]] = []
        try:
            for name, path, engineer_allowed in routes:
                app.dependency_overrides.pop(get_current_session, None)
                anonymous = client.delete(path).status_code

                app.dependency_overrides[get_current_session] = lambda: session
                session.user = engineer
                engineer_status = client.delete(
                    path,
                    headers={"X-CSRF-Token": csrf_token},
                ).status_code

                session.user = admin
                missing_csrf = client.delete(path).status_code
                invalid_csrf = client.delete(
                    path,
                    headers={
                        "X-CSRF-Token": "wrong-token-with-more-than-32-characters"
                    },
                ).status_code
                not_found = client.delete(
                    path,
                    headers={"X-CSRF-Token": csrf_token},
                ).status_code

                assert anonymous == 401, (name, "anonymous", anonymous)
                assert engineer_status == (404 if engineer_allowed else 403), (
                    name,
                    "engineer",
                    engineer_status,
                )
                assert missing_csrf == 422, (name, "missing_csrf", missing_csrf)
                assert invalid_csrf == 403, (name, "invalid_csrf", invalid_csrf)
                assert not_found == 404, (name, "not_found", not_found)
                rows.append(
                    (
                        name,
                        anonymous,
                        engineer_status,
                        missing_csrf,
                        invalid_csrf,
                        not_found,
                    )
                )
        finally:
            app.dependency_overrides.clear()
            client.close()
            engine.dispose()

    print("对象,匿名,工程师,管理员缺失CSRF,管理员错误CSRF,管理员不存在对象")
    for row in rows:
        print(",".join(str(value) for value in row))
    print(f"PASS: {len(rows)}/13 DELETE 边界矩阵")


if __name__ == "__main__":
    main()
