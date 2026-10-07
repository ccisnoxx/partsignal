"""只在测试中构造升级前的 CRON 数据，不绕过运行时版本守卫。"""

from uuid import UUID, uuid4

from sqlalchemy import select, text

from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_batch_creation import GeoBatchCreated
from app.services.geo_batches import schedule_identity
from tests.integration.geo_plans_support import PREFIX, PlansAPI


def historical_cron(api: PlansAPI, status: str = "ACTIVE") -> dict:
    row = api.create()
    with api.api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_monitoring_plans SET schedule_kind='CRON', "
                "cron_expression='0 * * * *', status=:status WHERE id=:id"
            ),
            {"id": row["id"], "status": status},
        )
        db.commit()
    return api.api.engineer.get(f"{PREFIX}/{row['id']}").json()


def historical_scheduled_batch(api: PlansAPI, window) -> tuple[dict, GeoBatchCreated]:
    # 先用受支持的人工入口取得完整冻结输入，再 INSERT 升级前的历史聚合。
    manual = api.create()
    response = api.api.engineer.post(
        f"{PREFIX}/{manual['id']}/run",
        json={"expected_revision": manual["revision"]},
        headers={"Idempotency-Key": f"historical-template-{uuid4()}"},
    )
    assert response.status_code == 201, response.text
    plan = historical_cron(api)
    with api.api.factory() as db:
        source = db.get(GeoObservationBatch, UUID(response.json()["batch_id"]))
        snapshot = source.plan_snapshot | {
            "plan_id": plan["id"],
            "plan_revision": plan["revision"],
            "schedule_kind": "CRON",
            "cron_expression": plan["cron_expression"],
        }
        batch = GeoObservationBatch(
            **{c.name: getattr(source, c.name) for c in GeoObservationBatch.__table__.columns}
            | {
                "id": uuid4(),
                "plan_id": UUID(plan["id"]),
                "trigger_type": "SCHEDULED",
                "scheduled_for": window,
                "schedule_identity": schedule_identity(UUID(plan["id"]), window),
                "created_by": None,
                "plan_snapshot": snapshot,
                "status": "PLANNED",
                "revision": 0,
            }
        )
        db.add(batch)
        db.flush()
        for source_run in db.scalars(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == source.id)
        ):
            db.add(
                GeoObservationRun(
                    **{
                        c.name: getattr(source_run, c.name)
                        for c in GeoObservationRun.__table__.columns
                        if c.computed is None
                    }
                    | {"id": uuid4(), "batch_id": batch.id}
                )
            )
        for subject in db.scalars(
            select(GeoBatchSubject).where(GeoBatchSubject.batch_id == source.id)
        ):
            db.add(
                GeoBatchSubject(
                    **{c.name: getattr(subject, c.name) for c in GeoBatchSubject.__table__.columns}
                    | {"batch_id": batch.id}
                )
            )
        db.flush()
        batch.status = "QUEUED"
        batch.revision = 1
        db.commit()
        plan = api.api.engineer.get(f"{PREFIX}/{plan['id']}").json()
        return plan, GeoBatchCreated(
            batch_id=batch.id,
            requested_run_count=batch.requested_run_count,
            created_at=batch.created_at,
        )
