"""一致读中冻结输入并用 PostgreSQL 权威函数查重；调用方持有 Run 锁。"""

from uuid import UUID

from sqlalchemy import JSON, cast, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.models.geo_analysis import GeoAnalysisFactVersion, GeoAnalysisRevision
from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_runs import GeoObservationRun
from app.schemas.geo_analysis import (
    GeoAnalysisConfiguration,
    GeoAnalysisFactBinding,
    GeoAnalysisInputSnapshot,
    GeoAnalysisParameters,
)
from app.schemas.geo_runs import GeoRunInputSnapshot
from app.services.geo_analysis import MENTION_RULE_VERSION, RECOMMENDATION_RULE_VERSION
from app.services.geo_batch_snapshots import freeze_subjects
from app.services.geo_citation_rules import CITATION_RULE_VERSION
from app.services.geo_claim_rules import CLAIM_RULE_VERSION
from app.services.geo_fact_versions import assemble_fact_versions

ANALYZER_VERSION = "geo-analysis-v1"
RULE_SET_VERSION = "+".join(
    (MENTION_RULE_VERSION, RECOMMENDATION_RULE_VERSION, CITATION_RULE_VERSION, CLAIM_RULE_VERSION)
)


def prepare_revision(db: Session, run: GeoObservationRun, *, current_dictionary: bool) -> UUID:
    """只追加或复用；失败 revision 可显式复跑，成功/待执行同 hash 不重复创建。"""
    if db.connection().get_isolation_level() != "REPEATABLE READ":
        raise ValueError("分析输入创建要求 REPEATABLE READ 一致快照")
    answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id))
    if answer is None:
        raise ValueError("分析必须保有原始回答")
    frozen = GeoRunInputSnapshot.model_validate(run.input_snapshot)
    subjects = (
        freeze_subjects(db, {row.id: row.role for row in frozen.subjects})
        if current_dictionary
        else frozen.subjects
    )
    if {(s.id, s.subject_type, s.product_id, s.role) for s in subjects} != {
        (s.id, s.subject_type, s.product_id, s.role) for s in frozen.subjects
    }:
        raise ValueError("重新分析不能改变原运行对象身份和角色")
    facts = assemble_fact_versions(db, subjects)
    snapshot = GeoAnalysisInputSnapshot(
        schema_version=1,
        answer_sha256=answer.answer_sha256,
        subjects=sorted(subjects, key=lambda s: s.id),
        fact_versions=[
            GeoAnalysisFactBinding(subject_id=row.subject_id, fact_version_id=row.fact.id)
            for row in facts.subjects
            if row.fact is not None
        ],
        configuration=GeoAnalysisConfiguration(
            rule_set_version=RULE_SET_VERSION,
            model_name=None,
            model_version=None,
            prompt_template_version=None,
            prompt_sha256=None,
            parameters=GeoAnalysisParameters(
                temperature=None, top_p=None, max_output_tokens=None, seed=None
            ),
        ),
    ).model_dump(mode="json")
    # JSON 参数由 SQLAlchemy 类型绑定，不在 Python 复制 PostgreSQL jsonb 的 hash 算法。
    input_hash = db.scalar(
        select(
            func.geo_analysis_input_sha256(
                cast(cast(snapshot, JSON), JSONB),
                "DETERMINISTIC",
                ANALYZER_VERSION,
            )
        )
    )
    a = GeoAnalysisRevision
    existing = db.scalar(
        select(a.id)
        .where(
            a.run_id == run.id,
            a.input_sha256 == input_hash,
            a.status.in_(["PENDING", "COMPLETED"]),
        )
        .order_by(a.revision.desc())
        .limit(1)
    )
    if existing is not None:
        return existing
    number = db.scalar(select(func.coalesce(func.max(a.revision), 0)).where(a.run_id == run.id))
    assert number is not None
    analysis = GeoAnalysisRevision(
        run_id=run.id,
        answer_snapshot_id=answer.id,
        revision=int(number) + 1,
        analyzer_type="DETERMINISTIC",
        analyzer_version=ANALYZER_VERSION,
        input_snapshot=snapshot,
    )
    db.add(analysis)
    db.flush()
    db.add_all(
        [
            GeoAnalysisFactVersion(
                analysis_revision_id=analysis.id,
                subject_id=row.subject_id,
                fact_version_id=row.fact.id,
            )
            for row in facts.subjects
            if row.fact is not None
        ]
    )
    db.add(GeoAnalysisJob(analysis_revision_id=analysis.id))
    db.flush()
    return analysis.id
