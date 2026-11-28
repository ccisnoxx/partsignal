"""Slice 1B PostgreSQL 集成测试：文章与多 URL 台账、PUBLIC 复制边界及不可变约束。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.identity import User
from app.security import hash_password
from tests.integration.test_identity_management import temporary_database


@pytest.mark.integration
def test_0081_articles_publications_ledger_and_public_copy_bundle() -> None:
    backend_dir = Path(__file__).resolve().parents[2]
    with temporary_database() as database_url:
        # 1. 验证 0081 降级以 55000 明确拒绝
        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0080_rbac_viewer_role"],
            cwd=backend_dir,
            env={**os.environ, "DATABASE_URL": database_url},
            capture_output=True,
            text=True,
            check=False,
        )
        assert downgrade.returncode != 0
        assert "downgrade 0081_articles_publications is forbidden" in downgrade.stderr

        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

        def override_get_db() -> Session:
            db = session_factory()
            try:
                yield db
            finally:
                db.close()

        with session_factory() as db:
            engineer = User(
                username="ops_1b",
                display_name="运营同学",
                password_hash=hash_password("OpsPass12345!"),
                account_type="ENGINEER",
                is_active=True,
                must_change_password=False,
            )
            viewer = User(
                username="leader_1b",
                display_name="领导只读",
                password_hash=hash_password("LeaderPass123!"),
                account_type="VIEWER",
                is_active=True,
                must_change_password=False,
            )
            db.add_all([engineer, viewer])
            db.commit()

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as client:
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": "ops_1b", "password": "OpsPass12345!"},
                )
                assert login.status_code == 200
                csrf = login.json()["csrf_token"]
                headers = {"X-CSRF-Token": csrf}

                # 2. 创建产品（含轻量简介与数据手册链接），无需审批 FactVersion 即可录稿
                prod = client.post(
                    "/api/v1/products",
                    json={
                        "part_number": "PS-OPA2333",
                        "brand": "PartSignal",
                        "category": "低功耗运放",
                        "summary": "超低失调精密运放，适用于工业传感器前端",
                        "datasheet_url": "https://example.com/datasheets/ps-opa2333.pdf",
                    },
                    headers=headers,
                )
                assert prod.status_code == 201, prod.text
                product_id = prod.json()["id"]
                assert prod.json()["summary"] == "超低失调精密运放，适用于工业传感器前端"

                # 3. 未标 PUBLIC 的产品资料禁止一键复制给外部 AI
                blocked_bundle = client.post(
                    f"/api/v1/products/{product_id}/prompt-copy-bundle",
                    json={"writing_goal": "知乎选型科普"},
                    headers=headers,
                )
                assert blocked_bundle.status_code == 409
                assert blocked_bundle.json()["error"]["code"] == "AI_DATA_CLASSIFICATION_FORBIDDEN"

                # 4. 标为 PUBLIC 后可一键复制，且严禁泄露内部 source_owner / source_reference
                saved_facts = client.put(
                    f"/api/v1/products/{product_id}/facts",
                    json={
                        "expected_revision": 0,
                        "body_markdown": "典型静态电流 17uA，失调电压 10uV。",
                        "classification": "PUBLIC",
                        "source_owner": "绝密内部负责人张三",
                        "source_reference": "内部PLM单号-SECRET-999",
                    },
                    headers=headers,
                )
                assert saved_facts.status_code == 200, saved_facts.text

                bundle = client.post(
                    f"/api/v1/products/{product_id}/prompt-copy-bundle",
                    json={
                        "writing_goal": "工业传感器前端运放选型",
                        "target_audience": "硬件工程师",
                    },
                    headers=headers,
                )
                assert bundle.status_code == 200, bundle.text
                combined = bundle.json()["combined_copy_text"]
                assert "17uA" in combined
                assert "绝密内部负责人张三" not in combined
                assert "SECRET-999" not in combined

                # 5. 验收 #2：外部 AI 文章直接粘贴保存，禁止伪造 SYSTEM_AI 与 GenerationJob
                spoof = client.post(
                    "/api/v1/articles",
                    json={
                        "product_id": product_id,
                        "title": "伪造系统生成",
                        "body_markdown": "内容",
                        "origin_type": "SYSTEM_AI",
                    },
                    headers=headers,
                )
                assert spoof.status_code == 422

                created_art = client.post(
                    "/api/v1/articles",
                    json={
                        "product_id": product_id,
                        "title": "工业控制用低功耗运放选型指南",
                        "summary": "对比零漂移低功耗运放关键指标",
                        "body_markdown": "# 选型指南\nPS-OPA2333 静态电流 17uA。",
                        "target_keywords": ["低功耗运放", "工业控制"],
                        "origin_type": "EXTERNAL_AI",
                        "external_model_name": "DeepSeek-R1",
                    },
                    headers=headers,
                )
                assert created_art.status_code == 201, created_art.text
                art_id = created_art.json()["id"]
                assert created_art.json()["origin_type"] == "EXTERNAL_AI"
                assert created_art.json()["external_model_name"] == "DeepSeek-R1"
                assert len(created_art.json()["revisions"]) == 1

                with session_factory() as db:
                    assert db.query(GenerationJob).count() == 0

                # 6. 验收 #3：一篇文章登记多个平台 URL，保持 UNVERIFIED 且重复 URL 返回 409
                pub1 = client.post(
                    f"/api/v1/articles/{art_id}/publications",
                    json={
                        "platform_name": "知乎",
                        "actual_title": "工业控制低功耗运放怎么选？",
                        "final_url": "https://zhuanlan.zhihu.com/p/123456789?utm_source=test",
                        "published_at": "2026-11-28T04:00:00Z",
                        "notes": "知乎专栏首发",
                    },
                    headers=headers,
                )
                assert pub1.status_code == 201, pub1.text
                assert pub1.json()["verification_status"] == "UNVERIFIED"
                assert pub1.json()["verified_at"] is None
                assert "utm_source=test" in pub1.json()["normalized_url"]

                pub2 = client.post(
                    f"/api/v1/articles/{art_id}/publications",
                    json={
                        "platform_name": "微信公众号",
                        "actual_title": "低功耗精密运放实测笔记",
                        "final_url": "https://mp.weixin.qq.com/s?__biz=MzA1&mid=1001&idx=1&sn=abc",
                        "published_at": "2026-11-28T05:00:00Z",
                    },
                    headers=headers,
                )
                assert pub2.status_code == 201, pub2.text
                assert pub2.json()["verification_status"] == "UNVERIFIED"

                dup_pub = client.post(
                    f"/api/v1/articles/{art_id}/publications",
                    json={
                        "platform_name": "知乎",
                        "actual_title": "重复登记",
                        "final_url": "https://zhuanlan.zhihu.com/p/123456789?utm_source=test",
                        "published_at": "2026-11-28T06:00:00Z",
                    },
                    headers=headers,
                )
                assert dup_pub.status_code == 409
                assert dup_pub.json()["error"]["code"] == "ARTICLE_PUBLICATION_URL_EXISTS"

                detail = client.get(f"/api/v1/articles/{art_id}")
                assert detail.status_code == 200
                assert detail.json()["publication_count"] == 2
                assert detail.json()["verified_publication_count"] == 0
                assert detail.json()["status"] == "PUBLISHED"

            # 7. 验证不可变触发器（revisions 与 events 禁止 UPDATE/DELETE）
            with session_factory() as db:
                with pytest.raises(DBAPIError):
                    db.execute(text("UPDATE article_revisions SET title = 'tampered'"))
                    db.flush()
                db.rollback()
                with pytest.raises(DBAPIError):
                    db.execute(text("DELETE FROM article_publication_events"))
                    db.flush()
                db.rollback()

            # 8. VIEWER 可只读查看文章与发布列表，写接口返回 403
            with TestClient(app) as v_client:
                v_login = v_client.post(
                    "/api/v1/auth/login",
                    json={"username": "leader_1b", "password": "LeaderPass123!"},
                )
                assert v_login.status_code == 200
                v_csrf = v_login.json()["csrf_token"]
                assert v_client.get("/api/v1/articles").status_code == 200
                assert v_client.get(f"/api/v1/articles/{art_id}").status_code == 200
                assert v_client.get("/api/v1/article-publications").status_code == 200
                denied = v_client.post(
                    "/api/v1/articles",
                    json={
                        "product_id": product_id,
                        "title": "无权写",
                        "body_markdown": "内容",
                    },
                    headers={"X-CSRF-Token": v_csrf},
                )
                assert denied.status_code == 403
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
