"""固定列CSV及其资源生命周期；每次只装配100个候选，不缓冲全量导出。"""

import csv
import io
import json
import unicodedata
from collections.abc import Callable, Generator, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from hashlib import sha256
from threading import RLock
from typing import Literal
from uuid import UUID

import anyio
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.models.geo_runs import GeoObservationRun as Run
from app.schemas.geo_insights import GeoOverviewFilters
from app.services.geo_answer_insights import _cells
from app.services.geo_insight_details import citation_events, claim_events
from app.services.geo_metrics import FORMULA_VERSION
from app.services.geo_overview import QUALITY_VERSION, _generic_reasons
from app.services.geo_overview_queries import (
    OverviewInput,
    candidate_query,
    load_inputs,
    selected_subjects,
)

CsvKind = Literal["runs", "citations", "claims"]
BATCH_SIZE = 100
COMMON_COLUMNS = (
    "as_of",
    "run_id",
    "batch_id",
    "analysis_revision_id",
    "review_id",
    "created_at",
    "status",
    "collection_mode",
    "query_topic_id",
    "query_topic_revision",
    "prompt_variant_id",
    "prompt_revision",
    "collection_profile_id",
    "profile_revision",
    "engine_surface_id",
    "surface_revision",
    "language_code",
    "region_code",
    "login_state",
    "mention_mode",
    "intent_type",
    "source_model",
    "source_product",
    "source_version",
    "analyzer_version",
    "rule_set_version",
    "analysis_configuration_key",
    "formula_version",
    "quality_formula_version",
)
COLUMNS = {
    "runs": COMMON_COLUMNS
    + (
        "repeat_index",
        "selected_subject_ids",
        "selected_product_ids",
        "subject_versions",
        "fact_version_bindings",
        "generic_eligible",
        "exclusion_reasons",
        "answer_present",
        "current_analysis_available",
        "current_review_valid",
        "review_required",
        "evidence_complete",
        "version_known",
        "cost_amount",
        "cost_currency",
    ),
    "citations": COMMON_COLUMNS
    + (
        "citation_id",
        "normalized_url_sha256",
        "hostname",
        "title",
        "occurrences",
        "source_category",
        "attributed_subject_id",
        "candidate_subject_ids",
        "shared_domain",
    ),
    "claims": COMMON_COLUMNS
    + (
        "claim_assessment_id",
        "subject_id",
        "fact_version_id",
        "claim_kind",
        "claim_text",
        "verdict",
        "severity",
    ),
}


def safe_cell(value: object) -> str:
    """只修改传输值；跳过Unicode空白/控制后检测公式，保留完整原始文本。"""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    text = str(value)
    control_prefix = False
    for char in text:
        control = unicodedata.category(char).startswith("C")
        if char.isspace() or control:
            control_prefix = control_prefix or control or char in "\t\r\n"
            continue
        if control_prefix or char in "=+-@":
            return "'" + text
        return text
    return "'" + text if control_prefix else text


def encode_row(columns: Sequence[str], row: Mapping[str, object]) -> bytes:
    output = io.StringIO(newline="")
    csv.writer(output).writerow(safe_cell(row[column]) for column in columns)
    return output.getvalue().encode("utf-8")


def _json(values: object) -> str:
    return json.dumps(values, default=str, ensure_ascii=False, separators=(",", ":"))


def _common(source: OverviewInput, as_of: datetime) -> dict[str, object]:
    run, value = source.metric, source.evidence
    d = run.dimensions
    return dict(
        as_of=as_of,
        run_id=run.run_id,
        batch_id=run.batch_id,
        analysis_revision_id=source.analysis_id,
        review_id=source.review_id,
        created_at=source.created_at,
        status=run.status,
        collection_mode=d.collection_mode,
        query_topic_id=d.query_topic_id,
        query_topic_revision=d.query_topic_revision,
        prompt_variant_id=d.prompt_variant_id,
        prompt_revision=d.prompt_revision,
        collection_profile_id=d.collection_profile_id,
        profile_revision=d.profile_revision,
        engine_surface_id=d.engine_surface_id,
        surface_revision=d.surface_revision,
        language_code=d.language_code,
        region_code=d.region_code,
        login_state=d.login_state,
        mention_mode=d.mention_mode,
        intent_type=d.intent_type,
        source_model=value.source_model,
        source_product=value.source_product,
        source_version=value.source_version,
        analyzer_version=value.analyzer_version,
        rule_set_version=d.rule_set_version,
        analysis_configuration_key=d.analysis_configuration_key,
        formula_version=FORMULA_VERSION,
        quality_formula_version=QUALITY_VERSION,
    )


def export_rows(
    inputs: list[OverviewInput], filters: GeoOverviewFilters, kind: CsvKind, as_of: datetime
) -> Iterator[dict[str, object]]:
    if kind == "runs":
        for source in inputs:
            run = source.metric
            subjects = selected_subjects(source.snapshot, filters)
            reasons = _generic_reasons(source, filters)
            yield _common(source, as_of) | dict(
                repeat_index=run.repeat_index,
                selected_subject_ids=_json(sorted(subjects)),
                selected_product_ids=_json(
                    sorted(
                        {
                            s.product_id
                            for s in source.snapshot.subjects
                            if s.id in subjects and s.product_id is not None
                        }
                    )
                ),
                subject_versions=_json(run.dimensions.subject_versions),
                fact_version_bindings=_json(run.dimensions.fact_version_bindings),
                generic_eligible=not reasons,
                exclusion_reasons=_json(reasons),
                answer_present=run.answer_present,
                current_analysis_available=run.current_analysis_available,
                current_review_valid=run.current_review_valid,
                review_required=run.review_required,
                evidence_complete=source.evidence_complete,
                version_known=source.version_known,
                cost_amount=source.cost_amount,
                cost_currency=source.cost_currency,
            )
        return
    # 沿用604唯一事件资格；跨选中subject重复的引用仅输出一次。
    seen: set[tuple[UUID, UUID]] = set()
    for cell in _cells(inputs, filters, "CURRENT").values():
        if not cell.public.selected_subject:
            continue
        if kind == "citations":
            for source, citation in citation_events(cell):
                key = source.metric.run_id, citation.citation_id
                if key in seen:
                    continue
                seen.add(key)
                # 规范URL保留任意query；只导出哈希避免签名或token参数离开详情边界。
                yield _common(source, as_of) | dict(
                    citation_id=citation.citation_id,
                    normalized_url_sha256=sha256(citation.normalized_url.encode()).hexdigest(),
                    hostname=citation.hostname,
                    title=citation.title,
                    occurrences=_json(citation.occurrences),
                    source_category=citation.source_category,
                    attributed_subject_id=citation.attributed_subject_id,
                    candidate_subject_ids=_json(citation.candidate_subject_ids),
                    shared_domain=citation.shared_domain,
                )
        else:
            for source, claim in claim_events(cell):
                yield _common(source, as_of) | dict(
                    claim_assessment_id=claim.claim_assessment_id,
                    subject_id=claim.subject_id,
                    fact_version_id=claim.fact_version_id,
                    claim_kind=claim.claim_kind,
                    claim_text=claim.claim_text,
                    verdict=claim.verdict,
                    severity=claim.severity,
                )


def iter_rows(
    db: Session, filters: GeoOverviewFilters, kind: CsvKind, as_of: datetime
) -> Generator[dict[str, object], None, None]:
    cursor: tuple[datetime, UUID] | None = None
    while True:
        query = candidate_query(filters).with_only_columns(Run.id, Run.created_at)
        if cursor is not None:
            query = query.where(
                or_(
                    Run.created_at < cursor[0],
                    and_(Run.created_at == cursor[0], Run.id > cursor[1]),
                )
            )
        with db.execute(query.limit(BATCH_SIZE)) as result:
            candidates = result.all()
        if not candidates:
            return
        batch_as_of, inputs = load_inputs(db, filters, run_ids=[row.id for row in candidates])
        if batch_as_of != as_of:
            raise ValueError("CSV分批读取必须保持同一数据库快照时间")
        yield from export_rows(inputs, filters, kind, as_of)
        cursor = candidates[-1].created_at, candidates[-1].id


class CsvStream(Iterator[bytes]):
    """首条已预取；关闭迭代器与RR会话的单一资源所有者。"""

    def __init__(
        self,
        columns: Sequence[str],
        rows: Generator[dict[str, object], None, None],
        first: Mapping[str, object],
        release: Callable[[], None],
    ) -> None:
        # asyncio.Task.cancel不受AnyIO shield保护；锁保证生产线程退出后才释放生成器/Session。
        self._lock = RLock()
        self.columns = columns
        self.rows = rows
        self.release = release
        self.initial: bytes | None = (
            b"\xef\xbb\xbf"
            + encode_row(columns, dict(zip(columns, columns, strict=True)))
            + encode_row(columns, first)
        )
        self.closed = False

    def __next__(self) -> bytes:
        with self._lock:
            if self.closed:
                raise StopIteration
            if self.initial is not None:
                initial, self.initial = self.initial, None
                return initial
            try:
                return encode_row(self.columns, next(self.rows))
            except BaseException:
                self.close()
                raise

    def close(self) -> None:
        with self._lock:
            if not self.closed:
                self.closed = True
                self.initial = None
                try:
                    self.rows.close()
                finally:
                    self.release()


class GeoCsvResponse(StreamingResponse):
    """ASGI取消/断开/发送或生成失败均释放流，不依赖仅成功时执行的background。"""

    def __init__(self, stream: CsvStream, *, as_of: datetime, kind: CsvKind) -> None:
        self.stream = stream
        filename = f"geo-{kind}-{as_of.astimezone(UTC):%Y%m%d-%H%M%SZ}.csv"
        super().__init__(
            stream,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Report-As-Of": as_of.astimezone(UTC).isoformat(),
                "Cache-Control": "no-store",
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # shield保护AnyIO取消；原生Task.cancel交错由CsvStream锁保护生产/清理顺序。
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(self.stream.close)
