# Identity IntegrityError 领域映射设计

## 1. 设计目标与权威边界

本设计把获批 T3-C 合同落到最小 owner：PostgreSQL 约束负责最终 identity 裁决，identity service 负责 command-scoped 领域映射，前端纯 mapper 负责结构化字段投影，Dialog 负责安全草稿恢复。OpenAPI、router metadata、generated client 和通用错误边界均保持不变。

```text
POST createUser
  -> service normalize + duplicate precheck
  -> add User + flush
     -> success: audit + commit
     -> 23505/uq_users_username: rollback + USER_USERNAME_EXISTS
     -> other IntegrityError: re-raise -> existing default 500 boundary
  -> ErrorEnvelope
  -> create-user mapper (exact code + exact loc)
  -> username inline error or form summary
  -> preserve safe draft, clear secret, explicit retry
```

## 2. Backend username mapper

### 2.1 单一构造器

在 `backend/app/services/identity.py` 增加一个私有 `_user_username_conflict()`，唯一负责构造：

```json
{
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
  }
}
```

构造器返回 status 409 的既有 `AppError`；request ID 继续由现有错误信封边界注入。预检和 flush 捕获路径复用该构造器，防止两条路径发生字段漂移。

### 2.2 精确 diagnostics allowlist

新增 User 的既有 flush 边界只接受：

```text
orig.sqlstate == "23505"
orig.diag.constraint_name == "uq_users_username"
```

匹配后 rollback 当前失败 Session，再 `raise _user_username_conflict() from error`。其他异常保持原对象/因果链并继续抛出；不得引入文本解析、查询推断、别名或全局 registry。

create command 的 normalize、hash、默认状态、audit payload 和 commit 顺序不变。成功审计必须继续位于 User flush 成功之后，因此数据库裁决失败不能留下伪成功审计。

## 3. Username 真实竞态测试

在 `backend/tests/integration/test_identity_management.py` 内使用两个独立 Session/connection 和仅存在于测试中的 barrier，使双方都完成当前 username 预检后才继续 flush：

1. 两事务提交 normalize 后相同的 username。
2. barrier 证明双方均越过预检。
3. PostgreSQL unique constraint 决定一胜一负。
4. 败者捕获领域错误，同时保留 cause 中真实 `23505` 与 `uq_users_username`。
5. 新 Session 检查恰一 User、赢家恰一成功审计、败者 request ID 无 SUCCESS audit/部分状态。
6. 显式 rollback/cleanup 后验证失败 Session 可再次查询。

常规 HTTP duplicate 固定预检响应。竞态响应与预检响应比较 status/code/message/details，排除每次请求天然不同的 request ID。

unknown sentinel 使用真实 `23505` 但不同 constraint 证明 allowlist，缺失 diagnostics 仅作最小定向分支测试；不得用 mock 替代获批约束的真实 PostgreSQL 证据。

## 4. Delete user 不变合同与确定性证据

production `delete_user()` 不改锁、检查、映射和提交顺序；测试在既有 integration 文件内通过 test-only wrapper/event/barrier 暂停特定边界。

### 4.1 场景 A：引用先行

1. 引用事务插入真实业务 FK row 并保持未提交。
2. 启动 delete；以 `pg_stat_activity`/数据库 wait 状态确认 delete 正在等待相关锁。
3. 提交引用事务。
4. delete 继续并由引用预检返回丰富 `USER_IN_USE`：动态 message + `details.references`。
5. 新 Session 断言 User/reference 均保留，且无 `user.deleted` SUCCESS audit。

### 4.2 场景 B：delete 锁先行

1. delete 取得 User `FOR UPDATE` 并完成零引用预检后，通过 test-only wrapper 暂停。
2. 引用事务写入真实业务 FK row；确认它在数据库中等待 parent key-share。
3. 释放 delete，使其成功提交。
4. 引用事务得到真实 PostgreSQL `23503`。
5. 新 Session 断言 User 与引用均不存在，不存在悬空行。

### 4.3 独立 fallback sentinel

先提交真实业务引用，再通过 test-only wrapper 仅让 reference counter 返回零，使 delete 继续到真实数据库 flush 并由 current-head FK 产生 `23503`。断言 service/HTTP 返回固定 `USER_IN_USE` message 与 `{}`，cause 为真实 23503；rollback 后 User/reference 均保留、无成功删除审计，Session 可继续查询。

三个场景均使用 event/barrier、数据库 wait 证据和有界 timeout；不得用 `sleep` 近似先后关系。任何预期 wait、异常或最终状态未在 timeout 内出现即测试失败。

## 5. Frontend 投影与 Dialog 状态

### 5.1 纯 mapper

在 `user-list.model.ts` 增加 create-user 专用纯 mapper。输入为 generated `ErrorDetail` 形状，输出为：

- canonical duplicate：username 字段 message、request ID，无 summary fallback；
- 非 canonical/malformed：form summary message、request ID，无字段定位。

只有 exact `USER_USERNAME_EXISTS` + exact `['body','username']` 成立时返回字段错误。mapper 不导入 `UserRequestError`，不依赖 HTTP class，不建立跨域框架，也不从 message 猜分支。

### 5.2 CreateUserDialog

失败时统一：Dialog 保持打开，保留 username/display_name/account_type，清空 temporary_password，并 reset mutation failure state 到允许显式重试的现有路径。canonical duplicate 额外 `form.setError('username', ...)` 并聚焦 username；其他错误显示 form summary。两种呈现均展示 request ID。

duplicate 不复用 revision helper，不进入 reload/freeze，不调用 `onCreated()`。成功路径的 close、form reset 与 users query refresh/invalidation 原样保持。

## 6. 文档 owner

- `contracts/database.md`：记录 normalized username、约束名、`23505 + exact constraint` 到领域 code 的映射和 unknown 边界。
- Frontend V2 行为文档：记录 exact code/loc、safe draft、secret 清除、focus、request ID、显式 retry 与禁止 reload/replay/invalidation，以及 delete 合同不变。
- backend database spec：记录 command allowlist、flush/audit/rollback 和真实 PostgreSQL 证据要求。
- frontend state spec：记录 create Dialog 字段恢复、secret 清除和 malformed fallback。
- backend error-handling spec 继续只拥有通用 diagnostics/unknown/ErrorEnvelope 规则，保持零 diff。

## 7. 精确文件边界

### 7.1 可修改

- Backend production/test：`backend/app/services/identity.py`、`backend/tests/integration/test_identity_management.py`
- Frontend production/test：`frontend/src/domains/identity/user-list.model.ts`、`user-list.model.test.ts`、`user-list-page.tsx`、`user-list-page.test.tsx`
- Docs/specs：`contracts/database.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`

### 7.2 只读零 diff

`contracts/openapi.yaml`、`backend/app/routers/identity.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`backend/app/errors.py`、`backend/app/models/identity.py`、`backend/app/migration_schema_v1.py`、`frontend/src/domains/identity/user.api.ts`、`frontend/src/shared/api/generated/schema.d.ts`、`.trellis/spec/backend/error-handling.md`。

若实现证据要求修改任一只读 owner，立即停止并回到 contract review。

## 8. Validation 设计

Required validation 分为：真实 PostgreSQL integration、现有 contract/runtime 回归、backend touched static、frontend targeted behavior/type/lint、一次正式 contract gate、只读 owner 零 diff和 allowed files whitespace 检查。

完整 backend unit、frontend 全套、build 与 E2E 默认 optional。只有证据扩大风险、用户明确要求或 release readiness 才运行；`make verify` 若被选为 full gate，替代而不是追加 `make contract-check`。

## 9. 取舍

- 不继续 `REVISION_CONFLICT`：create 没有 revision，且前端恢复语义不同。
- 不只靠预检：TOCTOU 必须由数据库唯一约束最终裁决。
- 不捕获全部 23505：会掩盖 PK/未来约束并破坏 unknown 边界。
- 不增加 OpenAPI code enum：现有 wire/status 已表达响应，新 enum 会制造无必要 generated churn。
- 不自动改名或 replay：会改变用户输入，并可能重放 secret。
- 不为 delete 测试移除锁：测试必须证明而不是削弱数据完整性。

## 10. 回滚与停止

允许修改文件作为一个原子 diff 回滚；只读 owner、schema 和生产数据从未进入回滚单元。catalog/diagnostics 不一致、需要公共合同变更、真实并发无法确定性复现、delete fallback 需要削弱 production 约束，或 review/validation 超出既定收敛上限时停止，不添加模糊兼容。
