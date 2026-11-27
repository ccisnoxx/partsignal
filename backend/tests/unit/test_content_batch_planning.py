"""Slice 2C 单元测试：批量任务规划 Schema 边界、规范化哈希与 OpenAPI 契约。"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput
from app.schemas.content_batch import (
    ContentTaskBatchCellInput,
    ContentTaskBatchCreateRequest,
    ContentTaskBatchPreviewRequest,
)
from app.services.content_batch_planning import _batch_request_sha256, _normalize_angle


def _sample_cell(angle: str = "国产替代选型") -> ContentTaskBatchCellInput:
    return ContentTaskBatchCellInput(
        product_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        query_topic_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        platform_profile_id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        brief=ContentBriefInput(
            target_question="TPS5430 有哪些国产替代型号？",
            search_intent=IntentType.REPLACEMENT,
            content_angle=angle,
        ),
    )


def test_batch_preview_enforces_1_to_100_cell_bounds() -> None:
    with pytest.raises(ValidationError):
        ContentTaskBatchPreviewRequest(cells=[])
    with pytest.raises(ValidationError):
        ContentTaskBatchPreviewRequest(cells=[_sample_cell(f"角度-{i}") for i in range(101)])
    valid = ContentTaskBatchPreviewRequest(cells=[_sample_cell()])
    assert len(valid.cells) == 1


def test_batch_request_sha256_is_deterministic_and_sensitive_to_payload() -> None:
    cell_a = _sample_cell("选型对比")
    cell_b = _sample_cell("应用排障")
    cid = uuid.UUID("00000000-0000-0000-0000-000000000099")
    h1 = _batch_request_sha256(cid, [cell_a, cell_b])
    h2 = _batch_request_sha256(cid, [cell_a, cell_b])
    h3 = _batch_request_sha256(None, [cell_a, cell_b])
    h4 = _batch_request_sha256(cid, [cell_b, cell_a])
    assert h1 == h2
    assert len(h1) == 64
    assert h1 != h3
    assert h1 != h4


def test_normalize_angle_collapses_whitespace_and_case() -> None:
    assert _normalize_angle("  DC-DC   选型指南 ") == _normalize_angle("dc-dc 选型指南")


def test_batch_create_defaults_acknowledge_warnings_false() -> None:
    req = ContentTaskBatchCreateRequest(cells=[_sample_cell()])
    assert req.acknowledge_warnings is False


def test_openapi_contains_slice_2c_batch_endpoints() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    doc = yaml.safe_load(contract.read_text(encoding="utf-8"))
    assert "/api/v1/content-tasks/batch-preview" in doc["paths"]
    assert "/api/v1/content-tasks/batch" in doc["paths"]
    assert doc["paths"]["/api/v1/content-tasks/batch-preview"]["post"]["operationId"] == (
        "previewContentTaskBatch"
    )
    assert doc["paths"]["/api/v1/content-tasks/batch"]["post"]["operationId"] == (
        "createContentTaskBatch"
    )
