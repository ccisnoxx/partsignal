"""GEO-501 闭合输入、机器结果、人工修正的公开数据合同。"""

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from jsonschema.exceptions import ValidationError as JsonError
from pydantic import TypeAdapter, ValidationError

from app.schemas import geo_analysis as schemas
from tests.unit.test_geo_run_contract import contract, input_snapshot, validate

__all__ = ["contract"]


def analysis_input() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "answer_sha256": "a" * 64,
        "subjects": input_snapshot()["subjects"],
        "fact_versions": [],
        "configuration": {
            "rule_set_version": "fixture-v1",
            "model_name": None,
            "model_version": None,
            "prompt_template_version": None,
            "prompt_sha256": None,
            "parameters": {
                "temperature": None,
                "top_p": None,
                "max_output_tokens": None,
                "seed": None,
            },
        },
    }


def revision_payload() -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "run_id": str(uuid4()),
        "answer_snapshot_id": str(uuid4()),
        "revision": 1,
        "status": "PENDING",
        "analyzer_type": "DETERMINISTIC",
        "analyzer_version": "fixture-v1",
        "input_snapshot": analysis_input(),
        "input_sha256": "a" * 64,
        "confidence_summary": None,
        "review_required_reasons": [],
        "error_code": None,
        "error_summary": None,
        "created_at": datetime.now(UTC).isoformat(),
        "finished_at": None,
    }


def corrections() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "mentions": [
            {
                "subject_id": str(uuid4()),
                "mention_count": 0,
                "first_character_offset": None,
                "matched_aliases": [],
            }
        ],
        "recommendations": [],
        "claims": [],
        "citations": [],
    }


@pytest.mark.parametrize(
    "name",
    [
        "GeoAnalysisRevisionOut",
        "GeoAnalysisFactBinding",
        "GeoEntityMentionOut",
        "GeoRecommendationOut",
        "GeoClaimAssessmentOut",
        "GeoRunReviewOut",
        "GeoAnalysisSelection",
    ],
)
def test_components_match_authority(contract, name):
    schema = TypeAdapter(getattr(schemas, name)).json_schema(
        ref_template="#/components/schemas/{model}"
    )
    definitions = schema.pop("$defs", {})
    assert contract["components"]["schemas"][name] == schema
    for key, value in definitions.items():
        if getattr(schemas, key, None) is not None:
            assert contract["components"]["schemas"][key] == value


def test_real_instances_validate(contract):
    value = revision_payload()
    output = schemas.GeoAnalysisRevisionOut.model_validate(value)
    validate(contract, "GeoAnalysisRevisionOut", output.model_dump(mode="json"))
    validate(
        contract,
        "GeoAnalysisSelection",
        {
            "run_id": value["run_id"],
            "current_analysis_revision_id": None,
            "current_review_id": None,
        },
    )
    for decision, payload in [("CONFIRMED", None), ("CORRECTED", corrections())]:
        review = schemas.GeoRunReviewOut.model_validate(
            {
                "id": str(uuid4()),
                "run_id": value["run_id"],
                "analysis_revision_id": value["id"],
                "decision": decision,
                "correction_payload": payload,
                "comment": "虚构复核说明",
                "reviewer_id": str(uuid4()),
                "created_at": value["created_at"],
            }
        )
        validate(contract, "GeoRunReviewOut", review.model_dump(mode="json"))
    subject = value["input_snapshot"]["subjects"][0]["id"]
    for model, fields in [
        (
            schemas.GeoEntityMentionOut,
            {
                "mention_count": 1,
                "first_character_offset": None,
                "matched_aliases": ["虚构品牌"],
                "confidence": None,
            },
        ),
        (
            schemas.GeoRecommendationOut,
            {
                "recommendation": "UNKNOWN",
                "rank": None,
                "rationale_excerpt": None,
                "confidence": None,
            },
        ),
        (
            schemas.GeoClaimAssessmentOut,
            {
                "fact_version_id": None,
                "claim_kind": "IDENTITY",
                "claim_text": "虚构声明",
                "claim_sha256": "a" * 64,
                "verdict": "UNJUDGEABLE",
                "severity": "LOW",
                "fact_excerpt": None,
                "explanation": "缺少权威事实",
                "confidence": None,
            },
        ),
    ]:
        parsed = model.model_validate(
            {
                "id": str(uuid4()),
                "analysis_revision_id": value["id"],
                "subject_id": subject,
                **fields,
            }
        )
        validate(contract, model.__name__, parsed.model_dump(mode="json"))


@pytest.mark.parametrize(
    "path",
    [[], ["configuration"], ["configuration", "parameters"], ["subjects", 0], ["fact_versions", 0]],
)
def test_secret_fields_rejected_at_each_boundary(contract, path):
    value = analysis_input()
    subject = value["subjects"][0]
    subject.update(subject_type="OWN_PRODUCT", product_id=str(uuid4()))
    value["fact_versions"] = [{"subject_id": subject["id"], "fact_version_id": str(uuid4())}]
    leaf = value
    for key in path:
        leaf = leaf[key]
    leaf["headers"] = {"Authorization": "fixture-only"}
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoAnalysisInputSnapshot", value)


@pytest.mark.parametrize(
    "patch",
    [
        {"schema_version": 2},
        {"schema_version": True},
        {"answer_sha256": "g" * 64},
        {"subjects": []},
    ],
)
def test_invalid_input_shape(contract, patch):
    value = analysis_input() | patch
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisInputSnapshot.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoAnalysisInputSnapshot", value)


def test_duplicate_and_foreign_fact_subject_rejected():
    value = analysis_input()
    value["subjects"].append(deepcopy(value["subjects"][0]))
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisInputSnapshot.model_validate(value)
    value = analysis_input()
    value["fact_versions"] = [
        {"subject_id": value["subjects"][0]["id"], "fact_version_id": str(uuid4())}
    ]
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisInputSnapshot.model_validate(value)


@pytest.mark.parametrize(
    "patch",
    [
        {"status": "COMPLETED"},
        {"status": "FAILED", "finished_at": datetime.now(UTC).isoformat()},
        {"review_required_reasons": ["UNKNOWN_SOURCE"]},
        {"error_code": "ANALYSIS_FAILED"},
    ],
)
def test_invalid_lifecycle(contract, patch):
    value = revision_payload() | patch
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisRevisionOut.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoAnalysisRevisionOut", value)


@pytest.mark.parametrize(
    "patch",
    [
        {"model_name": "fixture-model"},
        {
            "parameters": {
                "temperature": True,
                "top_p": None,
                "max_output_tokens": None,
                "seed": None,
            }
        },
    ],
)
def test_configuration_identity_and_types(contract, patch):
    value = analysis_input()["configuration"] | patch
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisConfiguration.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoAnalysisConfiguration", value)


def test_empty_and_absent_mention_corrections_rejected(contract):
    empty = corrections() | {"mentions": []}
    with pytest.raises(ValidationError):
        schemas.GeoReviewCorrectionPayload.model_validate(empty)
    with pytest.raises(JsonError):
        validate(contract, "GeoReviewCorrectionPayload", empty)
    value = corrections()
    value["mentions"][0]["matched_aliases"] = ["虚构品牌"]
    with pytest.raises(ValidationError):
        schemas.GeoReviewCorrectionPayload.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoReviewCorrectionPayload", value)


@pytest.mark.parametrize("analyzer", ["DETERMINISTIC", "EXTERNAL_MODEL", "HYBRID"])
def test_analyzer_type_configuration_rejected_by_public_schema(contract, analyzer):
    value = revision_payload()
    value["analyzer_type"] = analyzer
    if analyzer == "DETERMINISTIC":
        value["input_snapshot"]["configuration"].update(
            model_name="fixture-model",
            model_version="fixture-v1",
            prompt_template_version="fixture-v1",
            prompt_sha256="a" * 64,
        )
    with pytest.raises(ValidationError):
        schemas.GeoAnalysisRevisionOut.model_validate(value)
    with pytest.raises(JsonError):
        validate(contract, "GeoAnalysisRevisionOut", value)
