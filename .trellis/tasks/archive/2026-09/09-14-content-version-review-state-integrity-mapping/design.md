# Content Version review state IntegrityError mapping 设计

## 1. 设计目标

本设计把两条 ContentVersion review-state partial unique 约束放在同一个 `review.transition_content_version` command transaction 中审查，但只为能够从结构化 diagnostics 唯一证明业务含义的 pending 冲突建立领域映射。approved 冲突继续保留 unknown 边界，因为 constraint identity 不能证明 canonical approved winner。

设计遵循三个不变量：command owner 对失败事务负责 root rollback；service 业务 precheck 在任何数据库写入/flush 前保持优先级，权限继续由 router/dependency 在 command 调用前拒绝；前端只按结构化 error code 进入专用恢复状态。

## 2. 后端边界

### 2.1 本地精确 classifier

在 `backend/app/services/review.py` 内复用项目现有的结构化 diagnostics 读取方式，保持 classifier 为无副作用的局部函数或等价局部逻辑。它只判定：

```python
sqlstate == "23505"
and constraint_name == "uq_content_versions_one_pending_per_task"
```

classifier 不 rollback、不查询数据库、不解析异常字符串、不做 index alias，不把 approved 或其他 `23505` 合并为通用冲突。`orig`/`diag`/字段缺失也视为 unknown。

### 2.2 command-scoped catch

保持现有读取、锁定与 precheck 顺序不变；只把可能产生 review-state constraint failure 的写入、显式 flush 和最终 commit 包含在窄 `try/except IntegrityError` 中。catch 规则：

1. 对 root Session 执行 `rollback()`，清除 failed transaction，并恢复本 command 的所有未提交写入。
2. 只有 action 为 submit-review 且 classifier 精确命中 pending pair，抛出既有 `AppError` 形状的 409 `CONTENT_REVIEW_PENDING`。
3. approved exact pair、错误 action、其他 constraint/sqlstate 或 diagnostics 缺失均使用 bare re-raise，保持原始 `IntegrityError` 的 traceback/identity，由现有 unknown 500 边界处理。

不能在 catch 后 commit、重放 command、查询 winner 或重建“成功”结果。command 已经消费 root transaction；若未来真实调用方需要组合外层事务，必须由外层另行定义 savepoint 合同，不在本 Task 引入。

### 2.3 precheck 顺序

保持 service 内下列顺序和现有 code/message/details/status：目标 ContentVersion 锁定与存在性、`expected_revision`、ContentTask 锁定与 current pointer、状态转换、request-changes 输入、质量门禁。权限仍由 submit 的角色依赖和 approve 的 router account-type 检查在调用 `transition_content_version` 前拒绝；不向 service 新增或复制权限判断。新增 catch 不包裹或改写这些错误，不改变 Task/Version 锁。

### 2.4 成功路径

成功 submit-review 和 approve 继续使用现有状态更新、revision 递增、ContentReviewRecord、approve SUCCESS AuditLog 及一次最终 commit。不得为冲突处理改变 ContentTask pointer/revision 或 dispatch 规则。

## 3. 事务可观察性设计

### 3.1 pending 冲突 fixture

在真实 current-head PostgreSQL 中建立同一 task 已有一个 `PENDING_REVIEW` version、current pointer 指向另一个可 submit 的 DRAFT version。对目标执行 submit-review，使最终 flush/commit 真实命中 pending partial unique。失败前后拍摄并比较：目标 version、已有 pending version、task pointer/revision、review records、audit logs，以及可观察的 dispatch 副作用。

### 3.2 approved 冲突 fixture

approved 失败必须发生在旧 approved 已被 command 标记为 `SUPERSEDED` 并 flush、目标已准备转为 `APPROVED` 的晚期窗口。测试需使用受控、一次性的 PostgreSQL 测试装置制造 exact approved unique violation，同时不修改 schema/migration、不削弱生产锁、不把装置带入 production 代码。若在这些限制内无法稳定命中 exact index，则停止并报告，不以 mock 或错误 constraint 替代事务证明。

失败前后比较原 approved/目标 version、ContentReviewRecord、SUCCESS AuditLog、task pointer/revision 及其他写入；随后使用同一个 request Session 执行查询，证明 rollback 后可复用。

### 3.3 catalog 与 diagnostics 证据

测试/诊断从 current-head PostgreSQL 的 catalog 读取两条 index 的名称、唯一性、列和 predicate，并从真实 `IntegrityError.orig` 读取 `sqlstate` 与 `diag.constraint_name`。静态 ORM/migration 只作候选证据，不替代运行时观测。

## 4. HTTP 边界

pending exact conflict 通过既有 ErrorEnvelope 返回固定 409/code/message/details，复用 router 传入的 request ID，断言 body `error.request_id` 与 `X-Request-ID` 相同。

approved exact 和其他 unknown 通过真实 HTTP boundary 验证 status 500 与 no-leak：响应不得包含 SQL、表名、constraint、driver message 或 stack。测试只断言 generic/no-leak 行为，不把默认 500 的 JSON body、code、media type 固化为公共合同。

OpenAPI、router metadata、unit contract inventory、generated schema 均保持零 diff；现有 unit 文件只运行，不修改。

## 5. 前端状态设计

### 5.1 纯投影

在 `content-editor.model.ts` 中增加一个 code-only 的 editor recovery/blocker 投影，至少区分 `revision` 与 `content-review-pending`。它复用 `mapContentEditorError` 的结构化字段，但必须先安全处理 malformed `details`；只对 exact `CONTENT_REVIEW_PENDING` 产生 pending blocker，保留原始 code/message/可选 request ID，不从 message 推断。

其他 code、非标准 payload 或缺 request ID 继续走既有 generic error fallback。不得引入全局 error enum/registry 或第二套 API error type system。

### 5.2 Content Editor 生命周期

pending blocker 与既有 revision blocker 共享必要的“冻结 canonical + 显式 reload”基础行为，但 UI 文案和语义必须明确区分：

- submit failure 时不关闭 Dialog，保留其本地 comment；
- blocker 存续时 submit button 禁用，阻止第二次 POST；
- 取消/暂停该 editor context 的背景 query 自动采用；
- 显式 reload 失败不清除 blocker、comment、code/request ID；
- reload 成功后才 reset 为新 canonical context，并清除 blocker；
- 不自动 replay submit。

现有 revision conflict 行为保持不变。可以复用 notice 结构，但 title/body 必须根据 blocker kind 区分，不能把 pending 显示成 revision conflict。

### 5.3 Content Review Page

approved exact 在后端仍为 500，因此页面现有“仅 409 才刷新 canonical”的分支理论上不会触发。新增 component regression 证明一次 approve POST 后显示 generic server failure，不刷新/replay approve，也不选择其他 approved version。只有测试证明当前 production 行为不满足时，才允许最小修改 `content-review-page.tsx`。

## 6. 测试结构

Backend integration 文件同时承担：纯 classifier matrix、真实 PostgreSQL index/diagnostics、pending/approved HTTP 和 transaction rollback、Session 复用、成功路径及 service precheck priority 对照；权限通过 HTTP 403 且 command/flush/commit 未调用来验证现有 router/dependency owner。复用现有 fixture 与 request-ID/no-leak 模式；不得为命中冲突削弱生产锁或迁移。

Frontend model tests 覆盖 exact/negative/malformed 投影；Editor component tests覆盖 Dialog/local state、背景 context、reload failure/success、POST once；Review Page component test 覆盖 approved unknown 5xx generic/no replay。

## 7. 稳定文档同步

- `error-handling.md`：记录 review pending exact pair 的唯一领域映射与 approved/unknown 原抛。
- `database-guidelines.md`：只记录同一 command transaction 的 constraint owner、root rollback 和两类失败的完整原子性；不重写数据库合同。
- `state-management.md`：记录 Editor pending blocker 的本地状态/背景 canonical/reload/no replay，以及 Review Page approved 5xx generic 行为。
- Frontend V2 文档：细化 submit pending 与 approve unknown 500 的业务动作恢复语义。

`contracts/database.md` 仍是数据库公共合同且保持零 diff；不在多个文档复制 index DDL。

## 8. 风险与停止条件

- PostgreSQL catalog 与静态定义不一致：停止，不新增 migration 或兼容 alias。
- approved exact fixture 无法在不破坏锁/schema 的前提下真实触发：停止并报告证据，不用 mock 冒充 transaction proof。
- exact pending 需要改变公共 status/schema/generated type：停止，另建 contract-first Task。
- catch 改变 precheck、权限、状态机或需要 winner inference/replay：停止。
- default 500 的具体 envelope 可能由运行时中间件决定；只证明 no-leak 和 generic 行为，不把当前偶然形状写入合同。

## 9. 回滚策略

实施 diff 应保持 owner 局部：后端移除 review command 的 classifier/catch 即恢复旧行为；前端移除 pending blocker 投影/分支即恢复旧行为；测试和稳定文档同步反向删除。数据库无 migration、无数据修复、无公共合同生成物，因此不需要部署级数据回滚。
