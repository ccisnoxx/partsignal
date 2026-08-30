# 发布换版后核验 P0 根因与边界

## 观察事实

1. `publication_work_actions` 以 status映射动作，但换版例外只覆盖 `ACTION_REQUIRED`：`backend/app/services/publication_queries.py:88-134`。
2. `switch_publication_content_version` 允许全部非终态，保留旧结果字段，只更新版本/hash/revision并追加 `CONTENT_VERSION_CHANGED`：`backend/app/services/publication.py:544-592`。
3. `verify_publication_work` 接受 `AWAITING_VERIFICATION | ACTION_REQUIRED`，只验证结果字段，不读取最新event或动作owner：`backend/app/services/publication.py:702-770`。
4. PASSED会把当前Work版本与旧结果快照写入不可变Verification，创建PublishedArticle并完成Work/Task：同文件 `722-766`。
5. read surfaces通过最新event调用 `publication_work_actions`：`backend/app/services/publication_queries.py:395,436-479,585-690`；Workbench同样消费该owner：`backend/app/services/workbench.py:150-177`。
6. 稳定spec明确禁止旧结果核验新正文，但当前文字仅以失败后的ACTION_REQUIRED为主场景：`.trellis/spec/backend/publication-workbench-guidelines.md:330-359`。
7. 现有integration只验证read model在ACTION_REQUIRED换版后无VERIFY，再登记后恢复；没有直接尝试换版后核验：`backend/tests/integration/test_publication_workflow.py:1247-1596`。
8. `PublicationWorkEvent.created_at` 的数据库默认值是事务级 `now()`。较早开启、较晚取得 Work 锁的命令会得到更早事件时间，使 `created_at DESC, id DESC` 与真实锁序列倒置。

## 根因

服务端动作资格只有read path采用；write command没有复用。动作例外又绑定单一status，未覆盖switch命令实际允许的另一个核验状态。前端typed action减少了普通UI触发概率，但不是授权，旧客户端、并发请求或直接HTTP仍可调用command。

## 最小修复边界

- 扩展既有 `publication_work_actions` event barrier，不新增状态字段。
- verification command锁Work后读取最新event并复用该owner。
- `_work_event` 在既有 Work 锁序列内维持严格单调事件时间，不新增数据库列或第二顺序字段。
- 保留旧结果字段，通过event barrier要求重新登记。
- unit冻结动作矩阵；PostgreSQL/HTTP冻结命令拒绝、零副作用与合法恢复。
- 澄清稳定spec；OpenAPI、数据库和Frontend不变。

## 明确排除

Publication UI文案、Article合同冲突、缓存错误、永久删除、GEO、全局错误映射和contract checker均属于其他独立Task。
