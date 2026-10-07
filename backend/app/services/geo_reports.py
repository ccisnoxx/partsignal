"""实时报告应用边界：一致读取、首条预取和交付前独立成功审计。"""

import json
from datetime import datetime
from hashlib import sha256
from typing import Literal

from sqlalchemy import Connection, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.identity import User
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_reports import ExportKind, GeoReportExport, GeoReportPreview
from app.services.geo_answer_insights import get_insights
from app.services.geo_report_csv import COLUMNS, CsvKind, CsvStream, GeoCsvResponse, iter_rows
from app.services.geo_report_formulas import METHOD_NOTES, report_formulas

EXPORT_KINDS: tuple[ExportKind, ...] = ("runs", "citations", "claims", "opportunities")


def _factory(db: Session) -> sessionmaker[Session]:
    bind = db.get_bind()
    # 即使调用者绑定Connection，审计也必须有独立连接/事务，不能提交读取heartbeat。
    engine = bind.engine if isinstance(bind, Connection) else bind
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def filter_sha256(filters: GeoOverviewFilters) -> str:
    canonical = json.dumps(
        filters.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return sha256(canonical.encode()).hexdigest()


def _audit_prepared(
    db: Session,
    actor: User,
    filters: GeoOverviewFilters,
    as_of: datetime,
    export_type: str,
    request_id: str,
    action: Literal["geo_report.export_started", "geo_report.print_prepared"],
) -> None:
    with _factory(db).begin() as audit_db:
        user = audit_db.execute(
            select(User.is_active, User.account_type, User.must_change_password).where(
                User.id == actor.id
            )
        ).one_or_none()
        if user is None or not user.is_active:
            raise AppError("AUTH_REQUIRED", "账号已停用", 401)
        if user.must_change_password:
            raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
        if user.account_type not in {"ADMIN", "ENGINEER"}:
            raise AppError("PERMISSION_DENIED", "当前账号没有执行此操作的权限", 403)
        append_audit(
            audit_db,
            AuditEntry(
                actor_id=actor.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action=action,
                target_type="GeoReport",
                target_id=None,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="报告导出已授权并开始发送；不代表客户端已完整接收"
                if action == "geo_report.export_started"
                else "报告打印数据已准备；不代表已实际打印",
                details={
                    "facts": {
                        "export_type": export_type,
                        "as_of": as_of.isoformat(),
                        "filter_sha256": filter_sha256(filters),
                    }
                },
            ),
        )
    # 独立事务退出并确认commit后才允许返回200；异常直接上抛，不假成功。


def get_preview(db: Session, filters: GeoOverviewFilters) -> GeoReportPreview:
    insights = get_insights(db, filters)
    generated_at = db.scalar(select(func.clock_timestamp()))
    assert generated_at is not None
    quality = insights.data_quality.overview
    reason: Literal["NO_DATA", "NO_ELIGIBLE_RUNS"] | None = None
    if quality.candidate_run_count == 0:
        reason = "NO_DATA"
    elif quality.eligible_run_count == 0:
        reason = "NO_ELIGIBLE_RUNS"
    return GeoReportPreview(
        as_of=insights.as_of,
        generated_at=generated_at,
        filters=filters,
        available=reason is None,
        unavailable_reason=reason,
        insights=insights,
        formulas=report_formulas(),
        method_notes=METHOD_NOTES,
        exports=[
            GeoReportExport(
                kind=kind,
                available=kind != "opportunities",
                unavailable_reason="NOT_IMPLEMENTED" if kind == "opportunities" else None,
            )
            for kind in EXPORT_KINDS
        ],
    )


def prepare_print(
    db: Session, actor: User, filters: GeoOverviewFilters, request_id: str
) -> GeoReportPreview:
    report = get_preview(db, filters)
    if report.available:
        _audit_prepared(
            db, actor, filters, report.as_of, "print", request_id, "geo_report.print_prepared"
        )
    return report


def prepare_csv(
    db: Session, actor: User, filters: GeoOverviewFilters, kind: ExportKind, request_id: str
) -> GeoCsvResponse:
    if kind == "opportunities":
        raise AppError("NOT_IMPLEMENTED", "当前未实施机会导出", 501)
    return _prepare_csv(db, actor, filters, kind, request_id)


def _prepare_csv(
    db: Session, actor: User, filters: GeoOverviewFilters, kind: CsvKind, request_id: str
) -> GeoCsvResponse:
    read_db = _factory(db)()
    rows = None
    stream = None
    try:
        read_db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        as_of = read_db.scalar(select(func.now()))
        assert as_of is not None
        rows = iter_rows(read_db, filters, kind, as_of)
        try:
            first = next(rows)
        except StopIteration as error:
            raise AppError("GEO_REPORT_EMPTY", "当前筛选没有可导出的记录", 409) from error
        stream = CsvStream(COLUMNS[kind], rows, first, read_db.close)
        _audit_prepared(db, actor, filters, as_of, kind, request_id, "geo_report.export_started")
        return GeoCsvResponse(stream, as_of=as_of, kind=kind)
    except BaseException:
        if stream is not None:
            stream.close()
        else:
            try:
                if rows is not None:
                    rows.close()
            finally:
                read_db.close()
        raise
