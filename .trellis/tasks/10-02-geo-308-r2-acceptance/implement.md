# GEO-308 实施与验收记录

状态：done，2026-10-03已由本会话用户人工审查并接受实现与测试证据；Trellis状态completed。依赖 GEO-307 已于 2026-10-02 被用户接受，manifest=done / task=completed；未实施任何后续任务。

## 1. 实现摘要

只补验收测试与文档，生产 Application Service、Router、OpenAPI、数据库、迁移和前端业务实现没有改动。新增4项确定锁等待的取消/提交和草稿/提交交错；新增14类已提交聚合SQL攻击与2类取消终态攻击。旧文章GEO的导航/筛选书签/历史详情刷新与新运行中心共存，在完整真实栈中通过。

修复阻碍GEO验收的测试观测：上传改为唯一PUT/CSRF/204/VERIFIED加实际签名对象字节、size及SHA-256；观测面只读验收使用独立ENGINEER并完成首次改密；运行中心URL断言使用已安装TanStack Router解析结果，正确处理数字形式字符串的JSON引号编码。未放宽业务或安全要求。

## 2. 本任务修改文件

- `backend/tests/integration/test_geo_manual_races.py`：新增4项真实PG交错。
- `backend/tests/integration/test_geo_r2_immutability.py`：新增16项已提交事实/整笔回滚反例。
- `frontend/tests/e2e/geo-real-stack.spec.ts`：真实对象字节/hash、新旧导航与旧书签刷新。
- `frontend/tests/e2e/surfaces-real-stack.spec.ts`：自己的工程师账号与真实改密。
- `frontend/tests/e2e/questions-real-stack.spec.ts`：使用Router序列化手工URL，固定数值搜索词，删除后仍保留筛选。
- `frontend/tests/e2e/runs-real-stack.spec.ts`：语义URL状态断言，固定生成数字形式的测试搜索词，确保每次覆盖。
- `docs/geo-monitoring/04-delivery/07-r2-acceptance.md`：试用步骤、验证矩阵和当前未交付边界。
- `docs/geo-monitoring/03-technical/07-testing-and-quality.md`：R2验收覆盖说明。
- `docs/geo-monitoring/README.md` / `CHANGELOG.md`：本任务入口和变更记录。
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`：planned→in_progress→review，本地验证完成后等待人工接受。
- `docs/geo-monitoring/SHA256SUMS`：最终同步本任务涉及文档及新验收文件。
- 本任务 `prd.md`、`design.md`、`implement.md`、`task.json`、`implement.jsonl`、`check.jsonl`及`evidence/`；当前会话关联本任务。

进入时已有大量先行GEO未提交/未跟踪文件，均保留。`evidence/start-files.json`和`start-status.txt`冻结进入状态；`baseline/`是本任务候选文件的起始内容，`candidate.patch`按起始内容比较，不把整个Git脏树冒充本任务改动。

## 3. 公共与数据库合同

OpenAPI、generated DTO、数据库合同均零变化；`make contract-check`确认FastAPI operation/schema与根OpenAPI一致，前端生成类型与根合同一致。无新枚举、指标、幂等或权限语义，无第二套前端状态机/公式。

## 4. Alembic与数据迁移

无新revision，head仍为`0051_geo_manual_collection`。隔离PG16集成套件包含：空库head前滚；`test_geo_run_migration.py::test_forward_preserves_nonempty_old_geo_and_matches_metadata`；`test_geo_answer_migration.py::test_forward_keeps_nonempty_history_and_matches_models`；`test_geo_manual_migration.py::test_0051_preserves_nonempty_0050_evidence_and_safe_stop`。验证旧文章和非空原始证据/Run逐行不变、ORM对齐，并验证不可逆降级明确停止。不回填、不改历史、不迁移生产库。

## 5. 关键不变量、事务和锁

PG仍是唯一业务事实来源；不新增Redis消息。生产Router无事务/ORM写入，正式提交继续由现有Application Service保持原子性。测试不改写生产服务，仅暂停已经取得的真实锁，并用`pg_blocking_pids`确认等待指定连接；不同actor避免认证User锁掩盖集合锁。

正式提交锁顺序：User→提交身份advisory lock→Surface→Profile→Batch→Run→Draft→UUID排序文件；保存草稿不获取提交身份锁。测试取消writer仅Batch→Run。等待有deadline/statement_timeout，finally释放Event和行锁，不把睡眠时长或线程同时启动当作并发证据。

## 6. revision、幂等与错误

- 取消先提交：submit返回409 `INVALID_STATE_TRANSITION`，Run=CANCELLED/revision1，未留下Answer/提交身份/成功审计；相同HTTP提交仍拒绝。
- 提交先取消：既有取消策略409 `GEO_RUN_ALREADY_STARTED`，Run=COLLECTED/revision1，完整原回答/身份/审计仅一次。
- 提交先保存：迟到草稿409 `INVALID_STATE_TRANSITION`，不重建草稿。
- 保存先提交：409 `REVISION_CONFLICT`、current_revision=1，赢家草稿保留，Run仍PENDING/revision0。
- 新旧幂等用例保留相同key回执重放/异载荷冲突与两key竞态；新聚合攻击后再次相同key提交返回原回执。
- 非法SQL精确断言23514及具名constraint；合法修改随失败整笔rollback，Session可继续SELECT、新Session读出的完整事实相等。动态`as_of`与签名URL不属于冻结事实，数据库完整JSON行均比较。

取消writer只验收策略和存储的竞争，不是生产取消命令。未宣称取消HTTP/UI、取消审计、草稿清理、批次缓存刷新或队列恢复已经实现。

## 7. 安全、隐私与外部调用

只使用虚构数据、本地fake-OSS及本地OpenAI-compatible替身。E2E显式关闭API/BROWSER Collector与机会开关；没有新增真实AI、自动采集、机器分析、指标或机会业务。证据上传者、权限、CSRF、SSRF、TLS、短期签名、不可变触发器和审计保留原边界。

工程师测试密码在请求/产物前登记，沿用会话秘密注册、post-run scan与精确环境清理。任务Compose使用公开的本地测试密码，没有保存操作者私有环境或凭据；不打印`.env`或展开Compose配置。

## 8. 前端与试用

无路由、query key、URL schema或页面行为变更。`/geo/runs`与`/geo/observations`侧栏导航独立；旧new/detail/correct/insights入口、筛选书签、历史节点和刷新保持兼容。现有真实栈用例经UI完成三次人工采样、草稿恢复、截图、引用、安全原文与不可变详情。

R2可试用边界为MANUAL原始证据提交。结果COLLECTED / analysis_dispatch=NOT_IMPLEMENTED，三次提交completed=0，未知费用不补零。试用环境须显式启用GEO父开关并重载服务；本任务不更改生产配置或发布。

## 9. 真实执行命令与结果

命令由`evidence/run-check.py`保存原始argv、退出码、UTC起始时间、秒数及完整日志。`*.json`与同名`*.log`是实际结果，文件名含final不表示退出成功。最终数值测试输入修改之后重验前端typecheck/lint，并由专项和verify的后续E2E验证；生产业务及单元输入未变，其他成功证据复用。如下状态更新到门禁完成时：

| 命令 | 结果 | 证据 |
|---|---|---|
| `git diff --check` | 通过，最终文档收口检查 | diff-check-final.json/log |
| `make lint` | 通过，最新候选由恢复verify再次执行 | lint-final-candidate.json/log；verify-resumed.json/log |
| `make typecheck` | 通过，backend/app 142文件 + 前端，最新候选由恢复verify再次执行 | typecheck.json/log；verify-resumed.json/log |
| `make test-unit` | 后端2717、前端1121通过 | test-unit.json/log |
| `make test-integration COMPOSE=…` | 790通过，16条既有metadata warning | test-integration.json/log |
| `npm --prefix frontend run test` | 119文件1121通过（也由make test-unit调用） | frontend-test.json/log |
| `npm --prefix frontend run typecheck` | 通过 | frontend-typecheck-candidate.json/log |
| `make e2e` | 真实栈26通过；fixture498通过/54预期跳过（52真实栈模式及2视口专属），秘密扫描及清理通过 | e2e.json/log |
| `make verify COMPOSE=…` | 首次退出2（问题库测试URL）；修正后恢复退出0，所有阶段通过，复用项如下 | verify.json/log；verify-resumed.json/log；verify-reuse.json |
| `make contract-check` | 通过，公共和generated一致 | contract-check.json/log |
| R2定向PG | 20通过 | r2-integration-final.json/log |
| GEO E2E | 最终专项5通过（新增问题库URL回归），完整真实栈GEO同样通过 | geo-e2e-url-fix.json/log |
| repository dev Compose config --quiet | 通过 | dev-compose-config.json/log |
| 数值URL往返检查 | 整数/科学计数法/普通字符串3例通过 | numeric-url-values.json/log |
| 文档checksum | 115条全部通过，最终review收口检查 | document-hashes-final.json/log |
| Trellis task validate | implement/check各10有效entry；大合同注入截断warning | task-context.json/log |

需要PG/Redis的验证使用任务独立Compose（`evidence/compose.validation.yaml`），不使用dev数据库；静态检查及前端测试使用本地已安装工具。恢复命令：`make verify -o contract-check -o test-unit -o test-integration COMPOSE=…`。verify-reuse.json确认683项相关输入未变，成功的合同、单元及集成检查复用；lint/typecheck/build/完整E2E/部署脚本/配置在恢复命令中实际执行并通过。

`COMPOSE=…`完整值：`docker compose -f .trellis/tasks/10-02-geo-308-r2-acceptance/evidence/compose.validation.yaml`。

E2E / verify调用环境：
```sh
DATABASE_URL=postgresql+psycopg://partsignal:geo308-local-test-only@127.0.0.1:55458/partsignal
REDIS_URL=redis://127.0.0.1:56398/14
```
最终专项命令设置`PARTSIGNAL_E2E_SPEC='(questions|runs|geo|surfaces)-real-stack.spec.ts'`调用canonical `deploy/scripts/e2e-local.sh`。3份桌面编辑器/配置与375px配置截图在专项post-run scan=clean之后保存至`evidence/screenshots/`，来源和hash见`screenshots.json`。

集成Compose使用Redis15；E2E使用Redis14及随机独占数据库。原仓库`deploy/compose.dev.yaml config --quiet`额外通过，避免用验证Compose替代原配置检查；verify仍执行prod配置、Docker构建与部署脚本门禁。

## 10. 实施前基线

- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_batch_policy.py backend/tests/unit/test_geo_manual_collection_contract.py backend/tests/unit/test_geo_read_contract.py`：1382通过，baseline-backend-unit.log。
- `npm --prefix frontend run test -- src/app/navigation.test.ts src/domains/geo-runs src/domains/geo/geo-evidence-upload.test.tsx`：10文件59通过，baseline-frontend.log。
- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_manual_collection.py backend/tests/integration/test_geo_manual_collection_boundaries.py backend/tests/integration/test_geo_answers.py`：77通过，baseline-integration.log。环境为任务PG URL及本地OSS endpoint/public endpoint `http://127.0.0.1:19008`，database变量`PARTSIGNAL_TEST_DATABASE_URL`。

## 11. 首次失败与修正证据

- 初始Docker socket不存在，Colima default=Stopped；启动既有Colima后任务PG/Redis就绪，environment-colima.log/environment-up.log。
- 新测试早期将每次读取的as_of/短期签名误当冻结事实；改为逐行DB事实与除动态能力以外的API事实比较，diagnostic-read-clock.log。
- 迟到结果反例最初复制generated answer_sha256，被GeneratedAlways提前拒绝；改为只写可写且合法的字段，实际命中目标提交guard，diagnostic-generated-column.log。
- 首轮lint只因新增SQL字符串超行，拆分同一SQL后通过；lint.log保留失败。
- 最初专项E2E selector将多文件当一个字符串，No tests found；按脚本实际接口使用一个regex，geo-e2e.log。
- 导航初始断言同时匹配侧栏与面包屑；第二次错误地把GEO region当nav；按真实DOM的“主导航”限定后旧Flow A通过。geo-e2e-final.log / geo-e2e-candidate.log记录失败。
- 随机suffix可解析为JSON数字（当次为科学计数法）导致既有Run E2E比较编码q而失败；使用已安装Router的defaultParseSearch。其返回类型AnySchema不暴露q，改为toMatchObject语义断言后tsc通过，完整make e2e的Run场景通过。geo-e2e-accepted-candidate.log / geo-e2e-final-pass.log记录首次失败。

补充URL往返检查首次误用npm exec从根目录解析依赖，MODULE_NOT_FOUND；npm将Node视为临时工具放入缓存，项目依赖文件未变。改在frontend目录直接使用已安装Node后，初始对象deepStrictEqual又误把解析对象的null prototype视为不相等；应只验证q值。两次失败日志保留，最终结果以numeric-url-values.json/log为准。

首次完整verify在问题库删除后的空态失败：随机suffix=745145e4可解析为科学计数法，测试手工拼接原始q，Router得到number，schema拒绝后清空筛选。日志显示API GET丢失q，浏览器上下文显示搜索框为空。仅修正测试调用者使用defaultStringifySearch，并固定生成数值搜索词保护该合同；不改生产URL/schema/权限。验证后恢复verify，使用`-o contract-check -o test-unit -o test-integration`复用已成功且相关输入不变的合同/单元/集成；重跑受影响lint/typecheck/build/E2E及此前尚未执行的部署/配置门禁。首次失败与恢复成功分开记录。

没有盲目重跑，也没有为测试放宽生产合同。上述早期失败不能合成为通过，最终成功证据另列。

## 12. 收口、未验证项与恢复

完整verify恢复退出0，manifest及task已更新review，completedAt=null，prd范围验收全部勾选，文档hash同步。不done、不归档、不提交、不发布。任务Compose及基线OSS/对象目录已清理，cleanup.json/environment-down.json记录实际结果；OSS主动TERM退出143，工具确认完整graceful shutdown，不作为测试失败。Colima已恢复进入时的Stopped状态，colima-restored.json/log记录停止命令退出0。当前没有独立子代理任务或Digest要求；本次仅测试/文档，不改变高后果生产保证，主代理按任务起始候选做差异检查。

尚未发布、访问生产VPS、进行真人外部平台业务试用或生产迁移。现有16条SQLAlchemy metadata warning未扩大范围修复。Trellis注入32KiB限制会截断manifest和大合同，后续恢复须手工读取相关完整条目/章节，不能只依赖注入片段。

## 13. 后续任务

等待用户人工接受GEO-308。GEO-401..408接入API Collector及恢复/自动观测，GEO-501以后接入分析复核和后续指标；本任务未实现。取消/重试公共命令需要后续明确授权任务，不由本验收测试暗中接线。

## 人工验收完成 — 2026-10-03

本会话用户明确表示：“我已经人工审查并接受 GEO-308 的实现与测试证据。”据此仅将manifest的GEO-308从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-03，记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节和原始evidence保留验收前历史状态、实际测试结果及已知限制，不改写测试结果。本次仅记录GEO-308人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；未重跑实现阶段测试。
