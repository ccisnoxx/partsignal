"""预算与 Profile 限速的唯一 owner；调用方拥有短事务与 Run 锁。"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.collectors.contracts import CollectionRequest, Money
from app.config import settings
from app.models.geo_collection_admission import GeoCollectionReservation as Reservation
from app.models.geo_runs import GeoObservationBatch
from app.models.geo_runs import GeoObservationRun as Run
from app.schemas.geo_surfaces import GeoApiSettings


class BudgetExceeded(Exception):
    """限额、未知费用或币种不一致均不能取得发送授权。"""


class ProfileThrottled(Exception):
    """短暂限速没有产生业务结果；未 claim 的 Run 保持 PENDING。"""


def lock_accounting(db: Session) -> None:
    # 单租户日预算跨 Batch/Profile 共享；此锁必须先于任何 Batch/Run 行锁。
    db.execute(text("SELECT pg_advisory_xact_lock(407, 1)"))


def _cooling_down(db: Session, profile_id: object, now: datetime) -> bool:
    rows = db.execute(
        select(Run.finished_at, Run.retry_after_seconds).where(
            Run.collection_profile_id == profile_id,
            Run.error_code == "PROVIDER_RATE_LIMITED",
            Run.retry_after_seconds.is_not(None),
        )
    )
    # datetime 支持有界范围；供应商极大 Retry-After 仍保守限速，不溢出。
    return any(
        finished is not None and (now - finished).total_seconds() < seconds
        for finished, seconds in rows
    )


def require_profile_capacity(db: Session, request: CollectionRequest, now: datetime) -> None:
    options = GeoApiSettings.model_validate(dict(request.profile.settings))
    rows = db.execute(
        select(Reservation.state, Reservation.sent_at, Run.status)
        .join(Run, Run.id == Reservation.run_id)
        .where(
            Run.collection_profile_id == request.profile.id,
            or_(Run.status == "RUNNING", Reservation.sent_at > now - timedelta(seconds=60)),
        )
    ).all()
    active = sum(status == "RUNNING" for _, _, status in rows)
    quota = sum(
        state == "RESERVED" or (sent is not None and sent > now - timedelta(seconds=60))
        for state, sent, _ in rows
    )
    if (
        active >= options.max_concurrency
        or quota >= options.requests_per_minute
        or _cooling_down(db, request.profile.id, now)
    ):
        raise ProfileThrottled()


def require_send_capacity(db: Session, request: CollectionRequest, now: datetime) -> None:
    if _cooling_down(db, request.profile.id, now):
        raise ProfileThrottled()


def require_budget(
    db: Session, batch: GeoObservationBatch, run: Run, estimate: Money | None, now: datetime
) -> Decimal | None:
    batch_limit = batch.plan_snapshot.get("budget_limit")
    batch_limit = Decimal(batch_limit) if batch_limit is not None else None
    daily_limit = settings.geo_daily_budget_limit
    if batch_limit is None and daily_limit is None:
        return None
    if estimate is None:
        raise BudgetExceeded()
    day = now.astimezone(UTC).date()
    rows = db.execute(
        select(Reservation, Run.batch_id, Run.cost_amount, Run.cost_currency)
        .join(Run, Run.id == Reservation.run_id)
        .where(
            Reservation.run_id != run.id,
            Reservation.state != "RELEASED",
            or_(Run.batch_id == batch.id, Reservation.budget_day == day),
        )
    ).all()
    remaining = []
    for limit, daily in [(batch_limit, False), (daily_limit, True)]:
        if limit is None:
            continue
        if daily and estimate.currency != settings.geo_daily_budget_currency:
            raise BudgetExceeded()
        total = Decimal(0)  # 只累加明确金额，未知分支直接失败，不能 COALESCE 为 0。
        for reservation, batch_id, actual, currency in rows:
            outside = reservation.budget_day != day if daily else batch_id != batch.id
            if outside:
                continue
            if reservation.state == "UNKNOWN":
                raise BudgetExceeded()
            amount, unit = (
                (actual, currency)
                if reservation.state == "SETTLED"
                else (reservation.estimated_amount, reservation.estimated_currency)
            )
            if amount is None or unit != estimate.currency:
                raise BudgetExceeded()
            total += amount
        if total + estimate.amount > limit:
            raise BudgetExceeded()
        remaining.append(limit - total)
    return min(remaining)


def reserve(db: Session, run: Run, estimate: Money | None, now: datetime) -> None:
    reservation = db.get(Reservation, run.id)
    if reservation is None:
        reservation = Reservation(run_id=run.id)
        db.add(reservation)
    elif reservation.state != "RELEASED":
        raise ValueError("同一运行不能重复预留")
    reservation.state = "RESERVED"
    reservation.estimated_amount = estimate.amount if estimate is not None else None
    reservation.estimated_currency = estimate.currency if estimate is not None else None
    reservation.reserved_at = now
    reservation.budget_day = now.astimezone(UTC).date()
    reservation.sent_at = None
    reservation.settled_at = None


def authorize(db: Session, batch: GeoObservationBatch, run: Run, now: datetime) -> None:
    reservation = db.get(Reservation, run.id)
    if reservation is None or reservation.state != "RESERVED":
        raise ValueError("发送前必须持有唯一预留")
    estimate = None
    if reservation.estimated_amount is not None:
        assert reservation.estimated_currency is not None
        estimate = Money(reservation.estimated_amount, reservation.estimated_currency)
    require_budget(db, batch, run, estimate, now)
    reservation.state = "SENT"
    reservation.sent_at = now
    reservation.budget_day = now.astimezone(UTC).date()


def settle(db: Session, run: Run, now: datetime) -> None:
    reservation = db.get(Reservation, run.id)
    if reservation is None:
        return  # 尚未 claim 的配置失败、人工 Run 或预算拒绝没有预留。
    if reservation.state not in {"RESERVED", "SENT"}:
        raise ValueError("已结算的运行不能再次结算")
    reservation.state = (
        "RELEASED"
        if run.external_call_state == "NOT_STARTED"
        else "SETTLED"
        if run.cost_amount is not None
        else "UNKNOWN"
    )
    reservation.settled_at = now
