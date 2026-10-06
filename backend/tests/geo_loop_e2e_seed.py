"""GEO707 隔离真实栈的规则评估入口；不伪造采集、分析或业务状态。"""

import json
import sys
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select

from app.db import SessionLocal
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunityEvaluation
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_runs import GeoRunInputSnapshot
from app.services.geo_opportunities import evaluate_opportunities
from tests.geo_opportunity_e2e_seed import validate_owned_database


def main() -> None:
    validate_owned_database()
    batch_id = UUID(sys.argv[1])
    request_id = f"GEO707-{batch_id}"
    with SessionLocal() as db:
        batch = db.get(GeoObservationBatch, batch_id)
        runs = list(
            db.scalars(
                select(GeoObservationRun)
                .where(GeoObservationRun.batch_id == batch_id)
                .order_by(GeoObservationRun.repeat_index)
            )
        )
        if (
            batch is None
            or not batch.plan_snapshot["name"].startswith("GEO707 ")
            or batch.trigger_type != "MANUAL"
            or batch.status != "COMPLETED"
            or batch.requested_run_count != 5
            or len(runs) != 5
            or [run.repeat_index for run in runs] != [1, 2, 3, 4, 5]
        ):
            raise ValueError("GEO707 只评估本轮 API 创建且完成真实分析的五次虚构基线")
        first = GeoRunInputSnapshot.model_validate(runs[0].input_snapshot)
        if (
            len(first.subjects) != 1
            or first.subjects[0].subject_type != "OWN_PRODUCT"
            or first.subjects[0].role != "PRIMARY"
            or not first.subjects[0].canonical_name.startswith("GEO707-")
            # 公开产品事实不授予外发资格；canonical 批次仍冻结 INTERNAL。
            or first.data_classification != "INTERNAL"
            or first.prompt.mention_mode != "UNBRANDED"
            or first.prompt.priority != "CORE"
            or not first.prompt.prompt_text.startswith("GEO707 ")
            or not first.prompt.canonical_question.startswith("GEO707 ")
            or first.profile.collection_mode != "MANUAL"
            or not first.profile.name.startswith("GEO707 ")
            or not first.profile.settings.require_screenshot
        ):
            raise ValueError("GEO707 评估输入必须为自有虚构公开产品的核心非点名人工观测")
        product = db.get(Product, first.subjects[0].product_id)
        # 隔离测试使用已初始化管理员执行评估，批次创建者仍可为 ENGINEER。
        actor = db.scalar(
            select(User).where(User.username == "admin", User.account_type == "ADMIN")
        )
        if product is None or not product.part_number.startswith("GEO707-") or actor is None:
            raise ValueError("GEO707 评估缺少本轮虚构产品或创建者")
        fact = db.scalar(
            select(FactVersion)
            .where(
                FactVersion.product_id == product.id,
                FactVersion.status == "APPROVED",
                FactVersion.classification == "PUBLIC",
            )
            .order_by(FactVersion.version.desc())
            .limit(1)
        )
        if fact is None or not fact.body_markdown.startswith(f"# {product.part_number}\n"):
            raise ValueError("GEO707 评估必须使用同产品已批准的虚构公开事实")
        for run in runs:
            snapshot = GeoRunInputSnapshot.model_validate(run.input_snapshot)
            answer = db.scalar(select(GeoAnswerSnapshot).where(GeoAnswerSnapshot.run_id == run.id))
            if (
                run.status != "COMPLETED"
                or run.current_analysis_revision_id is None
                or snapshot != first
                or answer is None
                or product.part_number in answer.answer_text
                or answer.screenshot_file_id is None
                or answer.source_product != "GEO707虚构观测产品"
                or answer.source_model != "geo707-fictional-model"
                or answer.source_version != "geo707-fixture-v1"
            ):
                raise ValueError("GEO707 五次基线须有真实证据和分析，同环境且全部不提及型号")
        filters = GeoOverviewFilters(
            date_from=min(run.created_at for run in runs),
            date_to=max(run.created_at for run in runs) + timedelta(microseconds=1),
            subject_ids=[first.subjects[0].id],
            product_ids=[product.id],
            query_topic_ids=[first.prompt.query_topic_id],
            prompt_variant_ids=[first.prompt.id],
            collection_profile_ids=[first.profile.id],
        )
        results = evaluate_opportunities(db, filters, actor=actor, request_id=request_id)
        evaluations = list(
            db.scalars(
                select(GeoOpportunityEvaluation).where(
                    GeoOpportunityEvaluation.id.in_([result.evaluation_id for result in results]),
                    GeoOpportunityEvaluation.result_snapshot["rule_code"].as_string()
                    == "TOPIC_COVERAGE_GAP",
                    GeoOpportunityEvaluation.opportunity_id.is_not(None),
                )
            )
        )
        if len(evaluations) != 1:
            raise ValueError("GEO707 真实 evaluator 未生成唯一主题覆盖缺口机会")
        evaluation = evaluations[0]
        if (
            evaluation.result_snapshot["numerator"] != 0
            or evaluation.result_snapshot["denominator"] != 5
        ):
            raise ValueError("GEO707 主题覆盖缺口必须来源于全部五次有效基线")
        print(
            json.dumps({"opportunity_id": str(evaluation.opportunity_id), "request_id": request_id})
        )


if __name__ == "__main__":
    main()
