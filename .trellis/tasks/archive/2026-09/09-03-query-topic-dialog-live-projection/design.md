# Query Topic Dialog 实时投影设计

## 1. 设计目标

让 Query Topic 查看引用与删除 Dialog 只保存用户操作意图，不保存服务端行副本；当前 exact list query 成为名称、引用、动作、删除条件与 revision 的唯一 owner。保持编辑表单草稿和 409 显式 fresh reload 的既有语义。

## 2. 状态边界

| 状态 | Owner | 说明 |
| --- | --- | --- |
| 当前列表行 | TanStack Query：`queryTopicListQueryOptions(search)` | 唯一 live projection；只查当前 exact key |
| 查看/删除意图 | React local state：`{id, focusReturn}` | 只表达目标身份和焦点返回，不复制服务端字段 |
| 编辑/创建草稿 | React Hook Form + Editor local state | 继续冻结打开基线；被动列表刷新不覆盖 |
| 删除 mutation | `useMutation<{id, expectedRevision}>` | variables 在确认瞬间从 exact query 固化 |
| 409 freeze | mutation error | 被动投影更新不 reset；显式恢复成功才解除 |

不新增全局 store、query key、Detail 请求、轮询、canonical 副本或跨域抽象。

## 3. 页面派生流

页面保留 `referenceIntent` 与 `deleteIntent`，并在每次 render 从 `topics.data?.items` 按 ID 得到 `referenceTopic` / `deleteTopic`：

```text
RowActions click
  -> intent { id, focusReturn }
  -> current exact list data.find(id)
  -> Dialog renders current name/references/actions/deletion/revision

window visibility returns
  -> exact list refetch
  -> TanStack Query replaces page projection
  -> same intent resolves updated row
  -> open Dialog updates in place
```

如果 search 的 exact query identity 改变，清除两个 intent。若成功列表响应不再含该 ID，也清除 intent。关闭阶段的 `finalFocus` 才检查 `focusReturn.isConnected`；目标行消失时返回 `null`，不猜测替代焦点。

编辑 `EditorTarget` 不纳入上述派生。它的表单初值、revision baseline、dirty 草稿与 409 恢复是一次编辑会话的本地状态，若跟随列表被动更新会丢失用户输入。

## 4. 查看引用 surface

`QueryTopicReferencesDialog` 接收 intent 与当前派生 topic，所有名称、三类 count、canonical links 及 `deletionGuidance` 来自同一 topic。背景 refetch 期间可继续显示旧 data；refetch 失败时页面既有错误 banner 说明数据陈旧，Dialog 不伪装为刷新成功。

目标从成功新投影消失时关闭并清 intent。Dialog Root 不使用随行字段变化的 `key`，避免破坏 Base UI 关闭动画和焦点恢复。

## 5. 删除 surface 与确认

删除 Dialog 每次 render 计算：

- `blockers = current.deletion?.blockers ?? []`；
- `hasDeleteProjection = current.deletion !== null && current.available_actions.includes('DELETE')`；
- `canDelete = !topics.isFetching && !topics.error && !conflict && hasDeleteProjection && blockers.length === 0`。

投影转换：

| 最新投影 | Dialog 行为 |
| --- | --- |
| DELETE + 空 blockers | 显示最新名称的确认说明和确认按钮 |
| 非空 blockers | 保持打开，显示最新名称、引用数量/链接和阻断说明；不显示可执行确认入口 |
| `deletion=null` 或无 DELETE 且无 blocker 明细 | 保持打开，显示“服务端当前未提供删除资格”；不显示可执行确认入口 |
| query fetching | 保持当前 surface，但禁用确认并表明正在刷新 |
| query error + stale data | 保持当前信息与页面错误提示，禁用确认 |
| 目标从成功投影消失 | 关闭并清 intent；不发送 DELETE |

确认 handler 不信任 render 闭包中的行。它使用当前 exact query key 同步读取 `getQueryState/getQueryData`，再次拒绝 fetching、error、missing、`deletion=null`、无 DELETE 或 blockers 非空；通过后才调用 mutation，并把当次 `current.id/current.revision` 固化为 variables。服务端仍会在锁内重新校验权限、revision 与引用。

## 6. 409 与显式恢复兼容

删除 `409` 后 `remove.error` 保持 conflict freeze。窗口聚焦或其他 invalidation 可以更新 Dialog 名称、引用、动作和 revision，但不得调用 `remove.reset()`，因此不会被动恢复确认或 replay。

用户点击显式 reload 时：

1. 继续调用 `fetchFreshQueryTopics(queryClient)`，先取消 exact options 在途请求，再以 `staleTime: 0` 发起新的 `/api/v1/query-topics` GET；
2. 校验目标仍存在，并触发/等待当前 exact list query 校准，使 references 与删除 surface 来自当前列表投影；
3. 任一步失败都保留 conflict freeze 与真实错误；
4. 两步成功后才 `remove.reset()`，显示已读取当前 revision，并等待用户再次确认；
5. 再次确认仍从 exact list query 同步读取当时 revision，不使用 reload 时保存的本地副本。

这保留前序任务的点击后网络新鲜度，并消除本地 revision 第二来源。若两次读取之间再次发生竞态，confirm-time current revision 与服务端锁仍负责拒绝或接受，不自动重放。

## 7. 测试设计

扩展现有 generated-type fixture controller：

- `setProjection(id, patch)` 更新 `currentItems` 中指定行；
- `removeProjection(id)` 从 `currentItems` 移除目标；
- 继续记录 list/options/mutation requests，并保留未声明 API 与 runtime error 失败边界。

Playwright 使用项目已有 synthetic `visibilitychange` 模式触发 `refetchOnWindowFocus: 'always'`，覆盖：

1. 引用 Dialog 名称、count、link/guidance 实时更新；
2. 删除 Dialog从可删切到 blocker，再恢复并以最新 revision 删除；
3. fetching/error/missing 不发送 DELETE，missing 不残留可复现 intent；
4. 409 后被动更新不解冻，显式 reload 保留 fresh options 请求、失败冻结和人工二次确认；
5. 编辑草稿在被动刷新后不被覆盖；
6. 既有键盘焦点与四档宽度回归。

## 8. 兼容、回滚与边界

- 不修改 API schema、generated types、backend、数据库、HTTP 或权限合同。
- 不改变 `queryTopicsQueryOptions()` / `queryTopicListQueryOptions()` 的全局缓存配置。
- 不修改其他领域 Dialog；复制的是已批准的局部模式，不抽通用层。
- 产品代码预计只触及 `query-topic-list-page.tsx`；fixture/spec 只增加可控投影与行为断言。
- 如实现需要公共合同、新 endpoint、全局 store、跨域抽象或修改编辑草稿语义，停止并返回规划阶段。
- 回滚可按三个 task-scope 文件整体撤销；无迁移、持久化数据或部署状态需要恢复。
