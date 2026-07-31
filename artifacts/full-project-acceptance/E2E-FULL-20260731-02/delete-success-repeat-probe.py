"""在隔离 PostgreSQL 中验证 13 个 DELETE 路由的成功、重复与审计结果。"""

from __future__ import annotations

import importlib.util
import sys
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import get_db  # noqa: E402
from app.deps import get_current_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel  # noqa: E402
from app.models.configuration import (  # noqa: E402
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
)
from app.models.content import ContentTask  # noqa: E402
from app.models.geo_files import GeoObservation  # noqa: E402
from app.models.identity import AuditLog, User  # noqa: E402
from app.models.product_facts import FactVersion, Product  # noqa: E402
from app.models.publication import PlatformAccount, PublicationRecord  # noqa: E402
from app.security import hash_token  # noqa: E402


def load_test_tools() -> tuple[Any, Any]:
    """复用现有发布集成测试的隔离数据库和最小业务图。"""
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
    return module.temporary_database, module.seed_graph


def main() -> None:
    """逐对象执行 204、重复 404、数据库删除和成功审计断言。"""
    temporary_database, seed_graph = load_test_tools()
    csrf_token = "delete-success-csrf-token-more-than-32-characters"
    now = datetime.now(UTC)

    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = seed_graph(db)
            admin = User(
                username=f"success-admin-{uuid.uuid4().hex[:8]}",
                display_name="删除成功管理员",
                password_hash="not-used",
                account_type="ADMIN",
            )
            user_target = User(
                username=f"success-user-{uuid.uuid4().hex[:8]}",
                display_name="删除目标用户",
                password_hash="not-used",
                account_type="ENGINEER",
                is_active=False,
            )
            db.add_all([admin, user_target])
            db.flush()

            product_target = Product(
                part_number=f"DELETE-{uuid.uuid4().hex[:8]}",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"delete-{uuid.uuid4().hex[:8]}",
                category="TEST",
            )
            fact_product = Product(
                part_number=f"FACT-{uuid.uuid4().hex[:8]}",
                normalized_part_number=uuid.uuid4().hex,
                brand="PartSignal",
                normalized_brand=f"fact-{uuid.uuid4().hex[:8]}",
                category="TEST",
            )
            db.add_all([product_target, fact_product])
            db.flush()
            fact_target = FactVersion(
                product_id=fact_product.id,
                version=1,
                status="DRAFT",
                body_markdown="## 删除探针\n\n仅用于隔离测试。",
                classification="PUBLIC",
                change_summary="隔离删除探针",
                created_by=admin.id,
            )

            task_target = ContentTask(
                product_id=graph["product"].id,
                fact_version_id=graph["fact"].id,
                platform_profile_id=graph["profile"].id,
                status="CANCELLED",
                created_by=admin.id,
            )
            account_target = PlatformAccount(
                platform_profile_id=graph["other_profile"].id,
                label=f"删除账号 {uuid.uuid4().hex[:8]}",
                account_identifier=f"delete-account-{uuid.uuid4().hex[:8]}",
            )
            publication_target = PublicationRecord(
                idempotency_key=f"delete-publication-{uuid.uuid4().hex}",
                content_version_id=graph["content"].id,
                platform_account_id=graph["same_account"].id,
                section_url="https://community.example.invalid/delete-probe",
                status="REGISTERED",
                content_hash=graph["content"].content_hash,
                created_by=admin.id,
            )
            geo_target = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=graph["topic"].id,
                product_id=graph["product"].id,
                search_platform="删除探针",
                search_query="隔离删除探针",
                tested_at=now,
                notes="隔离删除探针",
                tested_by=admin.id,
            )

            type_target = PlatformType(
                name=f"删除类型 {uuid.uuid4().hex[:8]}",
                slug=f"delete-type-{uuid.uuid4().hex[:8]}",
                created_by=admin.id,
            )
            prompt_target = PlatformPrompt(
                name=f"删除 Prompt {uuid.uuid4().hex[:8]}",
                template_markdown="仅用于隔离删除探针。",
                updated_by=admin.id,
            )
            profile_owner_type = PlatformType(
                name=f"平台所有者类型 {uuid.uuid4().hex[:8]}",
                slug=f"profile-owner-{uuid.uuid4().hex[:8]}",
                created_by=admin.id,
            )
            db.add_all(
                [
                    fact_target,
                    task_target,
                    account_target,
                    publication_target,
                    geo_target,
                    type_target,
                    prompt_target,
                    profile_owner_type,
                ]
            )
            db.flush()
            profile_target = PlatformProfile(
                name=f"删除平台 {uuid.uuid4().hex[:8]}",
                slug=f"delete-profile-{uuid.uuid4().hex[:8]}",
                allowed_domains=["delete.example.invalid"],
                platform_type_id=profile_owner_type.id,
            )

            channel_target = AIChannel(
                name=f"删除渠道 {uuid.uuid4().hex[:8]}",
                description="隔离删除探针",
                protocol_type="openai-compatible-chat-completions",
                provider_brand="CUSTOM",
                base_url="https://example.invalid/v1",
                api_key_ciphertext="opaque-delete-probe",
                api_key_updated_at=now,
                timeout_seconds=30,
                created_by=admin.id,
            )
            db.add_all([profile_target, channel_target])
            db.flush()
            header_target = AIChannelHeader(
                channel_id=channel_target.id,
                name="X-Delete-Probe",
                normalized_name="x-delete-probe",
                is_sensitive=False,
                plain_value="probe",
            )
            model_target = AIModel(
                channel_id=channel_target.id,
                display_name="删除探针模型",
                model_id=f"delete-model-{uuid.uuid4().hex[:8]}",
                request_parameters={},
                created_by=admin.id,
            )
            db.add_all([header_target, model_target])
            db.commit()

            targets = [
                ("用户", f"/api/v1/users/{user_target.id}", "user.deleted", User, user_target.id),
                (
                    "产品",
                    f"/api/v1/products/{product_target.id}",
                    "product.deleted",
                    Product,
                    product_target.id,
                ),
                (
                    "事实版本",
                    f"/api/v1/fact-versions/{fact_target.id}",
                    "fact_version.deleted",
                    FactVersion,
                    fact_target.id,
                ),
                (
                    "内容任务",
                    f"/api/v1/content-tasks/{task_target.id}",
                    "content_task.deleted",
                    ContentTask,
                    task_target.id,
                ),
                (
                    "发布账号",
                    f"/api/v1/platform-accounts/{account_target.id}",
                    "platform_account.deleted",
                    PlatformAccount,
                    account_target.id,
                ),
                (
                    "发布记录",
                    f"/api/v1/publication-records/{publication_target.id}",
                    "publication_record.deleted",
                    PublicationRecord,
                    publication_target.id,
                ),
                (
                    "GEO 人工观测链",
                    f"/api/v1/geo-observations/{geo_target.id}",
                    "geo_observation.deleted",
                    GeoObservation,
                    geo_target.id,
                ),
                (
                    "平台类型",
                    f"/api/v1/platform-types/{type_target.id}",
                    "platform_type.deleted",
                    PlatformType,
                    type_target.id,
                ),
                (
                    "平台 Prompt",
                    f"/api/v1/platform-prompts/{prompt_target.id}?expected_revision=0",
                    "platform_prompt.deleted",
                    PlatformPrompt,
                    prompt_target.id,
                ),
                (
                    "平台",
                    f"/api/v1/platform-profiles/{profile_target.id}",
                    "platform_profile.deleted",
                    PlatformProfile,
                    profile_target.id,
                ),
                (
                    "AI 请求 Header",
                    f"/api/v1/ai-channel-headers/{header_target.id}",
                    "ai_channel_header.deleted",
                    AIChannelHeader,
                    header_target.id,
                ),
                (
                    "AI 模型",
                    f"/api/v1/ai-models/{model_target.id}",
                    "ai_model.deleted",
                    AIModel,
                    model_target.id,
                ),
                (
                    "AI 渠道",
                    f"/api/v1/ai-channels/{channel_target.id}",
                    "ai_channel.deleted",
                    AIChannel,
                    channel_target.id,
                ),
            ]

        def override_db() -> Iterator[Session]:
            with session_factory() as db:
                yield db

        session = SimpleNamespace(
            user=admin,
            csrf_hash=hash_token(csrf_token),
            last_seen_at=None,
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_session] = lambda: session
        client = TestClient(app)
        results: list[tuple[str, int, int, str]] = []
        try:
            for index, (name, path, action, model, target_id) in enumerate(targets, 1):
                request_id = f"delete-success-{index:02d}"
                deleted = client.delete(
                    path,
                    headers={
                        "X-CSRF-Token": csrf_token,
                        "X-Request-ID": request_id,
                    },
                )
                repeated = client.delete(
                    path,
                    headers={
                        "X-CSRF-Token": csrf_token,
                        "X-Request-ID": f"{request_id}-repeat",
                    },
                )
                assert deleted.status_code == 204, (name, deleted.status_code, deleted.text)
                assert repeated.status_code == 404, (
                    name,
                    repeated.status_code,
                    repeated.text,
                )
                with session_factory() as db:
                    assert db.get(model, target_id) is None, (name, "row_still_exists")
                    audit = db.scalar(
                        select(AuditLog).where(AuditLog.request_id == request_id)
                    )
                    assert audit is not None, (name, "audit_missing")
                    assert audit.action == action, (name, audit.action, action)
                    assert audit.outcome == "SUCCESS", (name, audit.outcome)
                results.append((name, deleted.status_code, repeated.status_code, action))
        finally:
            app.dependency_overrides.clear()
            client.close()
            engine.dispose()

    print("对象,首次DELETE,重复DELETE,成功审计")
    for row in results:
        print(",".join(str(value) for value in row))
    print(f"PASS: {len(results)}/13 DELETE 成功、重复与审计矩阵")


if __name__ == "__main__":
    main()
