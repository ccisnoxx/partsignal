# GEO-406 实施证据

状态：done（Trellis completed）；2026-10-03本会话用户人工验收完成，未提交、推送或发布。依赖GEO-405在manifest为done。
分支geo/GEO-406。Task Brief按19节模板创建，开始时manifest planned→in_progress；
实现、本地验证与独立复核后in_progress→review。其他任务状态不变。

## 结果与业务不变量

- 四种external_call_state复用已有PG列及0048守卫，首字节前提交SENT。
- 过期API RUNNING/NOT_STARTED且无答案：Batch→Run锁内撤token/expiry、清started_at、
  revision+1并恢复同attempt的PENDING；旧Worker不能授权发送或提交结果。
- SENT/UNKNOWN过期或已持久化SENT后未知失败：FAILED/COLLECTION/
  COLLECTOR_UNKNOWN_OUTCOME/UNKNOWN，清lease；任何自动路径不重发。
  完整结果已接收但提交故障保留COMPLETED。没有持久化完整结果的进程丢失保守UNKNOWN。
- 成功/失败提交校验RUNNING、token和期限，迟到结果不写旧终态或新attempt、不添加答案。
- 显式retry：同Batch/cell/完整输入、attempt_no+1、新PENDING/NOT_STARTED；原Run全字段不变。
  无答案的COLLECTION失败才可retry，单后继唯一键禁止分叉；重复命令409。
- 新Run、Batch最新attempt投影与成功审计同事务提交；非终态Batch清finished_at，
  requested_run_count不增加。commit后只派发新Run UUID，Broker失败由PENDING扫描恢复。
- 读动作、retry、Worker qualify共用冻结Profile匹配规则；已知冻结配置不匹配不投影RETRY。
  读模型只增加五个非敏感冻结标量，查询数不增加；人工录入既有语义保留。

## 事务、错误和安全边界

显式命令User→Channel→Model→Surface→Profile→Batch→Run；发送/claim沿配置→Batch→Run，
结果与恢复Batch→Run，无反向配置锁。Profile沿用NO KEY UPDATE兼容FK KEY SHARE。
expected_revision锁内校验，原终态无UPDATE。仅INSERT flush处的
23505 + uq_geo_runs_successor映射GEO_RUN_HAS_SUCCESSOR；未知DB错误原样失败。
审计失败回滚新attempt与Batch。重复retry无Idempotency-Key重放，409提示查看最新attempt。

公共命令保留ADMIN/ENGINEER、session、CSRF及当前actor校验；配置变化409 GEO_PROFILE_CHANGED，
资格不足422 GEO_PLAN_PROFILE_INELIGIBLE。API不接收客户端状态/输入/actor/外发分类。
审计仅run_id/previous_attempt_id/attempt_no；日志固定安全摘要和异常类型，不记录凭据或provider正文。
SSRF、TLS、peer、敏感字段保护未放宽。普通测试只用本地fake，不访问真实AI。

## 契约与迁移

OpenAPI新增POST /api/v1/geo/observation-runs/{run_id}/retry（retryGeoObservationRun），
闭合GeoRunRetryRequest要求非负整数expected_revision；201稳定身份回执为
run_id/batch_id/previous_attempt_id/attempt_no/created_at。标准400/401/403/404/409/422信封保留。
前端generated schema.d.ts同步；无路由、query key、URL状态或页面交互修改。

database.md增加恢复与追加attempt的写入合同。无新DDL/表/列/索引/Alembic revision或历史回填，
当前head仍0052_geo_profile_tests。隔离geo406空库alembic upgrade head退出0，alembic current确认为0052。
没有运行生产迁移或改写原GEO记录；安全停止沿用Worker/Beat停止和外发开关。

## 基线

初始工作树已有大量未提交GEO及其他修改。baseline-status.txt、baseline-sha256.json与
evidence/before保存起始状态；本任务差异按该快照计算，未把全部git dirty归为GEO-406。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_run_contract.py -q
docker --context colima compose -p partsignal-geo406 -f .trellis/tasks/10-03-geo-406-at-most-once/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_worker.py tests/integration/test_geo_runs.py -x
```

分别退出0和46 passed，见baseline-unit.log、baseline-integration.log。隔离PG16/Redis7.4/fake-oss，
测试配置无真实供应商。compose不改共享开发栈。

## 实际验证

| 命令 | 结果 | 证据 |
|---|---|---|
| git diff --check | 退出0 | git-diff-check.log |
| make lint | 退出0，Ruff/ESLint通过 | make-lint-final.log |
| make typecheck | 退出0，mypy156源码和前端tsc通过 | make-typecheck-final.log |
| make test-unit | 退出0；后端2999、前端1125通过 | make-test-unit-final.log |
| make test-integration COMPOSE='docker --context colima compose -p partsignal-geo406 -f .trellis/tasks/10-03-geo-406-at-most-once/evidence/validation-compose.yaml' | 退出0；860通过、18个既有迁移反射SAWarning | make-test-integration.log |
| make contract-check | 退出0，runtime/OpenAPI/generated类型一致 | contract-check-final.log |
| 隔离容器alembic upgrade head / alembic current | 均退出0，0052_geo_profile_tests (head) | alembic-upgrade-head.log / alembic-current.log |

全量集成启动时为初始候选；独立复核后的共享匹配规则及回归测试变化，以最终80项受影响
集成重验补充，未重复运行无关集成用例。lint/typecheck/unit在最终源码上通过，后续仅文档/任务证据修改。

最终定向命令：

```bash
docker --context colima compose -p partsignal-geo406 -f .trellis/tasks/10-03-geo-406-at-most-once/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_at_most_once.py tests/integration/test_geo_worker.py tests/integration/test_geo_runs.py tests/integration/test_geo_read_models.py tests/integration/test_geo_read_consistency.py -x
```

退出0，80 passed（target-accepted.log）：杀死发送前/后独立Worker子进程、SENT首字节前窗口、
UNKNOWN持久化恢复、重复消息/旧token/成功迟到、完整结果提交失败、显式新attempt调用计数、
不同actor并发retry唯一后继、审计和恢复回滚、权限/CSRF/revision/Broker失败及读模型/固定查询。
新增GEO-406集成19项，其他用例复用或更新原合同。

## 失败诊断与收敛

- 初次新增测试误按共享测试数据库全表计算答案数，改为本测试前后attempt范围。
- 配置变更准备仅递增revision被现有DB守卫拒绝，改为合法配置变更。
- API新增后全量unit有4项清单断言过期，更新220操作/1416响应/1196原始响应、
  retry精确响应签名和206校验响应数量；保留逐操作Header与错误集合检查。最终unit全通过。
- 独立P2：Profile变更后重新获得当前资格时，旧读投影会错误返回RETRY，写命令却409。
  用统一匹配规则修正；测试通过真实/test→/enable，先断言eligibility=true，再验证无RETRY、
  VIEW_FAILURE、GEO_PROFILE_CHANGED、原历史不变且无后继（retry-profile-regression.log：2 passed）。
- 该回归准备中错误读取不存在的summary.collection_eligible、局部facts变量遮蔽helper，
  均按实际schema/当前ProfileFacts改正，未放宽生产或测试合同。
- 审计execution退休字段按当前CLI schema改正：completed不等于被reclaim/stop，
  retired_from_followup=false、retirement_source=unknown。最终审计关闭和verify通过。

失败原始日志保留在evidence；未把失败/未运行项写成通过。18项SAWarning来自未改动的历史迁移
反射循环FK/dialect_options，无测试失败，未在本任务扩大修复范围。

## 独立复核与差异证据

critical_reviewer新上下文只读复核，确认修正后无剩余阻断；范围与缺口见independent-review.md。
审查期间源文件hash比较及主代理修改记录见review-write-evidence.json，未观察到审查代理写入。
WorkPlan、dispatch、execution、summary、Digest闭环校验通过，audit-verify.json无异常。
audit_id：20261003T110351Z-geo-406-c1fe5ce3。Digest副本在evidence/SUBAGENT_EXECUTION_DIGEST.*。
changed-files.json、geo406-candidate.diff及scope-check.json保留本任务真实增量与无关工作保护证据。

## 限制与后续

未运行真实供应商、生产迁移/发布、Browser矩阵或UI E2E；本次无相应接线/页面改变，
真实AI也不属于普通测试。生产API registry approved=false、工厂INTERNAL、总/子开关默认关闭
及预算执行未实现保持，不能将本任务验收理解为允许生产外发或R3发布。
COMPLETED是外部完整接收事实，正常业务采集只到COLLECTED；分析完成尚未实施。
终态迟到结果直接拒绝，没有新增旁路证据存储。后续GEO-407元数据/预算/rate limit、
GEO-408自动UI与GEO-506分析未实施。仅进入review，不代替人工done验收。

## 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-406 的实现与测试证据。”据此将manifest中GEO-406从review更新为done；Trellis task从review更新为completed，记录完成日期、验收人、验收范围和依据，Task Brief同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施GEO-407、GEO-408、GEO-506或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步manifest对应SHA-256条目。
