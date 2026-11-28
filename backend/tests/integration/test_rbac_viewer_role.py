"""Slice 1A PostgreSQL 集成测试：验证 0080 迁移、55000 降级拒绝及 VIEWER 全链路权限边界。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.identity import User
from app.security import hash_password
from tests.integration.test_identity_management import temporary_database


@pytest.mark.integration
def test_0080_downgrade_rejected_and_viewer_rbac_end_to_end() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    with temporary_database() as database_url:
        # 1. 验证 0080 降级以 55000 明确拒绝
        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0079_unified_cost_accounting"],
            cwd=backend_dir,
            env={**os.environ, "DATABASE_URL": database_url},
            capture_output=True,
            text=True,
            check=False,
        )
        assert downgrade.returncode != 0
        assert "downgrade 0080_rbac_viewer_role is forbidden" in downgrade.stderr

        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

        def override_get_db() -> Session:
            db = session_factory()
            try:
                yield db
            finally:
                db.close()

        with session_factory() as db:
            admin = User(
                username="rbac_admin",
                display_name="管理员",
                password_hash=hash_password("AdminPass1234!"),
                account_type="ADMIN",
                is_active=True,
                must_change_password=False,
            )
            db.add(admin)
            db.commit()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as admin_client:
                login = admin_client.post(
                    "/api/v1/auth/login",
                    json={"username": "rbac_admin", "password": "AdminPass1234!"},
                )
                assert login.status_code == 200, login.text
                admin_csrf = login.json()["csrf_token"]

                # 2. 管理员创建 VIEWER 账号，检查 summary.viewer_total
                created = admin_client.post(
                    "/api/v1/users",
                    json={
                        "username": "rbac_leader",
                        "display_name": "业务领导",
                        "temporary_password": "LeaderTempPass123!",
                        "account_type": "VIEWER",
                    },
                    headers={"X-CSRF-Token": admin_csrf},
                )
                assert created.status_code == 201, created.text
                assert created.json()["account_type"] == "VIEWER"

                listed = admin_client.get("/api/v1/users")
                assert listed.status_code == 200
                assert listed.json()["summary"]["viewer_total"] == 1
                assert listed.json()["summary"]["admin_total"] == 1

            with TestClient(app) as viewer_client:
                # 3. VIEWER 登录、首次自助改密（允许）
                v_login = viewer_client.post(
                    "/api/v1/auth/login",
                    json={"username": "rbac_leader", "password": "LeaderTempPass123!"},
                )
                assert v_login.status_code == 200, v_login.text
                assert v_login.json()["user"]["account_type"] == "VIEWER"
                v_csrf = v_login.json()["csrf_token"]

                changed = viewer_client.post(
                    "/api/v1/auth/change-password",
                    json={
                        "old_password": "LeaderTempPass123!",
                        "new_password": "LeaderFinalPass123!",
                    },
                    headers={"X-CSRF-Token": v_csrf},
                )
                assert changed.status_code == 204, changed.text
                v_csrf = viewer_client.get("/api/v1/auth/csrf").json()["csrf_token"]

                # 4. VIEWER 访问显式授权只读接口返回 200
                assert viewer_client.get("/api/v1/products").status_code == 200
                assert viewer_client.get("/api/v1/published-articles").status_code == 200
                assert viewer_client.get("/api/v1/platform-profiles").status_code == 200
                assert viewer_client.get("/api/v1/query-topics").status_code == 200
                assert viewer_client.get("/api/v1/geo-observations").status_code == 200

                # 5. VIEWER 访问运营态 GET 与全部写接口被服务端 403 拒绝
                for forbidden_get in (
                    "/api/v1/workbench/inbox",
                    "/api/v1/content-tasks",
                    "/api/v1/publication-works",
                    "/api/v1/content-campaigns",
                    "/api/v1/cost-entries",
                    "/api/v1/users",
                ):
                    resp = viewer_client.get(forbidden_get)
                    assert resp.status_code == 403, f"{forbidden_get} returned {resp.status_code}"
                    assert resp.json()["error"]["code"] == "PERMISSION_DENIED"

                for method, path, body in (
                    (
                        "POST",
                        "/api/v1/products",
                        {"part_number": "LM358", "brand": "TI", "category": "OpAmp"},
                    ),
                    (
                        "POST",
                        "/api/v1/query-topics",
                        {
                            "canonical_question": "低功耗运放推荐",
                            "intent_type": "PRODUCT",
                            "variants": ["低功耗运放推荐"],
                        },
                    ),
                    (
                        "POST",
                        "/api/v1/geo/observation-batches",
                        {"plan_id": "00000000-0000-4000-8000-000000000001"},
                    ),
                ):
                    resp = viewer_client.request(
                        method,
                        path,
                        json=body,
                        headers={
                            "X-CSRF-Token": v_csrf,
                            "Idempotency-Key": "viewer-blocked-key-1",
                        },
                    )
                    assert resp.status_code == 403, f"{method} {path} returned {resp.status_code}"
                    assert resp.json()["error"]["code"] == "PERMISSION_DENIED"
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
            _ = settings.session_cookie_name
