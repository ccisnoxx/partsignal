"""Markdown 生成快照、分级门禁与作业执行前校验测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.exc import IntegrityError

import app.services.content_production as content_production
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel, GenerationJob
from app.models.configuration import PlatformProfile, PlatformPrompt
from app.models.content import ContentTask, ContentVersion
from app.models.product_facts import FactVersion, Product
from app.routers.production import generation_jobs_out
from app.schemas.content import GenerationFactSnapshot
from app.schemas.product_facts import Confidentiality
from app.services.content_production import (
    _classify_humanization_integrity_error,
    build_generation_input,
    create_humanization_job,
    generation_job_retryable,
    retry_generation_job,
)
from app.services.generation import (
    content_hash,
    ensure_generation_eligible,
    ensure_generation_sources_public,
    ensure_humanization_egress_allowed,
    ensure_third_party_egress_allowed,
    generation_timeout_seconds,
    text_similarity,
)

FACT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
PRODUCT_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
TASK_ID = uuid.UUID("00000000-0000-0000-0000-000000000003")
SOURCE_ID = uuid.UUID("00000000-0000-0000-0000-000000000004")
JOB_ID = uuid.UUID("00000000-0000-0000-0000-000000000005")
PLATFORM_ID = uuid.UUID("00000000-0000-0000-0000-000000000006")
CHANNEL_ID = uuid.UUID("00000000-0000-0000-0000-000000000007")
MODEL_ID = uuid.UUID("00000000-0000-0000-0000-000000000008")
PROMPT_ID = uuid.UUID("00000000-0000-0000-0000-000000000009")


class SnapshotSession:
    """为快照构造测试提供按 ORM 类型读取的最小会话。"""

    def __init__(
        self,
        rows: dict[type[object], object],
        scalar_rows: list[object] | None = None,
        execute_rows: list[tuple[object, ...]] | None = None,
    ) -> None:
        self.rows = rows
        self.scalar_rows = list(scalar_rows or [])
        self.execute_rows = list(execute_rows or [])

    def get(self, model_type: type[object], _identity: object) -> object | None:
        return self.rows.get(model_type)

    def scalar(self, _query: object) -> object | None:
        return self.scalar_rows.pop(0) if self.scalar_rows else None

    def scalars(self, _query: object) -> list[object]:
        return list(self.rows.values())

    def execute(self, _query: object) -> SimpleNamespace:
        return SimpleNamespace(tuples=lambda: self.execute_rows)


def generation_input(*, classification: str = "PUBLIC") -> dict[str, Any]:
    """构造与生产代码一致的 content-markdown-v2 快照。"""
    return {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "content-markdown-v2",
        "channel": {"id": "channel", "timeout_seconds": 30},
        "model": {"id": "model", "model_id": "demo", "request_parameters": {}},
        "platform_profile": {"id": "platform", "name": "平台", "slug": "platform"},
        "fact_version": {
            "id": str(FACT_ID),
            "product_id": str(PRODUCT_ID),
            "version": 2,
            "classification": classification,
        },
        "system_message": "\n  平台 Prompt 原文  \n",
        "user_message": "\n# 事实 Markdown 原文\n\n- 参数：5 V  \n",
    }


def humanization_input(*, classification: str = "PUBLIC") -> dict[str, Any]:
    """构造与生产代码一致的 humanization-markdown-v2 快照。"""
    return {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "humanization-markdown-v2",
        "channel": {"id": "channel", "timeout_seconds": 45},
        "model": {"id": "model", "model_id": "demo", "request_parameters": {}},
        "humanization_prompt": {"revision": 3, "template_markdown": "改善表达。"},
        "source_content": {
            "id": str(SOURCE_ID),
            "task_id": str(TASK_ID),
            "fact_version_id": str(FACT_ID),
            "version": 1,
            "content_hash": "a" * 64,
            "title": "标题",
            "summary": "摘要",
            "body_markdown": "正文",
            "tags": ["标签"],
        },
        "source_generation_job_id": str(JOB_ID),
        "fact_version": {
            "id": str(FACT_ID),
            "product_id": str(PRODUCT_ID),
            "version": 2,
            "classification": classification,
        },
        "system_message": "改善表达。",
        "user_message": "源文章与事实 Markdown",
    }


def test_generation_snapshot_preserves_exact_two_message_contents() -> None:
    input_data = generation_input()

    snapshot = ensure_third_party_egress_allowed(input_data)

    assert snapshot.contract_version == "content-markdown-v2"
    assert snapshot.system_message == input_data["system_message"]
    assert snapshot.user_message == input_data["user_message"]


def test_build_generation_input_uses_prompt_and_fact_markdown_verbatim() -> None:
    prompt_markdown = "\n  平台 Prompt 原文  \n"
    fact_markdown = "\n# 事实 Markdown 原文\n\n- 参数：5 V  \n"
    task = cast(
        ContentTask,
        SimpleNamespace(
            id=TASK_ID,
            product_id=PRODUCT_ID,
            fact_version_id=FACT_ID,
            platform_profile_id=PLATFORM_ID,
        ),
    )
    fact = cast(
        FactVersion,
        SimpleNamespace(
            id=FACT_ID,
            product_id=PRODUCT_ID,
            version=2,
            status="APPROVED",
            classification="PUBLIC",
            body_markdown=fact_markdown,
        ),
    )
    product = cast(Product, SimpleNamespace(id=PRODUCT_ID, status="ACTIVE"))
    platform = cast(
        PlatformProfile,
        SimpleNamespace(
            id=PLATFORM_ID,
            name="平台",
            slug="platform",
            is_active=True,
            platform_prompt_id=PROMPT_ID,
        ),
    )
    prompt = cast(
        PlatformPrompt,
        SimpleNamespace(
            id=PROMPT_ID,
            name="技术文章 Prompt",
            revision=4,
            template_markdown=prompt_markdown,
        ),
    )
    channel = cast(
        AIChannel,
        SimpleNamespace(
            id=CHANNEL_ID,
            name="渠道",
            description="测试渠道",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://provider.invalid/v1",
            timeout_seconds=30,
            is_enabled=True,
            headers=[],
        ),
    )
    model = cast(
        AIModel,
        SimpleNamespace(
            id=MODEL_ID,
            channel_id=CHANNEL_ID,
            display_name="模型",
            model_id="model",
            request_parameters={},
            is_enabled=True,
            test_status="PASSED",
        ),
    )
    session = SnapshotSession(
        {
            FactVersion: fact,
            Product: product,
            AIChannel: channel,
        },
        [platform, prompt],
    )
    db = cast(Any, session)

    snapshot = build_generation_input(db, task, model, PROMPT_ID, 4)

    assert snapshot["contract_version"] == "content-markdown-v3"
    assert snapshot["platform_prompt"] == {
        "id": str(PROMPT_ID),
        "name": "技术文章 Prompt",
        "revision": 4,
    }
    assert snapshot["system_message"] == prompt_markdown
    assert snapshot["user_message"] == fact_markdown
    assert set(snapshot) == {
        "adapter_name",
        "contract_version",
        "channel",
        "model",
        "platform_profile",
        "platform_prompt",
        "fact_version",
        "system_message",
        "user_message",
    }

    session.scalar_rows = [platform]
    with pytest.raises(AppError) as rebound:
        build_generation_input(db, task, model, uuid.uuid4(), 4)
    assert rebound.value.code == "PLATFORM_PROMPT_CHANGED"

    session.scalar_rows = [platform, prompt]
    with pytest.raises(AppError) as revised:
        build_generation_input(db, task, model, PROMPT_ID, 5)
    assert revised.value.code == "PLATFORM_PROMPT_CHANGED"


@pytest.mark.parametrize("classification", ["INTERNAL", "RESTRICTED"])
def test_generation_snapshot_rejects_non_public_fact(classification: str) -> None:
    with pytest.raises(AppError) as captured:
        ensure_third_party_egress_allowed(generation_input(classification=classification))

    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


def test_legacy_generation_snapshot_is_read_only_at_execution_boundary() -> None:
    input_data = generation_input()
    input_data["contract_version"] = "chat-json-v1"

    with pytest.raises(AppError) as captured:
        ensure_third_party_egress_allowed(input_data)

    assert captured.value.code == "GENERATION_SNAPSHOT_INVALID"


def test_humanization_snapshot_uses_v2_fact_classification_gate() -> None:
    snapshot = ensure_humanization_egress_allowed(humanization_input())

    assert snapshot.contract_version == "humanization-markdown-v2"
    assert generation_timeout_seconds(snapshot.model_dump(mode="json"), job_type="HUMANIZE") == 45

    with pytest.raises(AppError) as captured:
        ensure_humanization_egress_allowed(humanization_input(classification="INTERNAL"))
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"


def test_legacy_humanization_snapshot_is_read_only_at_execution_boundary() -> None:
    input_data = humanization_input()
    input_data["contract_version"] = "humanization-json-v1"

    with pytest.raises(AppError) as captured:
        ensure_humanization_egress_allowed(input_data)

    assert captured.value.code == "GENERATION_SNAPSHOT_INVALID"


def test_humanization_integrity_classifier_requires_exact_23505_diagnostics() -> None:
    active = "uq_generation_jobs_active_humanization_source"
    cases = [
        ("23505", "uq_generation_jobs_idempotency_key", "uq_generation_jobs_idempotency_key"),
        ("23505", active, active),
        ("23505", "pk_generation_jobs", None),
        ("23514", "uq_generation_jobs_idempotency_key", None),
        ("23502", None, None),
        ("23503", active, None),
        ("55000", active, None),
    ]
    for sqlstate, constraint_name, expected in cases:
        error = IntegrityError(
            "INSERT", {}, SimpleNamespace(
                sqlstate=sqlstate, diag=SimpleNamespace(constraint_name=constraint_name)
            )
        )
        assert _classify_humanization_integrity_error(error) == expected
    assert _classify_humanization_integrity_error(IntegrityError("INSERT", {}, None)) is None


def test_humanization_integrity_recovery_preserves_caller_transaction_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = cast(ContentTask, SimpleNamespace(
        id=TASK_ID, status="OPEN", current_content_version_id=SOURCE_ID,
        fact_version_id=FACT_ID, product_id=PRODUCT_ID
    ))
    source = cast(Any, SimpleNamespace(
        id=SOURCE_ID, task_id=TASK_ID, fact_version_id=FACT_ID,
        source_type="AI", status="DRAFT", content_hash="a" * 64
    ))
    model = cast(Any, SimpleNamespace(id=MODEL_ID))
    actor = cast(Any, SimpleNamespace(id=uuid.uuid4()))
    winner = cast(Any, SimpleNamespace(
        content_task_id=TASK_ID, retry_of_id=None, ai_model_id=MODEL_ID,
        job_type="HUMANIZE", source_content_version_id=SOURCE_ID, input_snapshot={}
    ))
    fact = cast(Any, SimpleNamespace(
        id=FACT_ID, product_id=PRODUCT_ID, version=2, status="APPROVED",
        classification="PUBLIC", body_markdown="事实"
    ))
    product = cast(Any, SimpleNamespace(id=PRODUCT_ID, status="ACTIVE"))
    previous = cast(Any, SimpleNamespace(
        id=JOB_ID, status="FAILED", content_task_id=TASK_ID, job_type="HUMANIZE",
        input_snapshot=humanization_input(), source_content_version_id=SOURCE_ID,
        ai_model_id=MODEL_ID, ai_channel_id=CHANNEL_ID,
        adapter_name="openai-compatible-chat-completions"
    ))
    retry_winner = cast(Any, SimpleNamespace(
        content_task_id=TASK_ID, retry_of_id=JOB_ID, ai_model_id=MODEL_ID,
        job_type="HUMANIZE", source_content_version_id=SOURCE_ID, input_snapshot={}
    ))
    def integrity(name: str) -> IntegrityError:
        return IntegrityError("INSERT", {}, SimpleNamespace(
            sqlstate="23505", diag=SimpleNamespace(constraint_name=name)
        ))
    class TraceSession(SnapshotSession):
        def __init__(self, values: list[object]) -> None:
            super().__init__({ContentVersion: source, AIModel: model}, values)
            self.scalar_calls, self.rollbacks = 0, 0

        def scalar(self, _query: object) -> object | None:
            self.scalar_calls += 1
            return super().scalar(_query)

        def rollback(self) -> None:
            self.rollbacks += 1
    monkeypatch.setattr(content_production, "_validate_humanization_source", lambda *_: None)
    for values, error, code, rollback, scalar_calls in (
        (
            [task, source, None, None, winner],
            integrity("uq_generation_jobs_idempotency_key"), None, 1, 5,
        ),
        ([task, source, None, None], IntegrityError("INSERT", {}, None), None, 0, 4),
        (
            [task, source, None, None],
            integrity("uq_generation_jobs_active_humanization_source"),
            "HUMANIZATION_ALREADY_ACTIVE", 1, 4,
        ),
    ):
        db = TraceSession(values)
        def fail_create(
            error_to_raise: IntegrityError = error, **_kwargs: object
        ) -> tuple[object, bool]:
            raise error_to_raise
        monkeypatch.setattr(content_production, "_create_job", fail_create)
        def call(db_to_use: TraceSession = db) -> object:
            return create_humanization_job(
                db=cast(Any, db_to_use), content_version_id=SOURCE_ID,
                payload=SimpleNamespace(ai_model_id=MODEL_ID), actor=actor,
                request_id="integrity", idempotency_key="integrity-key")
        if isinstance(error.orig, type(None)):
            with pytest.raises(IntegrityError):
                call()
        elif code is not None:
            with pytest.raises(AppError) as captured:
                call()
            assert captured.value.code == code
        else:
            assert call() is winner
        assert (db.rollbacks, db.scalar_calls) == (rollback, scalar_calls)

    retry_cases = (
        (
            [task, None, previous.id, source, None, retry_winner],
            integrity("uq_generation_jobs_idempotency_key"), 1, 6, retry_winner, None,
        ),
        (
            [task, None, previous.id, source, None],
            integrity("uq_generation_jobs_active_humanization_source"),
            1, 5, None, "HUMANIZATION_ALREADY_ACTIVE",
        ),
        (
            [task, None, previous.id, source, None], IntegrityError("INSERT", {}, None),
            0, 5, None, None,
        ),
    )
    for values, error, rollback, scalar_calls, expected, code in retry_cases:
        db = TraceSession(values)
        db.rows.update({GenerationJob: previous, FactVersion: fact, Product: product})
        def fail_retry(
            error_to_raise: IntegrityError = error, **_kwargs: object
        ) -> tuple[object, bool]:
            raise error_to_raise
        monkeypatch.setattr(content_production, "_create_job", fail_retry)
        def run_retry(db_to_use: TraceSession = db) -> object:
            return retry_generation_job(
                db=cast(Any, db_to_use), generation_job_id=JOB_ID, actor=actor,
                request_id="retry-integrity", idempotency_key="retry-integrity-key")
        if expected is not None:
            assert run_retry() is expected
        elif code is not None:
            with pytest.raises(AppError) as captured:
                run_retry()
            assert captured.value.code == code
        else:
            with pytest.raises(IntegrityError):
                run_retry()
        assert (db.rollbacks, db.scalar_calls) == (rollback, scalar_calls)

    generate = cast(Any, SimpleNamespace(
        id=JOB_ID, status="FAILED", content_task_id=TASK_ID, job_type="GENERATE",
        input_snapshot=generation_input(), source_content_version_id=None,
        ai_model_id=MODEL_ID, ai_channel_id=CHANNEL_ID,
        adapter_name="openai-compatible-chat-completions"
    ))
    db = TraceSession([task, generate.id])
    db.rows.update({GenerationJob: generate, FactVersion: fact, Product: product})
    classifier_calls: list[IntegrityError] = []
    monkeypatch.setattr(
        content_production, "_classify_humanization_integrity_error",
        lambda error: classifier_calls.append(error) or "uq_generation_jobs_idempotency_key",
    )
    with pytest.raises(IntegrityError):
        retry_generation_job(
            db=cast(Any, db), generation_job_id=JOB_ID, actor=actor,
            request_id="generate-integrity", idempotency_key="generate-integrity-key")
    assert classifier_calls == []

@pytest.mark.parametrize(
    ("job_type", "contract_version"),
    [
        ("GENERATE", "chat-json-v1"),
        ("HUMANIZE", "humanization-json-v1"),
    ],
)
def test_legacy_job_retry_is_explicitly_rejected(job_type: str, contract_version: str) -> None:
    previous = cast(
        GenerationJob,
        SimpleNamespace(
            id=JOB_ID,
            job_type=job_type,
            input_snapshot={"contract_version": contract_version},
        ),
    )
    db = cast(Any, SnapshotSession({GenerationJob: previous}))

    with pytest.raises(AppError) as captured:
        retry_generation_job(
            db=db,
            generation_job_id=JOB_ID,
            actor=cast(Any, SimpleNamespace(id=uuid.uuid4())),
            request_id="request-1",
            idempotency_key="legacy-retry",
        )

    assert captured.value.code == "LEGACY_GENERATION_RETRY_FORBIDDEN"


def test_retry_projection_requires_supported_failed_job_and_open_parent() -> None:
    job = cast(
        GenerationJob,
        SimpleNamespace(
            job_type="GENERATE",
            status="FAILED",
            input_snapshot={"contract_version": "content-markdown-v3"},
        ),
    )
    task = cast(ContentTask, SimpleNamespace(status="OPEN"))

    assert generation_job_retryable(job, task) is True
    task.status = "COMPLETED"
    assert generation_job_retryable(job, task) is False
    task.status = "OPEN"
    job.input_snapshot = {"contract_version": "chat-json-v1"}
    assert generation_job_retryable(job, task) is False


def test_retry_projection_uses_database_latest_job_for_single_detail() -> None:
    task = cast(ContentTask, SimpleNamespace(id=TASK_ID, status="OPEN"))
    job = GenerationJob(
        id=JOB_ID,
        content_task_id=TASK_ID,
        idempotency_key="failed-job",
        job_type="GENERATE",
        source_content_version_id=None,
        status="FAILED",
        input_snapshot={"contract_version": "content-markdown-v3"},
        ai_channel_id=CHANNEL_ID,
        ai_model_id=MODEL_ID,
        adapter_name="openai-compatible-chat-completions",
        prompt_template_version="content-markdown-v3",
        prompt_hash="a" * 64,
        attempt_count=1,
        dispatch_attempt_count=1,
        content_version_id=None,
        retry_of_id=None,
        error_code="MODEL_TIMEOUT",
        error_summary="模型响应超时",
        provider_request_id=None,
        response_duration_ms=None,
        prompt_tokens=None,
        completion_tokens=None,
        total_tokens=None,
        created_by=uuid.uuid4(),
        created_at=datetime.now(UTC),
        started_at=None,
        finished_at=datetime.now(UTC),
    )
    db = cast(Any, SnapshotSession({ContentTask: task}, execute_rows=[(uuid.uuid4(), TASK_ID)]))

    projected = generation_jobs_out(db, [job])[0]

    assert projected.workflow_stage == "HISTORICAL_FAILURE"
    assert projected.primary_task == "VIEW_FAILURE"
    assert projected.available_actions == []


def test_retry_command_rejects_non_latest_failed_job() -> None:
    previous = cast(
        GenerationJob,
        SimpleNamespace(
            id=JOB_ID,
            content_task_id=TASK_ID,
            job_type="GENERATE",
            status="FAILED",
            input_snapshot={"contract_version": "content-markdown-v3"},
        ),
    )
    task = cast(ContentTask, SimpleNamespace(id=TASK_ID, status="OPEN"))
    db = cast(
        Any,
        SnapshotSession(
            {GenerationJob: previous},
            scalar_rows=[task, uuid.uuid4()],
        ),
    )

    with pytest.raises(AppError) as captured:
        retry_generation_job(
            db=db,
            generation_job_id=JOB_ID,
            actor=cast(Any, SimpleNamespace(id=uuid.uuid4())),
            request_id="request-2",
            idempotency_key="retry-current",
        )

    assert captured.value.code == "INVALID_STATE_TRANSITION"
    assert captured.value.message == "只有最新失败作业可以重试"


def test_generation_sources_require_public_nonblank_markdown() -> None:
    fact = cast(
        FactVersion,
        SimpleNamespace(classification="PUBLIC", body_markdown="\n# 已批准事实\n"),
    )
    ensure_generation_sources_public(fact)

    fact.classification = "INTERNAL"
    with pytest.raises(AppError) as captured:
        ensure_generation_sources_public(fact)
    assert captured.value.code == "AI_DATA_CLASSIFICATION_FORBIDDEN"

    fact.classification = "PUBLIC"
    fact.body_markdown = " \n "
    with pytest.raises(AppError) as captured:
        ensure_generation_sources_public(fact)
    assert captured.value.code == "FACT_BODY_REQUIRED"


def test_worker_rejects_snapshot_fact_identity_drift() -> None:
    task = cast(ContentTask, SimpleNamespace(status="OPEN", product_id=PRODUCT_ID))
    fact = cast(
        FactVersion,
        SimpleNamespace(
            id=FACT_ID,
            product_id=PRODUCT_ID,
            version=2,
            status="APPROVED",
            classification="PUBLIC",
        ),
    )
    product = cast(Product, SimpleNamespace(status="ACTIVE"))
    snapshot = GenerationFactSnapshot(
        id=FACT_ID,
        product_id=PRODUCT_ID,
        version=3,
        classification=Confidentiality.PUBLIC,
    )

    with pytest.raises(AppError, match="事实或产品已失效"):
        ensure_generation_eligible(task, fact, product, snapshot)


def test_generation_lease_timeout_comes_from_immutable_snapshot() -> None:
    input_data = generation_input()
    input_data["channel"]["timeout_seconds"] = 600

    assert generation_timeout_seconds(input_data) == 600


@pytest.mark.parametrize("timeout", [True, 9, 601, "30", None])
def test_generation_lease_rejects_invalid_snapshot_timeout(timeout: object) -> None:
    input_data = generation_input()
    input_data["channel"]["timeout_seconds"] = timeout

    with pytest.raises(AppError, match="快照超时无效"):
        generation_timeout_seconds(input_data)


def test_content_hash_and_similarity_remain_deterministic() -> None:
    first_hash = content_hash("标题", "摘要", "正文", ["标签"])
    second_hash = content_hash("标题", "摘要", "正文", ["标签"])

    assert first_hash == second_hash
    assert text_similarity("产品参数说明。", "产品参数说明！") >= 0.85
    assert text_similarity("产品参数说明。", "另一内容。") < 0.85
