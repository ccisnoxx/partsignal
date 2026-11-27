# GEO-302 实施与验证证据

2026-10-02 / R2 / 分支 geo/GEO-302。依赖GEO-301在manifest为done，Trellis completed，含本日用户人工接受。GEO-302从planned进入in_progress，实施及本地验证完成进入review；没有自行done、提交、部署或提前实施GEO-303。

## 实现与文件

- backend/app/services/geo_run_policy.py：冻结RunState、合法边和事实守卫、四终态集合、retry/cancel资格及稳定错误、带时区过期撤销lease恢复、Run workflow。
- backend/app/services/geo_batch_policy.py：完整初始cell集合、最大attempt、遗漏真实后继拒绝、Batch状态优先级及workflow；逐cell采集资格，无整体RETRY。
- backend/app/schemas/geo_run_workflow.py：2个闭合投影及6个typed token enum，字段全required，无默认成功能力。
- backend/tests/unit/test_geo_run_policy.py、test_geo_batch_policy.py、test_geo_run_workflow_contract.py：完整状态表、上下文反例、动作门禁、latest-attempt/完整性、真实wire标准OpenAPI正反例。
- contracts/openapi.yaml：只追加上述8个独立components；contracts/database.md：补纯策略与既有0048衔接，无schema变化。
- frontend/src/shared/api/generated/schema.d.ts：由api:generate重生成，仅8个新类型。
- docs/geo-monitoring/02-business/03-workflows-and-state-machines.md、03-technical/03-api-contract-design.md、README.md、CHANGELOG.md、SHA256SUMS和04-delivery/task-manifest.yaml：当前交付、合同说明、导航、记录和GEO-302状态。
- 本Task prd/design/implement、jsonl上下文、task.json及evidence：起点、精确命令日志、增量patch、复核与审计。

## 契约、迁移和不变量

GEO-301基础Out、所有operation、表/列/索引/约束/ORM/迁移不变；没有新Alembic revision，head保持0048_geo_batches_runs，无数据回填、破坏性迁移或生产操作。集成后隔离空库alembic upgrade head的既有全链前滚exit0，current确认0048_geo_batches_runs (head)；日志单独保存。31项迁移/Run基线和656项集成还覆盖既有0047→0048前滚及非空旧GeoObservation保留，不能把这些写成新迁移交付。

Run四终态无任何出边（包括同态），非法转换409 INVALID_STATE_TRANSITION。人工PENDING直接提交COLLECTED，自动先RUNNING且成功提交有答案/外发COMPLETED；采集后推进保有答案。RUNNING→PENDING仅自动、NOT_STARTED、无答案、过期且旧token已撤销；已发或UNKNOWN明确不能恢复。

retry仅FAILED/BUDGET_BLOCKED、COLLECTION、无答案、无后继，表示追加新attempt资格，不修改原Run；分析/复核失败无采集RETRY。已后继优先409 GEO_RUN_HAS_SUCCESSOR，其他不合格409 GEO_RUN_NOT_RETRYABLE。cancel只PENDING/NOT_STARTED/无答案，不合格409 GEO_RUN_ALREADY_STARTED。

Batch由每cell最大attempt重建：全PENDING为QUEUED，任意非终态优先RUNNING，全成功COMPLETED，成功混合PARTIAL；无成功预算优先BUDGET_BLOCKED，其次FAILED，最后全取消CANCELLED；未提交准备态PLANNED。缺初始cell/重复attempt/已提交空集/选中latest仍有真实后继明确失败，不择优历史答案。has_successor必须来自数据库存在性，不能在输入子集推导。

workflow与命令资格共用策略。ADMIN/ENGINEER业务权限一致；非活动actor无动作。人工录入和采集retry需当前资格，cancel保留安全停止能力；每cell资格独立，命令是否真实接线必须显式提供。未接线的能力传false，当前没有HTTP可执行入口。前端不复制状态机，不改route/query key/URL/页面，只消费生成类型。

## 事务、锁、revision、幂等与安全

纯策略无ORM/事务/行锁/写入/队列/网络副作用。现有0048终态、revision+1、外发进度、同cell连续attempt及唯一后继最终防线保留。后续Application Service须按现有稳定锁序从权威数据库事实转换，在锁内重验actor/资格/expected_revision/lease，并原子保存答案、状态和审计；读时actions不是写授权。当前不实现retry工厂幂等、缓存写入或实际lease撤销，不能宣称已验证这些接线竞态。

未改权限/CSRF/SSRF/TLS/凭据/不可变/审计边界，没有新配置或真实外部AI请求。投影只含闭合状态和动作，不含lease token、原始外部响应或敏感settings；错误为静态非敏感说明。测试使用隔离PostgreSQL16、Redis和fake OSS/既有本地fake provider；未使用普通测试访问真实Collector。

## 实际命令与结果

| 精确命令 | 结果 | evidence日志 |
|---|---|---|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_contract.py backend/tests/unit/test_geo_plan_management.py backend/tests/unit/test_geo_run_matrix.py | 基线95 passed | baseline-unit.log |
| APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55452/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_runs.py backend/tests/integration/test_geo_run_migration.py | 基线31 passed、2条既有警告 | baseline-integration.log |
| npm --prefix frontend run api:generate | exit0 | api-generate.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_batch_policy.py -k complete_roots_cannot_hide | pre-fix按预期失败：未抛ValueError；1 failed、762 deselected | missing-successor-red.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_batch_policy.py backend/tests/unit/test_geo_run_workflow_contract.py | 初版1354，修复后1355 passed | policy-targeted.log / policy-targeted-final.log |
| make contract-check | 运行时operation契约与generated均一致，exit0 | contract-check.log |
| make lint | 初版和修复后exit0，Ruff/ESLint通过 | lint.log / lint-final.log |
| make typecheck | 初版和修复后exit0；mypy122文件、tsc通过 | typecheck.log / typecheck-final.log |
| make test-unit | 初版2635后端+1067前端；修复后2636后端+1067前端，exit0 | test-unit.log / test-unit-final.log |
| make test-integration COMPOSE='docker compose -p partsignal-geo302-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-02-geo-302-state-policy/evidence/validation-compose.yaml' | 656 passed、10条既有SQLAlchemy警告，exit0，382.13s | test-integration.log |
| docker compose -p partsignal-geo302-validation -f .trellis/tasks/10-02-geo-302-state-policy/evidence/validation-compose.yaml run --rm backend-test alembic upgrade head | 隔离空库既有迁移全链前滚至0048，exit0 | alembic-upgrade.log |
| docker compose -p partsignal-geo302-validation -f .trellis/tasks/10-02-geo-302-state-policy/evidence/validation-compose.yaml run --rm backend-test alembic current | 0048_geo_batches_runs (head)，exit0 | alembic-current.log |
| git diff --check | 初版/最终exit0；增量新文件另查空白 | diff-check.log / diff-check-final.log |
| python3 .trellis/scripts/task.py validate .trellis/tasks/10-02-geo-302-state-policy | 上下文路径有效，exit0；两个大文件自动注入大小提示，已按权威章节手动读取 | task-context-validation.log |

首次context校验发现available-actions-contract路径写错，定位真实backend直属路径后修正并通过；不是代码或业务失败。当前全部要求门禁已实际运行。未运行make verify/build/E2E/browser matrix：无新增HTTP旅程或视觉/浏览器行为，无相应任务门禁；纯策略与公共wire用定向表和合同验证，已执行用户指定完整unit/integration。生产迁移未运行且没有新迁移。

## 独立复核与审计

Fresh critical_reviewer确认1项P2：初始roots完整但遗漏真实后继会错误返回FAILED。主代理最小修复latest.has_successor拒绝，回归测试先红后绿；复核代理独立纯Python -B反例确认修复，当前无未解决confirmed finding。覆盖与真实工具记录见evidence/read-only-review.md、reviewer-tools.json。代理12次exec全部只读，未写源文件；主代理实施全部修改。

SUBAGENT_EXECUTION_DIGEST与audit-verify通过，audit_id=20261002T211823Z-geo-302-5bbd8ac3。1次执行/1次复核报告接受/1次独立只读复核，无未执行ready task或残留活跃Worker；接受的是复核报告，不是用户人工done。Agent TOML配置gpt-6.1-sol/xhigh是配置证据，不假称runtime接口另已确认。

## 增量、环境和后续

开始时已有大量前序dirty工作；start-files.json记录4184个起点hash，evidence/baseline保存本Task可能修改文本副本。最终current-changed-files.json与geo302.patch只反映本任务15个计划内源码/合同/文档文件及任务记录，已检查无其他修改/删除、重复逻辑/默认成功、敏感字段或generated漂移。final-scope-verification.log确认OpenAPI仅8个新增Schema、所有既有paths/components保持；仅GEO-302任务变化，GEO-301仍done、GEO-303仍planned。document-hashes.log全包校验通过。范围校验脚本最初system Python无yaml，切到项目uv环境后通过；不改依赖。没有改其他任务状态。

原Docker context为default、Colima停止；为本任务启动Colima和partsignal-geo302-validation项目，用专用端口/卷，不触碰其他数据库。清理结果见infra-cleanup.log和infra-restored.log；只删除本任务容器/卷，colima stop exit0，docker context use default exit0，context show为default，colima status按停止状态返回exit1并明确not running，符合原状态。GEO-302仍review，Trellis保留当前任务便于人工接受，无completedAt。

已知限制：尚无HTTP/Worker接线，纯策略不能证明未来一致快照、锁内授权/资格重验、真实lease撤销/迟到拒绝、原子答案或retry幂等；这些交由后续任务，不伪装为本任务测试已覆盖。GEO-303工厂/快照/创建幂等为直接后续，本次未实现；答案、人工提交、读API、页面及Collector/分析亦按manifest各自执行。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-302 的实现与测试证据。”据此将manifest的GEO-302从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节与原始evidence保留验收前历史状态、实际验证结果和已知限制，不改写测试或复核审计快照。本次只记录GEO-302人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除其他会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
