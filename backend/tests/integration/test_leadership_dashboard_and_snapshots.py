"""Slice 1D PG17 集成测试：0083 冻结快照、修订链、双视角看板、首引去重与 VIEWER 权限。"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.configuration import QueryTopic
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.security import hash_password
from tests.integration.test_identity_management import temporary_database


@pytest.mark.integration
def test_0083_leadership_dashboard_and_frozen_report_snapshots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    backend_dir = Path(__file__).resolve().parents[2]
    with temporary_database() as database_url:
        # 1. 验证 0083 降级以 55000 明确拒绝
        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "0082_manual_monitoring_links"],
            cwd=backend_dir,
            env={**os.environ, "DATABASE_URL": database_url},
            capture_output=True,
            text=True,
            check=False,
        )
        assert downgrade.returncode != 0
        assert "downgrade 0083_report_snapshots is forbidden" in downgrade.stderr

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
                username="ops_1d",
                display_name="运营负责人",
                password_hash=hash_password("OpsPass12345!"),
                account_type="ENGINEER",
                is_active=True,
                must_change_password=False,
            )
            viewer = User(
                username="leader_1d",
                display_name="公司领导",
                password_hash=hash_password("LeaderPass123!"),
                account_type="VIEWER",
                is_active=True,
                must_change_password=False,
            )
            db.add_all([engineer, viewer])
            db.flush()

            topic = QueryTopic(
                canonical_question="工业控制低功耗运放选型",
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
                name="豆包网页端",
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

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as client:
                login = client.post(
                    "/api/v1/auth/login",
                    json={"username": "ops_1d", "password": "OpsPass12345!"},
                )
                assert login.status_code == 200
                headers = {"X-CSRF-Token": login.json()["csrf_token"]}

                # 创建产品、两篇发布 URL、自然需求核心问题与品牌定向问题
                prod = client.post(
                    "/api/v1/products",
                    json={"part_number": "PS-OPA2333", "brand": "PartSignal", "category": "运放"},
                    headers=headers,
                )
                assert prod.status_code == 201
                prod_id = prod.json()["id"]

                art = client.post(
                    "/api/v1/articles",
                    json={
                        "product_id": prod_id,
                        "title": "工业运放选型实战",
                        "body_markdown": "# 指南\nPartSignal PS-OPA2333。",
                        "origin_type": "EXTERNAL_AI",
                    },
                    headers=headers,
                )
                assert art.status_code == 201
                art_id = art.json()["id"]
                url_a = "https://zhuanlan.zhihu.com/p/10001"
                url_b = "https://docs.partsignal.com/opa2333"
                for plat, u in (("知乎", url_a), ("官网", url_b)):
                    res_pub = client.post(
                        f"/api/v1/articles/{art_id}/publications",
                        json={
                            "platform_name": plat,
                            "actual_title": f"{plat}-工业运放选型实战",
                            "final_url": u,
                            "published_at": datetime.now(UTC).isoformat(),
                        },
                        headers=headers,
                    )
                    assert res_pub.status_code == 201

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
                assert pv_nat.status_code == 201
                pv_nat_id = pv_nat.json()["id"]

                pv_brand = client.post(
                    f"/api/v1/geo/query-topics/{topic_id}/prompt-variants",
                    json={
                        "query_topic_id": topic_id,
                        "prompt_text": "PartSignal 的低功耗运放怎么样？",
                        "mention_mode": "BRANDED",
                        "prompt_category": "BRAND_MODEL",
                        "language_code": "zh-cn",
                        "region_code": "CN",
                        "priority": "STANDARD",
                    },
                    headers=headers,
                )
                assert pv_brand.status_code == 201
                pv_brand_id = pv_brand.json()["id"]

                now = datetime.now(UTC)
                # 验收 #9：1 条回答引用 2 篇 URL -> 回答级计 1 次命中，文章表现计 2 条，首次被引=2
                r1 = client.post(
                    "/api/v1/geo/direct-observations",
                    json={
                        "entry_kind": "BACKFILL",
                        "prompt_variant_id": pv_nat_id,
                        "collection_profile_id": profile_id,
                        "subject_ids": [brand_sub_id],
                        "backfill_source": "本周监测记录",
                        "answer_text": f"工业运放推荐 PartSignal，参考 {url_a} 和 {url_b}",
                        "collected_at": (now - timedelta(hours=2)).isoformat(),
                        "citations": [
                            {"original_url": url_a, "title": "知乎"},
                            {"original_url": url_b, "title": "官网"},
                        ],
                        "citation_observation": {"status": "COMPLETE", "missing_reason": None},
                        "inline_review": {"confirm_all": True, "comment": "确认"},
                    },
                    headers=headers,
                )
                assert r1.status_code == 201, r1.text

                # 品牌定向问题不进入自然提及率分母
                r_brand = client.post(
                    "/api/v1/geo/direct-observations",
                    json={
                        "entry_kind": "BACKFILL",
                        "prompt_variant_id": pv_brand_id,
                        "collection_profile_id": profile_id,
                        "subject_ids": [brand_sub_id],
                        "backfill_source": "品牌测试",
                        "answer_text": "PartSignal 是低功耗精密器件品牌。",
                        "collected_at": (now - timedelta(hours=1)).isoformat(),
                        "citation_observation": {"status": "NONE", "missing_reason": None},
                        "inline_review": {"confirm_all": True, "comment": "确认"},
                    },
                    headers=headers,
                )
                assert r_brand.status_code == 201

                period_from = (now - timedelta(days=3)).isoformat()
                period_to = (now + timedelta(hours=1)).isoformat()

                # 验收 #10：VIEWER 领导只读访问看板、筛选项、证据下钻；禁止创建快照（403）
                with TestClient(app) as v_client:
                    v_login = v_client.post(
                        "/api/v1/auth/login",
                        json={"username": "leader_1d", "password": "LeaderPass123!"},
                    )
                    assert v_login.status_code == 200
                    v_headers = {"X-CSRF-Token": v_login.json()["csrf_token"]}
                    dash = v_client.get(
                        "/api/v1/geo/leadership-dashboard",
                        params={"period_from": period_from, "period_to": period_to},
                    )
                    assert dash.status_code == 200, dash.text
                    d_json = dash.json()
                    cards = d_json["summary_cards"]
                    assert cards["perspective"] == "COMPANY"
                    # 仅 1 条自然需求进入分母，品牌定向问题被隔离在 brand_model_section
                    assert cards["natural_mention_rate"]["numerator"] == 1
                    assert cards["natural_mention_rate"]["denominator"] == 1
                    assert cards["article_citation_hit_rate"]["numerator"] == 1
                    assert cards["article_citation_hit_rate"]["denominator"] == 1
                    assert cards["first_cited_articles"]["first_cited_count"] == 2
                    assert len(d_json["article_performance"]) == 2
                    assert d_json["brand_model_section"]["valid_completed_runs"] == 1

                    ev = v_client.get(
                        "/api/v1/geo/leadership-dashboard/evidence",
                        params={"period_from": period_from, "period_to": period_to},
                    )
                    assert ev.status_code == 200 and ev.json()["total"] == 2

                    # VIEWER 禁止冻结快照
                    forbidden_snap = v_client.post(
                        "/api/v1/geo/report-snapshots",
                        json={
                            "report_kind": "WEEKLY",
                            "title": "越权快照",
                            "period_from": period_from,
                            "period_to": period_to,
                        },
                        headers=v_headers,
                    )
                    assert forbidden_snap.status_code == 403

                # 验收 #7：冻结 v1 -> 补录历史未命中 -> 实时看板重算但 v1 不变，并创建 v2 更正版
                snap1 = client.post(
                    "/api/v1/geo/report-snapshots",
                    json={
                        "report_kind": "WEEKLY",
                        "title": "2026-W48 GEO 周报",
                        "period_from": period_from,
                        "period_to": period_to,
                        "summary_notes": "本周首次引用 2 篇发布文章",
                    },
                    headers=headers,
                )
                assert snap1.status_code == 201, snap1.text
                snap1_id = snap1.json()["id"]
                assert (
                    snap1.json()["dashboard_payload"]["summary_cards"]["natural_mention_rate"][
                        "denominator"
                    ]
                    == 1
                )

                # 数据库触发器禁止 UPDATE/DELETE 已冻结快照
                with session_factory() as db:
                    with pytest.raises(DBAPIError):
                        db.execute(
                            text(
                                "UPDATE geo_report_snapshots SET title = 'tampered' "
                                "WHERE id = :id"
                            ),
                            {"id": snap1_id},
                        )
                    db.rollback()

                # 补录 2 天前的一条未命中记录
                r_backfill = client.post(
                    "/api/v1/geo/direct-observations",
                    json={
                        "entry_kind": "BACKFILL",
                        "prompt_variant_id": pv_nat_id,
                        "collection_profile_id": profile_id,
                        "subject_ids": [brand_sub_id],
                        "backfill_source": "历史补录未命中样本",
                        "answer_text": "市场上常见低功耗运放包括其他通用型号。",
                        "collected_at": (now - timedelta(days=2)).isoformat(),
                        "citation_observation": {"status": "NONE", "missing_reason": None},
                        "inline_review": {"confirm_all": True, "comment": "确认未提及"},
                    },
                    headers=headers,
                )
                assert r_backfill.status_code == 201

                # 实时看板分母已实时重算为 2（命中率 1/2 = 50%），但冻结快照 v1 仍为 1/1
                live_after = client.get(
                    "/api/v1/geo/leadership-dashboard",
                    params={"period_from": period_from, "period_to": period_to},
                )
                assert live_after.status_code == 200
                assert (
                    live_after.json()["summary_cards"]["natural_mention_rate"]["denominator"] == 2
                )
                assert live_after.json()["summary_cards"]["natural_mention_rate"]["rate"] == 0.5

                frozen_check = client.get(f"/api/v1/geo/report-snapshots/{snap1_id}")
                assert frozen_check.status_code == 200
                assert (
                    frozen_check.json()["dashboard_payload"]["summary_cards"][
                        "natural_mention_rate"
                    ]["denominator"]
                    == 1
                )

                # 创建更正新版 v2（指向 snap1_id）
                snap2 = client.post(
                    "/api/v1/geo/report-snapshots",
                    json={
                        "report_kind": "WEEKLY",
                        "title": "2026-W48 GEO 周报（更正版）",
                        "period_from": period_from,
                        "period_to": period_to,
                        "supersedes_snapshot_id": snap1_id,
                        "correction_reason": "补录前日 1 条历史未命中样本",
                    },
                    headers=headers,
                )
                assert snap2.status_code == 201, snap2.text
                assert snap2.json()["revision_no"] == 2
                assert (
                    snap2.json()["dashboard_payload"]["summary_cards"]["natural_mention_rate"][
                        "denominator"
                    ]
                    == 2
                )
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
