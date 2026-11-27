# GEO-405 实施与验证证据

## 状态与授权
GEO-405 / R3；geo/GEO-405；依赖 GEO-303、GEO-404、GEO-004 在 manifest 均 done。
manifest planned → in_progress → review → done；2026-10-03 本会话用户已人工审查并接受实现与测试证据，Trellis 状态为 completed。
未提交、推送或生产部署。保留初始全部脏改动；baseline-sha256.json、baseline-status.txt 和 before/ 保存任务边界。

## 实现与文件

- `backend/app/worker.py`
- `backend/app/services/geo_runs.py`
- `backend/app/services/geo_dispatch.py`
- `backend/app/services/geo_collection_execution.py`
- `backend/app/services/geo_run_lifecycle.py`
- `backend/app/services/geo_batches.py`
- `backend/app/services/geo_manual_collection.py`
- `backend/app/config.py`
- `backend/tests/integration/geo_worker_support.py`
- `backend/tests/integration/test_geo_worker.py`
- `backend/tests/unit/test_geo_worker_configuration.py`
- `deploy/scripts/check-production-inputs.py`
- `.env.example`
- `.env.production.example`
- `contracts/database.md`
- `docs/production-configuration.md`
- `docs/geo-monitoring/README.md`
- `docs/geo-monitoring/03-technical/05-worker-and-collector-architecture.md`
- `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/SHA256SUMS`

任务资料：prd.md（模板19节）、design.md、implement/check.jsonl、task.json 和 evidence/。

## 合同 / 数据 / 前滚
OpenAPI、generated frontend 类型、公共 operation/request/response/error枚举均未变；database.md仅补运行写入说明。
复用既有0052_geo_profile_tests head；无新Alembic revision、schema、索引、回填或生产数据迁移。
隔离PG测试从空库前滚到0052；旧0048 lease/revision/终态与0050答案延迟一致性守卫参与实际提交。
无需破坏性回滚；停Worker/Beat或关采集开关安全停止新发送，历史状态保留。

## 不变量与错误映射
- 工厂commit后dispatch。短事务锁Batch→Run预留metadata，再无DB事务发布run UUID；预留失败不发布，接收丢确认可重复入队，由claim防重复外部调用。首个Broker错误停止首次同步发布，PENDING下轮恢复。
- claim配置锁序Channel→Model→Surface→Profile→Batch→Run；Profile用NO KEY UPDATE，阻止配置更新/删除而兼容答案提交隐式FK KEY SHARE。结果/扫描Batch→Run，不反向获取配置。
- PENDING/NOT_STARTED/无答案/无后继才claim；数据库时间、唯一token、Channel timeout+grace租约与RUNNING原子提交。重复消息不重新构造provider调用。
- 网络在事务外。首个请求字节前重新锁定、重验当前资格/依赖revision/token/expiry，原子写SENT。发送后失败不自动重发。
- 当前提交仅正文/基本来源/闭合摘要；RUNNING/COMPLETED flush与答案/COLLECTED在同一事务，每次实际UPDATE revision+1。旧token/过期/终态拒绝，未知usage/cost保留NULL。
- 非空引用/文件证据明确PROVIDER_RESPONSE_INVALID/COMPLETED失败，无半答案；不提前实施407。预算限额当前明确配置失败，不忽略后发送。
- Collector固定码映射COLLECTION。未经分类执行/结果提交故障为WORKER_LOST；失败装配在no_autoflush裁决后统一写入，不暴露异常正文。
- PENDING按coalesce(dispatch_at,created_at)阈值限候选补投递；expired RUNNING保守FAILED/WORKER_LOST、清lease并重投影Batch。扫描锁冲突跳过，默认PG时钟。NOT_STARTED重入/UNKNOWN恢复/迟到证据/显式retry留406。
- MANUAL不投递/claim；COLLECTED仍使Batch RUNNING，不触发Analysis Worker。

## 安全 / 隐私 / 前端
功能默认关闭、API registration approved=false、Factory INTERNAL及Collector PUBLIC-only保持。
当前资格复用唯一eligibility，SSRF/DNS/peer/TLS/凭据回显防线沿用404，不使用真实AI。
凭据仅执行内存解密，诊断采用ID、固定码与异常类型；真实Redis消息断言没有prompt/credential。
前端无路由/query key/URL状态/页面或generated类型改动。
新增4个有范围校验的GEO运行参数，既有runtime可省略；进程启动快照，文件修改不表示热加载。

## 验证记录

| 命令 | 实际结果 | 证据 |
|---|---|---|
| `git diff --check` | exit0 | evidence/diff-check.log |
| `make lint` | exit0（Ruff + frontend ESLint） | evidence/lint-final.log |
| `make typecheck` | exit0（mypy153文件 + frontend tsc） | evidence/typecheck-final.log |
| `make test-unit` | exit0，backend2999、frontend1125/120文件 | evidence/test-unit-final.log |
| `make test-integration COMPOSE='docker --context colima compose -p partsignal-geo405 -f .trellis/tasks/10-03-geo-405-collection-worker/evidence/validation-compose.yaml'` | exit0，841 passed、18 warnings（既有schema反射警告），401.89秒；包含19项GEO Worker测试 | evidence/test-integration-final.log |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_configuration.py -q` | 编码前基线exit0 | prd.md记录，原工具输出已核对 |
| `docker --context colima compose -p partsignal-geo405 -f .trellis/tasks/10-03-geo-405-collection-worker/evidence/validation-compose.yaml run --rm backend-test pytest tests/integration/test_geo_batch_creation.py tests/integration/test_geo_runs.py tests/integration/test_geo_answers.py` | exit0，75 passed | evidence/target-existing-integration.log |
| 同Compose `pytest tests/integration/test_geo_worker.py -x` | 定向运行exit0，18 passed；新增第19项已由最终841项integration覆盖并通过 | evidence/worker-sixth.log |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_worker_configuration.py -q` | exit0，5通过 | evidence/worker-config-unit.log |

### 失败、诊断和证据更新
- 初始Docker默认socket不可用；启动既有Colima后用隔离Compose PG/Redis/本地fake-oss，没有操作生产资源。
- 集成基线第一次命令误写 `test_geo_answer_evidence.py`，exit4且无测试执行；改为实际 `test_geo_answers.py` 的75项定向检查。未把第一次算通过。
- 首次typecheck定位API settings无timeout字段；修复为锁内Channel timeout。首次测试fixture修复fake mode枚举名、URL /v1、repeat_count和隔离清理；未放宽生产门禁。
- review识别autoflush未递增revision，no_autoflush修复；429/非法JSON/断连分别保留真实固定错误码。
- worker-fifth.log真实deadlock与profile-lock-prefix.log确定性修复前Timeout失败证明FK锁环；Profile NO KEY UPDATE修复后通过。
- Broker持锁的故障传播由受控blocked sender证明；预留commit→无锁publish修复，同Batch结果不再等待Broker。
- 早期完整integration在候选修复时主动取消，exit2；最终gate从稳定候选重新启动，不能把取消运行报告为通过。
- 末次lint仅SIM117嵌套with风格问题，机械合并后通过；已清除config中与本任务无关的格式修改。

## 独立复核与审计
fresh critical_reviewer只读复核完成；确认的三个P1已修复并复核，未发现剩余阻断。
完整审查报告 evidence/independent-review.md；运行时工具调用 evidence/review-tool-calls.json均为只读，核对无源文件写入。
validated SUBAGENT_EXECUTION_DIGEST，audit_id=`20261003T102013Z-geo-405-2062a5cd`；Bundle closed、audit-verify passed，无异常/残留活跃代理。
模型/effort仅Agent TOML配置证据，不冒充运行时遥测；主代理负责实际测试与最终验收。

## 未运行与已知限制
没有真实AI、Browser、浏览器矩阵或E2E：本任务无前端/导航变化，真实PG/Redis/Celery和现有安全测试观察改变的执行边界。
未运行真实Redis网络黑洞、进程SIGKILL和完整重启故障演练；当前用真实Redis/Celery加受控阻塞/丢确认/过期及token反例。
未知usage/cost不补零；非空引用和文件证据尚未接线而明确拒绝。有budget_limit的执行不发送。
API生产批准和INTERNAL外发仍未开放，不能据本任务宣称R3可生产启用或完成全部恢复。

## 后续（不实施）
GEO-406：按外部发送状态恢复、迟到证据、显式新attempt；GEO-407：引用/usage/cost/预算/rate limit；GEO-506：机器分析Worker/revision生命周期。

## 最终边界核对
已核对任务专属diff与初始SHA256：14个既有文件变更、7个新增源码/测试文件；无任务外变更，初始无关脏改动保留。OpenAPI及前端初始哈希不变。本地验证完成时仅GEO-405为review；2026-10-03人工验收后GEO-405为done，GEO-406/407/506仍planned。

隔离Compose项目partsignal-geo405已down（exit0），未删除数据卷，未停止共享Colima。最终门禁结构化结果见evidence/final-validation.json。基线哈希脚本未收录5个Git引号编码的中文路径；最终逐个与HEAD字节核对一致，记录于scope-check.json。独立复核原始结论已从运行时完成记录保存至independent-review.md，复核后的最终门禁由主代理确认。

## 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-405 的实现与测试证据。”据此将 manifest 中 GEO-405 从 review 更新为 done；Trellis task 从 review 更新为 completed，记录完成日期、验收人和验收依据，Task Brief 同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施 GEO-406、GEO-407、GEO-506 或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步 manifest 对应 SHA-256 条目。
