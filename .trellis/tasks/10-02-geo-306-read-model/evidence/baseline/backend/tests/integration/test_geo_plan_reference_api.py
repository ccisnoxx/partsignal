"""计划关系接入已有资源 API 的删除阻断与安全投影。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.configuration import QueryTopic
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import User
from app.services import geo_catalog, geo_prompt_variants, geo_surface_commands
from app.services.geo_catalog_policy import SubjectReferenceCounts
from tests.integration.geo_surface_management_support import (
    PROFILES,
    SurfaceAPI,
    actor,
    surface_api,  # noqa: F401
    surface_engine,  # noqa: F401
)

pytestmark = pytest.mark.integration


def test_existing_api_deletion_and_role_projection(
    surface_api: SurfaceAPI,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = surface_api
    subject = api.admin.post(
        "/api/v1/geo/subjects",
        json={
            "subject_type": "OWN_BRAND",
            "canonical_name": "虚构品牌206",
            "display_name": "虚构品牌206",
        },
    ).json()
    surface = api.surface()
    profile = api.profile(surface)
    with api.factory() as session:
        updater = User(
            username=f"plan-updater-{uuid4().hex}",
            display_name="虚构维护者",
            password_hash="unused",
            account_type="ENGINEER",
            is_active=False,
            must_change_password=False,
            revision=0,
        )
        session.add(updater)
        topic = QueryTopic(
            canonical_question="虚构206问题", intent_type="REPLACEMENT", variants=[], revision=0
        )
        session.add(topic)
        session.flush()
        variant = GeoPromptVariant(
            query_topic_id=topic.id,
            prompt_text=f"虚构206问题{uuid4()}",
            mention_mode="UNBRANDED",
            language_code="zh-hans",
            region_code="CN",
            priority="CORE",
            created_by=api.admin_id,
        )
        session.add(variant)
        session.flush()
        plan = GeoMonitoringPlan(
            name="虚构API关系计划", created_by=api.admin_id, updated_by=updater.id
        )
        session.add(plan)
        session.flush()
        for suffix, column, resource in [
            ("subjects", "subject_id", subject["id"]),
            ("prompts", "prompt_variant_id", str(variant.id)),
            ("profiles", "collection_profile_id", profile["summary"]["id"]),
        ]:
            extra = ",role" if suffix == "subjects" else ""
            role = ",'PRIMARY'" if suffix == "subjects" else ""
            session.execute(
                text(
                    f"INSERT INTO geo_monitoring_plan_{suffix} (plan_id,{column}{extra}) "
                    f"VALUES (:plan,:resource{role})"
                ),
                {"plan": plan.id, "resource": UUID(resource)},
            )
        session.commit()
        variant_id = variant.id
        updater_id = updater.id
        audit_before = session.scalar(text("SELECT count(*) FROM audit_logs"))
    targets = [
        (f"/api/v1/geo/subjects/{subject['id']}", "GEO_SUBJECT_IN_USE"),
        (f"/api/v1/geo/prompt-variants/{variant_id}", "GEO_PROMPT_VARIANT_IN_USE"),
        (f"{PROFILES}/{profile['summary']['id']}", "GEO_PROFILE_IN_USE"),
    ]
    for url, code in targets:
        data = api.admin.get(url).json()
        assert "DELETE" not in data["available_actions"]
        assert "MONITORING_PLAN" in str(data["deletion"]["blockers"])
        response = api.admin.delete(url, params={"expected_revision": 0})
        assert response.status_code == 409 and response.json()["error"]["code"] == code
    for url, key, identity, params in [
        ("/api/v1/geo/subjects", "id", subject["id"], {"q": "虚构品牌206"}),
        ("/api/v1/geo/prompt-variants", "id", str(variant_id), {"query_topic_id": str(topic.id)}),
        (
            PROFILES,
            "summary",
            profile["summary"]["id"],
            {"engine_surface_id": surface["summary"]["id"]},
        ),
    ]:
        items = api.admin.get(url, params=params).json()["items"]
        selected = [
            item
            for item in items
            if (item[key]["id"] if key == "summary" else item[key]) == identity
        ]
        assert len(selected) == 1
        assert "DELETE" not in selected[0]["available_actions"]
        assert "MONITORING_PLAN" in str(selected[0]["deletion"]["blockers"])
    assert api.engineer.get(f"{PROFILES}/{profile['summary']['id']}").json()["deletion"] is None
    users = api.admin.get("/api/v1/users", params={"q": updater.username}).json()
    assert len(users["items"]) == 1
    user = users["items"][0]
    assert "DELETE" not in user["available_actions"]
    assert user["deletion"]["blockers"][0]["count"] == 1
    rejected_user = api.admin.delete(f"/api/v1/users/{updater_id}", params={"expected_revision": 0})
    assert rejected_user.status_code == 409
    assert rejected_user.json()["error"]["code"] == "USER_IN_USE"
    # 配置引用不冻结语义，也不能因更新响应省略真实删除阻断。
    changed = api.admin.patch(
        f"/api/v1/geo/prompt-variants/{variant_id}",
        json={"expected_revision": 0, "priority": "STANDARD"},
    )
    assert changed.status_code == 200 and changed.json()["deletion"]["blockers"] == [
        "MONITORING_PLAN"
    ]
    # 只旁路友好引用预检，真实 FK/权限/事务保持，证明最终错误映射与回滚。
    with monkeypatch.context() as patch:
        patch.setattr(
            geo_catalog,
            "subject_references",
            lambda db, ids: {identity: SubjectReferenceCounts(0, 0, 0, 0, 0) for identity in ids},
        )
        patch.setattr(geo_prompt_variants, "plan_prompt_referenced", lambda *args: False)
        patch.setattr(geo_surface_commands, "profile_plan_counts", lambda *args: {})
        for delete, field, identity, revision, code, constraint in [
            (
                geo_catalog.delete_subject,
                "subject_id",
                UUID(subject["id"]),
                0,
                "GEO_SUBJECT_IN_USE",
                "fk_geo_monitoring_plan_subjects_subject",
            ),
            (
                geo_prompt_variants.delete_variant,
                "variant_id",
                variant_id,
                1,
                "GEO_PROMPT_VARIANT_IN_USE",
                "fk_geo_monitoring_plan_prompts_prompt",
            ),
            (
                geo_surface_commands.delete_profile,
                "profile_id",
                UUID(profile["summary"]["id"]),
                0,
                "GEO_PROFILE_IN_USE",
                "fk_geo_monitoring_plan_profiles_profile",
            ),
        ]:
            with api.factory() as db:
                with pytest.raises(AppError) as caught:
                    delete(
                        db=db,
                        **{field: identity},
                        expected_revision=revision,
                        actor=actor(db, api),
                        request_id="geo206-real-fk",
                    )
                assert caught.value.code == code and caught.value.details == {}
                cause = caught.value.__cause__
                assert isinstance(cause, IntegrityError) and cause.orig.sqlstate == "23503"
                assert cause.orig.diag.constraint_name == constraint
                assert db.scalar(text("SELECT 1")) == 1
    with api.factory() as session:
        assert session.scalar(text("SELECT count(*) FROM audit_logs")) == audit_before + 1
        assert (
            session.scalar(
                select(GeoPromptVariant.first_referenced_at).where(
                    GeoPromptVariant.id == variant_id
                )
            )
            is None
        )
