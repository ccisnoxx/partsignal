"""Slice 3A 单元测试：content-markdown-v4 分层组装、外发门禁与 Prompt 版本契约校验。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.errors import AppError
from app.schemas.content import (
    GenerationBriefSnapshot,
    GenerationFactSnapshot,
    GenerationSnapshotV4,
    PlatformPromptVersionSnapshot,
)
from app.schemas.product_facts import Confidentiality
from app.services.content_production import _build_v4_user_message
from app.services.generation import ensure_third_party_egress_allowed


def test_v4_user_message_layers_brief_and_public_fact_without_internal_fields() -> None:
    brief = SimpleNamespace(
        target_question="TPS5430 国产替代怎么选型？",
        search_intent="REPLACEMENT",
        content_angle="选型对比与封装注意事项",
        target_audience="硬件研发工程师",
        content_format="技术解析长文",
        cta="申请免费样品评估",
        target_keywords=["TPS5430 替代", "DC-DC 降压"],
        must_answer_questions=["输入电压范围是多少？", "热阻设计注意什么？"],
        required_fact_points=["支持 5.5V-36V 输入", "连续输出 3A"],
        forbidden_expressions=["100%直接替代", "免测试直接焊上"],
    )
    fact = SimpleNamespace(
        applicable_region="中国大陆与亚太工业市场",
        approved_claims_summary="宽压 5.5V-36V，3A 连续输出。",
        content_restrictions="严禁宣称无条件引脚直替。",
        body_markdown="# 产品事实\n\n输入电压 5.5V-36V，最大输出电流 3A。",
        source_owner="内部绝密联系人王工",
        source_reference="INTERNAL-DOC-2026-999",
    )

    msg = _build_v4_user_message(brief=brief, fact=fact)  # type: ignore[arg-type]

    assert "## 内容 Brief（本次写作目标）" in msg
    assert "TPS5430 国产替代怎么选型？" in msg
    assert "选型对比与封装注意事项" in msg
    assert "100%直接替代" in msg
    assert "## 已批准 PUBLIC 产品事实（唯一允许使用的产品事实依据）" in msg
    assert "中国大陆与亚太工业市场" in msg
    assert "宽压 5.5V-36V，3A 连续输出。" in msg
    assert "严禁宣称无条件引脚直替。" in msg
    assert "## 事实边界与合规声明" in msg
    # 内部治理溯源字段严禁进入第三方 AI 消息
    assert "内部绝密联系人王工" not in msg
    assert "INTERNAL-DOC-2026-999" not in msg
    assert "source_owner" not in msg
    assert "source_reference" not in msg


def test_v4_snapshot_egress_enforces_public_classification() -> None:
    base_snapshot = GenerationSnapshotV4(
        adapter_name="openai-compatible-chat-completions",
        contract_version="content-markdown-v4",
        channel={"id": str(uuid.uuid4()), "timeout_seconds": 30},
        model={"id": str(uuid.uuid4()), "model_id": "gpt-4o-mini"},
        platform_profile={"id": str(uuid.uuid4()), "name": "知乎", "slug": "zhihu"},
        platform_prompt=PlatformPromptVersionSnapshot(
            id=uuid.uuid4(),
            name="知乎长文模板",
            revision=1,
            version_id=uuid.uuid4(),
            version=2,
        ),
        fact_version=GenerationFactSnapshot(
            id=uuid.uuid4(),
            product_id=uuid.uuid4(),
            version=1,
            classification=Confidentiality.PUBLIC,
        ),
        brief=GenerationBriefSnapshot(
            content_task_id=uuid.uuid4(),
            query_topic_id=uuid.uuid4(),
            target_question="TPS5430 国产替代选型",
            search_intent="REPLACEMENT",
            content_angle="参数对比",
            target_audience="硬件工程师",
            must_answer_questions=["输入范围"],
            required_fact_points=["36V"],
            forbidden_expressions=["完美替代"],
            content_format="长文",
            cta="查看资料",
            target_keywords=["TPS5430"],
        ),
        system_message="你是技术编辑",
        user_message="测试正文",
    )

    validated = ensure_third_party_egress_allowed(base_snapshot.model_dump(mode="json"))
    assert validated.contract_version == "content-markdown-v4"
    assert isinstance(datetime.now(UTC), datetime)

    internal_payload = base_snapshot.model_dump(mode="json")
    internal_payload["fact_version"]["classification"] = "INTERNAL"
    with pytest.raises(AppError) as err:
        ensure_third_party_egress_allowed(internal_payload)
    assert err.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"
