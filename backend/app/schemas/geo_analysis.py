"""机器分析与人工复核的闭合数据契约；不提供分析算法或命令。"""

from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.schemas.base import ContractModel, require_unique_items
from app.schemas.geo_runs import GeoRunSubjectSnapshot, NonEmpty, Sha256

NonNegative = Annotated[int, Field(strict=True, ge=0, le=2147483647)]
Positive = Annotated[int, Field(strict=True, ge=1, le=2147483647)]

Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Excerpt = Annotated[NonEmpty, Field(max_length=2000)]
Version = Annotated[NonEmpty, Field(max_length=100)]


def _schema_version(value: object) -> object:
    if type(value) is not int:
        raise ValueError("快照版本必须是整数")
    return value


SchemaVersion = Annotated[Literal[1], BeforeValidator(_schema_version)]


class GeoAnalysisStatus(StrEnum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class GeoAnalyzerType(StrEnum):
    DETERMINISTIC = "DETERMINISTIC"
    HYBRID = "HYBRID"
    EXTERNAL_MODEL = "EXTERNAL_MODEL"


class GeoRecommendationKind(StrEnum):
    RECOMMENDED = "RECOMMENDED"
    CONSIDERED = "CONSIDERED"
    NOT_RECOMMENDED = "NOT_RECOMMENDED"
    UNKNOWN = "UNKNOWN"


class GeoClaimKind(StrEnum):
    IDENTITY = "IDENTITY"
    PARAMETER = "PARAMETER"
    PACKAGE = "PACKAGE"
    TEMPERATURE_GRADE = "TEMPERATURE_GRADE"
    CERTIFICATION = "CERTIFICATION"
    LIFECYCLE_STATUS = "LIFECYCLE_STATUS"
    APPLICATION = "APPLICATION"
    REPLACEMENT_RELATION = "REPLACEMENT_RELATION"
    COMPATIBILITY_CONDITION = "COMPATIBILITY_CONDITION"
    OTHER = "OTHER"


class GeoClaimVerdict(StrEnum):
    ACCURATE = "ACCURATE"
    PARTIAL = "PARTIAL"
    INCORRECT = "INCORRECT"
    UNJUDGEABLE = "UNJUDGEABLE"


class GeoClaimSeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class GeoSourceCategory(StrEnum):
    OWNED = "OWNED"
    COMPETITOR = "COMPETITOR"
    INDUSTRY_MEDIA = "INDUSTRY_MEDIA"
    DISTRIBUTOR = "DISTRIBUTOR"
    COMMUNITY = "COMMUNITY"
    SOCIAL = "SOCIAL"
    SEARCH_ENGINE = "SEARCH_ENGINE"
    ACADEMIC_OR_INSTITUTIONAL = "ACADEMIC_OR_INSTITUTIONAL"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class GeoReviewDecision(StrEnum):
    CONFIRMED = "CONFIRMED"
    CORRECTED = "CORRECTED"


class GeoAnalysisParameters(ContractModel):
    temperature: Annotated[float, Field(strict=True, ge=0, le=2, allow_inf_nan=False)] | None
    top_p: Confidence | None
    max_output_tokens: Positive | None
    seed: NonNegative | None


class GeoAnalysisConfiguration(ContractModel):
    """仅非敏感的模型/模板身份和受控参数，不保存 prompt 正文或请求头。"""

    model_config = {
        "json_schema_extra": {
            "oneOf": [
                {
                    "properties": {
                        **{
                            name: {"type": "null"}
                            for name in (
                                "model_name",
                                "model_version",
                                "prompt_template_version",
                                "prompt_sha256",
                            )
                        },
                        "parameters": {
                            "properties": {
                                name: {"type": "null"}
                                for name in ("temperature", "top_p", "max_output_tokens", "seed")
                            }
                        },
                    }
                },
                {
                    "properties": {
                        name: {"type": "string"}
                        for name in (
                            "model_name",
                            "model_version",
                            "prompt_template_version",
                            "prompt_sha256",
                        )
                    }
                },
            ]
        }
    }

    rule_set_version: Version
    model_name: Annotated[NonEmpty, Field(max_length=200)] | None
    model_version: Version | None
    prompt_template_version: Version | None
    prompt_sha256: Sha256 | None
    parameters: GeoAnalysisParameters

    @model_validator(mode="after")
    def model_identity_complete(self) -> Self:
        values = (
            self.model_name,
            self.model_version,
            self.prompt_template_version,
            self.prompt_sha256,
        )
        if any(value is not None for value in values) and any(value is None for value in values):
            raise ValueError("模型、版本和提示身份必须完整或全部为空")
        if self.model_name is None and any(
            value is not None for value in self.parameters.model_dump().values()
        ):
            raise ValueError("无模型配置不得携带模型参数")
        return self


class GeoAnalysisFactBinding(ContractModel):
    subject_id: UUID
    fact_version_id: UUID


class GeoAnalysisInputSnapshot(ContractModel):
    schema_version: SchemaVersion
    answer_sha256: Sha256
    subjects: list[GeoRunSubjectSnapshot] = Field(min_length=1)
    fact_versions: list[GeoAnalysisFactBinding]
    configuration: GeoAnalysisConfiguration

    @model_validator(mode="after")
    def unique_subject_bindings(self) -> Self:
        require_unique_items([item.id for item in self.subjects])
        require_unique_items([item.subject_id for item in self.fact_versions])
        products = {item.id for item in self.subjects if item.subject_type == "OWN_PRODUCT"}
        if any(item.subject_id not in products for item in self.fact_versions):
            raise ValueError("事实绑定只能引用本快照中的自有产品")
        return self


class GeoAnalysisConfidenceSummary(ContractModel):
    mentions: Confidence | None
    recommendations: Confidence | None
    claims: Confidence | None


class GeoAnalysisRevisionOut(ContractModel):
    model_config = {
        "json_schema_extra": {
            "allOf": [
                {
                    "if": {"properties": {"analyzer_type": {"const": "DETERMINISTIC"}}},
                    "then": {
                        "properties": {
                            "input_snapshot": {
                                "properties": {
                                    "configuration": {
                                        "properties": {"model_name": {"type": "null"}}
                                    }
                                }
                            }
                        }
                    },
                    "else": {
                        "properties": {
                            "input_snapshot": {
                                "properties": {
                                    "configuration": {
                                        "properties": {"model_name": {"type": "string"}}
                                    }
                                }
                            }
                        }
                    },
                },
                {
                    "if": {"properties": {"status": {"const": "PENDING"}}},
                    "then": {"properties": {"finished_at": {"type": "null"}}},
                    "else": {"properties": {"finished_at": {"type": "string"}}},
                },
                {
                    "if": {"properties": {"status": {"const": "FAILED"}}},
                    "then": {
                        "properties": {
                            "error_code": {"const": "ANALYSIS_FAILED"},
                            "error_summary": {"type": "string"},
                        }
                    },
                    "else": {
                        "properties": {
                            "error_code": {"type": "null"},
                            "error_summary": {"type": "null"},
                        }
                    },
                },
                {
                    "if": {"properties": {"status": {"enum": ["PENDING", "FAILED"]}}},
                    "then": {
                        "properties": {
                            "confidence_summary": {"type": "null"},
                            "review_required_reasons": {"maxItems": 0},
                        }
                    },
                },
            ]
        }
    }
    id: UUID
    run_id: UUID
    answer_snapshot_id: UUID
    revision: Positive
    status: GeoAnalysisStatus
    analyzer_type: GeoAnalyzerType
    analyzer_version: Version
    input_snapshot: GeoAnalysisInputSnapshot
    input_sha256: Sha256
    confidence_summary: GeoAnalysisConfidenceSummary | None
    review_required_reasons: list[Version] = Field(max_length=20)
    error_code: Literal["ANALYSIS_FAILED"] | None
    error_summary: Annotated[NonEmpty, Field(max_length=500)] | None
    created_at: AwareDatetime
    finished_at: AwareDatetime | None

    @model_validator(mode="after")
    def lifecycle(self) -> Self:
        if (self.status == GeoAnalysisStatus.PENDING) != (self.finished_at is None):
            raise ValueError("分析终态必须有完成时间")
        if self.finished_at is not None and self.finished_at < self.created_at:
            raise ValueError("完成时间不得早于创建时间")
        if self.status == GeoAnalysisStatus.FAILED:
            if self.error_code is None or self.error_summary is None:
                raise ValueError("失败分析必须保留明确错误")
        elif self.error_code is not None or self.error_summary is not None:
            raise ValueError("未失败分析不得伪造错误")
        if self.status != GeoAnalysisStatus.COMPLETED and (
            self.confidence_summary is not None or self.review_required_reasons
        ):
            raise ValueError("只有成功分析可提供结果摘要")
        if (self.analyzer_type == GeoAnalyzerType.DETERMINISTIC) != (
            self.input_snapshot.configuration.model_name is None
        ):
            raise ValueError("分析器类型与模型配置不一致")
        return self


class GeoEntityMentionOut(ContractModel):
    id: UUID
    analysis_revision_id: UUID
    subject_id: UUID
    mention_count: Positive
    first_character_offset: NonNegative | None
    matched_aliases: list[Annotated[NonEmpty, Field(max_length=240)]] = Field(min_length=1)
    confidence: Confidence | None


class GeoRecommendationOut(ContractModel):
    id: UUID
    analysis_revision_id: UUID
    subject_id: UUID
    recommendation: GeoRecommendationKind
    rank: Positive | None
    rationale_excerpt: Excerpt | None
    confidence: Confidence | None


class GeoClaimAssessmentOut(ContractModel):
    model_config = {
        "json_schema_extra": {
            "if": {"properties": {"fact_version_id": {"type": "null"}}},
            "then": {
                "properties": {
                    "verdict": {"const": "UNJUDGEABLE"},
                    "fact_excerpt": {"type": "null"},
                }
            },
        }
    }
    id: UUID
    analysis_revision_id: UUID
    subject_id: UUID
    fact_version_id: UUID | None
    claim_kind: GeoClaimKind
    claim_text: Excerpt
    claim_sha256: Sha256
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity
    fact_excerpt: Excerpt | None
    explanation: Excerpt
    confidence: Confidence | None

    @model_validator(mode="after")
    def evidence_required(self) -> Self:
        if self.fact_version_id is None and (
            self.verdict != GeoClaimVerdict.UNJUDGEABLE or self.fact_excerpt is not None
        ):
            raise ValueError("缺少事实版本时只能不可核验且不得伪造事实摘录")
        return self


class GeoMentionCorrection(ContractModel):
    model_config = {
        "json_schema_extra": {
            "if": {"properties": {"mention_count": {"const": 0}}},
            "then": {
                "properties": {
                    "first_character_offset": {"type": "null"},
                    "matched_aliases": {"maxItems": 0},
                }
            },
            "else": {"properties": {"matched_aliases": {"minItems": 1}}},
        }
    }
    subject_id: UUID
    mention_count: NonNegative
    first_character_offset: NonNegative | None
    matched_aliases: list[Annotated[NonEmpty, Field(max_length=240)]]

    @model_validator(mode="after")
    def absent_mention(self) -> Self:
        if self.mention_count == 0 and (
            self.first_character_offset is not None or self.matched_aliases
        ):
            raise ValueError("未提及时不得保留位置或命中别名")
        if self.mention_count > 0 and not self.matched_aliases:
            raise ValueError("提及修正必须保留命中别名")
        return self


class GeoRecommendationCorrection(ContractModel):
    subject_id: UUID
    recommendation: GeoRecommendationKind
    rank: Positive | None
    rationale_excerpt: Excerpt | None


class GeoClaimCorrection(ContractModel):
    claim_assessment_id: UUID
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity
    explanation: Excerpt


class GeoCitationCorrection(ContractModel):
    citation_id: UUID
    source_category: GeoSourceCategory
    subject_id: UUID | None


class GeoReviewCorrectionPayload(ContractModel):
    model_config = {
        "json_schema_extra": {
            "anyOf": [
                {"properties": {name: {"minItems": 1}}}
                for name in ("mentions", "recommendations", "claims", "citations")
            ]
        }
    }
    schema_version: SchemaVersion
    mentions: list[GeoMentionCorrection]
    recommendations: list[GeoRecommendationCorrection]
    claims: list[GeoClaimCorrection]
    citations: list[GeoCitationCorrection]

    @model_validator(mode="after")
    def nonempty_unique_corrections(self) -> Self:
        if not (self.mentions or self.recommendations or self.claims or self.citations):
            raise ValueError("修正至少需要一项明确结果")
        for values in (
            [item.subject_id for item in self.mentions],
            [item.subject_id for item in self.recommendations],
            [item.claim_assessment_id for item in self.claims],
            [item.citation_id for item in self.citations],
        ):
            require_unique_items(values)
        return self


class GeoRunReviewOut(ContractModel):
    model_config = {
        "json_schema_extra": {
            "if": {"properties": {"decision": {"const": "CONFIRMED"}}},
            "then": {"properties": {"correction_payload": {"type": "null"}}},
            "else": {
                "properties": {
                    "correction_payload": {"type": "object"},
                    "comment": {"minLength": 1, "pattern": r"\S"},
                }
            },
        }
    }
    id: UUID
    run_id: UUID
    analysis_revision_id: UUID
    decision: GeoReviewDecision
    correction_payload: GeoReviewCorrectionPayload | None
    comment: Annotated[str, Field(strict=True, max_length=2000, pattern=r"^[^\x00]*$")]
    reviewer_id: UUID
    created_at: AwareDatetime

    @model_validator(mode="after")
    def decision_payload(self) -> Self:
        validate_review_decision(self.decision, self.correction_payload, self.comment)
        return self


def validate_review_decision(
    decision: GeoReviewDecision, correction_payload: GeoReviewCorrectionPayload | None, comment: str
) -> None:
    """命令与历史响应共享决定和修正的业务合同。"""
    if decision == GeoReviewDecision.CONFIRMED and correction_payload is not None:
        raise ValueError("确认不得携带修正")
    if decision == GeoReviewDecision.CORRECTED and (
        correction_payload is None or not comment.strip()
    ):
        raise ValueError("修正必须携带非空结构化结果和说明")


class GeoAnalysisSelection(ContractModel):
    """选择规则组件；后续查询服务负责一致读，历史 review 不伪装有效。"""

    model_config = {
        "json_schema_extra": {
            "if": {"properties": {"current_analysis_revision_id": {"type": "null"}}},
            "then": {"properties": {"current_review_id": {"type": "null"}}},
        }
    }

    run_id: UUID
    current_analysis_revision_id: UUID | None
    current_review_id: UUID | None

    @model_validator(mode="after")
    def review_requires_analysis(self) -> Self:
        if self.current_analysis_revision_id is None and self.current_review_id is not None:
            raise ValueError("当前复核必须属于当前分析")
        return self
