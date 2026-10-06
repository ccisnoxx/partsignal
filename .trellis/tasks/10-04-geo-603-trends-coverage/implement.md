# GEO-603 实施与交付证据

## 交付状态

2026-10-04，分支 `geo/GEO-603`；依赖 GEO-601 已 done且人工接受记录已核对。仅实现603。manifest从planned进入in_progress，完成实现/本地验证后为review；等待用户人工接受，未标记done、提交、推送、归档或启用生产。Trellis保持活动任务，meta.delivery_status=review，completedAt=null。

## 实现与合同

- `geo_metrics.py`新增趋势比较和覆盖分类，原18项公式版本geo-answer-v1不改；`geo_metric_views.py`为冻结窗口、门槛与不可用原因。
- 新应用读服务 `geo_answer_insights.py` 和schema/router，复用602输入/批量查询；main仅注册Router。
- 根OpenAPI新增`/api/v1/geo/insights`及`/runs`，operationId为getGeoAnswerInsights/listGeoAnswerInsightRuns；新增11个Schema。evidence/openapi-semantic-diff.json证明所有既有路径及Schema语义不变，包括旧文章关系级`/api/v1/geo-insights`。
- 根database.md只追加只读合同，API方法/README/需求追踪同步；前端只运行canonical api:generate更新schema.d.ts，没有页面、路由、query key或URL状态变更。
- 新unit：test_geo_metric_trends.py、test_geo_answer_insights.py；新integration：test_geo_answer_insights.py。公共契约数量断言同步，不放宽错误或安全合同。

## 关键不变量与失败边界

当前/紧邻等长前期使用原始Run.created_at半开窗口，UTC规范化；无法表示前期明确422。完整cell保留冻结环境、规则、对象字典、事实绑定与实际竞争集合。每期恰好一个可比cell才算趋势，集合改变、多cell、维度/公式改变、缺窗口、无分母或样本不足均null变化+显式原因；普通趋势每期至少5合格运行，SOV按方法§15为3。前期零相对变化null，不制造无限增长。

产品/平台/SOV区块引用原始cell，不平均百分比。竞品分母为冻结PRIMARY/COMPETITOR对象事件，REFERENCE不混入；产品筛选不收缩实际集合。BRANDED被自然可见、自然SOV和自然覆盖排除；合格运行数独立于事件数。零分母null。所有变体保留；主题达标阈值0.6/可报告3，稳定分类需5。文档未定义的高比例3–4分类保持null/INSUFFICIENT_STABLE_SAMPLE，达标布尔值不冒充稳定分类。准确率明确单列不可判断声明数，不纳入可判断分母。

同一RR事务一次加载两窗口，固定12次应用SELECT、含认证13SQL，empty/dense均验证；复用current Analysis、其绑定latest Review和全表successor排除旧attempt。不写ORM、DML、commit、审计、指标表或队列；不加行锁，不推进revision，不改变状态机或引入幂等键。请求关闭回滚读Session，复用既有409 GEO_READ_MODEL_INCOMPLETE、404失效cell及422输入错误。下钻实时重新读as_of，不保证跨请求快照或失效cell回退。

ADMIN/ENGINEER认证、session及强制改密保持，响应no-store；Router无事务所有权。没有外部I/O/真实AI调用；公共响应不含凭据、lease token、headers、回答原文或受限事实正文。测试使用独占PG16/Redis/fake-OSS，未更改生产控制。

## 数据与迁移

没有表/列/索引/约束、Alembic revision、数据回填或历史数据迁移。`cd backend && uv run alembic heads`退出0，输出0056_geo_run_review (head)，记录在evidence/alembic-heads.log。完整集成包含既有迁移回归并通过；本任务不存在新的前滚步骤，也未对生产数据库执行迁移。安全停止只需回退新增只读源码/Router，历史证据不动。

## 实际验证

所有自动命令通过evidence/run_check.py记录精确argv/cwd/时间/退出码及日志，不把未运行检查称通过。

| 命令/范围 | 实际结果 | 证据前缀 |
|---|---|---|
| `uv run --project backend pytest backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_metric_inputs.py backend/tests/unit/test_geo_overview.py` | 基线135通过 | baseline-unit |
| 隔离Compose `run --rm backend-test pytest tests/integration/test_geo_overview.py` | 基线8通过 | baseline-integration |
| `make lint` | 最终退出0，后端Ruff/前端ESLint通过 | final-lint |
| `make typecheck` | 最终退出0，mypy189源文件/tsc通过 | final-typecheck |
| `make test-unit` | 后端3508、前端1170通过 | candidate-unit |
| `make test-integration COMPOSE='docker compose -p partsignal-geo603-validation -f .trellis/tasks/10-04-geo-603-trends-coverage/evidence/validation-compose.yaml'` | 986通过，25条既有迁移fixture SQLAlchemy警告 | candidate-integration |
| `make contract-check` | 最终退出0，FastAPI/root OpenAPI及generated类型一致 | final-contract |
| `uv run --project backend pytest backend/tests/unit/test_geo_metric_trends.py backend/tests/unit/test_geo_answer_insights.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py` | 最后两项修正后439通过 | final-target-unit |
| 隔离Compose `run --rm backend-test pytest tests/integration/test_geo_answer_insights.py tests/integration/test_geo_overview.py -q` | 最终15项通过，退出0 | final-target-integration |
| `git diff --check` | 最终退出0；新文件另检查尾随空白 | final-diff-check / scope-check |

完整单元门禁在初审两项修正之前运行；修正后重新运行直接受影响的439项单元、15项HTTP/PG、lint/typecheck/contract-check，复用未受影响范围的成功证据，不重复全套。完整集成运行期间已进入上述修正阶段，因此最终源码以最后15项定向PG结果补充确认，不将长运行本身当作精确最终快照。

## 已定位失败及收敛

初次mypy报告4项局部类型标注/变量复用问题，修正后通过；初次契约比较是新sample filters的nullable默认字段漂移，按运行时合同修正。初次单元572通过/1失败是公共响应总数旧断言，同步实际合同后完整unit通过。

初次PG3失败/10通过来自旧接口URL写错、产品筛选夹具同时限制品牌、RR夹具被前用例数据混入；修正真实入口与隔离筛选。随后一次测试文件编辑产生缩进收集失败，已修正；v3的13项通过，最终增加日期回归后15项通过。候选lint失败是测试循环回调闭包B023，绑定本轮list后通过；candidate-contract失败是最终路径调整后generated漂移，canonical api:generate之后通过。

初审准确率反例回归先红（缺属性AttributeError），加必填计数后绿；日期溢出由独立只读反例证明，新DTO两HTTP入口422保护。所有失败日志保留，未盲重试或放宽生产边界。

## 独立审查与审计

初审fresh critical_reviewer发现2项P2，最终fresh只读复核确认关闭且无新增问题；记录见evidence/independent-review.md、independent-fix-review.md。审查者未重复门禁。计数混合反例由服务单测保护，HTTP未单独构造100未知声明；响应模型/根合同一致性补充检查。最终复核父模型和MetricWindow使用主代理提供的未修改最小原文，这一来源限制保留在报告。

SUBAGENT_EXECUTION_DIGEST已由本机WorkPlan生成，2计划/2审查交付验收通过，0活跃/0未知写入/0异常；这里的“验收通过”是审查子任务交付，不是把603标记done。Audit Bundle关闭并验证通过，audit_id=`20261004T071706Z-geo-603-0384324f`，14个审计产物。固定TOML配置gpt-6.1-sol/xhigh不表示单独核验运行时模型。

## Diff、文档校验与限制

启动时仓库已有大量其他GEO任务未提交/未跟踪工作。本任务仅改evidence/changed-files.json列出的20个源/合同/文档文件和本Task；evidence/before基线与task-only.diff用于隔离实际修改。最终语义检查只允许manifest的603行改变，OpenAPI只新增上述路径/Schema；无迁移、环境、部署、依赖或其他任务修改。

SHA256SUMS仅更新本任务修改的5份文档条目。启动前存在03-technical/04-frontend-architecture.md校验条目不一致，保持未修复，证据见preexisting-doc-hash-mismatches.json；不能宣称整个既有文档包校验通过。

无新前端旅程，不运行build/E2E/浏览器矩阵；本任务不进行生产、容量、真实平台或性能验收。主题分母是实际监测/有合格运行主题，不从可变计划重建历史应执行总量；跨请求快照不冻结。高比例3–4样本分类未定义，显式不可用。没有当前不可消解冲突、缺依赖或必须外部输入，无blocked条件。

后续GEO-604负责引用/风险/质量洞察，GEO-605负责前端，GEO-702负责机会；均未实现。Task保持review等待人工接受。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-603 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-04；既有review证据与验证限制保留为验收前历史。本次仅收尾GEO-603，不修改其他任务状态、不实施后续任务、不提交或归档。

保留既有execution_note、review_note、实施过程及evidence的历史状态与真实测试结果；SHA256SUMS仅同步manifest条目。本次收尾运行git diff --check，实际结果在最终回复报告。
