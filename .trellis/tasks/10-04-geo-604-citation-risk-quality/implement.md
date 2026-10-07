# GEO-604 实施证据

2026-10-04，本任务在既有geo/GEO-604分支实施。依赖601/504/505均done，604由planned→in_progress→review；无done、提交、PR或归档。起始9730文件摘要及工作树在evidence/baseline-files.json、git-status-before.txt；本任务前副本在before/，最终本任务增量在candidate.diff及candidate-scope.json。前序未提交成果保留。

## 实现与合同

新增geo_insight_evidence.py冻结原始引用、有效分类/声明、共享候选和版本元数据；geo_insight_details.py共享引用/声明事件选择器及聚合/分页；geo_insight_quality.py复用602质量公式，组装费用/版本/共享及质量下钻。Schema在geo_insight_details.py；既有answer_insights服务、Schema和Router接线，overview_queries只增加快照转换，不新增SQL。geo_metrics.py保持601权威owner，域名覆盖及新增五项指标直接消费该库。

根OpenAPI新增citations/claims/quality/runs三GET，扩展既有insights响应和runs的五项指标码；24组件新增或变化，具体清单见openapi-changes.json。静态/运行时完整合同与generated类型一致。旧文章级GeoInsights与其他operation语义不变；精确metadata门禁扩展三operation，保留每response错误信封和唯一RequestIdHeader校验。

database.md仅追加只读合同，无表/列/索引/ORM/DDL/Alembic/回填。head确认0056_geo_run_review；隔离PG集成中空库及旧head前滚通过，不操作生产数据。方法§21、API、PRD已批准判断标签、README、追踪与CHANGELOG同步。状态机、ADR、权限和指标公式不变。

前端仅重生成frontend/src/shared/api/generated/schema.d.ts，无页面、路由、query key、URL状态或客户端公式。605/606/607/701/702、文章自动匹配/来源变化、Browser、真实provider和生产启用范围外。

## 不变量、事务及安全

同一RR批量输入、latest attempt、current成功analysis及其中latest Review整体投影是事实源。引用和声明摘要/明细使用同一选择器；质量与组成Run使用602同一质量字典。事件条数与不同Run计数分别返回，完整cell不混算；费用分币且仅已报告值进入均价，未知不补零，零值保留。规范URL每回答一次，occurrences不膨胀分母；精确hostname覆盖调用601。目标UNJUDGEABLE可以下钻但不算正确/错误，严重错误仅INCORRECT HIGH/CRITICAL。共享候选及缺必要复核的backlog进入同筛选候选质量统计，排除Run去重而原因可重叠。

每请求固定12次应用SELECT、含身份13SQL，在认证前进入REPEATABLE READ，禁autoflush、关闭Session回滚。无DML/commit/行锁/锁序/revision推进/状态转换/写幂等/审计/Redis消息或外部I/O。GET保留ADMIN/ENGINEER、session及改密门禁、no-store、闭合422；消失cell404，损坏历史沿用409 GEO_READ_MODEL_INCOMPLETE。详情只返回已授权保存证据，不返回完整答案、raw payload、Review comment、lease或凭据；不访问引用URL、OSS HEAD或AI。

## 实际验证

每项精确argv、开始/结束时间、退出码在同名evidence/*.json，完整输出在*.log。make集成显式覆盖COMPOSE为专用项目和validation-compose.yaml：PG16、Redis7.4、fake OSS，无宿主端口、真实平台或生产资源。

| 检查 | 结果 | 记录 |
|---|---|---|
| 定向当前基线unit（metrics/inputs/overview/insights/citations/claims） | 279 passed | baseline-unit |
| 定向当前基线PG（overview/insights/citations/claims） | 23 passed | baseline-pg |
| 604+601/602/603定向unit | 150 passed | target-unit |
| 604+602/603定向PG/HTTP | 21 passed | target-integration-final |
| 精确公共合同/响应metadata及604 unit | 415 passed | contract-metadata-corrected |
| git diff --check | exit 0 | diff-check/final-diff-check |
| make lint | 后端及前端通过 | lint-final |
| make typecheck | mypy 193文件、前端tsc通过 | typecheck-final |
| make test-unit | 后端3518、前端1170通过 | test-unit-final |
| make test-integration COMPOSE='docker compose -p partsignal-geo604-validation -f .trellis/tasks/10-04-geo-604-citation-risk-quality/evidence/validation-compose.yaml' | 994 passed，25条既有SQLAlchemy warnings | test-integration |
| 补充最终604 PostgreSQL/HTTP文件 | 7 passed：加入零费用/混币JSON往返及同revision后续Review整体替换 | review-gap-integration-final |
| make contract-check | runtime及generated一致 | contract-final |
| uv run --project backend alembic -c backend/alembic.ini heads | 0056_geo_run_review (head) | alembic-head |

完整单元/集成成功后，仅补充独立复核发现的具体HTTP覆盖缺口；应用代码保持冻结，新增/调整的集成测试文件全量7项再通过，未冗余重跑完整门禁。E2E、浏览器矩阵、性能阶段、真实provider、生产前滚/发布未运行：本任务为服务端只读API，真实HTTP/PG已观察变化边界，无页面流程变化；这些门禁属于后续任务，未宣称通过。

## 修正轨迹

第一次PG测试失败来自夹具：原URL查询参数不同不能合并、snapshot引用数必须等于实际去重条数；原共用库导致分页混入前项、未来created_at违反已有时间守卫、按首cell取指标误取未选竞品；以及默认快照没有domains。修正输入、历史窗口隔离和selected_subject定位，不改生产约束。失败日志保留，随后21项通过。

完整unit暴露既有225 operation/1449 response/raw1224数量需随三个新GET变为228/1469/1241，422数量211→214。精确签名组同步三operation，并捕获/移除新静态路径重复RequestIdHeader；没有删除或放宽metadata校验。旧GeoInsightDataQuality同名组件碰撞已改用GeoAnswerInsightDataQuality，组件同步仅限本任务前缀，不重写legacy合同。ruff的排序/长行和mypy的明确类型修正后检查通过。

补充费用测试首次错误断言同时间Run的固定数组位置；按created_at/UUID稳定排序不保证创建先后，改验零/六金额集合后7项通过。上述均保留失败证据，不作为通过记录；成功结果只采用最后相关检查。

## 独立复核与证据

fresh critical_reviewer只读复核无确认缺陷；独立内存反例覆盖current字典/子域候选、CORRECTED→CONFIRMED整体替换、机器不变、未知分析、零/未知/混币及摘要/质量下钻，另核对OpenAPI语义及冻结应用哈希。作者测试记录和独立执行明确区分；审查本身未重新运行pytest/PG。

复核提出的已知费用HTTP序列化和同analysis后续Review替换缺口已由主代理补充最终7项PG/HTTP闭合。current分析域名字典相对采集字典变化的组合仍由既有metric_inputs及独立内存反例覆盖，没有新增专门HTTP序列；不宣称该组合完成HTTP验收。review-write-evidence.json确认应用代码无变化，仅主代理的测试和新路径header修正，无未知写入。

两次委派（只读文档事实核对、独立只读复核）的SUBAGENT_EXECUTION_DIGEST属于当前任务，audit-finalize及audit-verify通过，无异常或活跃worker。审计ID：20261004T074818Z-geo-604-0cac42be；确定性JSON/Markdown副本在evidence。验收依据是主代理核对合同/结果及文件哈希，未把runtime completed当作验收。

## 限制与收尾

跨请求实时RR的as_of可变化，不提供报告快照或filter token；cell消失明确404。质量元数据完整性不证明当前OSS可下载。大数据量/性能属607；605消费本次generated读合同，702行动闭环独立交付，不实施它们。

文档SHA256SUMS只更新本任务涉及条目；既有03-technical/04-frontend-architecture.md哈希不一致保留并在doc-hashes.json记录，不归入本任务。完整集成25条SAWarning来自未改迁移metadata测试的循环FK排序/dialect_options；无失败且未扩展修改。最终scope审计与manifest语义比较记录在final-scope.json/semantic-contract-audit.json。本任务专用容器网络按精确compose project清理，不删除其他项目或生产资源。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-604 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-04；既有review证据与验证限制保留为验收前历史。本次仅收尾GEO-604，不修改其他任务状态、不实施后续任务、不提交或归档。

保留既有execution_note、review_note、实施过程及evidence的历史状态与真实测试结果；SHA256SUMS仅同步manifest条目。本次收尾运行git diff --check，实际结果在最终回复报告。
