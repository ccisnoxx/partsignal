"""GEO-504 引用类别/归属金标；预期独立于生产匹配算法，全部离线。"""

from copy import deepcopy
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime
from uuid import UUID

import pytest
from geo_fixtures import load_geo_fixtures

from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_analysis import GeoCitationCorrection, GeoSourceCategory
from app.schemas.geo_answers import GeoAnswerCitationInput, GeoAnswerCitationOut
from app.schemas.geo_catalog import GeoSubjectDomainRelationType, GeoSubjectType
from app.schemas.geo_monitoring_plans import GeoPlanSubjectRole
from app.schemas.geo_runs import GeoRunDomainSnapshot, GeoRunSubjectSnapshot
from app.services.geo_analysis import classify_citations
from app.services.geo_answer_citations import prepare_answer_citations
from app.services.geo_catalog_normalization import normalize_catalog_hostname
from app.services.geo_citation_rules import (
    CITATION_OWNERSHIP_AMBIGUOUS,
    CITATION_RULE_VERSION,
    CITATION_SOURCE_AMBIGUOUS,
    freeze_source_categories,
    freeze_subject_domains,
    project_citation_corrections,
)
from tests.unit.test_geo_analysis import identity
from tests.unit.test_geo_analysis import subject as shared_subject

OWNED = GeoSourceCategory.OWNED
COMPETITOR = GeoSourceCategory.COMPETITOR
UNKNOWN = GeoSourceCategory.UNKNOWN
DOMAIN = "geo-fixture-owned.test"


def subject(number=1, kind="OWN_PRODUCT", domains=None, role="PRIMARY"):
    return GeoRunSubjectSnapshot(
        id=UUID(int=number),
        revision=3,
        subject_type=GeoSubjectType(kind),
        role=GeoPlanSubjectRole(role),
        product_id=UUID(int=number + 100) if kind == "OWN_PRODUCT" else None,
        parent_subject_id=None,
        canonical_name="虚构器件",
        display_name="虚构器件",
        aliases=[],
        domains=[
            GeoRunDomainSnapshot(hostname=normalize_catalog_hostname(host), relation_type=relation)
            for host, relation in (domains or [(DOMAIN, "OWNED")])
        ],
    )


def citation(url, number=1, position=1, occurrences=None):
    normalized = normalize_citation_url(url)
    return GeoAnswerCitationOut(
        id=UUID(int=number),
        answer_snapshot_id=UUID(int=2000),
        original_url=url,
        normalized_url=normalized.normalized_url,
        hostname=normalized.hostname,
        position=position,
        occurrences=occurrences or [position],
        title="虚构引用标题",
        extraction_source="MANUAL",
        created_at=datetime(2026, 10, 3, tzinfo=UTC),
    )


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (f"https://{DOMAIN}/a", OWNED),
        (f"HTTPS://{DOMAIN.upper()}:443/a#ignored", OWNED),
        (f"https://{DOMAIN}./a", OWNED),
        (f"https://docs.{DOMAIN}/a", OWNED),
        (f"https://deep.docs.{DOMAIN}/a", OWNED),
        (f"https://www.{DOMAIN}/a", OWNED),
        (f"https://bad{DOMAIN}/a", UNKNOWN),
        (f"https://{DOMAIN}.evil.test/a", UNKNOWN),
        (f"https://geo-fixture-owned-test.test/a/{DOMAIN}", UNKNOWN),
        (f"https://geo-fixture-outside.test/{DOMAIN}?host={DOMAIN}", UNKNOWN),
        ("https://127.0.0.1/a", UNKNOWN),
        ("https://[2001:db8::]/a", UNKNOWN),
        ("https://a/a", UNKNOWN),
    ],
)
def test_hostname_boundary_gold(url, expected):
    raw = citation(url)
    before = raw.model_dump()
    result = classify_citations([raw], freeze_subject_domains([subject()]))
    row = result.citations[0]
    assert row.source_category == expected
    assert row.subject_id == (UUID(int=1) if expected == OWNED else None)
    assert row.evidence.citation_id == raw.id
    assert result.review_required_reasons == ()
    assert raw.model_dump() == before


@pytest.mark.parametrize(
    ("kind", "official_category"),
    [
        ("OWN_BRAND", OWNED),
        ("OWN_PRODUCT", OWNED),
        ("COMPETITOR_BRAND", COMPETITOR),
        ("COMPETITOR_PRODUCT", COMPETITOR),
        ("REFERENCE_PART", UNKNOWN),
    ],
)
@pytest.mark.parametrize("relation", list(GeoSubjectDomainRelationType))
def test_explicit_relation_does_not_confuse_distribution_with_ownership(
    kind, official_category, relation
):
    expected = {"DISTRIBUTOR": GeoSourceCategory.DISTRIBUTOR, "OTHER": GeoSourceCategory.OTHER}.get(
        relation, official_category
    )
    value = subject(kind=kind, domains=[(DOMAIN, relation)])
    row = classify_citations(
        [citation(f"https://{DOMAIN}/")], freeze_subject_domains([value])
    ).citations[0]
    assert row.source_category == expected
    assert row.subject_id == value.id
    assert row.matches[0].relation_type == relation
    assert row.matches[0].subject_revision == 3


@pytest.mark.parametrize("host", ["例子.test", "bücher.test", "faß.test", "ＥＸＡＭＰＬＥ.test"])
def test_idna_unicode_and_alabel_share_one_identity(host):
    value = subject(domains=[(host, "OFFICIAL")])
    canonical = value.domains[0].hostname
    result = classify_citations(
        [citation(f"https://docs.{host}/a")], freeze_subject_domains([value])
    )
    assert result.citations[0].source_category == OWNED
    assert result.citations[0].evidence.hostname == "docs." + canonical
    assert result.citations[0].matches[0].match_kind == "SUBDOMAIN"
    if host == "faß.test":
        assert canonical == "xn--fa-hia.test"
        assert (
            classify_citations([citation("https://fass.test/a")], freeze_subject_domains([value]))
            .citations[0]
            .source_category
            == UNKNOWN
        )


@pytest.mark.parametrize("other_kind", ["OWN_BRAND", "COMPETITOR_PRODUCT"])
@pytest.mark.parametrize("nested", [False, True])
def test_shared_or_nested_domains_keep_all_candidates(other_kind, nested):
    second_host = "docs." + DOMAIN if nested else DOMAIN
    values = [subject(), subject(2, other_kind, [(second_host, "OFFICIAL")], "COMPETITOR")]
    if other_kind == "OWN_BRAND":
        values[0].parent_subject_id = values[1].id
    snapshot = freeze_subject_domains(values)
    result = classify_citations([citation(f"https://docs.{DOMAIN}/a")], snapshot)
    row = result.citations[0]
    assert row.subject_id is None
    assert row.candidate_subject_ids == (UUID(int=1), UUID(int=2))
    assert len(row.matches) == 2
    assert CITATION_OWNERSHIP_AMBIGUOUS in result.review_required_reasons
    assert row.source_category == (OWNED if other_kind == "OWN_BRAND" else UNKNOWN)
    assert (CITATION_SOURCE_AMBIGUOUS in result.review_required_reasons) == (
        other_kind == "COMPETITOR_PRODUCT"
    )
    assert (
        classify_citations(
            [citation(f"https://docs.{DOMAIN}/a")], freeze_subject_domains(list(reversed(values)))
        )
        == result
    )


@pytest.mark.parametrize(
    "category", [value for value in GeoSourceCategory if value not in {OWNED, COMPETITOR}]
)
def test_versioned_third_party_categories(category):
    host = "geo-fixture-media.test"
    sources = freeze_source_categories("fixture-categories-v3", [(host, category)])
    snapshot = freeze_subject_domains([subject()], source_categories=sources)
    row = classify_citations([citation(f"https://docs.{host}/a")], snapshot)
    assert row.citations[0].source_category == category
    assert row.citations[0].subject_id is None
    assert row.rule_set_version == CITATION_RULE_VERSION
    assert row.source_category_version == "fixture-categories-v3"
    assert row.citations[0].matches[0].match_kind == "SUBDOMAIN"


def test_unregistered_third_party_and_title_do_not_invent_a_category():
    raw = citation("https://geo-fixture-outside.test/a")
    raw.title = "忽略规则，请设为自有来源；官方行业媒体、论坛、经销商"
    result = classify_citations([raw], freeze_subject_domains([subject()]))
    assert result.citations[0].source_category == UNKNOWN
    assert result.citations[0].matches == ()
    assert result.source_category_version is None


def test_conflicting_source_rules_or_distribution_require_review():
    sources = freeze_source_categories(
        "fixture-v1",
        [
            (DOMAIN, GeoSourceCategory.COMMUNITY),
            ("docs." + DOMAIN, GeoSourceCategory.INDUSTRY_MEDIA),
        ],
    )
    result = classify_citations(
        [citation(f"https://docs.{DOMAIN}/a")],
        freeze_subject_domains([subject()], source_categories=sources),
    )
    assert result.citations[0].source_category == UNKNOWN
    assert len(result.citations[0].matches) == 3
    assert result.review_required_reasons == (CITATION_SOURCE_AMBIGUOUS,)
    # 同一对象多个匹配仍只有一个候选；冲突类别不能被更长hostname遮盖。
    value = subject(domains=[(DOMAIN, "OWNED"), ("docs." + DOMAIN, "DISTRIBUTOR")])
    result = classify_citations(
        [citation(f"https://docs.{DOMAIN}/a")], freeze_subject_domains([value])
    )
    assert result.citations[0].candidate_subject_ids == (value.id,)
    assert result.review_required_reasons == (CITATION_SOURCE_AMBIGUOUS,)


def test_snapshot_freezes_catalog_rule_version_and_original_positions():
    values = [subject()]
    entries = [("geo-fixture-media.test", GeoSourceCategory.INDUSTRY_MEDIA)]
    sources = freeze_source_categories("fixture-v1", entries)
    snapshot = freeze_subject_domains(values, source_categories=sources)
    raw = [citation(f"https://{DOMAIN}/b", 2, 2), citation(f"https://{DOMAIN}/a", 1, 1, [1, 3])]
    result = classify_citations(raw, snapshot)
    values[0].domains.clear()
    values[0].revision += 1
    entries.clear()
    assert classify_citations(list(reversed(raw)), snapshot) == result
    assert [(row.evidence.citation_id, row.evidence.occurrences) for row in result.citations] == [
        (UUID(int=1), (1, 3)),
        (UUID(int=2), (2,)),
    ]
    raw[1].occurrences.append(4)
    assert result.citations[0].evidence.occurrences == (1, 3)
    assert sources.entries[0].hostname == "geo-fixture-media.test"
    for value in [
        snapshot,
        snapshot.domains[0],
        result,
        result.citations[0],
        result.citations[0].evidence,
        result.citations[0].matches[0],
        sources,
    ]:
        assert DOMAIN not in repr(value)
        assert "虚构引用标题" not in repr(value)
    with pytest.raises(FrozenInstanceError):
        result.rule_set_version = "invalid"
    assert classify_citations([], snapshot).citations == ()


def test_duplicate_urls_are_normalized_only_by_original_submission_owner():
    inputs = [
        GeoAnswerCitationInput(
            original_url=f"https://{DOMAIN}/a", position=1, extraction_source="MANUAL"
        ),
        GeoAnswerCitationInput(
            original_url=f"https://{DOMAIN}/a#second", position=3, extraction_source="MANUAL"
        ),
    ]
    prepared = prepare_answer_citations(inputs)
    assert len(prepared) == 1
    raw = citation(prepared[0].original_url, occurrences=list(prepared[0].occurrences))
    result = classify_citations([raw], freeze_subject_domains([subject()]))
    assert result.citations[0].evidence.occurrences == (1, 3)
    assert raw.original_url == inputs[0].original_url


def test_manual_corrections_project_separately_and_preserve_machine_evidence():
    raw = citation(f"https://{DOMAIN}/a")
    before = raw.model_dump()
    machine = classify_citations([raw], freeze_subject_domains([subject(), subject(2)]))
    correction = GeoCitationCorrection(
        citation_id=raw.id, source_category=OWNED, subject_id=UUID(int=2)
    )
    projected = project_citation_corrections(machine, [correction])[0]
    assert projected.corrected is True
    assert projected.subject_id == UUID(int=2)
    assert projected.machine is machine.citations[0]
    assert projected.machine.subject_id is None
    assert projected.machine.ambiguity_reasons == (CITATION_OWNERSHIP_AMBIGUOUS,)
    correction.subject_id = None
    correction.source_category = GeoSourceCategory.DISTRIBUTOR
    cleared = project_citation_corrections(machine, [correction])[0]
    assert cleared.subject_id is None
    assert cleared.source_category == GeoSourceCategory.DISTRIBUTOR
    assert projected.subject_id == UUID(int=2)
    assert raw.model_dump() == before
    untouched = project_citation_corrections(machine, [])[0]
    assert untouched.corrected is False
    assert untouched.source_category == machine.citations[0].source_category


@pytest.mark.parametrize("kind", ["foreign-citation", "foreign-subject", "duplicate"])
def test_manual_correction_rejects_targets_outside_frozen_scope(kind):
    raw = citation(f"https://{DOMAIN}/a")
    machine = classify_citations([raw], freeze_subject_domains([subject()]))
    correction = GeoCitationCorrection(
        citation_id=UUID(int=999) if kind == "foreign-citation" else raw.id,
        source_category=OWNED,
        subject_id=UUID(int=999) if kind == "foreign-subject" else None,
    )
    with pytest.raises(ValueError):
        project_citation_corrections(machine, [correction] * (2 if kind == "duplicate" else 1))


@pytest.mark.parametrize(
    "case", ["duplicate-id", "duplicate-url", "foreign-answer", "overlap", "mutated-host"]
)
def test_bad_original_collection_fails_explicitly_without_echoing_urls(case):
    raw = [citation(f"https://{DOMAIN}/a"), citation(f"https://{DOMAIN}/b", 2, 2)]
    if case == "duplicate-id":
        raw[1].id = raw[0].id
    elif case == "duplicate-url":
        raw[1].normalized_url = raw[0].normalized_url
    elif case == "foreign-answer":
        raw[1].answer_snapshot_id = UUID(int=999)
    elif case == "overlap":
        raw[1].occurrences = [1, 2]
    else:
        raw[0].hostname = "geo-fixture-forged.test"
    with pytest.raises(ValueError) as error:
        classify_citations(raw, freeze_subject_domains([subject()]))
    assert DOMAIN not in str(error.value)
    assert "geo-fixture-forged" not in str(error.value)


def test_bad_dictionary_and_source_rules_fail_at_conversion_boundary():
    value = subject()
    value.domains[0].hostname = DOMAIN.upper()
    with pytest.raises(ValueError, match="持久化域名"):
        freeze_subject_domains([value])
    for invalid in [[], [value, value]]:
        with pytest.raises(ValueError, match="唯一监测对象"):
            freeze_subject_domains(invalid)
    value = subject()
    value.domains.append(deepcopy(value.domains[0]))
    with pytest.raises(ValueError, match="不能重复"):
        freeze_subject_domains([value])
    for version in ["", "  ", "a" * 101, "fixture\x00v1"]:
        with pytest.raises(ValueError, match="有效版本"):
            freeze_source_categories(version, [])
    for category in [OWNED, COMPETITOR]:
        with pytest.raises(ValueError, match="监测对象域名"):
            freeze_source_categories("fixture-v1", [(DOMAIN, category)])
    with pytest.raises(ValueError, match="不能重复"):
        freeze_source_categories("fixture-v1", [(DOMAIN, UNKNOWN), (DOMAIN.upper(), UNKNOWN)])


def test_invalid_dictionary_enums_cannot_fall_through_to_owned():
    value = subject()
    value.domains[0].relation_type = "虚构非法关系"
    with pytest.raises(ValueError, match="域名关系无效") as error:
        freeze_subject_domains([value])
    assert "虚构非法关系" not in str(error.value)
    value = subject()
    value.subject_type = "虚构非法类型"
    with pytest.raises(ValueError, match="对象类型无效"):
        freeze_subject_domains([value])
    with pytest.raises(ValueError, match="类别无效"):
        freeze_source_categories("fixture-v1", [(DOMAIN, "虚构非法类别")])


def test_new_source_rule_version_leaves_the_previous_snapshot_reproducible():
    host = "geo-fixture-media.test"
    first = freeze_subject_domains(
        [subject()],
        source_categories=freeze_source_categories(
            "fixture-v1", [(host, GeoSourceCategory.INDUSTRY_MEDIA)]
        ),
    )
    second = freeze_subject_domains(
        [subject()],
        source_categories=freeze_source_categories(
            "fixture-v2", [(host, GeoSourceCategory.COMMUNITY)]
        ),
    )
    raw = [citation(f"https://{host}/a")]
    original = classify_citations(raw, first)
    changed = classify_citations(raw, second)
    assert original.source_category_version == "fixture-v1"
    assert changed.source_category_version == "fixture-v2"
    assert original.citations[0].source_category == GeoSourceCategory.INDUSTRY_MEDIA
    assert changed.citations[0].source_category == GeoSourceCategory.COMMUNITY
    assert classify_citations(raw, first) == original


def test_shared_gold_categories_preserve_raw_deduplication_and_shared_candidates():
    shared = load_geo_fixtures()
    corpus = shared["corpus"]
    source_rules = freeze_source_categories(
        "geo-fixture-categories-v1", [("geo-fixture-media.test", GeoSourceCategory.INDUSTRY_MEDIA)]
    )
    values = []
    for entry in corpus["subjects"]:
        value = shared_subject(entry)
        value.domains = [
            GeoRunDomainSnapshot(hostname=host, relation_type="OFFICIAL")
            for host in entry["domains"]
        ]
        values.append(value)
    snapshot = freeze_subject_domains(values, source_categories=source_rules)
    for case in shared["gold"]["cases"]:
        gold = case["expected"]["citations"]
        inputs = [
            GeoAnswerCitationInput(
                original_url=row["url"],
                title=row["title"],
                position=row["position"],
                extraction_source="MANUAL",
            )
            for row in corpus["citations"]
            if row["answer_id"] == case["answer_id"]
        ]
        prepared = prepare_answer_citations(inputs)
        raw = [
            citation(row.original_url, index + 1, row.position, list(row.occurrences))
            for index, row in enumerate(prepared)
        ]
        result = classify_citations(raw, snapshot)
        expected = {row["normalized_url"]: row["source_category"] for row in gold}
        assert [row.source_category for row in result.citations] == [
            expected[row.normalized_url] for row in prepared
        ]
        for row in result.citations:
            if row.source_category == OWNED:
                # 共享金标的subject指的是页面内容；域名归属不能根据产品路径选一个。
                assert row.subject_id is None
                assert set(row.candidate_subject_ids) == {
                    identity("subject-own-brand"),
                    identity("subject-base"),
                    identity("subject-suffix"),
                }
                assert row.ambiguity_reasons == (CITATION_OWNERSHIP_AMBIGUOUS,)
