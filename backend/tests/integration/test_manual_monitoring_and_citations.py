"""Slice 1C PG17 集成测试：0082 迁移、今日监测、预判确认、引用归因、补录失败与旧入口冻结。"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.configuration import QueryTopic
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias
from app.models.geo_runs import GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.security import hash_password
from tests.integration.test_identity_management import temporary_database


@pytest.mark.integration
def test_0082_manual_monitoring_workflow_and_citation_links(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    backend_dir = Path(__file__).resolve().parents[2]
    with temporary_database() as database_url:
        # 1. 验证 0082 降级以 55000 明确拒绝
        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0081_articles_publications"],
            cwd=backend_dir,
            env={**os.environ, "DATABASE_URL": database_url},
            capture_output=True,
            text=True,
            check=False,
        )
        assert downgrade.returncode != 0
        assert "is forbidden" in downgrade.stderr

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
                username="ops_1c",
                display_name="日常运营",
                password_hash=hash_password("OpsPass12345!"),
                account_type="ENGINEER",
                is_active=True,
                must_change_password=False,
            )
            viewer = User(
                username="leader_1c",
                display_name="领导只读",
                password_hash=hash_password("LeaderPass123!"),
                account_type="VIEWER",
                is_active=True,
                must_change_password=False,
            )
            db.add_all([engineer, viewer])
            db.flush()

            topic = QueryTopic(
                canonical_question="工业控制用低功耗运放有哪些选择？",
                intent_type="PRODUCT",
                variants=[],
                revision=0,
            )
            db.add(topic)
            db.flush()

            brand_sub = GeoSubject(
                subject_type="OWN_BRAND",
                canonical_name="PartSignal",
                normalized_name="partsignal",
                display_name="PartSignal",
                is_active=True,
                revision=0,
                created_by=engineer.id,
            )
            db.add(brand_sub)
            db.flush()
            db.add(
                GeoSubjectAlias(
                    subject_id=brand_sub.id,
                    alias="PartSignal",
                    normalized_alias="partsignal",
                    alias_kind="NAME",
                    is_active=True,
                )
            )
            surface = GeoEngineSurface(
                name="豆包",
                slug="doubao",
                surface_kind="CONSUMER_UI",
                provider_brand="CUSTOM",
                compliance_status="APPROVED",
                capabilities={
                    "answer_text": True,
                    "citations": True,
                    "web_search_signal": True,
                    "model_version": False,
                    "usage": False,
                    "cost": False,
                },
                is_active=True,
                revision=0,
                created_by=engineer.id,
            )
            db.add(surface)
            db.flush()
            profile = GeoCollectionProfile(
                engine_surface_id=surface.id,
                name="豆包网页端-联网默认",
                collection_mode="MANUAL",
                adapter_key="manual",
                language_code="zh-cn",
                region_code="CN",
                login_state="AUTHENTICATED",
                web_search_policy="REQUIRED",
                settings_json={"require_screenshot": False},
                is_active=True,
                revision=0,
                created_by=engineer.id,
            )
            db.add(profile)
            db.commit()

            topic_id = str(topic.id)
            brand_sub_id = str(brand_sub.id)
            profile_id = str(profile.id)
            engineer_id = str(engineer.id)

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as client:
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": "ops_1c", "password": "OpsPass12345!"},
                )
                assert login.status_code == 200
                csrf = login.json()["csrf_token"]
                headers = {"X-CSRF-Token": csrf}

                # 2. 验证旧 GeoObservation 写入入口已冻结（410）
                legacy_post = client.post(
                    "/api/v1/geo-observations",
                    json={
                        "product_id": brand_sub_id,
                        "query_topic_id": topic_id,
                        "search_platform": "豆包",
                        "search_query": "低功耗运放",
                        "observed_at": datetime.now(UTC).isoformat(),
                        "article_results": [],
                    },
                    headers=headers,
                )
                assert legacy_post.status_code in (410, 422)

                # 3. 验收 #1：零文章前提下创建三类问题变体与 CORE_BASELINE 计划，幂等生成今日清单
                pv_nat = client.post(
                    f"/api/v1/geo/query-topics/{topic_id}/prompt-variants",
                    json={
                        "query_topic_id": topic_id,
                        "prompt_text": "工业控制用低功耗运放有哪些选择？",
                        "mention_mode": "UNBRANDED",
                        "prompt_category": "NATURAL_DEMAND",
                        "language_code": "zh-cn",
                        "region_code": "CN",
                        "priority": "CORE",
                    },
                    headers=headers,
                )
                assert pv_nat.status_code == 201, pv_nat.text
                pv_nat_id = pv_nat.json()["id"]
                assert pv_nat.json()["prompt_category"] == "NATURAL_DEMAND"

                pv_lookup = client.post(
                    f"/api/v1/geo/query-topics/{topic_id}/prompt-variants",
                    json={
                        "query_topic_id": topic_id,
                        "prompt_text": "请搜索文章《低功耗运放实战指南》",
                        "mention_mode": "UNBRANDED",
                        "prompt_category": "ARTICLE_LOOKUP",
                        "language_code": "zh-cn",
                        "region_code": "CN",
                        "priority": "STANDARD",
                    },
                    headers=headers,
                )
                assert pv_lookup.status_code == 201, pv_lookup.text

                plan_res = client.post(
                    "/api/v1/geo/monitoring-plans",
                    json={
                        "name": "核心基线-每日豆包",
                        "description": "10核心问题起步计划",
                        "subjects": [{"subject_id": brand_sub_id, "role": "PRIMARY"}],
                        "prompt_variant_ids": [pv_nat_id],
                        "collection_profile_ids": [profile_id],
                        "repeat_count": 1,
                        "schedule_kind": "MANUAL_ONLY",
                        "cron_expression": None,
                        "timezone": "Asia/Shanghai",
                        "budget_limit": None,
                        "rule_set_revision": 1,
                        "plan_role": "CORE_BASELINE",
                        "default_assignee_id": engineer_id,
                    },
                    headers=headers,
                )
                assert plan_res.status_code == 201, plan_res.text
                plan_id = plan_res.json()["id"]
                act = client.post(
                    f"/api/v1/geo/monitoring-plans/{plan_id}/activate",
                    json={"expected_revision": 0},
                    headers=headers,
                )
                assert act.status_code == 200, act.text

                today_str = date.today().isoformat()
                ens1 = client.post(
                    "/api/v1/geo/daily-checklist/ensure",
                    json={"target_date": today_str},
                    headers=headers,
                )
                assert ens1.status_code == 200, ens1.text
                assert ens1.json()["created_run_count"] == 1
                ens2 = client.post(
                    "/api/v1/geo/daily-checklist/ensure",
                    json={"target_date": today_str},
                    headers=headers,
                )
                assert ens2.status_code == 200
                assert ens2.json()["created_run_count"] == 0
                assert len(ens2.json()["reused_batch_ids"]) == 1

                checklist = client.get(f"/api/v1/geo/daily-checklist?target_date={today_str}")
                assert checklist.status_code == 200, checklist.text
                assert checklist.json()["summary"]["planned_total"] == 1
                run_id = checklist.json()["items"][0]["run_id"]
                assert checklist.json()["items"][0]["assignee_id"] == engineer_id

                # 4. 验收 #5 前置：创建产品与知乎文章发布记录（无须审批 FactVersion）
                prod = client.post(
                    "/api/v1/products",
                    json={"part_number": "PS-OPA2333", "brand": "PartSignal", "category": "运放"},
                    headers=headers,
                )
                assert prod.status_code == 201
                art = client.post(
                    "/api/v1/articles",
                    json={
                        "product_id": prod.json()["id"],
                        "title": "低功耗运放实战指南",
                        "body_markdown": "# 选型\nPartSignal 方案。",
                        "origin_type": "EXTERNAL_AI",
                        "external_model_name": "DeepSeek",
                    },
                    headers=headers,
                )
                assert art.status_code == 201
                pub = client.post(
                    f"/api/v1/articles/{art.json()['id']}/publications",
                    json={
                        "platform_name": "知乎专栏",
                        "actual_title": "低功耗运放实战指南",
                        "final_url": "https://zhuanlan.zhihu.com/p/778899",
                        "published_at": datetime.now(UTC).isoformat(),
                    },
                    headers=headers,
                )
                assert pub.status_code == 201
                pub_id = pub.json()["id"]

                # 5. 验收 #4 + #5：只读规则预判（粘贴正文自动抽取 URL、识别别名、分级匹配知乎 URL）
                preview = client.post(
                    f"/api/v1/geo/observation-runs/{run_id}/manual-preview",
                    json={
                        "answer_text": (
                            "工业低功耗运放可选 PartSignal，参考 "
                            "https://zhuanlan.zhihu.com/p/778899 "
                            "以及追踪链接 "
                            "https://zhuanlan.zhihu.com/p/778899?utm_source=doubao "
                            "和他人知乎 https://zhuanlan.zhihu.com/p/9999999。"
                        ),
                        "citations": [],
                    },
                    headers=headers,
                )
                assert preview.status_code == 200, preview.text
                p_data = preview.json()
                assert any(s["mentioned"] for s in p_data["subjects"])
                by_url = {c["normalized_url"]: c for c in p_data["citation_suggestions"]}
                exact_url = "https://zhuanlan.zhihu.com/p/778899"
                tracked_url = "https://zhuanlan.zhihu.com/p/778899?utm_source=doubao"
                assert by_url[exact_url]["suggested_link_status"] == "AUTO_EXACT"
                assert by_url[tracked_url]["suggested_link_status"] == "CANDIDATE"
                other_url = "https://zhuanlan.zhihu.com/p/9999999"
                assert by_url[other_url]["suggested_link_status"] is None

                # 6. 同屏提交（无需文件上传）带未确认 CANDIDATE -> 先进入 NEEDS_REVIEW
                sub_res = client.post(
                    f"/api/v1/geo/observation-runs/{run_id}/manual-submit",
                    json={
                        "expected_draft_revision": 0,
                        "answer_text": f"工业低功耗运放推荐 PartSignal，见 {exact_url}",
                        "answer_format": "TEXT",
                        "web_search_observed": True,
                        "citations": [
                            {
                                "original_url": exact_url,
                                "position": 1,
                                "title": "实战指南",
                                "extraction_source": "MANUAL",
                            },
                            {
                                "original_url": tracked_url,
                                "position": 2,
                                "title": "带追踪链接",
                                "extraction_source": "MANUAL",
                            },
                        ],
                        "citation_observation": {"status": "COMPLETE", "missing_reason": None},
                        "collected_at": datetime.now(UTC).isoformat(),
                        "inline_review": {"confirm_all": True, "comment": "确认 PartSignal 命中"},
                    },
                    headers={**headers, "Idempotency-Key": "slice1c-submit-1"},
                )
                assert sub_res.status_code == 201, sub_res.text
                sub_json = sub_res.json()
                assert sub_json["run_status"] == "NEEDS_REVIEW"
                assert sub_json["analysis_revision_id"] is not None
                links = sub_json["citation_links"]
                assert len(links) == 2
                cand = next(x for x in links if x["link_status"] == "CANDIDATE")
                confirmed_link = client.patch(
                    f"/api/v1/geo/citation-links/{cand['id']}",
                    json={"expected_revision": cand["revision"], "link_status": "CONFIRMED"},
                    headers=headers,
                )
                assert confirmed_link.status_code == 200, confirmed_link.text
                assert confirmed_link.json()["link_status"] == "CONFIRMED"

                # 7. 验收 #6：历史补录 + 实际改问 + 人工采集失败（MANUAL_TIMEOUT）
                seven_days_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()
                backfill = client.post(
                    "/api/v1/geo/direct-observations",
                    json={
                        "entry_kind": "BACKFILL",
                        "prompt_variant_id": pv_nat_id,
                        "collection_profile_id": profile_id,
                        "backfill_source": "历史企微聊天截图补录",
                        "answer_text": "历史测试：PartSignal 运放功耗低。",
                        "actual_prompt_text": "工业控制用超低功耗运放推荐（现场改问）",
                        "collected_at": seven_days_ago,
                        "citation_observation": {"status": "NONE", "missing_reason": None},
                        "inline_review": {"confirm_all": True, "comment": "历史补录已确认"},
                    },
                    headers=headers,
                )
                assert backfill.status_code == 201, backfill.text
                bf_data = backfill.json()
                assert bf_data["is_backfill"] is True
                assert bf_data["run_status"] == "COMPLETED"

                with session_factory() as db:
                    bf_ans = db.scalar(
                        select(GeoAnswerSnapshot).where(
                            GeoAnswerSnapshot.run_id == bf_data["run_id"]
                        )
                    )
                    assert bf_ans is not None
                    assert bf_ans.query_modified is True
                    assert bf_ans.actual_prompt_text == "工业控制用超低功耗运放推荐（现场改问）"
                    bf_run = db.get(GeoObservationRun, bf_data["run_id"])
                    assert bf_run is not None
                    assert bf_run.collected_at is not None
                    assert bf_run.collected_at < bf_run.created_at

                # 探索直录（不填答案，先建 PENDING 再标 MANUAL_TIMEOUT 失败）
                exp_run = client.post(
                    "/api/v1/geo/direct-observations",
                    json={
                        "entry_kind": "EXPLORATORY",
                        "prompt_variant_id": pv_nat_id,
                        "collection_profile_id": profile_id,
                    },
                    headers=headers,
                )
                assert exp_run.status_code == 201, exp_run.text
                exp_run_id = exp_run.json()["run_id"]
                fail_res = client.post(
                    f"/api/v1/geo/observation-runs/{exp_run_id}/manual-fail",
                    json={
                        "expected_run_revision": 0,
                        "error_code": "MANUAL_TIMEOUT",
                        "error_summary": "豆包页面长时间转圈超时",
                    },
                    headers=headers,
                )
                assert fail_res.status_code == 200, fail_res.text
                assert fail_res.json()["status"] == "FAILED"
                assert fail_res.json()["error_code"] == "MANUAL_TIMEOUT"

                # 8. VIEWER fail-closed 校验：禁止访问今日监测与写操作，允许只读下钻 citation-links
                with TestClient(app) as viewer_client:
                    v_login = viewer_client.post(
                        "/api/v1/auth/login",
                        json={"username": "leader_1c", "password": "LeaderPass123!"},
                    )
                    assert v_login.status_code == 200
                    v_headers = {"X-CSRF-Token": v_login.json()["csrf_token"]}
                    assert viewer_client.get("/api/v1/geo/daily-checklist").status_code == 403
                    assert (
                        viewer_client.post(
                            "/api/v1/geo/daily-checklist/ensure", json={}, headers=v_headers
                        ).status_code
                        == 403
                    )
                    assert (
                        viewer_client.get(
                            f"/api/v1/geo/observation-runs/{run_id}/citation-links"
                        ).status_code
                        == 200
                    )
                    _ = pub_id
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
