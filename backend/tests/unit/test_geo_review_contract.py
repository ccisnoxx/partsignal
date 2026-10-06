"""复核命令复用闭合correction，拒绝自由JSON和伪造追溯字段。"""

from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.geo_reviews import GeoRunReviewCreated, GeoRunReviewRequest
from tests.unit.test_geo_analysis_contract import corrections
from tests.unit.test_geo_run_contract import annotations_removed, validate
from tests.unit.test_geo_run_contract import contract as contract


@pytest.mark.parametrize("model", [GeoRunReviewRequest, GeoRunReviewCreated])
def test_review_components_match_authority(contract, model):
    schema = TypeAdapter(model).json_schema(ref_template="#/components/schemas/{model}")
    definitions = schema.pop("$defs", {})
    assert contract["components"]["schemas"][model.__name__] == schema
    for name, definition in definitions.items():
        assert annotations_removed(contract["components"]["schemas"][name]) == annotations_removed(
            definition
        )


def request(**patch):
    return {
        "analysis_revision_id": str(uuid4()),
        "expected_run_revision": 4,
        "decision": "CONFIRMED",
        "correction_payload": None,
        "comment": "确认",
        **patch,
    }


@pytest.mark.parametrize(
    "patch",
    [
        {"expected_run_revision": -1},
        {"expected_run_revision": True},
        {"reviewer_id": str(uuid4())},
        {"created_at": "1999-01-01"},
        {"comment": "bad\x00"},
        {"decision": "SUPERSEDED"},
        {"correction_payload": corrections()},
        {"decision": "CORRECTED"},
        {"decision": "CORRECTED", "correction_payload": corrections(), "comment": "  "},
    ],
)
def test_invalid_review_command(patch):
    with pytest.raises(ValidationError):
        GeoRunReviewRequest.model_validate(request(**patch))


@pytest.mark.parametrize("decision", ["CONFIRMED", "CORRECTED"])
def test_real_review_request_validates_static_and_runtime(contract, decision):
    from app.main import app

    value = request(
        decision=decision, correction_payload=corrections() if decision == "CORRECTED" else None
    )
    output = GeoRunReviewRequest.model_validate(value).model_dump(mode="json")
    for schema in (contract, app.openapi()):
        validate(schema, "GeoRunReviewRequest", output)


def test_review_operation_has_real_auth_csrf_and_revision(contract):
    operation = contract["paths"]["/api/v1/geo/observation-runs/{run_id}/review"]["post"]
    assert operation["operationId"] == "reviewGeoObservationRun"
    assert operation["security"] == [{"sessionCookie": []}]
    assert set(operation["responses"]) == {"201", "400", "401", "403", "404", "409", "422"}
    assert next(p for p in operation["parameters"] if p.get("name") == "X-CSRF-Token")["required"]
    assert (
        "expected_run_revision"
        in contract["components"]["schemas"]["GeoRunReviewRequest"]["required"]
    )
