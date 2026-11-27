# Phase 4 PRD：GEO 归因增强、统一成本核算、Campaign 看板与全仓合同封版收口

## 目标
基于已冻结的纯 GEO 内容运营（方向 A）蓝图第 6 节及共识 #11–#12，交付：
1. **Slice 4A（`0078_geo_interventions`）**：在 GEO R6（`GeoOpportunity` / `GeoOpportunityAction` / `GeoRetestBaseline` / `GeoOpportunityDecision`）之上新增归因编排聚合 `GeoIntervention`，显式固化 `causal_claim = 'NOT_ESTABLISHED'` 与可比性/样本量披露。
2. **Slice 4B（`0079_unified_cost_accounting`）**：`AIModel` 可选输入/输出百万 Token 单价与币种配置；`GenerationJob` 与 `ContentQualityCheckJob` 完成时按当时单价冻结 `cost_amount/cost_currency`（缺价显式 `NULL` 不补零）；新增追加式可作废的 `operating_cost_entries` 人工/外采费用台账。
3. **Slice 4C（实时归因看板与经营指标）**：Campaign 归因与成本看板 API/UI、全局经营指标与内容衰退预警读模型、AI 模型定价弹窗与 Campaign 干预/成本台账交互。
4. **Slice 4D（全仓合同封版收口）**：对齐全部新增操作在 `contracts/openapi.yaml` 的 `$ref: '#/components/responses/ErrorResponse'` 规范，刷新 `backend/tests/unit/test_contract.py` 冻结基线并全量验证通过。

## 硬性不变量
- Alembic `revision` 长度 `<= 32` 字符；所有迁移为加法前滚，`downgrade()` 均以 `SQLSTATE 55000` 拒绝。
- 严格保留 `causal_claim = 'NOT_ESTABLISHED'`、多币种分列不混算、缺价显式 `NULL` 并标注缺价样本率。
- 所有新建手工维护源码文件 `<= 500` 行；不执行 Git 暂存/提交；保留既有未提交工作区修改。
