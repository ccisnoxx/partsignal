"""质量洞察消费602唯一质量口径；费用分币、版本/共享域名保留真实缺口。"""

import json
from collections import Counter, defaultdict
from decimal import Decimal
from hashlib import sha256
from typing import cast

from sqlalchemy.orm import Session

from app.schemas.geo_insight_details import (
    GeoAnswerInsightDataQuality,
    GeoInsightCostSummary,
    GeoInsightQualityDrilldown,
    GeoInsightQualityFilters,
    GeoInsightQualityPage,
    GeoInsightQualitySample,
    GeoInsightVersionSummary,
    QualityCode,
)
from app.schemas.geo_insights import GeoOverviewDataQuality, GeoOverviewFilters, OverviewMetric
from app.services.geo_overview import QUALITY_CODES, _generic_reasons, _quality, _quality_card
from app.services.geo_overview_queries import OverviewInput, load_inputs


def _version(source: OverviewInput, kind: str) -> dict[str, str | None]:
    value = source.evidence
    return dict(
        source_model=value.source_model if kind == "collection_version" else None,
        source_product=value.source_product if kind == "collection_version" else None,
        source_version=value.source_version if kind == "collection_version" else None,
        analyzer_version=value.analyzer_version if kind == "analysis_version" else None,
        rule_set_version=value.rule_set_version if kind == "analysis_version" else None,
        analysis_configuration_key=(
            source.metric.dimensions.analysis_configuration_key
            if kind == "analysis_version" and source.metric.current_analysis_available
            else None
        ),
    )


def version_key(source: OverviewInput, kind: str) -> str:
    return sha256(json.dumps([kind, _version(source, kind)], sort_keys=True).encode()).hexdigest()


def _versions(
    inputs: list[OverviewInput], filters: GeoOverviewFilters, kind: str
) -> list[GeoInsightVersionSummary]:
    groups: dict[str, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        if source.metric.answer_present:
            groups[version_key(source, kind)].append(source)
    return [
        GeoInsightVersionSummary(
            version_key=key,
            **_version(parts[0], kind),
            run_count=len(parts),
            drilldown=GeoInsightQualityDrilldown(
                filters=filters, quality_code=cast(QualityCode, kind), version_key=key
            ),
        )
        for key, parts in sorted(groups.items())
    ]


def data_quality(
    inputs: list[OverviewInput], filters: GeoOverviewFilters
) -> GeoAnswerInsightDataQuality:
    parts = _quality(inputs, filters)
    cards = [_quality_card(code, parts[code], filters) for code in QUALITY_CODES]
    generic = cards[0]
    shared = [s for s in inputs if any(c.shared_domain for c in s.evidence.citations)]
    costs: dict[str, list[OverviewInput]] = defaultdict(list)
    for source in inputs:
        if source.cost_amount is not None and source.cost_currency is not None:
            costs[source.cost_currency].append(source)
    known_costs = []
    for currency, sources in sorted(costs.items()):
        amount = sum((s.cost_amount for s in sources if s.cost_amount is not None), Decimal(0))
        known_costs.append(
            GeoInsightCostSummary(
                currency=currency,
                known_run_count=len(sources),
                total_amount=amount,
                average_amount=amount / len(sources),
                drilldown=GeoInsightQualityDrilldown(
                    filters=filters,
                    quality_code="cost_coverage",
                    cohort="NUMERATOR",
                    currency=currency,
                ),
            )
        )
    collection = _versions(inputs, filters, "collection_version")
    analysis = _versions(inputs, filters, "analysis_version")
    dimension_count = len({s.metric.dimensions for s in inputs})
    notes: list[str] = []
    conditions = (
        (bool(shared), "SHARED_DOMAIN"),
        (
            any(s.metric.review_required and not s.metric.current_review_valid for s in inputs),
            "REVIEW_BACKLOG",
        ),
        (sum(len(s) for s in costs.values()) < len(inputs), "COST_UNKNOWN"),
        (
            any(s.metric.answer_present and not s.version_known for s in inputs),
            "MODEL_VERSION_UNKNOWN",
        ),
        (len(collection) > 1, "MIXED_COLLECTION_VERSIONS"),
        (len(analysis) > 1, "MIXED_ANALYSIS_VERSIONS"),
        (dimension_count > 1, "MULTIPLE_DIMENSIONS"),
    )
    notes.extend(code for condition, code in conditions if condition)
    return GeoAnswerInsightDataQuality.model_validate(
        dict(
            overview=GeoOverviewDataQuality(
                candidate_run_count=len(inputs),
                eligible_run_count=generic.numerator,
                excluded_run_count=len(inputs) - generic.numerator,
                exclusion_reason_counts=generic.exclusion_reason_counts,
                status_counts=dict(Counter(s.metric.status for s in inputs)),
                dimension_count=dimension_count,
                cards=cards,
            ),
            shared_domain_run_count=len(shared),
            shared_domain_citation_count=sum(
                c.shared_domain for s in inputs for c in s.evidence.citations
            ),
            shared_domain_drilldown=GeoInsightQualityDrilldown(
                filters=filters, quality_code="shared_domain", cohort="NUMERATOR"
            ),
            excluded_drilldown=GeoInsightQualityDrilldown(
                filters=filters, quality_code="eligible_runs", cohort="EXCLUDED"
            ),
            known_costs=known_costs,
            collection_versions=collection,
            analysis_versions=analysis,
            notes=notes,
        )
    )


def list_quality_runs(db: Session, request: GeoInsightQualityFilters) -> GeoInsightQualityPage:
    filters = GeoOverviewFilters.model_validate(
        request.model_dump(include=set(GeoOverviewFilters.model_fields))
    )
    as_of, inputs = load_inputs(db, filters)
    quality = {
        code: {part.source.metric.run_id: part for part in parts}
        for code, parts in _quality(inputs, filters).items()
    }
    values = []
    for source in inputs:
        run = source.metric
        reasons = _generic_reasons(source, filters)
        if request.quality_code in QUALITY_CODES:
            part = quality[cast(OverviewMetric, request.quality_code)][run.run_id]
            numerator, denominator = part.numerator, part.denominator
            excluded = (
                bool(reasons) if request.quality_code == "eligible_runs" else denominator == 0
            )
        else:
            denominator = 1 if request.quality_code == "shared_domain" else int(run.answer_present)
            numerator = (
                int(any(c.shared_domain for c in source.evidence.citations))
                if request.quality_code == "shared_domain"
                else denominator
            )
            excluded = denominator == 0
        if not (
            request.cohort == "CANDIDATE"
            or request.cohort == "DENOMINATOR"
            and denominator > 0
            or request.cohort == "NUMERATOR"
            and numerator > 0
            or request.cohort == "EXCLUDED"
            and excluded
        ):
            continue
        if request.exclusion_reason is not None and request.exclusion_reason not in reasons:
            continue
        if request.version_key is not None and (
            not run.answer_present
            or version_key(source, request.quality_code) != request.version_key
        ):
            continue
        if request.currency is not None and source.cost_currency != request.currency:
            continue
        value = source.evidence
        values.append(
            GeoInsightQualitySample(
                run_id=run.run_id,
                batch_id=run.batch_id,
                created_at=source.created_at,
                status=run.status,
                analysis_revision_id=source.analysis_id,
                review_id=source.review_id,
                numerator=numerator,
                denominator=denominator,
                exclusion_reasons=list(reasons),
                cost_amount=source.cost_amount,
                cost_currency=source.cost_currency,
                source_model=value.source_model,
                source_product=value.source_product,
                source_version=value.source_version,
                analyzer_version=value.analyzer_version,
                rule_set_version=value.rule_set_version,
                analysis_configuration_key=run.dimensions.analysis_configuration_key
                if run.current_analysis_available
                else None,
                review_required=run.review_required,
                current_review_valid=run.current_review_valid,
                shared_domain_citation_ids=[
                    c.citation_id for c in value.citations if c.shared_domain
                ],
                review_required_reasons=list(value.review_required_reasons),
            )
        )
    values.sort(key=lambda s: (s.created_at, s.run_id), reverse=True)
    return GeoInsightQualityPage(
        as_of=as_of,
        filters=request,
        total=len(values),
        page=request.page,
        page_size=request.page_size,
        items=values[(request.page - 1) * request.page_size : request.page * request.page_size],
    )
