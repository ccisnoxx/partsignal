# 发布核验最终权威设计

## 1. 不变量

核验资格不是 `PublicationWork.status` 的单变量函数。服务端必须同时使用当前 status 与最新 `PublicationWorkEvent.action`：

```text
status ∈ {AWAITING_VERIFICATION, ACTION_REQUIRED}
AND latest_event.action != CONTENT_VERSION_CHANGED
AND 当前结果字段完整
```

其中 `CONTENT_VERSION_CHANGED` 是显式 stale-result barrier。它之后只有 `register_publication_result` 追加的 `RESULT_REGISTERED` 能恢复核验；普通失败核验追加 `VERIFICATION_FAILED` 后仍允许当前版本继续复核，保留既有重复 FAILED 合同。

## 2. 权威 owner

`backend/app/services/publication_queries.py:publication_work_actions` 继续拥有 status/event 到 `available_actions + primary_task` 的唯一映射。实现只扩展现有 `CONTENT_VERSION_CHANGED` 分支，使其同时覆盖：

- `AWAITING_VERIFICATION`：登记结果后、首次核验前切换版本。
- `ACTION_REQUIRED`：失败核验后修订并切换版本。

不创建新状态、布尔字段、helper class 或数据库列。Frontend继续直接消费同一 typed projection。

## 3. verification command 数据流

写路径按以下顺序执行：

1. `_lock_work` 以 `SELECT ... FOR UPDATE` 锁 Work，并先比较 `expected_revision`。
2. `_work_event` 在 Work 锁序列内显式生成事件时间，并以上一事件时间加 1 微秒作为下限，避免 PostgreSQL `now()` 的事务起始语义把后执行命令排到前面；现有 `created_at DESC, id DESC` 因而继续表达真实命令顺序。
3. 在取得 Work 锁后，按 `created_at DESC, id DESC` 读取最新 WorkEvent；应用内其他发布命令同样先锁 Work，因此等待后的查询能看到前序命令已提交事件。
4. 最新事件不存在时返回 `PUBLICATION_CONTEXT_INCOMPLETE`。
5. 调用 `publication_work_actions(work.status, latest_event.action)`；若不含 `VERIFY`，返回 `INVALID_STATE_TRANSITION`，中文 message 明确要求重新登记发布结果。
6. 资格通过后再执行现有结果字段完整性、ContentTask锁、Verification append 和 PASSED/FAILED分支。

命令不得自行复制“status + event”的另一张资格表，也不得调用前端 token或信任旧 read response。

## 4. 状态与历史保持

换版仍只更新 `content_version_id`、`content_hash`、revision并追加带 old/new版本ID的事件。旧 `actual_title/final_url/published_at` 不清空，因为当前稳定合同明确把事件 barrier 作为“必须重新登记”的权威，清空字段会把同一个业务规则复制到可空字段，并改变Workspace显示语义。

拒绝发生在创建 Verification、修改 Work/Task 或写 Audit 之前。`AppError` 通过现有 FastAPI handler进入冻结的 ErrorEnvelope；不新增错误 schema或error code。

重新登记会覆盖结果字段并追加 `RESULT_REGISTERED`。之后 read projection与command均重新允许VERIFY；成功核验创建的 Verification必须绑定当前 `work.content_version_id`，PublishedArticle继续读取该 PASSED snapshot。

## 5. 测试设计

### Unit

在 `test_security_and_publication.py` 扩展 action matrix：

- `AWAITING_VERIFICATION + CONTENT_VERSION_CHANGED` 与现有 `ACTION_REQUIRED` 断言一致。
- `AWAITING_VERIFICATION + RESULT_REGISTERED`、`ACTION_REQUIRED + VERIFICATION_FAILED` 继续含VERIFY。
- 其他状态动作集合不受影响。

### PostgreSQL service integration

在现有失败→换版闭环中，换版后、重新登记前直接调用 `verify_publication_work`，断言 `INVALID_STATE_TRANSITION` 与完整零副作用快照；随后继续现有重新登记和成功核验，证明恢复路径未破坏。

另构造合法 `AWAITING_VERIFICATION` 换版场景，证明相同 barrier 不只存在于失败路径。测试可以使用真实业务服务建立工作/登记结果，并创建满足现有 switch candidate合同的当前批准版本；不得直接调用动作helper冒充命令覆盖。

### HTTP integration

至少一个场景通过真实 FastAPI route、session dependency、CSRF 和 PostgreSQL提交 `POST /api/v1/publication-works/{work_id}/verifications`，断言409 ErrorEnvelope的code与request_id。HTTP测试不得mock `verify_publication_work`。

## 6. 文档与兼容性

- 在发布工作台稳定规范中明确：无论换版前为 `AWAITING_VERIFICATION` 还是 `ACTION_REQUIRED`，最新事件为 `CONTENT_VERSION_CHANGED` 时都必须先登记结果。
- OpenAPI已经声明verification endpoint及409 ErrorResponse，不改变shape。
- 数据库已有WorkEvent与Verification外键，不新增migration。
- Frontend generated types与Action Registry不变；read projection修正后自动撤回错误按钮。

## 7. 风险与回滚

- 风险：最新事件排序若与read model不一致会造成read/write分歧。命令查询必须复用现有 `created_at DESC, id DESC` 规则。
- 风险：较早开启、较晚取得 Work 锁的事务会让 PostgreSQL `now()` 早于前序已提交事件。事件 writer 必须在锁内维持严格单调时间，并由双 Session 回归冻结。
- 风险：过度收紧可能禁止 `VERIFICATION_FAILED` 后直接复核。测试必须冻结该既有合法路径。
- 回滚点仅为两个service文件的局部逻辑；无schema、迁移或数据回填，回滚不需要数据操作。
- 若实现发现存在不经Work锁追加事件的写路径，应停止并回到规划，不在本 Task 内引入第二把锁或扩大状态机。
