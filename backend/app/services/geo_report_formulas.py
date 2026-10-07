"""报告方法说明；只描述601/602实际公式，不另行计算业务指标。"""

from app.schemas.geo_reports import GeoReportFormula
from app.services.geo_metrics import FORMULA_VERSION
from app.services.geo_overview import QUALITY_VERSION

METHOD_NOTES = [
    "本报告为实时读取，不是归档快照；as_of为数据库一致读取事务时间，生成时间为数据库时钟。",
    "仅使用筛选窗口内latest attempt、显式current成功分析及其latest有效Review，不择优挑选历史结果。",
    "业务结果按完整维度和冻结对象集合分层，不混合模式、点名、环境、规则、事实或版本。",
    "比例同时保留分子、分母、合格运行数及排除原因；零分母为null，失败不算未提及。",
    "样本等级NONE/OBSERVED/REPORTABLE/STABLE只表示样本数量门槛，不表示统计显著性。",
    "趋势比较紧邻等长窗口；维度不兼容或样本不足时变化为null并保留原因。",
    "目标主题覆盖=达到目标且达到REPORTABLE门槛的主题数/全部监测主题数；正向主题覆盖的分母为合格主题数。",
    "引用按每个回答的规范URL去重；原始occurrences不扩大事件分母，共享域名保持显式说明。",
    "UNJUDGEABLE声明保留在明细中，但不进入准确、部分准确、错误或严重错误的可判断分母。",
    "未知费用、模型或版本保持未知；已知费用按币种分别汇总，不换算或补零。",
    "当前未实施机会实体与行动闭环，机会导出明确返回NOT_IMPLEMENTED。",
]


def report_formulas() -> list[GeoReportFormula]:
    business = (
        ("natural_visibility", "自然可见率", "目标被提及的合格运行数", "UNBRANDED合格运行数"),
        ("recommendation_rate", "推荐率", "目标被推荐的合格运行数", "推荐意图合格运行数"),
        ("accurate_claim_rate", "声明准确率", "目标ACCURATE声明数", "目标可判断声明数"),
        ("mention_sov", "提及份额", "目标被提及运行事件数", "冻结竞争集合被提及运行事件总数"),
        (
            "recommendation_sov",
            "推荐份额",
            "目标被推荐运行事件数",
            "冻结竞争集合被推荐运行事件总数",
        ),
        (
            "owned_source_coverage",
            "自有来源覆盖率",
            "含自有来源引用的运行数",
            "引用观察及分类合格运行数",
        ),
        (
            "owned_citation_share",
            "自有引用份额",
            "自有来源规范URL引用数",
            "合格运行规范URL引用总数",
        ),
        ("partial_claim_rate", "声明部分准确率", "目标PARTIAL声明数", "目标可判断声明数"),
        ("incorrect_claim_rate", "声明错误率", "目标INCORRECT声明数", "目标可判断声明数"),
        (
            "severe_error_run_rate",
            "严重错误运行率",
            "含INCORRECT且HIGH/CRITICAL目标声明的运行数",
            "含目标可判断声明的合格运行数",
        ),
    )
    quality = (
        ("eligible_runs", "通用合格率", "通用合格运行数", "筛选候选运行数"),
        (
            "run_success_rate",
            "运行成功率",
            "COMPLETED运行数",
            "COMPLETED/FAILED/CANCELLED终态运行数",
        ),
        ("analysis_run_coverage", "分析覆盖率", "有回答且current分析可用的运行数", "有回答运行数"),
        ("review_backlog", "待复核率", "要求复核但current复核无效的运行数", "筛选候选运行数"),
        ("evidence_completeness", "证据完整率", "证据完整的COMPLETED运行数", "COMPLETED运行数"),
        ("cost_coverage", "费用覆盖率", "金额与币种均已知的运行数", "筛选候选运行数"),
        (
            "model_version_coverage",
            "模型版本覆盖率",
            "有回答且模型与版本已知的运行数",
            "有回答运行数",
        ),
    )
    return [
        GeoReportFormula.model_validate(
            dict(
                metric_code=code,
                label=label,
                formula_version=version,
                numerator_description=numerator,
                denominator_description=denominator,
            )
        )
        for rows, version in ((business, FORMULA_VERSION), (quality, QUALITY_VERSION))
        for code, label, numerator, denominator in rows
    ]
