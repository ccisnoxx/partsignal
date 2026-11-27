# Phase 4 实施记录

## 切片进度

- [x] Slice 4A：`GeoIntervention` 干预编排与归因层（`0078_geo_interventions`）
- [x] Slice 4B：统一 AI 成本冻结与人工/外采费用台账（`0079_unified_cost_accounting`）
- [x] Slice 4C：Campaign 归因看板、经营指标与内容衰退预警
- [x] Slice 4D：全仓合同封版收口（`test_contract.py` + `contracts/openapi.yaml` + 全栈回归）

## 独立只读审查与收敛记录

- **Slice 4A–4B 审查（1 P0 + 5 P1 + 3 P2）**：全部已修复并回归验证，包括按真实 `GeoRetestComparison` 结构解析前后窗口指标/可比性原因与 `decision.baseline_id` 配对、消除 `User` AB-BA 与 `ContentCampaign <-> GeoIntervention` 锁序倒置、绑定运营费用后锁定 `campaign_id`、`AwareDatetime` 防混合时区 500、`DeletionBlockerType` 同步与活动删除投影、`GET /api/v1/ai-models/{model_id}/pricing` 收紧至 `AdminUser`、`0078` 触发器补齐 `id` 不可变与禁止 `ACTIVE/EVALUATING -> PLANNED` 回退、`GenerationJob` ORM 约束补齐，以及列表 N+1 批量化。
- **Slice 4C 审查（2 P0 + 6 P1 + 2 P2）**：全部已修复并回归验证，包括统一活动与全局看板时间窗口口径（事件口径产出 + 窗口成本 + UTC+14 日历上界排除未来排期费用）、GEO 归因去重重试旧 Attempt、叠加 `GeoRunReview` 人工复核投影与 `GeoCitationClassification` + 引用可观测性过滤、修复空产品活动作用域隔离、补齐 `IN_PROGRESS` 机会与衰退预警、GEO 未定价率与单样本成本同集收敛、核心聚合 SQL 下推与 `ARRAY(PGUUID)` 绑定、模型定价保存后联动失效 `aiChannelKeys.models` 并补齐 409 CAS 恢复路径、前端表单防重复提交与子查询错误态、`UNHEALTHY_PAGE` 跳转目标改为 `/publishing/articles/{id}`。

## 验证摘要

- 合同与生成：`make contract-generate`、`make contract-check` 通过（318 operations、2066 responses、全仓非 2xx 响应统一 `$ref: '#/components/responses/ErrorResponse'`）。
- 后端静态与单测：`ruff check` 通过；`mypy`（318 源文件）0 错；`test_contract.py` 61/61 通过；`test_cost_accounting.py` 6/6 通过。
- 真实 PostgreSQL 17 集成回归：`test_geo_interventions.py`、`test_unified_cost_accounting.py`、`test_campaign_attribution_and_metrics.py`、`test_content_planning_layer.py`、`test_quality_gate_and_duplication.py`、`test_public_page_health_checks.py` 共 8/8 通过。
- 前端验证：`tsc -b`、`eslint --max-warnings 0`、目标 Vitest（46/46，含全部 7 个 Phase 4 审计动作与事实字段前端投影）通过。
