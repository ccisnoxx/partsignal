# GEO-104 实施与验证证据

## 当前交付

- 发布 R1；依赖 GEO-103 在 manifest 为 done，GEO-103 实施记录含 2026-10-02 人工接受；GEO-101/102 也为 done。
- 起始分支已是 geo/GEO-104；本任务未创建分支、提交、PR 或生产发布。
- 当前本地实现及指定检查通过，3轮fresh独立只读critical review已完成，确认问题均解除；manifest、Task Brief与task.json均为review，等待人工验收，未标记done。
- 初始工作树包含 GEO-001～103 的未提交修改。evidence/initial-fingerprints.json、initial-status.txt 与 before/ 保存任务起始证据，候选以这些快照比较，不将所有 git diff 归于本任务。

## 实现

Application Service 分为写命令 geo_catalog.py、固定锁序 geo_catalog_locks.py、一致批量读 geo_catalog_queries.py；normalization共享Unicode搜索键且保留原写入校验；复用 GEO-103 的纯 projector/policy/normalization/Schema。Router 只拥有 HTTP 参数、session/ADMIN/ENGINEER/CSRF、响应和 request_id，不拥有 Session commit、FOR UPDATE 或 ORM 写入。

12 个操作：Subject list/create/get/update/delete/enable/disable，Alias create/update/delete，Domain create/delete。创建 Subject revision=0；所有子写命令比较父 expected_revision，成功返回完整父投影；子行没有独立 revision。Subject DELETE 返回204、Subject POST返回201、其他写返回200。有效字段全相同/同态启停不改 revision/updated_at、不增加成功审计；锁后 stale revision 总是先冲突，不能以 no-op 绕过。

PATCH 使用 model_fields_set 保留省略/null 意图。类型/Product/创建信息不可修改；OWN_PRODUCT 三个持久化名称为 NULL，当前 Product 的型号、品牌、类别及 revision 仅形成只读摘要，不复制事实，不因 Product 名称变化增加 Subject revision。父级允许停用，父级停用不级联子级。

## 公开与数据库合同

- contracts/openapi.yaml 将 GEO-101 冻结的12个 Path Item 原样从 x-geo-catalog-contract.paths 移入标准 paths并删除扩展；总操作176，响应1120（移除跨切面request-context后的raw响应944）。严格 runtime drift gate 没有豁免。
- 公共 DeletionBlockerType 增加 GEO_SUBJECT，用于既有 Product 删除投影，generated schema.d.ts 同步。其余已有路径以及所有 Catalog Path Item 与任务起始冻结形状一致；机器对比见 evidence/contract-promotion.json。
- contracts/database.md 更新应用接线、Product/User 删除引用、一致读及安全审计实施状态，不改DDL。技术数据/API、README、追踪矩阵、CHANGELOG 和哈希同步。
- 前端仅适配既有 Product/Content 共用 blocker 枚举文案、Auth schema 及 Audit 动作/关联登记；未新增 Catalog 页面、前端域状态机、路由、query key 或 URL 状态。

## 事务、锁、并发与错误映射

锁序为 OWN_PRODUCT 的 Product → UUID 升序去重旧/新品牌（品牌目标也在此阶段）→ Subject → Alias/Domain。初读身份只确定锁集合，取得目标锁后 populate_existing，并重新校验 revision 与 subject_type/product_id/parent_subject_id；等待期间父绑定漂移即拒绝 REVISION_CONFLICT，不追锁新父级、不自动重放。非法父 ID 只锁真实品牌，避免错误父类型反向锁另一 Product 聚合。

Subject 写、父 revision 和最小成功审计同一事务。任何异常回滚；具体业务 flush 才映射已登记的精确 SQLSTATE+constraint/index，审计 flush/commit 故障保留 unknown。未解析异常文本、未全局吞 IntegrityError、未猜默认 blocker。

| 写边界 | 精确数据库对 | 结果 |
|---|---|---|
| Subject create/enable |23505 + uq_geo_subjects_active_own_product|409 GEO_SUBJECT_PRODUCT_EXISTS，body.product_id；enable含绑定subject_id/product_id|
| Subject write |23514 + ck_geo_subjects_parent_type / ck_geo_subjects_parent_not_self|409 GEO_SUBJECT_PARENT_INVALID，body.parent_subject_id|
| Subject delete |23503 + fk_geo_subjects_parent_identity|409 GEO_SUBJECT_IN_USE，details={}；rollback后不重查失败事务|
| Alias create/update |23505 + uq_geo_subject_aliases_subject_normalized|409 GEO_SUBJECT_ALIAS_EXISTS，body.alias|
| Domain create |23505 + uq_geo_subject_domains_subject_hostname|409 GEO_SUBJECT_DOMAIN_EXISTS，body.hostname|

无 Catalog Idempotency-Key；重复创建由唯一性裁决，不返回假成功。主 Product 锁序列化活动身份竞争，partial unique 为最终仲裁。多个停用身份合法，再启用需同一 Product 锁和唯一性检查。子字典竞争先复核父 revision；停用 Alias 仍占唯一键。

## 引用、删除与一致读取

当前真实引用表仅 CHILD_SUBJECT，计数包含停用子级；有引用拒绝物理删除，停用成功且不改引用。未来 MonitoringPlan/Run/Analysis/Opportunity 尚无表，所以按已接受合同显式零，不提供假查询。后续引入对应域时必须同时增加 RESTRICT FK、共享锁序、批量计数及反例测试；不能只在 JSON 存 ID 后绕过删除 owner。

Product 删除服务/投影纳入全部 GeoSubject.product_id（含停用身份），User 业务引用纳入 GeoSubject.created_by；FK RESTRICT 最终防线保持。Subject 删除仅 CASCADE Alias/Domain，不清理子 Subject、Product、用户或审计历史。

列表/详情由服务在认证读取前关闭autoflush并建立 REPEATABLE READ；认证last_seen_at内存更新不在GET请求中flush/commit，避免同Cookie并发提交触发RR更新冲突；count/page、当前 Product、父摘要、所有字典和引用计数同一快照，批量 SQL 数不随 Subject 数增长。过滤 q/type/product/parent/active、10/20/50分页、名称/更新时间排序带稳定ID；LIKE通配符按字面转义。没有持久化派生计数。q与当前Product型号/品牌、display_name共用NFKC、Unicode空白折叠与casefold；结构筛选后分批规范化当前名称，以单个UUID[]参数接入SQL count/page，没有复制Product事实或截断合法casefold展开。yield_per(500)仅表示结果分批处理，未开启服务端stream_results；驱动缓冲与匹配UUID列表仍随筛选后数据量增长。

## 安全、隐私与外部调用

ADMIN 写、ADMIN/ENGINEER 读；全部十个写操作使用真实Cookie session和CSRF依赖。ENGINEER typed actions为空、deletion=null，不将UI投影当授权。子ID不属于URL Subject返回404。

十个Catalog成功动作登记于既有CONFIGURATION审计白名单，稳定target_type=GeoSubject/target_id=Subject UUID；facts仅revision/is_active，没有名称、描述、别名、hostname、产品事实、密钥或Cookie。删除保留最小tombstone，审计详情关联从AVAILABLE变MISSING。没有新的审计删除权限。

Catalog规范化/域名配置不发DNS、HTTP或外部AI请求；普通验证只用虚构夹具、本地PostgreSQL/Redis/fake OSS及已有fake provider，没有真实平台采集。未改CSRF、SSRF、TLS、凭据、不可变或历史数据边界。

## Alembic 与数据

没有本任务新revision，head仍0044_geo_catalog，0001～0044文件指纹均保持任务起始值，无历史回填、生产迁移或降级。完整集成包含带旧记录0043→0044前滚、legacy快照保留、metadata与拒绝破坏性downgrade反例。额外在隔离geo104_forward空库执行alembic upgrade head，退出0；SQL确认version_num=0044_geo_catalog（alembic-forward.log、alembic-head-forward.log）。

首次向pytest基础数据库geo104_validation查询alembic_version失败：该库由现有integration fixtures用create_all/drop_all生命周期管理，version表不存在；失败记录alembic-head.log。这不代表Alembic前滚失败，随后使用独立空库取得明确前滚/版本证据。

恢复路径沿已接受0044合同：代码回退或前滚修复；需要数据库恢复时使用迁移前备份，禁止删除Catalog历史作为downgrade。

## 实际验证

全部测试使用任务隔离Compose project partsignal-geo104-validation，.env.example 加 evidence/compose-validation.yaml；不连接既有开发卷或生产数据。Colima起始停止，本任务启动本地Engine；结束down --volumes --remove-orphans退出0，仅删除本project的3个容器、3个卷及网络；docker ps确认无其他运行容器后colima stop退出0，colima list -j确认Stopped，恢复初始停止状态。证据见environment-cleanup.log。

| 命令 | 最终结果 | 日志 |
|---|---|---|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_geo_catalog_metadata.py backend/tests/unit/test_geo_catalog_schema.py backend/tests/unit/test_geo_catalog_policy.py backend/tests/unit/test_geo_catalog_projection.py |基线132 passed|evidence/baseline-unit.log|
| 隔离compose run --rm backend-test pytest tests/integration/test_geo_catalog.py tests/integration/test_geo_catalog_constraints.py |基线71 passed，2既有warnings|evidence/baseline-postgresql-corrected.log|
| 隔离compose run --rm backend-test pytest tests/integration/test_geo_catalog_api.py |17 passed|evidence/api-third.log|
| 隔离compose run --rm backend-test pytest tests/integration/test_geo_catalog_concurrency.py tests/integration/test_geo_catalog_transactions.py |14 passed|evidence/concurrency-transactions-initial.log|
| make lint |退出0，Ruff+ESLint通过|evidence/lint.log|
| make typecheck |退出0，mypy89源码+tsc通过|evidence/typecheck.log|
| make test-unit |退出0，后端967/前端863 passed|evidence/test-unit.log|
| make test-integration COMPOSE='docker compose --env-file .env.example -p partsignal-geo104-validation -f deploy/compose.dev.yaml -f .trellis/tasks/10-02-geo-104-catalog-api/evidence/compose-validation.yaml' |退出0，466 passed，2既有warnings，290.19s|evidence/test-integration.log|
| make contract-check |最终退出0，完整runtime及generated types一致|evidence/contract-check-final.log|
| git diff --check |退出0，无空白错误（最终命令证据见checks-final.json）|evidence/diff-check.log|
| 最终修改的两个metadata测试文件定向Ruff |退出0|evidence/lint-metadata-final.log|
| 隔离compose run --rm backend-test pytest tests/integration/test_geo_catalog_api.py tests/integration/test_geo_catalog_concurrency.py tests/integration/test_geo_catalog_transactions.py tests/integration/test_geo_catalog_read_regressions.py |最终39 passed，4.47s|evidence/catalog-final-targeted.log|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_errors.py |最终14 passed，0.26s|evidence/error-mapping-final.log|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_schema.py backend/tests/unit/test_geo_catalog_policy.py backend/tests/unit/test_geo_catalog_projection.py backend/tests/unit/test_geo_catalog_contract.py |规范化修正后127 passed，1.20s|evidence/unit-normalization-final.log|
| UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend |最终退出0|evidence/lint-backend-final.log|
| UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app |最终退出0，89源码|evidence/typecheck-backend-final.log|
| 文档包shasum -a 256 -c SHA256SUMS |退出0，原清单全部成员一致|evidence/doc-hashes.log|

基线PostgreSQL精确命令为：
```sh
docker compose --env-file .env.example -p partsignal-geo104-validation -f deploy/compose.dev.yaml -f .trellis/tasks/10-02-geo-104-catalog-api/evidence/compose-validation.yaml run --rm backend-test pytest tests/integration/test_geo_catalog.py tests/integration/test_geo_catalog_constraints.py
```

make test-unit完整结果来自最后两处局部后端修正之前；随后已针对规范化和mapper分别执行127/14项单元，后端Ruff/mypy及39项Catalog集成，并最终重跑466项完整PG集成。前端与其输入在这些修正中未改变，复用已通过的ESLint/tsc/863项单元证据。未把完整单元标成在最终后端修正后重新执行。

新增覆盖：真实Session API的CRUD、PATCH省略/null、聚合revision/no-op/stale、Alias/Domain唯一与子归属、Product当前身份、父引用及Product/User删除阻断；每个写端点ADMIN/CSRF以及读认证；两个独立Session的Product身份竞争、字典revision竞争、父删除/子创建双向交错及锁等待父绑定漂移；真实23505与23503兜底；审计/commit失败原子性；RR跨count/page新写入不混快照与批量查询成本；低敏审计及删除tombstone。14项单元保护精确诊断和未知边界；新增8项真实API读回归覆盖同Cookie GET列表/详情与写请求交错、无UPDATE sessions、全角/casefold/合法长品牌与保留分隔符后缀。

首次失败及修正均保留，没有把未通过命令改写为通过：
1. compose run --no-build 为无效选项，去掉后基线71项通过。
2. Product删除COUNT的静态类型int|None，改为scalar_one；typecheck通过。
3. 初次contract-check的generated类型未同步，运行make contract-generate后两项合同检查通过。
4. API夹具产品规范身份重复，修正仅隔离套件清理。随后TestClient透出异常，定位SQLAlchemy Result直接dict转换失败，改为tuples().all()。类型校验位置调整时一次错误传参立即修正。最终17项通过。
5. 新路由使旧静态/运行时metadata操作数与精确状态库存过期（164→176、1039→1120、875→944、带422操作150→162）。增加12项明确签名和精确计数，定向失败检查修正后通过，完整make test-unit重跑通过；未放宽status/header/error信封保护。
6. 新测试初稿Ruff导入/长行问题修正，完整make lint通过。
7. 独立复核发现RR认证autoflush与Unicode搜索差异，先写反例：7项修正前按预期失败（真实SerializationFailure及查询total=0，read-regressions-before.log）。修正后31项相关API/事务通过，追加第8项合法160个ß品牌casefold展开并重跑完整集成。
8. 主代理复核最终unique guard发现enable失败flush后ORM过期属性读取；扩展真实23505测试，修正前PendingRollbackError（enable-guard-before.log）。改为flush前保存纯身份错误，修正后39项集成、14项单元通过；独立复核确认解除，最终完整集成466项通过。

两条metadata warning在本任务前71项基线与既有GEO-103完整证据中已出现：旧内容/发布表循环FK的排序提示，以及既有dialect_options提示。metadata compare仍为空，本任务未扩大无关模型修复。

未运行make e2e、build、make verify全栈门禁和真实外部平台测试：本任务无Catalog页面/导航/Worker/部署或外部集成改变，真实API+PostgreSQL+静态/generated合同直接覆盖本轮行为；没有本任务CI/发布要求再执行这些成本更高且无新增风险的门禁。未在生产前滚。

## 独立复核与范围核对

3轮独立critical_reviewer均为fresh只读、fork_turns=none，按multi-agent-orchestration完成plan/validate/guard-dispatch，并核对写入指纹。

- 第1轮确认RR认证autoflush、Unicode当前名称搜索两项P2；主代理补真实HTTP/PG反例并修正。
- 第2轮确认两项P2解除，实际只读PG验证空/单项/70,000项UUID[]单绑定参数与分批结果；无新阻断。明确未验证大规模Catalog延迟/峰值内存，不能称为服务端流式读取。
- 第3轮确认enable真实partial unique失败事务恢复问题解除，精确映射/回滚/审计边界保持，无新阻断。强制最终约束分支在真实服务层覆盖，HTTP已覆盖预检查；未通过HTTP重复强制触发该约束。缺少绑定事实的unknown组合以代码审阅确认，14项单元未直接覆盖该组合。

3份review-N-findings.md和review-N-write-evidence.json记录结论、只读与覆盖边界。没有将主代理自查冒充独立复核，也没有将复核工作验收统计当成GEO-104人工done。

持久Audit Bundle已关闭且audit-verify通过，无异常、残留活跃Worker或Reviewer文件写入：
`/Users/sc/.codex/audits/multi-agent/partsignal-2069b161/20261002T074402Z-geo-104-catalog-independent-review-17ed434b`

audit_id：`20261002T074402Z-geo-104-catalog-independent-review-17ed434b`。经校验SUBAGENT_EXECUTION_DIGEST.json/.md副本在本任务evidence内；3次计划/执行工作验收/独立复核，模型与推理档位仅来自固定Agent TOML配置证据。audit-finalize/verify日志见audit-final-verify.log。

evidence/contract-promotion.json确认12个冻结Path Item原样接线、既有路径不改，仅公共DeletionBlockerType增加GEO_SUBJECT。scope-final.json按任务起始2998个指纹核对：候选外既有文件、前序Trellis记录和44个迁移无改变。final.diff是相对起始before快照的本任务diff，final-files.json包含34个实现/测试/合同/文档文件；本Task记录单列，不混入前序dirty修改。最终diff/范围/精确合同/敏感信息与文档哈希核对完成。

## 修改文件

- `backend/app/audit_types.py`
- `backend/app/main.py`
- `backend/app/routers/geo_catalog.py`
- `backend/app/schemas/common.py`
- `backend/app/services/audit_logs.py`
- `backend/app/services/geo_catalog.py`
- `backend/app/services/geo_catalog_locks.py`
- `backend/app/services/geo_catalog_normalization.py`
- `backend/app/services/geo_catalog_queries.py`
- `backend/app/services/identity.py`
- `backend/app/services/product_facts.py`
- `backend/tests/integration/geo_catalog_support.py`
- `backend/tests/integration/test_geo_catalog_api.py`
- `backend/tests/integration/test_geo_catalog_concurrency.py`
- `backend/tests/integration/test_geo_catalog_read_regressions.py`
- `backend/tests/integration/test_geo_catalog_transactions.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_geo_catalog_contract.py`
- `backend/tests/unit/test_geo_catalog_errors.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `contracts/database.md`
- `contracts/openapi.yaml`
- `docs/geo-monitoring/03-technical/02-data-architecture.md`
- `docs/geo-monitoring/03-technical/03-api-contract-design.md`
- `docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/CHANGELOG.md`
- `docs/geo-monitoring/README.md`
- `frontend/src/app/auth/auth-provider.tsx`
- `frontend/src/domains/audit/audit.model.ts`
- `frontend/src/domains/content/content-task-lifecycle.tsx`
- `frontend/src/domains/product/product.model.ts`
- `frontend/src/shared/api/generated/schema.d.ts`
- `docs/geo-monitoring/SHA256SUMS`。
- 本任务 `.trellis/tasks/10-02-geo-104-catalog-api/` 的 prd/design/implement、task.json、implement/check.jsonl 与 evidence。

## 状态与限制

manifest和Trellis从planned→in_progress→review，等待人工验收，未自行done；task.json completedAt保持null。GEO-103 done、GEO-105 planned不变；本轮仅GEO-104。

已知限制：当前只对已存在的真实引用域计数；未来4个域必须在各自任务接入真实FK/锁/计数。名称q规范化扫描成本随结构筛选后资源数增长，本任务没有大规模延迟/峰值内存基准；没有生产迁移或真实外部平台验证。

后续GEO-105实现Catalog页面，GEO-106完成R1纵向验收；未来真实引用域/历史字典快照接入由各自任务负责。本轮没有对应计划/Run/Analysis/Opportunity表或回答级业务。数据库/缓存/凭据/依赖大版本、生产启动配置没有新增变更。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-104 的实现与测试证据。”据此仅将 manifest 的 GEO-104 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围和依据；Task Brief 的当前状态同步更新。

以上实施章节和原始 evidence 保留提交人工验收时的历史状态、测试结果及边界，不把未运行检查改写为通过。本次仅记录 GEO-104 验收，不改变其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾执行 git diff --check，并核对五个收尾文件的未跟踪文件空白及其他文件保持不变；实际结果见本轮最终报告。
