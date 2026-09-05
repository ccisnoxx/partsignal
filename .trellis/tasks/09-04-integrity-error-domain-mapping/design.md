# IntegrityError 领域错误映射设计

## 1. 设计结论

本任务只形成可 review 的实施设计，不修改运行时代码。审计结果不支持“一个全局异常 registry 统一映射所有数据库约束”：当前 head 至少包含 31 个主键、74 个外键、44 个 CHECK、18 个 UNIQUE constraint、8 个 UNIQUE index 和 242 个 NOT NULL 列，业务含义分属 identity、configuration、content/generation、publication/GEO 等稳定 owner。

采用以下方向：

1. 删除 `IntegrityError -> 409 REVISION_CONFLICT` 的全局业务映射；未知完整性故障回到现有框架默认 500 boundary，由 request Session owner 回滚，不冻结新的公共内部错误码或 JSON shape。
2. 只有 service command 能证明某个结构化 PostgreSQL 诊断属于本命令拥有的已知业务约束时，才把它转换为既有或经合同先行批准的新领域 `AppError`。
3. 真正的 `expected_revision` 比较失败继续使用 `REVISION_CONFLICT`；数据库约束、状态 blocker、幂等冲突和内部不变量失败不得借用该 code。
4. 不建立通用错误码 registry、插件、策略框架或第二套错误类型系统。每个稳定 service owner 显式维护自己的窄 allowlist；只有安全读取 DBAPI diagnostics 的无业务小函数在出现真实重复后才考虑抽取。
5. 分阶段实施：先纠正未知边界，再按稳定领域收敛可恢复约束；需要新 error code 或新的前端恢复政策时，先冻结合同，再改 runtime/generated/frontend。

完整约束矩阵见 [`research/database-constraint-matrix.md`](research/database-constraint-matrix.md)，逐项 companion 见 [`research/database-constraint-companion.csv`](research/database-constraint-companion.csv)，路径清单见 [`research/backend-integrity-paths.md`](research/backend-integrity-paths.md)。

## 2. 证据基线与统计口径

### 2.1 IntegrityError 路径

- 8 个源码文件 import `IntegrityError`：6 个 service，加上 `backend/app/errors.py`、`backend/app/main.py`。
- 9 个 service `except IntegrityError` 语法站点：`identity.py` 1 个、`product_facts.py` 2 个、`platform_configuration.py` 3 个、`content_planning.py` 1 个、`content_production.py` 1 个、`publication.py` 1 个。
- 按复用 helper 和业务命令族合并为 7 类 service handling path：产品创建/更新、用户删除、平台类型创建/更新、平台 profile 创建、Prompt 创建/更新、自然化作业创建、平台账号创建/更新。
- 上述 catch 实际覆盖 11 个 HTTP `operationId`；全仓库另有 33 个显式 `db.flush()` 和 87 个 `db.commit()` 写入边界，未被本地精确捕获的 HTTP 路径都可能逃逸到全局 handler，worker 则由自己的 Session/失败状态 owner 处理。
- 另有 1 个全局 handler path，注册到所有 HTTP operation；因此本设计分别报告“9 个 catch 站点 / 7 类 service path / 1 个全局 path”，避免把 import 行或共享 helper 重复计算为路径。
- 其他包含 `flush()`/`commit()` 的写命令没有本地 catch，当前未分类的 `IntegrityError` 都会进入错误的全局 handler；后台 worker 使用独立 Session，不经过 FastAPI handler。

### 2.2 数据库约束

当前 ORM metadata 和 0001–0043 migration 静态审计的计数：

| 维度 | 数量 | 说明 |
|---|---:|---|
| 业务表 / PRIMARY KEY | 31 | 每表一个，复合主键按一个 constraint 计 |
| FOREIGN KEY | 74 | 复合 FK 按一个 constraint 计 |
| CHECK | 44 | 以当前 head 模型与最终 migration 为准 |
| UNIQUE constraint | 18 | `UniqueConstraint` / 列级 unique |
| UNIQUE index | 8 | 包括表达式和 partial unique index |
| NOT NULL | 242 | 列级边界，无独立 `constraint_name` |
| EXCLUDE | 0 | 未发现 |

表约束为 167；把唯一索引计入唯一性权威后为 175；按用户要求再把 242 个 NOT NULL 列作为单独诊断边界审计，共 417 项。PK 列也具有 NOT NULL 语义，因此 417 是“约束/列级边界审计项”而不是 417 个语义互斥的 catalog object。触发器守卫不属于 `pg_constraint`，另有 39 个最终 active instance（36 个普通 trigger、3 个 `CONSTRAINT TRIGGER`），不混称为 catalog constraint；companion 按统一字段逐行列出 417 项加 39 个 trigger guard，共 456 条规范化 enforcement row。

### 2.3 约束矩阵的统一字段规则

矩阵对每个被分组压缩展示的 PK/FK/CHECK/NOT NULL 项应用同一默认字段：

- 当前业务预检：若该 service 无明确预检，记为“无”；schema/Pydantic 校验不能替代数据库最终权威。
- 当前处理：未被 7 类 service path 精确捕获的 HTTP 命令均为“未分类，落入全局 `REVISION_CONFLICT`”；worker 路径为“异常由 worker 自有事务 owner 处理”，不能写成 HTTP 409。
- 当前 HTTP：全局路径为 409 / `REVISION_CONFLICT` / `数据约束冲突`；无 HTTP owner 的内部写入不虚构 HTTP 结果。
- 目标处理：默认是 unknown，原样 re-raise 到内部失败边界；只有矩阵明确列出已有/待批准领域含义的约束才映射。
- 事务 owner：拥有该 command 的 service；顶层 HTTP 异常由 `get_db()` 做 root rollback 兜底。只有外层业务明确要求保留先前写入时，才由外层建立 savepoint。
- 测试：每个领域映射必须有真实 PostgreSQL diagnostics + service/HTTP 行为 + 无部分副作用；默认 unknown 项由各 SQLSTATE 类别 sentinel 代表，不为 417 项机械创建 417 条 HTTP 测试。

## 3. 错误分类与识别协议

### 3.1 三类失败

| 类别 | 权威判断 | HTTP/domain 结果 | 客户端恢复 |
|---|---|---|---|
| 真正 revision 过期 | service 加锁后比较请求 `expected_revision` 与当前 revision | 既有 409 `REVISION_CONFLICT` | 保留本地输入；仅用户显式 reload 后采用 canonical state；不自动 replay |
| 已知数据库约束竞态 | 当前 command 的 allowlist 精确匹配 `orig.diag.constraint_name`，或 command-specific 的结构化 `sqlstate` | 既有或 contract-first 批准的领域 code/status/details | 按具体 code：字段修正、blocker、幂等重放或重新选择；不得借用 revision UX |
| 未知 IntegrityError | diagnostics 缺失、约束名不在 allowlist、SQLSTATE/表列组合未获业务映射，或触发器未形成公共合同 | 原异常继续抛出；request Session rollback；现有默认 500 boundary | 通用失败；不把它标为 stale/revision，不自动重试，不展示 DB 细节 |

完整 producer 清单见 [`research/revision-conflict-producer-inventory.md`](research/revision-conflict-producer-inventory.md)：service 中共有 62 个显式语法生产点，覆盖 68 个合并 operationId；其中 46 个是真实 expected/current revision mismatch，2 个是 AI 外部调用返回后的合同批准 revision-snapshot stale，2 个是明确误用，12 个 GEO context/chain 失败只有“稳定 409”证据、具体 code 待合同决策。全局 IntegrityError handler 是另一个被动 producer，不计入这 62 个。

两个明确误用是 `createUser` 重复 username 与“请求带 expected revision 但自然化 Prompt 尚不存在”；前者与 `uq_users_username` 同一约束路径，后续 identity task 必须先批准准确 code，再让预检和真实 23505 race 完全一致；后者另列 configuration contract reconciliation，不借本 mapper task 顺手改。AI 的两个 snapshot stale 本质上仍是外部调用期间 revision 已变化，保留既有 `REVISION_CONFLICT`。GEO 的 12 个 context/chain producer不属于数据库 IntegrityError；在 code 决策前保持现状但不得扩张使用，后续 T5-C 决定是否改为专门 context code。

### 3.2 允许的诊断字段

- UNIQUE / PK：`orig.sqlstate == "23505"` 加 `orig.diag.constraint_name`。
- FK：`orig.sqlstate == "23503"` 加 command-specific `constraint_name` allowlist；`deleteUser` 现有仅按 `23503` 的写法可继续作为 command-scoped 正确样例，因为删除用户是唯一动作且合同把受阻引用统一定义为 `USER_IN_USE`，但不得推广成全局 FK mapper。
- CHECK：`orig.sqlstate == "23514"` 加 `constraint_name`。
- NOT NULL：`orig.sqlstate == "23502"` 加 `diag.table_name` 与 `diag.column_name`；只有获批准的输入字段映射才可转成 422/领域错误。
- 触发器：许多守卫为 `55000` 或没有 `constraint_name` 的 `23514`；默认属于 unknown。除非稳定合同提供结构化可识别字段，否则不建立业务映射。

禁止：`str(error)`、`message_primary`、数据库英文文本、substring、猜测 column/value，以及 rollback 后查询到某行便反推此次失败约束。二次查询只能在已由 diagnostics 确认幂等 unique constraint 后判断“同载荷重放 / 异载荷冲突”。

## 4. 当前与目标数据流

### 4.1 当前流

```text
HTTP request
  -> route / request schema
  -> service command：预检、锁、修改 ORM、revision、audit/event
  -> flush 或 commit
       ├─ 少数已知 catch：rollback -> AppError -> ErrorEnvelope
       ├─ profile/prompt/humanization：泛捕获后靠回查/猜测映射
       └─ 其他 IntegrityError：get_db rollback
                              -> 全局 handler
                              -> 409 REVISION_CONFLICT
```

问题有三层：unknown 被伪装为 revision；三个本地 catch 仍可能误分类；部分数据库 unique race 没有与业务预检共享同一个领域结果。

### 4.2 目标流

```text
HTTP request
  -> route / request schema
  -> service command（业务事务 owner）
       -> lock + expected_revision comparison
            └─ mismatch -> AppError(REVISION_CONFLICT)
       -> 在最窄可归属的 flush 边界执行写入
            ├─ diagnostics 精确命中 command allowlist
            │    -> rollback root / rollback owner-provided savepoint
            │    -> domain AppError
            └─ 未命中
                 -> 原样 re-raise
                 -> get_db root rollback
                 -> framework default 500 boundary
       -> 已确认无约束错误后 append audit/event（或与业务数据同事务）
       -> commit
```

若约束只在最终 commit 才触发，command owner 必须在 commit 边界捕获并保持相同诊断规则。为更早发现且避免已组装 response 后失败，优先在拥有该不变量的 service 显式 `flush()`；不能仅为了捕获而把一个原子 command 拆成多个 commit。

## 5. 事务、rollback、savepoint 与副作用

### 5.1 Session failed state

项目实际使用 SQLAlchemy 2.0.51、psycopg 3.3.4。flush 失败后 Session 进入 partial rollback/failed state；在同一 Session 查询或继续 flush 之前必须显式 rollback。`backend/app/db.py:get_db()` 对逃逸异常执行 rollback 并 close，但它不是业务 commit owner。

### 5.2 所有权规则

- 顶层单命令：service 在自己拥有的 flush/commit catch 中判断 diagnostics，并对已知映射执行 root rollback；unknown 可原样抛给 `get_db()` rollback。
- 组合/批量命令：外层业务 command 决定失败是否整批回滚。`bulkUpdateUserStatus` 对数据库/编程/审计异常要求整批回滚，不能靠 savepoint 保留前项。
- 需要保留外层状态的真实组合命令：由外层显式 `begin_nested()` 建立 savepoint；内层 mapper 不得自行决定保留。SQLAlchemy `Session.begin_nested()` 会在建立 SAVEPOINT **之前无条件 flush 当前 pending state**，因此顺序合同是：先验证并显式 flush 要保留的外层状态，确认 root transaction 仍 active，再进入 nested block 添加目标写入。若 `begin_nested()` 的前置 flush 自身失败，SAVEPOINT 尚未建立，必须 root rollback，不能声称外层状态仍可保留。
- nested 路径的测试必须分别证明：目标写入在 SAVEPOINT 内失败后 root transaction 仍 active、允许的外层状态可提交；以及前置 flush/unknown 失败时整笔 root transaction 回滚。当前仓库没有 `begin_nested()` 使用，因此没有真实组合需求前不预建 savepoint abstraction。
- mapper/helper 不同时拥有 diagnostics 分类和无条件 `db.rollback()`；业务 command 必须看得见事务副作用。

### 5.3 原子性

- `append_audit()` 只向当前 Session add，不自行 commit；AuditLog 与业务对象同事务。
- Publication events、review records、revision 增量也在 command 当前事务。
- 已知/未知失败都必须恢复数据库中的原对象、revision、事件、审核记录和成功 AuditLog；失败请求不得留下部分行。
- 队列投递和对象存储 I/O 沿用既有“数据库提交后投递 / 先声明再外部 I/O”合同，不在 mapper 中补偿或重排。
- rollback 后生成对象可能被 expunge，脏对象会过期/恢复；错误 details 使用已验证请求字段和固定 loc，不从 rollback 后 ORM 状态猜值。

## 6. 已有映射与需收敛路径

### 6.1 保留的正确样例

| 约束/命令 | 当前领域结果 | 设计动作 |
|---|---|---|
| `uq_products_normalized_brand` / create/update product | 409 `PRODUCT_ALREADY_EXISTS`，定位 brand/part_number | 保留，补真实 `23505 + constraint_name` 与双事务竞态证明 |
| `uq_platform_types_slug` / create/update platform type | 409 `PLATFORM_TYPE_SLUG_EXISTS`，定位 slug | 保留，补 diagnostics 与副作用断言 |
| `uq_platform_accounts_profile_identifier_normalized` / create/update account | 409 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`，定位 account_identifier | 保留，补真正双连接竞态而非仅 monkeypatch 预检 |
| delete user 的 FK `23503` | precheck 为 409 `USER_IN_USE` + references；flush fallback 为固定 message + `{}` | 保持 command-scoped；分别补确定性锁序证据、真实 `23503` fallback sentinel 和失败审计断言 |

### 6.2 已有 code、识别方式错误

| 命令 | 当前缺陷 | 目标 |
|---|---|---|
| create platform profile | catch 后按 slug 回查 | 只在最终 DB 的 `uq_platform_profiles_slug` diagnostics 命中时返回现有 `PLATFORM_SLUG_EXISTS` |
| create/update platform prompt | catch 后按 name 回查 | 只匹配 migration 的真实 DB 名 `uq_platform_prompt_templates_name`，返回现有 `PLATFORM_PROMPT_NAME_EXISTS` |
| create humanization job / retry HUMANIZE job | create 路径把任何 IntegrityError 推断为 idempotency 或 active job；retry 路径没有 catch | 两条路径分别匹配 `uq_generation_jobs_idempotency_key` 与 `uq_generation_jobs_active_humanization_source`；只有前者再回查 payload；其他原抛 |

### 6.3 当前直接落入全局错误路径

所有没有本地精确 catch 的 PK/FK/CHECK/NOT NULL/unique/trigger failure 当前都可能变成 409 `REVISION_CONFLICT`。优先级最高的可达样本包括：

- `createUser` 的 `uq_users_username` race（且预检已误用同一 code）；
- AI Header `(channel_id, normalized_name)` 和 AI Model `(channel_id, model_id)` unique；
- `createPlatformProfile` 的创建竞态 / slug unique；
- content task / generation job / publication work idempotency unique 的数据库最终路径；
- fact/content version 的 version、pending/approved partial unique；
- publication work/article/issue partial unique；
- 所有 CHECK、NOT NULL、未预期 FK 和触发器拒绝。

其中不是所有约束都应转成 4xx。没有明确用户可恢复语义或正常请求不可达的 PK、CHECK、NOT NULL、审计/不可变触发器默认保持 unknown 500。

## 7. 全局 handler 决策

选择删除专用 `integrity_error_handler` 及其注册，不新增内部 ErrorEnvelope handler。依据：

1. 现有 `ErrorEnvelope` 是业务/校验错误信封；`ErrorDetail.code` 是开放 string，但 OpenAPI 没有 `INTERNAL_ERROR`、`DATABASE_ERROR` 或统一 500 code。
2. 已完成的 non-2xx/complete response gate 明确拒绝猜测 ordinary unhandled 500 的稳定 code/shape；全局 handler 不能作为逐 operation 409 权威。
3. 保留内部信封需要先定义新的公共 status/code/schema、runtime metadata、generated client 与前端策略，当前没有产品合同证据。
4. 默认 FastAPI/Starlette server-error boundary 已是其他未处理异常的统一边界。实施时必须以 `debug=False` 的真实 HTTP sentinel 观察 500 和不泄漏；不能在规划文档中把尚未实测的 body/header 形状写成合同。

因此，删除 handler 是撤销错误业务映射，不是新增一个稳定公共 500 API。OpenAPI 不声明 ordinary unknown 500；如果未来产品决定冻结 JSON 500，必须另立 contract-first task。

## 8. 公共合同、generated client 与前端影响

### 8.1 无需公共合同变更的情况

- 保持现有 409 + `ErrorResponse`，只把已知 constraint race 精确映射到 operation 已经使用的 code/status/details。
- `PRODUCT_ALREADY_EXISTS`、`PLATFORM_TYPE_SLUG_EXISTS`、`PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`、`PLATFORM_SLUG_EXISTS`、`PLATFORM_PROMPT_NAME_EXISTS`、`IDEMPOTENCY_CONFLICT`、`HUMANIZATION_ALREADY_ACTIVE`、`USER_IN_USE` 的 status/envelope 可复用现有 operation 409 声明。
- 删除错误全局 handler、让 unknown 回到未声明的普通 500，不新增 stable wire contract，因此不修改 OpenAPI/generated client。

### 8.2 必须 contract-first 的情况

- 新增重复用户名、AI Header/Model、pending review、publication work/issue 等领域 code；
- 修改某 operation 的 status set；
- 把公共 `ErrorDetail.code` 从 string 冻结为 enum/union；
- 为 unknown 500 定义稳定 JSON error code/shape；
- 改变现有“任意删除 409 冻结确认”的前端业务政策。

顺序固定为：`contracts/openapi.yaml`（若 wire 变化）→ router `error_responses(...)` / service runtime → backend contract tests → generated client → frontend domain projection/恢复测试。数据库 schema 无需为了 mapper 新增 migration；只有真实 catalog name 无法稳定识别且确需重命名时，另立 migration task。

### 8.3 REVISION_CONFLICT consumer

生产前端有 15 个显式 `REVISION_CONFLICT` 匹配行，它们总体按 code 处理；另有 14 个 `status === 409` 匹配行，涵盖删除 blocker、context stale、幂等冲突等，不等于 revision consumer。后续前端 task 必须逐 operation 明确允许的 code 集合：

- 编辑草稿/表单仅由真实 revision（以及合同明确列出的 GEO publication changed 等独立 code）进入“保留输入 + 显式 reload”。
- `USER_IN_USE`、`PLATFORM_TYPE_IN_USE`、`IDEMPOTENCY_CONFLICT` 等进入自己的 blocker/recovery。
- 文档当前明确规定部分删除操作“任意 409 冻结确认”；是否收紧是产品行为合同决策，不能在后端 mapper task 中暗改。

## 9. 后续实施任务拆分

### T1：unknown IntegrityError boundary correction（推荐首项）

目标：只撤销全局伪装并以一个真实 PostgreSQL HTTP sentinel 证明 unknown 明确失败；不新增领域 code。

文件边界：

- `backend/app/errors.py`
- `backend/app/main.py`
- `backend/tests/integration/test_ai_channel_management.py`（新增 AI Model duplicate unknown sentinel）
- `backend/tests/unit/test_runtime_response_metadata.py`（只证明 handler/metadata 未漂移，不冻结默认 500 body）
- `.trellis/spec/backend/error-handling.md`

`backend/tests/integration/test_platform_types.py` 与 `backend/tests/unit/test_contract.py` 仅作为不修改的 validation target，分别证明正确 unique mapper/revision 和 frozen operation/response 合同未回归。禁止触碰 service 映射、OpenAPI/generated/frontend、数据库 schema。保留所有已有 `AppError` 和 revision 语义。详见第 11 节验收。

### T2：configuration 已有码约束收敛

目标：只收敛已有公共 code 的 platform type/profile/prompt/account identity unique；AI Header/Model 新 code 不进入本 Task，继续走 T1 的 unknown boundary。

精确文件边界：

- production：`backend/app/services/platform_configuration.py`、`backend/app/services/content_planning.py`（仅 platform profile 创建 command；update schema 不含 slug）、`backend/app/services/publication.py`（仅 platform account helper）；
- integration：`backend/tests/integration/test_platform_types.py`、`test_platform_accounts.py`、`test_platform_profile_list.py`、`test_platform_workspace.py`、`test_prompt_preview_options.py`；
- unit：`backend/tests/unit/test_audit.py`、`test_configuration_audit.py`、`test_contract.py`、`test_runtime_response_metadata.py`；
- spec：`.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`；T2-C 另负责 `.trellis/spec/backend/ai-configuration-guidelines.md:44-49,61-64` 的语义同步。

本 Task 不改 router/OpenAPI/generated/frontend，因为所有目标 operation 已声明 409 且沿用既有码；若实际证据显示 status/schema 需变，停止并先建 T2-C `configuration-integrity-error-contract-decision`，其文件边界固定为 `contracts/openapi.yaml`、`backend/app/routers/configuration.py`、`planning.py`、`publication.py`、`backend/tests/unit/test_contract.py`、`test_runtime_response_metadata.py`、`frontend/src/shared/api/generated/schema.d.ts` 和对应 configuration mapper/tests。依赖 T1；不得触碰 publication work 状态机或 content generation。

T2-C 同时负责冻结 `putContentHumanizationPrompt` 的资源缺失语义：`backend/app/services/platform_configuration.py:745-792` 当前在资源不存在且请求携带 `expected_revision` 时返回 `REVISION_CONFLICT`，而该分支是资源不存在语义误用，不是 `IntegrityError` mapper。T2-C 必须先决定“不存在 + expected_revision”应使用的既有/新 code、message、details、status 与前端恢复政策，再由 T2 实现同步 service `platform_configuration.py:745-792`、router `backend/app/routers/configuration.py:321-340`、`backend/tests/integration/test_platform_workspace.py`（新增该行为测试）和必要的 `backend/tests/unit/test_contract.py`/`test_runtime_response_metadata.py`；若 wire/status/code 变化，依赖 contract decision 后再同步 OpenAPI/generated/frontend。验收是：缺失资源与 stale revision 分支可区分，决策后的响应与合同一致，成功首次创建仍无 expected revision，失败不写 Prompt 或成功审计；不得把该问题归入 IntegrityError mapper，也不得在本规划阶段预先决定新 code。

### T3-C / T3：identity account contract decision 与实现

T3-C 先决定 `uq_users_username` 的准确 code/message/details 和前端行为；现有 409 status/envelope 若不变，记录“不改 OpenAPI schema”的依据，不能因为 `ErrorDetail.code` 是 string 就跳过业务合同决策。

T3-C 已由 `09-05-identity-integrity-error-contract-decision` 细化；该 child 是最终合同 owner，永久保持 planning-only，不作为 implementation target。其 targeted re-review 通过且用户显式批准最新规划后，另建 `identity-integrity-error-domain-mapping` implementation child，并在新 child 文档中显式声明依赖本 T3-C；只对新 child 准备 manifests 和执行 `task.py start`。

T3 允许修改：`backend/app/services/identity.py`、`backend/tests/integration/test_identity_management.py`、`frontend/src/domains/identity/user-list.model.ts`、`user-list.model.test.ts`、`user-list-page.tsx`、`user-list-page.test.tsx`、`contracts/database.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`。`contracts/openapi.yaml`、`backend/app/routers/identity.py`、`backend/tests/unit/test_contract.py`、`test_runtime_response_metadata.py`、`backend/app/errors.py`、identity ORM/migration schema、`frontend/src/domains/identity/user.api.ts`、generated schema 与 `.trellis/spec/backend/error-handling.md` 只作为零 diff validation targets。若证据要求改变任一只读 owner，停止并回到 contract review。

T3 目标：使 username 预检与真实 `23505 + uq_users_username` race 返回同一获批 `USER_USERNAME_EXISTS`；其他 diagnostics 保持 unknown。保留 delete user command-scoped `23503 -> USER_IN_USE` 的固定 fallback，并把删除数据完整性证明拆成三个独立证据：引用先行时 delete 等待后由 precheck 返回 references；delete 锁先行时引用写入等待、delete 提交后引用方得到真实 `23503` 且无悬空行；已提交引用加 test-only counter bypass 确定触发 delete command 自身的真实 `23503` fallback。并发测试必须使用 event/barrier、数据库 wait 证据与有界 timeout，不使用 `sleep`，也不得削弱 production lock。T3 依赖 T1 与获批 T3-C，可与 T2 并行；不得混入用户权限或状态转换改造。

### T4：content/generation 已有码收敛与待决项隔离

第一可实施子目标同时覆盖 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob`：两者都通过 `_create_job` 写入 `generation_jobs`，都可能命中 `uq_generation_jobs_idempotency_key` 与 `uq_generation_jobs_active_humanization_source`。实现只精确区分现有 `IDEMPOTENCY_CONFLICT` 与 `HUMANIZATION_ALREADY_ACTIVE`，其他约束原抛。其精确文件边界仍为 `backend/app/services/content_production.py`、`backend/tests/integration/test_generation_reliability.py`、`backend/tests/unit/test_generation.py`、`.trellis/spec/backend/error-handling.md`。

content task、generation job、content/fact version 的其他 unique/partial unique 如果需要新 code，先建 T4-C `content-integrity-error-contract-decision`；其边界为 `contracts/openapi.yaml`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`.trellis/spec/backend/database-guidelines.md`、`backend/tests/unit/test_contract.py`。获批后的 T4 扩展实现边界固定为 `backend/app/services/content_planning.py`、`content_production.py`、`generation.py`、`review.py`，`backend/app/routers/planning.py`、`production.py`、`product_facts.py`，以及 `backend/tests/integration/test_content_task_creation.py`、`test_generation_reliability.py`、`test_content_review.py`、`test_content_draft_lifecycle.py`。依赖 T1 和 T4-C；CHECK/NOT NULL/trigger 默认 unknown。

### T5-C / T5：publication/GEO contract decision 与实现

T5-C 先决定 publication work/article/issue 可恢复 unique 与 12 个 GEO context `REVISION_CONFLICT` producer 的 code；平台账号既有码不重复决策。T5-C 文件边界：`contracts/openapi.yaml`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`.trellis/spec/backend/{database-guidelines,error-handling,publication-workbench-guidelines}.md`、`backend/tests/unit/test_contract.py`。

T5 实现文件边界：`backend/app/services/publication.py`、`geo_observation.py`；`backend/app/routers/publication.py`、`observation.py`（仅 T5-C 要求 metadata 时）；`backend/tests/integration/test_publication_workflow.py`、`test_geo_insights.py`、`test_geo_observation_correction.py`、`test_geo_observation_detail.py`；`backend/tests/unit/test_runtime_response_metadata.py`。前端/generated 留给 T6，除非 T5-C 明确要求同 Task 原子同步。目标是按 stable owner 收敛 unique/FK/跨表守卫，同时保持 event time、不可变历史和删除事务合同。依赖 T1 与 T5-C，必须独立高风险只读 review。

### T6：frontend 409 recovery projection reconciliation

目标：在后端 code 稳定后，逐 operation 把 15 个生产文件中的 status-only 409 判断投影为 revision、blocker、idempotency 或 context stale；不做视觉改动。

生产文件边界固定为：

- `frontend/src/domains/configuration/{platform-list-page,platform-types-page,platform-workspace-page}.tsx`
- `frontend/src/domains/content/{content-review-page,content-task-lifecycle}.tsx`
- `frontend/src/domains/geo/geo-observation-detail-page.tsx`、`geo.api.ts`、`query-topic-list-page.tsx`
- `frontend/src/domains/identity/user-list-page.tsx`
- `frontend/src/domains/publication/publication-workspace-actions.tsx`、`published-article-detail-page.tsx`、`published-content-issue-workspace-actions.tsx`、`published-content-issue-workspace-page.tsx`、`start-publication-dialog.tsx`
- `frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx`

测试边界按生产文件逐项固定，不使用同目录通配：`frontend/src/domains/configuration/platform-list-page.tsx` → `frontend/src/domains/configuration/platform-list-page.test.tsx`；`frontend/src/domains/configuration/platform-types-page.tsx` → `frontend/src/domains/configuration/platform-types-page.test.tsx`；`frontend/src/domains/configuration/platform-workspace-page.tsx` → `frontend/src/domains/configuration/platform-workspace-page.test.tsx`；`frontend/src/domains/content/content-review-page.tsx` → `frontend/src/domains/content/content-review-page.test.tsx`；`frontend/src/domains/content/content-task-lifecycle.tsx` → `frontend/src/domains/content/content-task-list-page.test.tsx`、`frontend/src/domains/content/content-task-detail-page.test.tsx`；`frontend/src/domains/geo/geo-observation-detail-page.tsx` → `frontend/src/domains/geo/geo-observation-detail-page.test.tsx`；`frontend/src/domains/geo/geo.api.ts` → `frontend/src/domains/geo/geo.api.test.ts`；`frontend/src/domains/geo/query-topic-list-page.tsx` → 拟新增 `frontend/src/domains/geo/query-topic-list-page.test.tsx`（Query Topic 409 code 投影与 request ID）；`frontend/src/domains/identity/user-list-page.tsx` → `frontend/src/domains/identity/user-list-page.test.tsx`；`frontend/src/domains/publication/publication-workspace-actions.tsx` → `frontend/src/domains/publication/publication-workspace-page.test.tsx`；`frontend/src/domains/publication/published-article-detail-page.tsx` → `frontend/src/domains/publication/published-article-detail-page.test.tsx`；`frontend/src/domains/publication/published-content-issue-workspace-actions.tsx`、`frontend/src/domains/publication/published-content-issue-workspace-page.tsx` → `frontend/src/domains/publication/published-content-issue-workspace-page.test.tsx`；`frontend/src/domains/publication/start-publication-dialog.tsx` → `frontend/src/domains/publication/publication-work-page.test.tsx`；`frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx` → `frontend/src/domains/geo/geo-observation-correction-page.test.tsx` 与 `frontend/tests/e2e/geo-observation-correction.spec.ts`。其中 actions/dialog 使用宿主 page 的既有组合测试，不虚构独立 nodeid；无现成 Query Topic page 测试时仅以“拟新增文件 + 行为名”登记。文档边界为 `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 与 `08-testing-quality-and-acceptance.md`；generated schema 只在上游 contract decision 改 OpenAPI 时同步。依赖 T2–T5 中实际新增/冻结的 code，并需产品决定“任意删除 409 冻结确认”是否保留。

## 10. Validation、review、停止与回滚

### 10.1 每个后续 Task 的 required validation

- 真实 PostgreSQL：直接确认 `sqlstate` 和最终 catalog `constraint_name`（NOT NULL 为 table/column）；mock 只能做分支补充。
- service/HTTP：预检和 DB 最终 race 的 status/code/details 完全一致；unknown 不返回 `REVISION_CONFLICT`。
- concurrency：两个独立 Session/connection 经过 barrier，同时通过预检后竞争；恰一方成功，另一方得到指定领域结果。
- 原子性：失败方无 SUCCESS AuditLog、event、review record、revision 增量或部分关联行；后续请求不出现 failed-session 错误。
- contract：只有 wire/status/route metadata 变化时运行完整 contract/generated gate；否则至少运行受影响 runtime/contract regression。

精确建议命令见 [`research/testing-strategy.md`](research/testing-strategy.md)。

### 10.2 Optional validation

- 与变更领域无关的 backend integration 全套、frontend 全套、E2E 和完整 build。
- 当共享 handler、公共合同或多个核心领域同时变化时，完整 integration/contract gate 升级为 required。
- `make verify` 只在 targeted checks 全部通过后的候选上运行一次；失败不在同一回合自动重跑完整 gate。

### 10.3 独立 review 与停止条件

- T1 的 reviewer 核对未知 wire、不泄漏、Session cleanup、无新公共 code。
- T2–T4 reviewer 核对 constraint owner、真实 catalog 名、预检/race 一致性与 rollback 所有权。
- T5 需要独立高风险只读 review，重点是不可变历史、删除、event/revision 原子性。
- 一次完整 review，最多一次针对受影响路径的 re-review；re-review 仍有 MEDIUM 以上新问题或同一问题未解则停止。
- 每个 validation gate 最多两轮 repair → targeted re-check；同根因复现或第二轮失败即停止并报告。

### 10.4 回滚边界

- T1 可独立恢复 handler 注册，但这样会恢复已知错误行为；回滚时必须连同 sentinel/spec 一起恢复并明确风险。
- 各领域 task 只回滚自己的 mapper、tests、contract projection，不回滚数据库 schema，因为默认不创建 migration。
- contract-first task 的 static OpenAPI、runtime metadata、generated client、frontend projection 必须作为一个原子变更回滚，不能留下跨层漂移。
- 不使用 `git reset --hard`、`checkout --`、stash 或宽路径清理；当前 staged artifacts 与既有 dirty 文件始终排除。

## 11. 推荐第一个实施 Task 的精确验收

建议用户批准后首先创建并启动 `unknown-integrity-error-boundary-correction`，只完成以下一件事：**未知 SQLAlchemy `IntegrityError` 不再被系统宣称为业务 `REVISION_CONFLICT`**。

可观察验收标准：

1. `backend/app/errors.py` 不再存在 `IntegrityError -> AppError("REVISION_CONFLICT", ..., 409)` 的 handler；`backend/app/main.py` 不再注册该 handler。
2. 一个合法 AI channel 下重复创建相同 `(channel_id, model_id)`，由真实 PostgreSQL 触发 `23505` 和预期 unique constraint；HTTP 在 `debug=False` 下得到现有默认 500 boundary，而不是 409/`REVISION_CONFLICT`。
3. 该响应不包含 SQL、表名、constraint name、DB message 或 stack；测试不冻结默认 500 的 body/code/header 为新公共合同。
4. 失败请求无 `ai_model.created` SUCCESS AuditLog、无第二条 AIModel，原 channel/model revision 不变；请求结束后的独立查询成功，证明 request Session 已 rollback/close。
5. 至少各复跑一个真实 `expected_revision` 409 和一个已有正确 constraint mapper（建议 product 或 platform type），证明二者仍返回原有 ErrorEnvelope/status/code/details。
6. `make contract-check` 继续通过，OpenAPI/generated client 无 diff；因为本 Task 没有新增稳定 500 response 或 error code。
7. `.trellis/spec/backend/error-handling.md` 明确 unknown 原样抛出、默认 server-error boundary、不把该 boundary 写成稳定 JSON 合同。
8. 实际 diff 仅在上述文件和测试范围；数据库 migration/schema、前端、其他 service、权限和状态转换均无变化。

该 Task 完成后再进入 T2–T5；T1 不声称已经修复 profile/prompt/humanization 的本地误分类。

## 12. 本规划阶段不变项

- 不运行 `task.py start`。
- 不修改代码、合同、数据库、migration、generated client、前端或稳定 spec。
- 不运行 PostgreSQL 写入测试、线上请求或生产数据操作。
- 不创建后续实施 Task；只给出方案，等待用户批准。
- 不提交、不归档、不 push，不改写任何历史 Task。
