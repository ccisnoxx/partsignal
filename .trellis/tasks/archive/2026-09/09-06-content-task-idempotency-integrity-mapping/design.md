# Content Task 幂等 IntegrityError 映射设计

## 1. 设计摘要

本任务只在普通 `content_planning.create_content_task` 的事务 owner 内补齐两个缺口：把 ordinary source kind 纳入普通 replay 判定，并在精确 `uq_content_tasks_idempotency_key` 唯一约束失败后由 caller rollback、查询和重验 winner。沿用现有 advisory lock、`ContentTask` 模型、`AppError` 与 request middleware，不修改 GEO command、router、公开 API 或数据库 schema。

## 2. 当前问题

### 2.1 普通 lookup 没有排除 GEO winner

普通 command 当前只比较 `product_id`、`fact_version_id`、`platform_profile_id`。GEO command 写入相同表和 idempotency key，并另存一对一 `ContentTaskGeoSource`。因此三个目标字段相同时，普通 command 会错误 replay GEO 任务。

### 2.2 普通 caller 没有恢复数据库最终 race

advisory lock 能串行遵守同一 namespace 的正常 writer，但数据库唯一约束仍是所有 writer 的最终权威。若 writer 绕过锁协议，候选普通 task 可在 lookup 与 flush 之间遇到真实 `23505`。当前 `add_locked_content_task` 直接 flush，`create_content_task` 没有精确 catch/rollback/winner recovery。

## 3. 所有权与不变量

| 责任 | 权威 owner | 本任务处理 |
| --- | --- | --- |
| 普通请求 identity | `ContentTaskCreate` 三字段 + ordinary source kind | 在 `content_planning.py` 内集中判定，不新增公开 DTO |
| GEO source identity | `geo_observation.create_geo_optimization_content_task` + `ContentTaskGeoSource` | 只读；仅作为普通 winner 的负例 |
| 正常同 key 串行 | 现有 transaction advisory lock | 保持，测试证明后到者不 insert |
| 精确 diagnostics 分类 | `content_planning.py` 的表内私有 classifier | 只接受固定位置的 `23505 + uq_content_tasks_idempotency_key` |
| rollback 与 winner 恢复 | `create_content_task` caller | 精确命中后 root rollback，再查询和重验 |
| HTTP envelope/request ID | 既有 `AppError` handler 与 request middleware | 零代码 diff，以 HTTP 测试验证 |
| 成功和失败副作用 | 普通 ContentTask 创建事务 | 新建成功仍按现有 commit；replay/conflict/unknown 不增加副作用 |

## 4. Canonical identity 判定

普通 identity 的三个目标字段都必须等于请求值，且 `ContentTaskGeoSource` 不存在。ordinary source kind 是 command discriminator，不是第四个 API 字段，也不得加入 `ContentTaskCreate` 或 generated client。

普通 pre-insert lookup 与 exact-race recovery 必须共享相同的“是否为普通同 identity”判断口径：

- 无 GEO source 且三字段全等：same ordinary identity；
- 存在 GEO source：different command/source kind，返回既有冲突；
- 无 GEO source但任一完整字段不同：different ordinary identity，返回既有冲突；
- 仅在 exact-race recovery 中，winner 缺失或必需字段不可验证：unknown，原抛最初 `IntegrityError`。

`platform_profile_id` 允许因历史删除而变为 `NULL`，但请求字段非空；exact-race recovery 中该状态不足以可靠证明本次 winner 的冻结 identity，应按不可验证处理并原抛。正常 pre-insert lookup 的既有 task 不等于当前请求时仍返回幂等冲突。

## 5. 精确 classifier

新增或整理一个表内私有、无副作用 helper，只读取：

- `error.orig.sqlstate`；
- `error.orig.diag.constraint_name`。

只有二者分别精确等于 `"23505"` 和 `"uq_content_tasks_idempotency_key"` 才返回已知。helper 不执行 rollback、查询、source 判断、HTTP 映射或异常吞噬；不读取替代属性或 message。`content_planning.py` 已因平台 slug mapping 导入 `IntegrityError`，无需跨模块错误 registry。

## 6. 目标流程

### 6.1 普通 lookup

1. 获取现有 `content-task-create:{key}` transaction advisory lock。
2. 按 key 查询 `ContentTask`。
3. 未命中则进入现有资源锁定与资格校验。
4. 命中则查询该 task 是否存在 `ContentTaskGeoSource`，再按第 4 节判定：same ordinary identity replay；否则抛准确 `IDEMPOTENCY_CONFLICT`。

### 6.2 候选 insert 与 exact-race recovery

1. 按现有 platform → product → fact 顺序锁定和校验资源。
2. 调用现有 `add_locked_content_task` 构造并 flush 候选。
3. 非 `IntegrityError` 维持现有传播。
4. 捕获 `IntegrityError` 后先分类：非精确 idempotency constraint 立即原样抛出。
5. 精确命中时保存原异常并 `db.rollback()`。
6. rollback 后按 key 重新加载 winner；缺失则原抛。
7. 先检查 identity 可验证性，再查询 GEO source kind。
8. same ordinary identity 返回 winner；字段完整但不同或存在 GEO source 时抛既有 `IDEMPOTENCY_CONFLICT`；不可验证时原抛。
9. 仅新建成功且 `commit=True` 时执行现有 commit；replay 不 commit、不 dispatch。

不把 rollback 放入 `add_locked_content_task`：该 helper 也是 GEO command 的构造入口，改变其事务语义会跨越本任务 owner。恢复必须留在普通 caller 对该调用的局部边界。

## 7. 并发模型

| 场景 | 仲裁机制 | 预期路径 | 结果 |
| --- | --- | --- | --- |
| 顺序同 key、同普通 identity | 普通 lookup | 命中、无 GEO source | 同 Task、`201` |
| 顺序同 key、异 identity | 普通 lookup | 完整字段不同 | `409 IDEMPOTENCY_CONFLICT` |
| 顺序普通请求遇到 GEO winner | 普通 lookup + source existence | source kind 不同 | `409 IDEMPOTENCY_CONFLICT` |
| 正常同 key 并发 | advisory lock | 后到者在锁后 lookup | 一次 insert、同 Task、`201` |
| 绕过 advisory protocol 的 writer race | PostgreSQL unique constraint | loser 精确 `23505` 后 rollback/requery | 同普通 identity replay；异 identity/GEO 冲突 |

测试只在受控 sentinel/race 中让另一个 Session 在普通 pre-insert lookup 后写入 winner；该机制证明数据库防御性恢复，不代表现有正常并发协议。

## 8. 错误与 HTTP 合同

已知冲突保持：

```text
HTTP 409
code: IDEMPOTENCY_CONFLICT
message: 幂等键已用于另一内容任务创建请求
details: {}
```

HTTP 级测试通过真实 middleware/handler 验证 `error.request_id == X-Request-ID`。service 不拼接 envelope 或 request ID。

以下情况重新抛出同一个原始 `IntegrityError`：非 `23505`、diagnostics 缺失、其他 constraint/index、rollback 后 winner 缺失、winner identity 不可验证。unknown 仍使用默认 500，只做“不包含 SQL、表名、constraint、数据库 message”的负面断言，不固定 body 形状。

## 9. 事务与原子性

- flush 失败后 Session 处于 failed state；只有精确已知 constraint 由普通 caller root rollback 后继续查询。
- non-matching unknown 由上层 request Session owner rollback；直接 service 测试捕获后显式 rollback 再验证可复用性。
- 候选普通创建在 flush 前只挂起一个 ContentTask；rollback 必须清除它。现有路径不创建版本、事实、审核、审计或 dispatch，测试以调用前后计数和关键字段快照证明没有间接泄漏。
- winner 的 ID、状态、revision、current pointer 和来源保持不变。

## 10. 测试设计

### 10.1 顺序与正常并发

- 扩展现有 same/different identity 测试，增加预存在 GEO winner 负例和准确错误字段。
- 保留两个独立 Session 的正常并发；通过 SQL statement 观测或等价稳定证据断言 `content_tasks` insert 只执行一次，证明后到者走 lookup。

### 10.2 真实 exact diagnostics 与 sentinel/race

- 从 current-head PostgreSQL catalog 核对 constraint 名称，并从真实 duplicate insert 捕获 `orig.sqlstate`/`orig.diag.constraint_name`。
- 用 test-only 同步点在普通 lookup 后暂停 caller；另一个不获取 advisory lock 的 Session 提交普通 same identity、普通 different identity 或 GEO winner，再释放 caller 触发真实 unique violation。
- 同 identity 返回 winner；异 identity/GEO winner 返回准确冲突；三种情况都只保留 winner 一行。

### 10.3 unknown 与恢复矩阵

- 以窄测试替身覆盖 diagnostics 缺失、非 `23505`、其他 constraint、winner missing、identity 不完整；断言重新抛出原异常对象。
- unknown HTTP sentinel 使用 `raise_server_exceptions=False` 或现有等价模式，断言 500 且响应不含敏感数据库细节。
- 已知 conflict HTTP 路径断言完整 ErrorEnvelope 与 request ID/header 一致。

### 10.4 前端与合同回归

- 运行现有 `new-content-task-page.test.tsx`；其中已经覆盖冲突后保留表单、废弃 key、下一次显式提交生成新 key，因此不新增或修改前端测试。
- 运行 `test_contract.py` 与 `test_runtime_response_metadata.py`，并执行路径级零 diff gate，证明 OpenAPI/runtime/generated/public status 不变。

## 11. 文档设计

`contracts/database.md` 只记录 schema 约束与持久化仲裁事实；`.trellis/spec/backend/database-guidelines.md` 记录 service-local 精确映射和事务恢复规则。避免在两处复制完整测试矩阵，也不把 implementation-only sentinel 写成稳定生产协议。

## 12. 停止条件与回退

- current-head catalog 名与 `uq_content_tasks_idempotency_key` 不一致时停止，不使用 message fallback；需要 schema 修复时另行规划 migration Task。
- 若 ordinary source kind 判定必须修改 `geo_observation.py`、GEO frontend、GEO incoming/shared-key policy 或双向 identity，停止并转后续 T5-C。
- 若需要新增 status/code、修改 OpenAPI/router/generated client、数据库 schema、权限或状态机，停止并回到合同决策。
- 回退只撤销本任务允许文件中的候选 diff；不使用 `git reset --hard`、`git checkout --`、stash 或范围外清理。
