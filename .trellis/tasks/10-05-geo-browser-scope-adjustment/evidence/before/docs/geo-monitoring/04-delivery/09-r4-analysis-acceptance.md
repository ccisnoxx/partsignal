# R4 分析器质量与前端复核验收（GEO-508）

日期：2026-10-03。GEO-508任务状态为review，任务状态以 task-manifest.yaml 为准，等待人工接受。

## 验收口径与输入

分析器为本地 DETERMINISTIC `geo-analysis-v1`，规则版本包括 geo-mentions-v1、geo-recommendations-v1、geo-citations-v1、geo-claims-v1。不使用真实外部AI。原始回答、批准事实、别名与域名字典是显式冻结输入；机器与人工结果分别保留。

已有虚构 JSON 共151个独立场景（共享13、提及28、推荐63、声明47）。共享13跨四阶段复用形成190阶段场景检查，不能称190个独立样本。质量策略未批准precision/recall/F1数值阈值；本次标准为全部既有语义断言通过，不改写金标预期。

输入版本：共享dataset geo-005-v1，fixture/gold=1.0.0；追加集各自version=1.0.0。全部JSON及schema哈希见 [gold-input-sha256.json](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/gold-input-sha256.json)。fixture和金标未修改，原文敏感标记校验通过。

## 全部分析金标结果

执行 `uv run --project backend pytest backend/tests/unit/test_geo_analysis.py backend/tests/unit/test_geo_recommendations.py backend/tests/unit/test_geo_citations.py backend/tests/unit/test_geo_claims.py --junitxml=.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/analysis-gold.xml`，退出0，270 passed。

| 阶段 | JSON场景范围 | 本轮suite结果 | 保护的可观察合同 |
|---|---|---:|---|
| 提及 | 共享13+追加28 | 49 passed | 精确型号/后缀、大小写/连字符、Unicode位置、计数/别名、否定、歧义候选 |
| 推荐 | 共享13+追加63 | 83 passed | 名称出现不等于推荐、四态、可靠rank、条件/引语/否定、无序/冲突复核 |
| 引用 | 共享13+代码金标 | 66 passed | hostname边界、子域名、IDNA、共享域名、原始去重/位置、分类与修正 |
| 声明 | 共享13+追加47 | 72 passed | 类型/verdict/severity、同产品批准事实、条件替代、数值冲突、事实不足、受限事实本地化 |

suite数量包括规则边界及安全反例，不能称270个金标独立样本。引用共享13是在一个测试内逐例运行；代码金标与JSON场景计数分开。

`make test-geo-fixtures` 退出0，四组Schema/关系/敏感数据规则全部通过；外部调用0。原始命令/退出码见 [analysis-gold.json](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/analysis-gold.json) 与 [fixture-check.json](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/fixture-check.json)，JUnit见 [analysis-gold.xml](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/analysis-gold.xml)。

## 已知映射与质量限制

- 共享引用金标的subject_ids表示页面内容对象；实际域名归属不能从URL产品路径选一个共享对象。现有test_geo_citations.py明确要求OWNED、subject_id=null且保留品牌/两个产品候选及CITATION_OWNERSHIP_AMBIGUOUS。本次保持该批准行为，不更改金标，也不声称每个局部字段逐字相等。
- 本地执行器当前无第三方来源类别登记，未匹配的真实输入分类为UNKNOWN；纯规则金标显式装配虚构媒体登记，不代表生产已有该登记能力。
- 共享prompt injection标记是无可信权限原文；测试证明不会被当工具执行或污染推荐/事实判断，不代表通用提示注入检测或DLP能力。
- 早期PRD枚举草稿已由GEO-501落地和根OpenAPI四态裁决，页面消费generated类型。无权威事实始终UNJUDGEABLE。
- 通过Review门禁不等于完整MetricEligibility。必要复核前false；通过后null/METRIC_ELIGIBILITY_NOT_IMPLEMENTED，GEO-601继续拥有完整资格和公式。

## 严重错误与历史纵向验收

新增真实PG `test_geo_r4_acceptance.py` 验证5V回答与3.3V批准事实冲突为INCORRECT/HIGH，HIGH_SEVERITY_INCORRECT进入review gate。人工CONFIRMED保留错误判断及原始回答，不伪装错误已修复；新字典revision重分析使旧Review仅历史，stale提交409；当前CORRECTED追加说明、机器行不变、原Answer/Citation不变。定向1 passed，精确命令见 [r4-severe-pg.json](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/r4-severe-pg.json)。

前端最终候选 Vitest 124文件/1170项通过；PG复核基线26项、新增严重错误纵向1项通过，完整PG集成973项通过。最终 `make e2e` 退出0：canonical真实流程27项、GEO enabled/api-disabled/monitoring-disabled各1项、UI矩阵498项通过；UI矩阵60项真实栈专属用例按模式跳过，真实流程已由前述专属入口运行。三个GEO阶段另各有1项相斥模式跳过，不计入通过数。敏感产物扫描与随机数据库/Redis/端口/存储精确清理均通过。

完整命令见 [make-e2e-candidate.json](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/evidence/make-e2e-candidate.json)。早期失败与修正、verify续跑结果/复用证据、独立复核见本任务 [实施证据](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/implement.md)。`verify`剩余门禁续跑退出0，复用未变化的合同/973项PG/前端构建和最终完整E2E证据；最新静态/类型/unit、后端构建、collector契约194项、部署与Compose门禁实际执行通过。精确续跑参数与来源见实施证据，不声称无参数verify完整重跑，也不将未执行检查或首轮非零命令改写为通过。

## 交付与后续

OpenAPI/数据库/Alembic无变化，当前head0056_geo_run_review；无历史数据迁移、生产操作或发布。后续GEO-601指标与602～607洞察、701以后机会、801以后Browser不属于本任务。
