# Identity IntegrityError 合同决策

## Goal

在不修改业务代码、公共合同、generated client、稳定规范、数据库或生产数据的前提下，冻结 identity account 后续 T3 所需的 username 唯一冲突合同、前端恢复语义、删除用户 `23503` 边界、实施文件边界与验收门槛。当前 T3-C 永久保持 planning-only；合同获批后另建一个可独立 review、实施、检查和归档的 T3 implementation child。

本任务是父任务 `09-04-integrity-error-domain-mapping` 的 T3-C 合同决策，依赖已完成的 unknown `IntegrityError` 默认 500 边界修复。

## Background

当前 `create_user()` 把 username 预检重复错误写成 `409 REVISION_CONFLICT`，但该请求没有 `expected_revision`，也不存在可比较的旧版本。两个并发请求还可能同时通过预检，由 `uq_users_username` 在 `flush()` 时裁决；该真实 PostgreSQL 路径目前没有具名 mapper，会进入默认服务端 500。

当前新增用户接口已经在冻结 OpenAPI 与 runtime response metadata 中声明 409，并使用统一 `ErrorEnvelope`。因此，本任务不需要扩大 HTTP status 或 wire schema，只需批准一个准确、可定位、可恢复的业务错误合同，并明确 T3 不得把未知数据库故障降级成宽泛 409。

删除用户已有 command-scoped `23503 -> USER_IN_USE` 最终防线。T3 只补足可重复的数据库与副作用证据，不改变该合同、锁序、引用定义或前端删除恢复行为。

## Requirements

### R1. 冻结 username duplicate 精确合同

- username 预检重复与真实 `uq_users_username` 唯一约束竞争必须返回完全相同的 HTTP status、`code`、`message` 与 `details`。
- 批准的合同为：
  - HTTP `409`；
  - `code = USER_USERNAME_EXISTS`；
  - `message = 用户名已存在`；
  - `details = {"errors":[{"loc":["body","username"],"msg":"用户名已存在","type":"user_username_exists"}]}`；
  - `request_id` 继续由当前统一错误信封注入并回显本次请求 ID。
- username identity 保持当前服务端规则：提交值经 `strip().lower()` 后写入并比较；本任务不新增第二套 normalization 或前端身份权威。

### R2. 保持 unknown IntegrityError 边界

- 只有 SQLAlchemy `IntegrityError` 同时满足 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_users_username"` 时，才映射为 `USER_USERNAME_EXISTS`。
- diagnostics 缺失、sqlstate 不同、constraint name 不同或未来新增的约束必须原样抛出，继续进入既有默认服务端 500 边界。
- 禁止解析数据库错误文本、按请求字段猜测原因、rollback 后重新查询分类、接受多个猜测 constraint 名或复用 `REVISION_CONFLICT` 兜底。

### R3. 冻结创建用户的前端恢复行为

- 前端只在 `code` 精确等于 `USER_USERNAME_EXISTS` 且 `details.errors[].loc` 精确等于 `body.username` 时，把服务端错误投影到 username 字段；不得从 `message` 推断字段。
- 创建 Dialog 保持打开；保留 username、display name、account type，清空 temporary password，并把焦点移回 username。用户修改 username、重新输入 temporary password 后显式重试。
- 即使错误已投影到字段，也必须显示 request ID；message 可用于用户展示，但不能作为分支条件。
- details 缺失、结构错误或 loc 未知时，不猜测字段；改在 form summary 展示服务端 message 与 request ID，同时仍保留安全输入并清空 temporary password。
- duplicate failure 不进入 revision conflict 冻结态，不 reload、不自动 replay、不执行成功后的 query invalidation。

### R4. 原样保留 delete user 的 command-scoped 23503 合同

- 保留当前 `delete_user()` 对 command 内任意 PostgreSQL `23503` 的映射：`409 USER_IN_USE`、message `用户仍有业务历史引用，不能删除`、details `{}`。
- 保留预检 blocker 的现有丰富响应：`409 USER_IN_USE`、动态引用摘要 message、`details.references = [{"type":"USER_BUSINESS_HISTORY","count":N}]`。
- 两条 `USER_IN_USE` 路径不在 T3 中强行合并 message/details；不得通过 rollback 后查询或猜测 constraint 来伪造 references。
- 保留 `_USER_STATE_LOCK`、目标 user `FOR UPDATE`、revision 优先级、启用用户禁止删除、引用统计、永久删除声明上下文和成功审计顺序。
- T3 必须以真实 PostgreSQL `23503` 证明最终防线与失败原子性，但不得为了制造竞态削弱现有锁。

### R5. 冻结合同与文档同步范围

- `createUser` 的公开 status 集合与 `ErrorEnvelope` wire 均不变；`ErrorDetail.code` 保持开放字符串。因此 T3 不修改 `contracts/openapi.yaml`、`backend/app/routers/identity.py`、runtime response metadata 期望或 generated client。
- `backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`contracts/openapi.yaml` 和 generated schema 只作为不应产生 diff 的 validation target。
- T3 更新 `contracts/database.md` 中 username constraint 到领域 code 的权威映射，更新 Frontend V2 行为文档中的恢复合同，并将稳定开发约束同步到现有 backend database 与 frontend state owner；不在通用 error spec 复制 identity 专属事实。

### R6. 冻结 T3 实施与验证边界

- 列出允许修改的 production、test、documentation 与 stable spec 文件，以及明确只读/禁止修改的文件。
- required validation 覆盖真实 PostgreSQL diagnostics、双事务 username race、预检/constraint 合同等价、unknown 反例、事务/审计原子性、真实 `23503` 删除防线、frontend 字段投影、request ID、secret 清除及 contract/runtime/generated 无漂移。
- 删除并发证据必须使用 test-only event/barrier、数据库 lock/wait 状态和有界 timeout 冻结确定性先后关系；不得依赖 `sleep` 或只记录非确定性观察结果。
- 冻结一次正式门禁、最多两次定向 repair/re-check、一次完整独立 review 和最多一次定向 re-review 的上限。
- 本 T3-C 不作为实现 target。合同获批后另建 `identity-integrity-error-domain-mapping` child；新任务必须引用本决策为批准输入，自有 reviewable `prd.md`/`design.md`/`implement.md` 与真实 `implement.jsonl`/`check.jsonl`，且只对新任务执行 `task.py start`。

### R7. 保持本规划任务边界

- 除创建本 T3-C 所需的 task scaffold 与父子关系元数据外，本任务正文只完成 `prd.md`、`design.md`、`implement.md`，并按独立 review 修订父任务 T3 权威段落。
- 本 T3-C 永不运行 `task.py start`，也不持有 T3 implementation manifests；本轮不创建后续 implementation child、不实施 T3、不修改业务代码、公共合同、generated client、稳定 specs、数据库或生产数据。
- 不提交、不归档、不 push；现有其他脏文件与 artifacts 全部保持不动并排除在本任务之外。

## Confirmed Contract Decisions

| 分支 | 决策 |
| --- | --- |
| username 预检重复 | `409 USER_USERNAME_EXISTS`，定位 `body.username` |
| `23505 + uq_users_username` | 与预检完全相同的 `USER_USERNAME_EXISTS` 合同 |
| 其他或不完整 diagnostics | 保持 unknown，进入默认服务端 500 |
| 删除预检发现业务引用 | 原样保留动态 `USER_IN_USE + details.references` |
| delete flush 命中任意 `23503` | 原样保留 `409 USER_IN_USE`、固定 message、空 details |
| 真正 revision 比较失败 | 继续使用 `REVISION_CONFLICT`；创建用户重复不得复用 |

精确响应、事务边界、前端恢复矩阵、文件边界与测试设计以 `design.md` 为准。

## Constraints

- PostgreSQL 是 username identity 与删除可行性的最终权威；Redis 不参与本任务判断。
- Server 是 normalization、状态转换、权限、revision 与输入校验的最终权威。
- 成功审计只能在可能失败的 flush 之后追加；失败请求不能留下第二个 User、SUCCESS AuditLog、session、副作用或不可继续使用的事务状态。
- 不创建 migration，不重命名约束，不改变 User schema、认证权限、账号状态机、删除资格或密码策略。
- 不恢复 unknown `IntegrityError -> REVISION_CONFLICT`，也不新增全局异常 mapper、错误码 enum 或第二套 error registry。
- 所有新增或实质改写的 Python 注释、docstring、异常 message 与开发者可见文本遵循项目中文规则。

## Out of Scope

- 任何 T3 业务、测试、UI、contract generation 或 stable spec 实施。
- 修改用户名更新能力；当前公开 `UserUpdate` 不包含 username。
- 用户名可用性探测 API、乐观保留用户名、自动改名、自动重放或自动生成密码。
- 修改删除用户的 blocker taxonomy、lock strategy、权限、revision 规则、永久删除声明或历史清理语义。
- 数据库迁移、数据修复、生产数据操作、全仓 full suite、E2E 或 release gate。
- 创建或启动后续 T3 implementation child；该动作必须等待本次修订完成 targeted re-review 及用户显式批准最新规划。

## Acceptance Criteria

- [x] `uq_users_username` 的精确 status/code/message/details/request-id 语义已冻结。
- [x] code 明确选择 `USER_USERNAME_EXISTS`，未误用 `REVISION_CONFLICT`、`USER_ALREADY_EXISTS` 或模糊通用冲突。
- [x] 预检与真实数据库竞争被要求返回完全相同的字段级合同，unknown diagnostics 继续默认 500。
- [x] 创建 Dialog 的字段定位、草稿保留、secret 清除、request ID、显式重试和 malformed fallback 已定义。
- [x] 删除用户的 precheck 与 `23503` 两条既有 `USER_IN_USE` 响应已分别冻结，并明确不为测试削弱锁。
- [x] 删除并发已拆成两个可确定调度、可断言阻塞点与最终持久状态的锁序场景；delete command 自身的 `23503` fallback 由独立真实数据库 sentinel 证明。
- [x] OpenAPI、runtime metadata、generated client、Frontend V2 文档、database contract 与稳定 specs 的必要/非必要变更已逐项说明。
- [x] T3 精确文件边界、required/optional validation、停止条件、review 上限与回滚边界已冻结。
- [x] 本 T3-C 与未来 T3 implementation child 生命周期已明确分离；父任务 T3 权威要求和文件边界已同步。
- [x] 除 task scaffold、父子元数据、三份规划文档及父任务 T3 权威段落外，没有其他本任务修改；未运行 `task.py start`，未实施 T3，未提交、归档或 push。

## Review Question

是否批准本 Contract Decision，并同意批准后另建独立 T3 implementation child，按 `design.md` 的精确合同和 `implement.md` 的原子文件边界进入新一轮 planning/start 门禁？若需要调整 code、message、details、secret 处理或 delete fallback，必须在创建实施任务前修改本任务文档。
