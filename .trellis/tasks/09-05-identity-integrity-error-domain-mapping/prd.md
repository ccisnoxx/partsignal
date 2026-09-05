# Identity IntegrityError 领域映射

## Goal

实现已获批准的 identity username 完整性错误合同：让用户名预检与真实 PostgreSQL `23505 + uq_users_username` 竞态返回同一可定位、可恢复的 `409 USER_USERNAME_EXISTS`，同时保持 unknown `IntegrityError` 默认 500 边界和 delete user 既有 `23503 -> USER_IN_USE` 合同不变，并以确定性真实数据库证据闭合事务、审计和前端恢复行为。

本任务是父任务 `09-04-integrity-error-domain-mapping` 的独立 T3 implementation child。合同决策来源为已批准且 targeted re-review 通过的 `09-05-identity-integrity-error-contract-decision`；本任务不得重新发明或扩大该合同。

## Dependencies and Preconditions

- `unknown-integrity-error-boundary-correction` 已完成并归档；unknown `IntegrityError` 已回到默认服务端 500 边界。
- `09-05-identity-integrity-error-contract-decision` 已完成独立 review、定向 re-review，并获用户批准。
- 开始实施前必须确认 current-head PostgreSQL catalog 中精确约束名仍为 `uq_users_username`，且真实 duplicate diagnostics 为 `sqlstate=23505`、`constraint_name=uq_users_username`。
- 本任务三份规划、两份真实 manifests 和独立只读 planning review 均完成后，仍需用户批准最新 child 规划，才可运行 `task.py start`。

## Requirements

### R1. 精确映射 duplicate username

- username 预检重复与真实唯一约束竞态必须返回完全相同的领域结果：
  - HTTP `409`；
  - `code = USER_USERNAME_EXISTS`；
  - `message = 用户名已存在`；
  - `details = {"errors":[{"loc":["body","username"],"msg":"用户名已存在","type":"user_username_exists"}]}`；
  - `request_id` 由现有统一错误信封注入当前请求 ID。
- username identity 继续使用当前服务端 `strip().lower()` 规则；不得新增第二套 normalization 或让前端成为 identity 权威。
- service 内只建立一个 username conflict 构造器，由预检和 flush 后映射共同使用。

### R2. 保持 unknown 边界

- 仅当 SQLAlchemy `IntegrityError` 同时满足 `error.orig.sqlstate == "23505"` 和 `error.orig.diag.constraint_name == "uq_users_username"` 时映射为 `USER_USERNAME_EXISTS`。
- diagnostics 缺失、sqlstate 不同、constraint 不同及未来约束必须原异常抛出，继续进入既有默认 500 边界。
- 禁止解析数据库错误文本、按请求字段猜测、rollback 后回查分类、接受别名、宽泛捕获所有 `23505` 或复用 `REVISION_CONFLICT`。

### R3. 前端字段定位与安全恢复

- 只有 `code` 精确为 `USER_USERNAME_EXISTS` 且某个 `details.errors[].loc` 精确为 `['body', 'username']` 时，才把服务端错误投影到 username 字段；`message` 只展示，不参与分支。
- 创建 Dialog 保持打开，保留 username、display name、account type，清空 temporary password，并把焦点移回 username；用户修改 username、重新输入 temporary password 后显式重试。
- 字段错误与 form summary fallback 均显示 request ID。
- details 缺失、结构错误、loc 未知或 code 不匹配时不得猜字段；在 form summary 展示服务端 message 与 request ID，同时保留安全输入并清空 temporary password。
- duplicate failure 不进入 revision conflict 冻结态，不 reload、不自动 replay、不调用成功回调或成功后的 query invalidation。

### R4. delete user 合同不变并补足真实证据

- 保留预检 blocker：`409 USER_IN_USE`、动态引用摘要 message、`details.references=[{"type":"USER_BUSINESS_HISTORY","count":N}]`。
- 保留 command-scoped PostgreSQL `23503` fallback：`409 USER_IN_USE`、message `用户仍有业务历史引用，不能删除`、details `{}`。
- 不合并两条 `USER_IN_USE` 的 message/details，不用 rollback 后查询伪造 references。
- 保持 `_USER_STATE_LOCK`、User `FOR UPDATE`、revision/active 检查优先级、引用统计、永久删除上下文、session cascade 和成功审计顺序不变。
- 用两个确定性锁序场景及一个独立 fallback sentinel 验证真实 PostgreSQL 行为；测试不得使用 `sleep`、伪造 `IntegrityError` 或削弱 production lock/schema。

### R5. 合同与文档边界

- `createUser` 的 status 集合、共享 `ErrorEnvelope`、开放字符串 `ErrorDetail.code` 均不变。
- 不修改 OpenAPI、identity router runtime metadata、generated client、通用 error owner、identity ORM/migration schema 或 `user.api.ts`。
- 更新 `contracts/database.md` 的数据库映射事实、Frontend V2 行为文档、backend database 稳定规范和 frontend state 稳定规范；identity 专属事实不得复制到通用 error spec。

### R6. 工作流、验证与回滚

- 实施只发生在本任务状态变为 `in_progress` 之后；planning 阶段不得修改业务代码、公共合同、稳定 specs 或数据库。
- required validation 必须覆盖真实 diagnostics、双事务 race、预检/constraint 等价、unknown 反例、失败原子性、delete 三类真实数据库证据、前端字段投影/secret/request ID，以及 contract/runtime/generated 零漂移。
- 一次正式 gate 只能在定向检查通过后的候选上运行；默认 `make contract-check`，若用户要求 full/release gate，则以一次 `make verify` 替代，不能二者都运行。
- 单 gate 最多两次 `repair -> targeted re-check`；独立 implementation review 一次完整检查、最多一次定向 re-review。
- mapper、前端、测试、文档与稳定 specs 作为同一 T3 回滚单元；所有只读 owner、数据库 schema 和生产数据始终排除在回滚单元外。
- 不提交、不归档、不 push；提交前另行提交精确 commit plan 并取得用户批准。

## Scope

### Allowed production and test files

- `backend/app/services/identity.py`
- `backend/tests/integration/test_identity_management.py`
- `frontend/src/domains/identity/user-list.model.ts`
- `frontend/src/domains/identity/user-list.model.test.ts`
- `frontend/src/domains/identity/user-list-page.tsx`
- `frontend/src/domains/identity/user-list-page.test.tsx`

### Allowed documentation and stable specs

- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

### Read-only zero-diff targets

- `contracts/openapi.yaml`
- `backend/app/routers/identity.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `backend/app/errors.py`
- `backend/app/models/identity.py`
- `backend/app/migration_schema_v1.py`
- `frontend/src/domains/identity/user.api.ts`
- `frontend/src/shared/api/generated/schema.d.ts`
- `.trellis/spec/backend/error-handling.md`

### Out of scope

- migration、schema、constraint rename/alias、生产数据操作；
- 权限、账号状态机、删除业务规则、全局 exception handler 或跨域 error registry；
- 新 HTTP status、OpenAPI schema/code enum、runtime response metadata 或 generated client 变更；
- 自动改名、自动 reload/replay、保存或重放 temporary password；
- 无关 UI、视觉、路由、API client 或其他 domain 的错误投影。

## Acceptance Criteria

- [ ] current-head 真实 PostgreSQL 证明 `uq_users_username` 与 `23505` diagnostics；不同 constraint 和缺失 diagnostics 不被映射。
- [ ] 常见预检 duplicate 与双 Session race 败者均精确返回获批 status/code/message/details；除 request ID 外领域响应完全相同。
- [ ] 双 Session race 恰一方成功、数据库恰一 normalized User，败者无 `user.created` SUCCESS audit、无第二行或 SessionRecord，失败 Session rollback 后可继续查询。
- [ ] 前端仅按 exact code + exact loc 定位 username；Dialog、焦点、安全草稿、secret 清除、request ID、显式重试和无成功 invalidation 行为均由测试证明。
- [ ] malformed/unknown error 不猜字段，展示 summary + request ID，并执行相同 secret 清除规则。
- [ ] delete 场景 A 证明引用事务先行、delete 等待、引用提交后预检返回丰富 `USER_IN_USE`，User/reference 保留且无成功删除审计。
- [ ] delete 场景 B 证明 delete 锁先行、引用写等待、delete 成功后引用方得到真实 `23503`，最终无 User/reference/悬空行。
- [ ] 独立 fallback sentinel 证明 delete command 自身真实 `23503` 映射为固定 message/details，失败后 User/reference 保留且 Session 可恢复。
- [ ] stale revision、active user、非 23503 原抛及既有成功 create/delete 行为不回归。
- [ ] 四份权威文档/spec 与实现一致；所有只读 targets 相对实施基线零 diff。
- [ ] required validation、scoped diff、touched-scope 中文文档检查和独立 implementation review 完成；未执行的 optional gate 与残余风险有记录。

## Stop Conditions

- current-head constraint 名或真实 diagnostics 与批准合同不同，或实现需要 migration/constraint alias。
- 实际需要修改任一只读 owner、公开 status/wire schema、runtime metadata、generated client 或通用 error spec。
- username race 无法用两个独立 Session 观察批准 diagnostics，且相同编排根因重复。
- delete `23503` 只能通过削弱 production lock、修改 schema 或伪造数据库异常触发。
- 任一 gate 达到 repair/re-check 上限仍失败，或独立定向 re-review 仍发现 MEDIUM 以上问题。

命中停止条件时保留当前 diff，报告原始证据、已尝试修复、受影响文件和可选下一步，不扩大范围或把失败改写成成功。
