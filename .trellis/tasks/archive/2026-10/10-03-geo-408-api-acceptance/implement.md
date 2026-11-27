# GEO-408 实施与验收记录

日期：2026-10-03。分支：`geo/GEO-408`。实现和本地完整门禁均完成；2026-10-03本会话用户已人工审查并接受实现与测试证据，manifest与Task Brief为 `done`，Trellis task为 `completed`；无提交、PR、部署或真实供应商调用。

## 实现与合同

运行中心按服务端 workflow stage 与完整 Batch summary 轮询，后台由 TanStack Query focus 管理暂停发送。R3 `ANALYSIS_PENDING` 没有执行器，不继续空轮询；读取错误保留成功数据并暂停定时轮询。详情显示三项独立 token、费用/币种、外部调用状态、HTTP/Retry-After、安全错误及尝试链，null 不补零、不推算。

仅服务端 `RETRY` 动作允许显式新尝试。确认携带 `expected_revision` 和 CSRF；回执闭合校验新 UUID、父 attempt、Batch 与 attempt_no。命令 pending/unknown journal 属于 QueryClient 会话，跨详情关闭、切换与路由卸载保留，只保存原 Run/Batch/revision/attempt_no 和命令阶段。GET 发现直接后继才解除未知；无后继不授权再次 POST。主体 epoch 变化后旧 continuation 失效，迟到响应不覆盖新的导航/筛选。业务状态仍只来自 generated OpenAPI 投影。

生产 Application Service、根 `contracts/openapi.yaml`、`contracts/database.md`、Alembic 与配置默认值不变。没有新增 revision 或数据迁移；head 仍为 `0053_geo_collection_admission`。真实栈空库均由既有 base→head 前滚。既有配置→accounting→Batch→Run 锁序、revision、`uq_geo_runs_successor`、lease/token 与不可变触发器继续拥有一致性；retry 无请求幂等键，不能盲目重放。

## 测试装配和安全

`backend/tests/geo_e2e_*` 为显式 test-only 工厂，不改 `backend/app`：启动验证 APP_ENV=test、随机本轮数据库名、实际 PostgreSQL owner comment、非0 Redis、精确回环 fake URL；所有业务和诊断传输受 `127.0.0.1:19012/v1` 限制。仅严格 GEO408 虚构 prompt、GEO408 无产品绑定对象可在测试装配为 PUBLIC；INTERNAL 场景保留实际拒绝。生产 registry 未批准、工厂默认 INTERNAL、SSRF/TLS/凭据/CSRF/审计边界保持。

fake 不去重请求，按独立 diagnostic UUID、真实 Run UUID 逐次记录接收次数。正常模式既有管理/计划/批次 mutation 通过真实 UI；读取使用真实 API、PG、Celery Worker/Beat、真实 Collector 与 production preview。重复消息真实投递两个稳定 Run ID，用 test-only Celery 完成回执和 broker outstanding 状态共同证明消费，不改业务状态。仅 GEO 测试 phase 使用现有补投2秒/扫描5秒参数；生产默认120/60秒不变，仍由生产准入和 Beat 恢复未发送新尝试。

关闭模式通过既有 Application Service 预先创建并排队真实 PENDING，随后从关闭配置启动全新 API/Worker；读取安全失败与 NOT_STARTED、业务 Run count=0。测试入口复用随机数据库归属、精确 Celery/Kombu allowlist 清理、PID/端口释放、secret canary scanner，不使用 FLUSHDB、通配删除或真实平台。

## 环境与命令

本次使用已有 Docker `colima` context，独立 Compose 项目 `partsignal-geo408`，仅本任务 PG16 `127.0.0.1:55458`、Redis7.4 `127.0.0.1:56398`、fake OSS `127.0.0.1:19018`。Compose 定义见 `evidence/validation-compose.yaml`。没有修改默认开发栈或生产配置。

公开测试环境变量：

```sh
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55458/partsignal
REDIS_URL=redis://127.0.0.1:56398/14
# 后端定向 integration 使用 Redis DB15
COMPOSE='docker compose -p partsignal-geo408 -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-408-api-acceptance/evidence/validation-compose.yaml'
```

精确实际命令、退出码、最终门禁计数与原始日志见以下记录和最终验证表；各次初始失败单独保留，不合成为通过。

## 已确认基线和定向证据

| 命令 | 结果 | 证据 |
|---|---|---|
| `npm --prefix frontend run test -- src/domains/geo-runs`（基线） | 54项/8文件通过 | evidence/baseline-frontend.log |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_read_contract.py backend/tests/unit/test_geo_run_workflow_contract.py backend/tests/unit/test_geo_worker_configuration.py -q` | 22项通过 | evidence/baseline-backend.log |
| `make contract-check`（基线） | 退出0 | evidence/baseline-contract.log |
| `PARTSIGNAL_E2E_SPEC=tests/e2e/runs-real-stack.spec.ts deploy/scripts/e2e-local.sh` | 1通过，secret clean，全部清理通过 | evidence/baseline-e2e.log |
| `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests/unit/test_geo_e2e_runtime.py -o addopts= --strict-markers -q` | 30通过；子代理原始输出已核对 | evidence/harness-tool-evidence.json |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_worker.py backend/tests/integration/test_geo_at_most_once.py backend/tests/integration/test_geo_collection_admission.py -q` | 退出0，三组真实PG/Redis定向检查通过 | evidence/geo-runtime-integration.log |
| `npm --prefix frontend run test -- src/domains/geo-runs`（三项复核修复后） | 70项/9文件通过 | evidence/frontend-review-fixes.log |
| `PARTSIGNAL_E2E_GEO_MODE=enabled deploy/scripts/e2e-local.sh`（最终正常模式） | 1通过/1模式跳过，secret clean，全部清理通过 | evidence/geo-enabled-fourth.log |

## 初始失败与修复证据

- 第一次 enabled 用例的 API Key 精确标签未包含必填星号，等待停滞后由本任务终止runner，退出143；清理全部通过，缺本轮完成标记导致 scanner 退出1。修正定位器并使用15秒动作超时，未把中断当通过。
- 第二次 enabled 退出1：现有 API 将实际费用规范为 `0.0012`，用例错误预期固定6位 `0.001200`。只修正测试预期，生产金额合同保持；secret scan clean、清理完整。
- 第三次 enabled 退出1：429冷却后新尝试保持PENDING，生产补投120秒/扫描60秒超出定向等待；仅测试 phase 设置现有2秒/5秒参数，保留真实准入、Beat和Worker。第四次通过。原始前三次日志均保留。
- 独立复核找到：详情卸载丢失 pending/unknown blocker、hidden期间完成GET后的 fresh focus无法可靠恢复 interval、本地 Redis 被额外限制14。均已修正。新增真实 QueryObserver 生命周期与pending/unknown关闭重开/切走返回测试；服务端和安全合同未放宽。

## R3 演示与页面证据

正常真实栈用例验证 Profile/模型测试与显式启用、计划和冻结批次、Worker领取/自动轮询、原文/重复引用位置[1,3]、独立partial usage/null与实际费用、重复消息 count保持1、发送后UNKNOWN、新attempt两次调用各1/旧终态不可变、预算/INTERNAL外发前 count=0。375/1440无水平溢出截图见 `evidence/screenshots/`，已人工视觉核对。

三个模式与完整门禁均已有实际成功退出证据，R3八项演示通过；两个关闭模式均由新Worker消费真实PENDING并证明业务Run外发计数0。

## 审查、差异和任务状态

起点存在大量前序未提交工作，本任务没有回退。`baseline-sha256.json` 与 task `before/` 定义开始状态；`candidate.patch`、`task-changes.json` 是当前任务增量，不把整个 Git diff 当本次修改。中文文件名的初始采集引用问题仅修复证据脚本；未改相应文件。Makefile/spec原始快照经反向还原后hash精确匹配开始值，e2e-environment原始HEAD blob同样hash匹配；没有猜测开始版本。

独立只读审查与最终复核、可管理 audit_id、validated Digest 已记录并校验。Task Brief 19项与design保留决策/边界；manifest只更新GEO-408 planned→in_progress→review，不自行done或修改其他任务。

## 限制与后续

本次不授予真实外发批准；生产adapter批准false、INTERNAL数据准入保持。采集成功停于COLLECTED/ANALYSIS_PENDING，分析、复核、指标、机会、复测继续明确NOT_IMPLEMENTED。无Browser Collector、新身份系统、依赖大版本升级或历史回填。GEO-801与GEO-902及其他后续按各自依赖和人工授权另行实现。

## 候选门禁与失败修正

| 命令 | 结果 | 日志 |
|---|---|---|
| `make lint` | 退出0 | evidence/make-lint-candidate.log |
| `make typecheck` | 退出0；mypy158源码与前端tsc通过 | evidence/make-typecheck-candidate.log |
| `npm --prefix frontend run test` | 1141项/121文件通过，退出0 | evidence/frontend-test-candidate.log |
| `npm --prefix frontend run typecheck` | 退出0 | evidence/frontend-typecheck-candidate.log |

首次完整 `make e2e` 退出2：canonical 25通过/1失败，旧 GEO 导航用例仍断言408修改前介绍文案。这是本任务造成的预期漂移，已同步 `geo-real-stack.spec.ts:521`，不是前序无关失败。secret scan clean且资源精确清理；后续 GEO 三模式/fixture当轮未进入。原始 `evidence/make-e2e.log` 保留，修正后的完整运行使用 `evidence/make-e2e-final.log`。

第二轮完整 `make e2e` 退出2：canonical26通过、GEO enabled1通过；api-disabled 的 PENDING消费安全失败/NOT_STARTED/count=0 已通过，随后 retry错误预期409，实际生产配置资格优先拒绝 `422 GEO_PLAN_PROFILE_INELIGIBLE`（公开合同已包含422）。修正测试为精确422和固定code，未放宽为任意4xx，未改生产顺序；该轮monitoring-disabled与fixture未进入。所有执行阶段secret clean/cleanup通过。修正后先以本地非0 DB7定向重验api-disabled，兼验Redis本地配置合同，再继续所要求完整门禁。

修正后定向 `PARTSIGNAL_E2E_GEO_MODE=api-disabled deploy/scripts/e2e-local.sh` 与 `PARTSIGNAL_E2E_GEO_MODE=monitoring-disabled deploy/scripts/e2e-local.sh` 均退出0、各1通过/1模式跳过，使用本地Redis DB7。两模式全新Worker消费真实PENDING、安全FAILED/COLLECTOR_DISABLED/NOT_STARTED、历史读取、无RETRY入口、retry精确422/GEO_PLAN_PROFILE_INELIGIBLE、Profile对应开关blocker和fake Run count=0通过。secret clean，随机PG/临时存储/DB7精确键/全部服务端口完整清理。日志 `evidence/geo-api-disabled.log`、`evidence/geo-monitoring-disabled.log`。

独立只读审查及最终复核均完成：初次指出3项具体缺陷，最终复核确认生命周期/focus/Redis修复及生产安全边界、两个关闭模式实际证据，无确认剩余代码问题。最终复核结束时完整门禁仍进行中，不能把复核报告本身当门禁通过。后续验证由主代理读取实际退出码。重复消息测试CLI期限30秒，外层仅将等待从20秒校正到40秒（保留启动/归属校验余量），没有业务或装配语义变化。

validated `SUBAGENT_EXECUTION_DIGEST` 与持久化 Bundle 已关闭并 `audit-verify` 通过，无error/warning。audit_id：`20261003T123558Z-geo-408-220c2d2c`；4计划、5执行/5子任务接受、2独立只读复核、源码写入路径9个已从完整实际tool inputs核对，4条只读执行无写入证据；无残留活跃Worker。摘要见 `evidence/SUBAGENT_EXECUTION_DIGEST.md`，校验输出见 `evidence/audit-verify.txt`。模型/档位仅Agent TOML配置快照，不是运行时遥测；子任务接受不代表GEO-408被人工done。

## 完整 E2E 收敛

第三轮完整 `make e2e` 退出0：canonical真实栈26通过；GEO enabled/api-disabled/monitoring-disabled三个真实阶段各1通过、各1模式跳过；canonical production-artifact页面suite498通过/58条件跳过。全部阶段secret scan clean、真实栈清理成功。记录 `evidence/make-e2e-passed.log`。模式跳过区分互斥配置，fixture跳过真实栈专属用例，未将跳过写成通过。

最终自查发现后台轮询回归测试缺少document visibility切换，原先只有focusManager不足以辨别旧visibleInterval问题。已补齐hidden→visible条件，并临时复现旧间隔表达式：定向检查在预期的“GET应2次、实际1次”处失败，随后精确恢复源码；当前API测试7通过。证据 `evidence/polling-regression-prefixed.log` 与 `evidence/polling-regression-fixed.log`。该自查只加强测试，已独立复核的轮询实现不变。

`make verify COMPOSE='docker compose -p partsignal-geo408 -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-03-geo-408-api-acceptance/evidence/validation-compose.yaml'` 退出0；此COMPOSE仅选择本任务测试栈，其他recipe和门禁均原样执行。日志 `evidence/make-verify.log`。实际通过根合同及generated检查、lint、mypy158/前端tsc、后端3029单元、前端1141项/121文件、完整真实PG集成、前后端Docker构建、完整E2E、部署脚本与Compose dev/test及prod配置检查。

verify内E2E再次完成canonical真实26通过，GEO三个独立阶段各1通过/1模式跳过，页面498通过/58条件跳过（6.4分钟）。全部secret scan clean、各阶段随机PG/精确Redis键/端口/存储清理通过。Collector contract 194通过，fixture金标13校验且外部调用0；配置安全、E2E生命周期/secret scanner、staging/production脚本自检通过。没有将部署脚本模拟检查当作实际生产发布。

## 最终验证结果

| 实际命令 | 退出码与结果 | 原始日志 |
|---|---|---|
| `git diff --check` | 0 | evidence/git-diff-check-final.log |
| `make lint` | 0；后端ruff/前端ESLint通过 | evidence/make-lint-candidate.log；verify再次通过 |
| `make typecheck` | 0；mypy158源码与前端tsc通过 | evidence/make-typecheck-candidate.log；verify再次通过 |
| `npm --prefix frontend run test` | 0；1141项/121文件 | evidence/frontend-test-candidate.log；verify再次通过 |
| `npm --prefix frontend run typecheck` | 0 | evidence/frontend-typecheck-candidate.log；verify再次通过 |
| `make e2e` | 0；真实26、GEO三个阶段各1，页面498通过/58条件跳过 | evidence/make-e2e-passed.log；verify再次通过 |
| `make verify COMPOSE=…`（上文精确命令） | 0；完整recipe通过 | evidence/make-verify.log |

用户指定命令无未运行项。真实供应商、生产部署及后续GEO任务未执行，属于本任务范围外。测试输入全为虚构，本地fake不提供真实产品事实。非阻断输出：未改动的迁移测试产生SQLAlchemy多向FK/dialect_options警告；Vite提示大chunk；容器启动探测短暂Empty reply随后自检通过。完整门禁成功，未为消除这些输出修改无关模块。

当前任务维护文件33个，完整列表见 `evidence/changed-files.md`；任务增量见 `evidence/candidate.patch` 和 `evidence/task-changes.json`。生产边界228个起点文件hash无本任务漂移，见 `evidence/production-boundary-check.json`。根合同、generated与Alembic保持；各隔离空库既有base→0053前滚成功，历史保全迁移集成通过，无本任务新增revision或历史回填。

最终交付检查确认仅GEO-408状态从planned→in_progress→review，GEO-407/GEO-307仍done，其他manifest任务记录逐字不变；文档包116项SHA-256全部有效，见 `evidence/delivery-final-check.json`。独立Compose项目 `partsignal-geo408` 的 `down -v` 退出0，容器/卷/网络均无残留，55458/56398/19018与全部E2E固定端口无监听，见 `evidence/validation-stack-cleanup.json` 与原始cleanup.log。没有停止Colima或操作其他项目。完整working tree保存 `evidence/working-tree-final.txt`，前序未提交工作保持。

机器可读最终命令/结果汇总见 `evidence/validation-results.json`。源码与运行配置通过门禁后未再修改；收敛只更新任务状态、验收记录和文档校验和，不把未重新执行的广泛检查列为另一轮通过。

## 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-408 的实现与测试证据。”据此将 manifest 中 GEO-408 从 review 更新为 done；Trellis task 从 review 更新为 completed，记录完成日期、验收人、验收范围和依据，Task Brief 同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施 GEO-801、GEO-902 或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步 manifest 对应 SHA-256 条目。
