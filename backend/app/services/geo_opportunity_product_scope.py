"""保存来源的自有产品范围；行动命令与选项读取共用，不依赖当前Catalog。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_runs import GeoRunInputSnapshot


def saved_own_product_ids(db: Session, opportunity: GeoOpportunity) -> frozenset[UUID]:
    frozen = [
        GeoRunInputSnapshot.model_validate(snapshot)
        for snapshot in db.scalars(
            select(GeoObservationRun.input_snapshot)
            .join(GeoOpportunitySource, GeoOpportunitySource.run_id == GeoObservationRun.id)
            .where(GeoOpportunitySource.opportunity_id == opportunity.id)
            .distinct()
        )
    ]
    subjects = [subject for run in frozen for subject in run.subjects]
    scoped = [
        subject
        for subject in subjects
        if subject.id == opportunity.subject_id and subject.subject_type == "OWN_PRODUCT"
    ]
    candidates = scoped or [
        subject for subject in subjects if subject.subject_type == "OWN_PRODUCT"
    ]
    return frozenset(subject.product_id for subject in candidates if subject.product_id is not None)
