# Query Topic Dialog 投影所有权审计

## 结论

缺口位于 `frontend/src/domains/geo/query-topic-list-page.tsx` 的页面本地 target 所有权：查看引用 target 保存完整 `QueryTopicListItem`，删除 target 保存名称与 revision。`queryTopicListQueryOptions(search)` 虽会在窗口聚焦时强制 refetch，Dialog 仍继续消费打开瞬间的副本。

最小修复 owner 是 Query Topic 列表页本身：本地 intent 只保存稳定 ID 与焦点返回点，Dialog 每次 render 从当前 exact list query data 按 ID 派生行。无需修改 API、后端或缓存时长，也不应建立通用 Dialog framework。

## 当前数据流与缺口

| 路径 | 当前来源 | 缺口 |
| --- | --- | --- |
| 列表 | `queryTopicListQueryOptions(search)` / `geoKeys.topicList(params)` | 已配置 `refetchOnWindowFocus: 'always'`，本身可获得跨标签新投影 |
| 查看引用 | `ReferenceTarget.topic` 完整行副本 | 名称、三类引用与 deletion guidance 不随 list query 更新 |
| 删除确认 | `DeleteTarget.question/revision` | 名称和 DELETE payload 使用旧快照；动作/blockers 变化只有提交后才可能由服务端拒绝 |
| 编辑表单 | `EditorTarget.topic` 打开基线 + RHF 草稿 | 本地草稿刻意冻结；不属于本 Task 的被动 live projection |
| 409 恢复 | `fetchFreshQueryTopics()` | 前序 Task 已保证点击后 fresh full-options GET；不得删除、弱化或自动 replay |

## 规范与已实现模式

- `.trellis/spec/frontend/state-management.md:85-110` 已定义删除 intent-by-ID、exact query 派生、confirm-time current revision、fetch/error guard、409 freeze 与断开焦点处理。
- `platform-list-page.tsx`、`platform-types-page.tsx` 与 `platform-workspace-page.tsx` 已实现同类模式；对应 Playwright 通过 synthetic `visibilitychange` 验证聚焦刷新后的名称、blockers、资格与 revision。
- `component-guidelines.md:250` 禁止用会在关闭过程中变化的 Dialog Root `key` 清理状态；焦点应在关闭完成时检查原节点是否仍连接。
- `available-actions-contract.md` 明确 Query Topic 的 `available_actions/deletion/references/revision` 来自服务端权威投影，前端不得按引用计数或角色推导删除资格。

## 已确认设计决定

1. 查看引用与删除 intent 只保存 `{id, focusReturn}`；不复制服务端字段。
2. 当前 exact query key 改变或目标从当前投影消失时清 intent；不扫描其他页 cache。
3. 删除资格变化时不关闭 Dialog，而是原位切换为最新阻断/不可执行说明；资格恢复时显示最新确认 surface。
4. confirm 同步读取 exact query state/data；fetching、error、missing 或矛盾删除投影均不发请求。
5. 删除 mutation variables 固化确认瞬间的 `{id, expectedRevision}`；409 被动刷新只更新展示，不解冻。
6. 显式 reload 保留 fresh full-options GET，并校准当前 exact list projection；只有恢复步骤成功后才 reset 409 freeze，仍由用户再次点击确认。
7. 编辑 Dialog 的 RHF 草稿与冲突基线不接受被动 list reset。

## 测试缺口与最小覆盖

当前 `geo-topics.spec.ts` 覆盖静态引用、删除初始 revision、409 fresh reload 与焦点返回，但未覆盖 Dialog 打开后的 list refetch。Fixture 已持有可变 `currentItems`，只需暴露按 ID 更新/移除投影的方法，并复用现有 synthetic visibility transition：

- 查看引用 Dialog 打开后更新名称、引用计数和 deletion guidance；
- 删除 Dialog 打开后先转为 blockers surface，再恢复 DELETE 并提交最新 revision；
- query fetching/error 或目标消失时不得提交，目标消失后 intent 不复现；
- 409 后被动刷新仍冻结且不 replay，显式 reload 仍产生新的 full-options GET；
- 编辑草稿在被动 list refetch 后保持。

正式回归继续使用双 project production-artifact Query Topics spec；不需要 real-stack、后端或全仓 gate。
