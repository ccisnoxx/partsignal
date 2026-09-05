# Identity IntegrityError 合同决策设计

## 1. 设计结论

本任务冻结以下原则：

1. 重复 username 是资源 identity 冲突，不是 revision 过期；使用新的 `409 USER_USERNAME_EXISTS`。
2. username 预检与 `23505 + uq_users_username` 共用一个错误构造器，输出完全相同的字段级 `ErrorEnvelope`。
3. 仅以结构化 PostgreSQL diagnostics 精确识别获批约束；其他 `IntegrityError` 继续作为 unknown 抛出。
4. 创建 Dialog 只按 exact code + exact structured loc 投影 username；保留安全输入、清空 temporary password、显示 request ID，并要求用户显式重试。
5. delete user 现有 command-scoped `23503 -> USER_IN_USE` 原样保留；T3 只补真实数据库与原子性证据，不把 precheck 和 fallback 的 details 强行统一。
6. `createUser` 已公开 409 和统一 ErrorEnvelope，T3 不修改 OpenAPI、router metadata、generated client 或 response occurrence 基线。

## 2. 权威证据与当前状态

### 2.1 数据库与服务 owner

- `backend/app/db.py` 的 naming convention 将单列 unique 命名为 `uq_%(table_name)s_%(column_0_name)s`。
- `backend/app/models/identity.py` 与 `backend/app/migration_schema_v1.py` 都把 `User.username` 声明为 `unique=True`，因此 current model 的精确名称是 `uq_users_username`；T3 开始前仍须在测试数据库 current head catalog 核验。
- `backend/app/services/identity.py::create_user()` 当前先把 username `strip().lower()`，再查询是否存在；预检命中时错误地返回 `REVISION_CONFLICT`。
- 同一函数的 `db.flush()` 位于 `user.created` SUCCESS audit 之前，但没有捕获 `IntegrityError`。因此两个请求同时通过预检时，数据库败者目前进入 unknown 500。
- `backend/app/db.py::get_db()` 是请求 Session owner，异常时 rollback。T3 的已知 duplicate mapper仍应在捕获点显式 rollback 后抛出具名 `AppError`，使同一 service 边界与测试 Session 的清理行为明确。

### 2.2 公共 HTTP 与 runtime metadata

- `contracts/openapi.yaml::createUser` 已声明 `201/400/401/403/409/422`，409 引用共享 `ErrorResponse`。
- 共享 `ErrorDetail.code` 是开放字符串，`details` 是开放 object；新增稳定 code 不需要 enum、第二套 registry 或 schema 分支。
- `backend/app/routers/identity.py::create_user_endpoint` 已通过 `error_responses(401, 403, 409, 422)` 注册同一 409 runtime model。
- 因 status、wire shape、required 字段和 schema identity 均不变，`test_contract.py`、`test_runtime_response_metadata.py` 与 generated schema 只能作为无漂移门禁，不能为了新 code 修改计数或签名。

### 2.3 当前 frontend consumer

- `frontend/src/domains/identity/user.api.ts` 的 `UserRequestError` 已保留 HTTP status 与完整 `ErrorDetail`，并把服务端 message 与 request ID 组合成可展示文本。
- `CreateUserDialog` 当前任意失败都保持 Dialog 打开、保留非密码字段、清空 temporary password，但只显示 form summary，不解析 structured loc。
- `user-list.model.ts` 当前持有 User form schema 与纯状态投影，却没有 create error mapper；`user-list.model.test.ts` 也没有字段错误投影覆盖。
- 用户 edit/reset/status 的 `REVISION_CONFLICT` 与 delete 的任意 409 freeze 是其他命令的既有行为；create username duplicate 不得进入这些分支。

### 2.4 删除用户当前边界

- `delete_user()` 依次获取 `_USER_STATE_LOCK`、锁定目标 User 行、校验 revision/active、统计全部业务历史引用，然后才删除并 flush。
- precheck 命中时，`in_use()` 返回动态 message 与 `details.references`。
- flush 捕获任意 command 内 PostgreSQL `23503` 时，当前 rollback 并返回固定 `USER_IN_USE` message 与空 details；其他 sqlstate 原抛。
- 父计划提出的“预检后新增引用 race”不能在规划阶段假定为可达：当前表锁与目标行 `FOR UPDATE` 会影响引用写入的并发顺序。T3 不得为构造测试移除或后移这些锁；应分别验证锁下的并发可观察结果，以及绕过预检后由真实 FK 触发的 `23503` fallback。

## 3. Username duplicate 精确合同

统一响应继续使用：

```json
{
  "error": {
    "code": "USER_USERNAME_EXISTS",
    "message": "用户名已存在",
    "details": {
      "errors": [
        {
          "loc": ["body", "username"],
          "msg": "用户名已存在",
          "type": "user_username_exists"
        }
      ]
    },
    "request_id": "<当前请求 ID>"
  }
}
```

HTTP status 固定为 `409`。预检与真实数据库分支的 status、code、message、details 必须逐字段完全相同；只有 request ID 随请求变化。

### 3.1 code 选择依据

- 选择 `USER_USERNAME_EXISTS`：同时标明领域 owner（User）、identity 字段（username）与冲突事实（exists），和项目已有 `AI_MODEL_ID_EXISTS`、`PLATFORM_TYPE_SLUG_EXISTS`、`PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 风格一致。
- 不选 `REVISION_CONFLICT`：create 请求没有 `expected_revision`，也没有 stale canonical resource 可 reload。
- 不选 `USER_ALREADY_EXISTS`：无法区分 User UUID/entity 重复与 username identity 重复，字段定位也不明确。
- 不选 `USERNAME_ALREADY_EXISTS`：缺少 domain owner，未来其他身份主体出现 username 时容易冲突。
- 不复用 `VALIDATION_ERROR`：输入单独看是合法的，冲突来自数据库中的既有 identity。

### 3.2 constraint 识别

只有以下谓词为真才映射：

```text
isinstance(error, IntegrityError)
and error.orig.sqlstate == "23505"
and error.orig.diag.constraint_name == "uq_users_username"
```

缺失 `orig`/`diag`、空 constraint、不同 sqlstate、`pk_users`、CHECK、FK、NOT NULL 或未来约束均原样抛出。不得解析异常字符串，不得根据 payload 含 username 就猜成 duplicate，不得 rollback 后重新 SELECT 分类。

### 3.3 事务与副作用顺序

推荐在 `identity.py` 内增加两个局部 owner：

- `_user_username_conflict()`：唯一构造上述 `AppError`；预检与 database mapper 共用。
- `_flush_new_user(db)`：只包围当前新增 User 的 flush；只识别获批 diagnostics，已识别时 rollback 并 `raise ... from error`，unknown 原抛。

顺序保持：normalize → precheck → 构造/添加 User → 精确 flush → SUCCESS audit → commit。这样数据库失败发生在成功审计之前；败者 rollback 后不会留下 User、session 或 SUCCESS AuditLog，并保留原 `IntegrityError` 作为 cause 供 integration 断言 diagnostics。

不新增 repository、全局 mapper、generic constraint registry 或薄转发层。

### 3.4 normalization 边界

服务端现有 `strip().lower()` 是唯一 username identity owner；预检和写入都使用同一个 normalized 值。前端可 trim 以提供即时表单体验，但不能成为大小写/空白唯一性的最终权威。T3 不改变 username 长度、字符集、casefold 策略或数据库 collation。

## 4. Frontend 恢复合同

### 4.1 纯 mapper 边界

在 `user-list.model.ts` 增加一个仅面向 create-user 的纯函数。它接收生成类型中的 `ErrorDetail`，输出：

- canonical `USER_USERNAME_EXISTS + body.username`：`fields.username = message`、保留 `requestId`，不产生猜测字段；
- code 匹配但 details 缺失/畸形/loc 未知：不设置字段，返回 form summary message 与 `requestId`；
- 其他 code：不设置 username，由现有 summary 展示真实错误与 request ID。

mapper 不导入 `UserRequestError`，避免 `user.api.ts -> user-list.model.ts -> user.api.ts` 循环依赖；page 只负责从 `UserRequestError.detail` 取出生成类型并执行 UI side effects。

### 4.2 Dialog 状态矩阵

| 结果 | 字段/summary | 保留 | 清除 | 后续动作 |
| --- | --- | --- | --- | --- |
| canonical `USER_USERNAME_EXISTS + body.username` | username inline；summary 仍显示 request ID | username、display name、account type | temporary password | 聚焦 username；用户改名、重输密码后显式提交 |
| exact code 但 malformed/unknown loc | 仅 form summary，包含 message + request ID | 全部非 secret 输入 | temporary password | 不猜字段；用户自行修正并显式提交 |
| 其他结构化错误 | 现有 form summary，包含 message + request ID | 全部非 secret 输入 | temporary password | 按现有错误展示；不自动 replay |
| 成功 | 关闭 Dialog、reset form | 无 | 全部 | 执行既有成功 invalidation/刷新 |

所有失败都保持 Dialog 打开。duplicate 不设置 revision conflict lock，不显示 reload，不自动 GET，不自动改写 username，不自动生成/恢复 temporary password，也不调用 `onCreated()`。

### 4.3 可访问性

字段错误沿用 `FormField`/react-hook-form 的 `aria-invalid` 与错误描述关联；canonical duplicate 后把焦点移回 username。request ID 在可感知的 `ErrorSummary` 中始终可读，不能因 inline error 而消失。

## 5. Delete user 合同保持不变

### 5.1 两条既有 USER_IN_USE 响应

| 来源 | HTTP/code | message | details |
| --- | --- | --- | --- |
| precheck 发现 N 条业务历史引用 | `409 USER_IN_USE` | `用户仍被以下对象引用：业务历史（N）` | `{"references":[{"type":"USER_BUSINESS_HISTORY","count":N}]}` |
| delete flush 捕获 PostgreSQL `23503` | `409 USER_IN_USE` | `用户仍有业务历史引用，不能删除` | `{}` |

T3 不把 fallback details 改成 references：事务失败后不能从原异常可靠得出项目的聚合 blocker count，rollback 后重查也会引入第二次分类与并发时点歧义。现有 frontend delete Dialog 已把 409 作为重新加载前的冻结信号，并展示服务端文本/request ID，空 details 可正确消费。

### 5.2 可执行测试设计

- 保留现有 reference precheck HTTP 测试，补精确 message/details/request ID 断言。
- 用两个独立 Session、test-only event/barrier、`pg_stat_activity` lock wait 证据和有界 statement/lock timeout 冻结场景 A：引用事务先插入真实 FK row 并保持未提交；delete 请求在取得目标 User 行锁时等待。确认等待后提交引用事务，delete 恢复并在 precheck 看到该引用，返回带 `details.references` 的 `USER_IN_USE`；User/reference 均保留，无 `user.deleted` SUCCESS audit。
- 用相同的确定性设施冻结场景 B：delete 已取得目标 User `FOR UPDATE` 并完成零引用 precheck；通过 test-only wrapper 在进入 delete/flush 前暂停。第二 Session 的引用写入必须因 parent key-share 冲突保持等待；释放 delete 后，delete 提交并删除 User，引用事务得到真实 PostgreSQL `23503`，最终 User 与该引用都不存在，不产生悬空引用。
- 上述两个锁序场景不得使用 `sleep` 判断阻塞，不得只打印或记录调度结果，也不得修改 production lock。timeout、未观察到预期 wait 或最终状态不符均为测试失败。
- delete command 自身的 `23503 -> USER_IN_USE` 由第三条独立 sentinel 证明：数据库中保留已提交的真实业务引用，test-only wrapper 让 reference counter 返回零，使 delete flush 确定触发 `23503`。断言 cause sqlstate、固定 `USER_IN_USE` 响应、User/reference 仍存在、无 `user.deleted` SUCCESS audit、Session rollback 后可查询。
- 若 current head 实际无法在不改变生产锁/约束的情况下触发 delete command 内 `23503`，触发停止条件：保留现有合同，报告证据并修订父任务验收，不制造 mock-only 成功证明。

## 6. 合同与文档同步矩阵

| Owner | T3 决策 | 原因 |
| --- | --- | --- |
| `contracts/openapi.yaml` | 不修改；required validation | createUser 已有 409 ErrorResponse；code/details 为开放结构 |
| `backend/app/routers/identity.py` | 不修改；required validation | runtime 已声明 409 unified model |
| `frontend/src/shared/api/generated/schema.d.ts` | 不生成、不修改；required validation | OpenAPI 无变化 |
| `backend/tests/unit/test_contract.py` | 不修改；required validation | status/wire/signature/occurrence 不变 |
| `backend/tests/unit/test_runtime_response_metadata.py` | 不修改；required validation | router metadata 不变 |
| `.trellis/spec/backend/error-handling.md` | 不修改；required validation | 通用 diagnostics/unknown/field-error 规则已覆盖，不复制 identity 专属事实 |
| `contracts/database.md` | 修改 | 数据库 identity、constraint 与领域 code 的权威 owner |
| `.trellis/spec/backend/database-guidelines.md` | 修改 | 冻结 `uq_users_username` 精确识别、unknown 与事务规则 |
| `docs/frontend-v2/05-business-actions-state-and-api-contract.md` | 修改 | 前端字段、secret、request ID、retry/reload/replay 行为 owner |
| `.trellis/spec/frontend/state-management.md` | 修改 | 冻结 User create Dialog 的稳定恢复约束 |

不新增 error-code registry 文档，不把相同完整 JSON 复制到每个 owner；各文档只记录自己负责的事实。

## 7. T3 精确文件边界

### 7.0 任务生命周期

当前 `identity-integrity-error-contract-decision` 只拥有合同决策、父任务 T3 权威段落同步和规划 review，永不作为 implementation target，也不运行 `task.py start`。

本决策通过 targeted re-review 并获用户显式批准后，另建 `identity-integrity-error-domain-mapping` implementation child，parent 仍为 `09-04-integrity-error-domain-mapping`。新任务必须：

- 在自己的 `prd.md`、`design.md`、`implement.md` 中把本 T3-C 写为已批准依赖，不能只依赖 task tree 位置暗示顺序；
- 复制本节允许/只读文件边界与第 8 节验收，但不得改变已批准合同；
- 在 start 前完成自己的 planning review，并填充真实 `implement.jsonl` 与 `check.jsonl`；
- 只对新 implementation child 执行 `task.py start`、实施、check、commit plan 和归档。

### 7.1 允许修改

Backend production/test：

- `backend/app/services/identity.py`
- `backend/tests/integration/test_identity_management.py`

Frontend production/test：

- `frontend/src/domains/identity/user-list.model.ts`
- `frontend/src/domains/identity/user-list.model.test.ts`
- `frontend/src/domains/identity/user-list-page.tsx`
- `frontend/src/domains/identity/user-list-page.test.tsx`

Authoritative docs/stable specs：

- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

### 7.2 只读 validation target；预期零 diff

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

若实现证据要求修改任一只读 target、数据库 schema、公开 status/wire 或生成类型，立即停止并回到 T3-C review，不在 T3 中自行扩边界。

## 8. T3 精确验收设计

### 8.1 Backend username

1. 常见预检：已存在 normalized username 时，HTTP 精确返回本设计的 409/code/message/details/request ID。
2. 双事务 race：两个独立 Session/connection 在同一 normalized username 的预检之后、写入之前通过 barrier；最终恰一请求成功，恰一请求得到同一 `USER_USERNAME_EXISTS`，数据库恰一行。
3. diagnostics：race 败者的 cause 为真实 PostgreSQL `23505`，constraint name 精确为 `uq_users_username`。
4. 等价性：预检与 constraint 路径除 request ID 外完整错误体相同。
5. unknown allowlist：同一 flush owner 收到真实 `23505` 但 constraint 不是 `uq_users_username` 时原异常继续抛出；缺失 diagnostics 的定向 unit 分支也不得映射。
6. 原子性：败者没有 User、session 或 `user.created` SUCCESS audit；赢家只有一条成功审计；败者 Session 清理后可继续查询。
7. 正常 create、权限、CSRF、密码规则、用户名 normalization 与真正 revision-based commands 不回归。

### 8.2 Backend delete

1. reference precheck 保持动态 message、`details.references`、User/引用不变和无成功删除审计。
2. 真实 FK fallback 精确观察 `23503` cause，返回固定 `USER_IN_USE` message 与 `{}`，User/引用仍存在，无 `user.deleted` SUCCESS audit，Session 可继续使用。
3. 非 `23503` IntegrityError 原抛；revision mismatch 仍优先为 `REVISION_CONFLICT`，active user 仍为 `USER_ACTIVE`。
4. 引用事务先持有未提交 FK row 时，delete 必须被观测为等待；引用提交后 delete precheck 返回带 references 的 `USER_IN_USE`，User/reference 保留。
5. delete 已持有 User row lock 并通过零引用 precheck 时，后发引用写入必须被观测为等待；delete 提交后引用写入得到真实 FK `23503`，最终无 User、无引用、无悬空记录。
6. 两个锁序测试使用 test-only event/barrier、数据库 wait 证据和有界 timeout，不使用 `sleep`；delete command `23503 -> USER_IN_USE` 另由已提交引用加定向绕过 counter 的独立 sentinel 证明。
7. 当前 `_USER_STATE_LOCK`、row lock 与永久删除声明上下文不改变。

### 8.3 Frontend

1. exact code + `body.username` 产生 inline username error、`aria-invalid`、focus 和 request ID。
2. username/display name/account type 保留，temporary password 清空；修正 username 后必须重新输入密码并显式提交。
3. malformed/missing details、unknown loc 和其他 code 不猜字段，走 summary 并保留 request ID；密码仍清空。
4. duplicate 不进入 revision conflict/delete 409 freeze，不出现 reload，不自动 replay，不调用成功 invalidation。
5. 成功创建的现有关闭、reset、query invalidation 行为保持不变。

### 8.4 Contract/documentation

1. OpenAPI、runtime metadata、generated schema 与 response occurrence/signature 无 diff且门禁通过。
2. database contract、Frontend V2 行为文档与两份稳定 spec 各自在自己的 owner 内同步，内容与代码/tests 一致。
3. 代码 diff 不包含迁移、权限、状态机、删除规则、全局 handler 或无关前端视觉改动。

## 9. 取舍与拒绝方案

| 方案 | 决策 | 原因 |
| --- | --- | --- |
| 继续 `REVISION_CONFLICT` | 拒绝 | create 无 revision，恢复语义错误 |
| 只靠预检 | 拒绝 | 存在 TOCTOU，PostgreSQL unique 才是最终权威 |
| 捕获所有 23505 为 username duplicate | 拒绝 | 会掩盖 PK/未来约束，破坏 unknown 边界 |
| 全局 constraint registry | 拒绝 | 单一 identity command 不需要跨域第二 owner |
| OpenAPI code enum | 拒绝 | 会把开放业务 code 集合变成跨域公共类型并产生无必要 generated churn |
| duplicate 自动改名或 replay | 拒绝 | 改变用户输入，且 temporary password 不应自动保留或重放 |
| delete fallback rollback 后重查 references | 拒绝 | 第二次分类存在时点歧义，且改变既有合同 |
| 为构造 FK race 移除锁 | 拒绝 | 测试不能削弱 production 数据完整性 |

## 10. 停止、review 与回滚边界

- current head catalog 若不存在精确 `uq_users_username`，停止；不得接受别名或自行 migration。
- 真实 race 若不能观察 `23505 + uq_users_username`，先诊断测试编排/数据库隔离，不添加 fuzzy mapper。
- delete `23503` sentinel 若只能通过改变 production lock/schema 才能触发，停止并报告，不扩实现。
- 任一 required gate 最多两次 `repair -> targeted re-check`；相同根因重复或第二次仍失败即停止。
- 正式 contract gate 在 targeted checks 全部通过后的候选上只运行一次。
- 独立 review 一次完整检查，最多一次针对修复路径的 re-review；仍有 MEDIUM 以上问题即停止。
- mapper/前端/docs/spec 必须作为同一 T3 原子 diff 回滚；OpenAPI/generated/router/ORM model/database schema 始终不进入该回滚单元。
- 当前 T3-C 只在 targeted re-review 通过后申请用户批准；批准后另建 implementation child，本任务自身永不 start。
