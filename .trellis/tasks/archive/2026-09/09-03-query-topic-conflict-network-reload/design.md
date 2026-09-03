# Query Topic 409 显式重载网络新鲜度设计

## 1. 设计不变量

`409 REVISION_CONFLICT` 后的显式恢复只能采纳一次**由用户点击触发、且在点击之后发起**的 canonical options 请求的成功响应。

这条不变量同时排除两种旧数据来源：

1. `staleTime: 30_000` 窗口内由 `fetchQuery` 直接返回的 fresh cache；
2. 点击前已经在 exact query key 上进行、随后被 `fetchQuery` 复用的在途请求。

普通 options 消费者继续使用既有 30 秒缓存；强制网络新鲜度只属于冲突 Dialog 的显式恢复动作。

## 2. Authoritative Owners

| 责任 | Owner | 约束 |
| --- | --- | --- |
| 完整 Query Topic options 的 query key/query function | `queryTopicsQueryOptions()` | 继续作为唯一数据请求定义，不复制 `api.GET` |
| 显式冲突恢复的新鲜度 | `query-topic-list-page.tsx` 内 domain-local helper | 两个 Dialog 共享；不改变全局 query options |
| canonical 字段、revision、available actions | `/api/v1/query-topics` 成功响应 | 服务端最终权威 |
| 本地草稿与冲突冻结 | 各 Dialog 当前本地状态 | 请求失败时保留，不从 stale cache 降级恢复 |
| 行列表 | `geoKeys.topicList(params)` | 与完整 options query 分离，不作为恢复数据源 |

## 3. 最小实现

在 `query-topic-list-page.tsx` 增加一个小型 domain-local helper，由编辑与删除的 `reloadCanonical()` 共用：

```ts
async function fetchFreshQueryTopics(queryClient: QueryClient) {
  const options = queryTopicsQueryOptions();
  await queryClient.cancelQueries({ exact: true, queryKey: options.queryKey });
  return queryClient.fetchQuery({ ...options, staleTime: 0 });
}
```

实现时以已安装 TanStack Query 类型和现有项目模式校验最终签名。关键语义是：

1. 先取消 exact options key 的旧在途请求；
2. 复用原 query key 和 query function；
3. 仅本次显式调用覆盖 `staleTime: 0`；
4. 等待新请求成功后，调用方才更新 Dialog 状态。

不把 helper 放进 `geo.api.ts`，因为“冲突后显式强制网络读取”是页面动作语义，不是所有 options 消费者的默认缓存合同；也不创建只转发 API 的新 service 层。

## 4. 状态流

### 4.1 编辑冲突

```text
PATCH 409
  -> 保留草稿、request ID 和 conflict error
  -> 禁用保存
  -> 用户点击显式 reload
  -> cancel exact old in-flight query
  -> fresh GET /api/v1/query-topics
     -> 成功且 topic 存在：采纳 canonical 字段/revision，清除冲突，恢复保存
     -> 失败或 topic 不存在：保留原草稿与冲突冻结，仅展示 reload error
```

### 4.2 删除冲突

```text
DELETE 409
  -> 保留 conflict error/request ID
  -> 禁用确认删除
  -> 用户点击显式 reload
  -> cancel exact old in-flight query
  -> fresh GET /api/v1/query-topics
     -> 成功、topic 存在且含 DELETE：采纳 revision，清除冲突，恢复确认
     -> topic 不存在：提示已不存在，保持不可删除
     -> DELETE 不再可用：提示服务端限制并刷新 list projection，保持不可删除
     -> 请求失败：保留冲突冻结，仅展示 reload error
```

两个流程都不会在 reload 成功后自动执行 mutation。

## 5. 错误与竞态矩阵

| 场景 | 可采纳数据 | UI 结果 | Mutation |
| --- | --- | --- | --- |
| options cache fresh | 点击后新 GET 的成功响应 | 按新响应恢复 | 不重放 |
| exact options request 点击前在途 | 取消旧请求；只采纳随后新 GET | 等待新请求结果 | 不重放 |
| 新 GET 网络/HTTP 失败 | 无 | 保留草稿、409/request ID 与动作冻结；显示 reload error | 不重放 |
| 新 GET 中 topic 缺失 | 无 | 编辑提示不存在；删除沿用现有不存在提示 | 不重放 |
| 删除时新响应无 `DELETE` | 新响应仅用于确认动作不可用 | 提示服务端不再允许并刷新列表投影 | 不重放 |
| 新 GET 成功且允许恢复 | 新 canonical/revision | 清除冲突并恢复人工动作 | 仅后续人工触发 |

## 6. 回归测试设计

扩展现有 generated-type 严格 fixture：

- 记录 `/api/v1/query-topics` 的 GET 请求；
- 提供该 endpoint 的 `success` / `error` 控制；
- 保持未知 API 返回 501、mutation 请求计数和 CSRF/revision 断言不变。

在现有编辑与删除 409 用例中构造真实 fresh-cache 条件：第一次显式 reload 成功并填充完整 options cache，随后再次制造 409，在 30 秒内再次点击 reload。断言第二次点击仍增加 GET 计数。至少一个路径先注入 GET 失败，证明旧缓存不会被当作成功、冲突与草稿/禁用状态保持；恢复 GET 后再次点击，才采纳 canonical/revision。全过程核对 mutation 请求数，排除自动重放。

若实现阶段发现一个测试承载过多互斥状态，可在同一 `geo-topics.spec.ts` 中拆成两个聚焦用例，但不新建平行测试 harness。

## 7. 拒绝的方案

- **将全局 `staleTime` 改为 0**：会改变 New Observation、Correction Workspace 等普通 options 消费者，扩大请求量和行为范围。
- **只调用 `invalidateQueries`**：active observer 的异步 refetch 与缓存读取存在竞态，不能证明恢复采纳的是点击后的请求。
- **`removeQueries`、清空缓存或 nonce query key**：破坏共享 cache 身份，可能引入重复数据源和不必要闪烁。
- **复制 `api.GET` 或新增 detail endpoint**：形成第二请求定义或扩大公共合同，不是本缺口所需。
- **reload 成功后自动重放 mutation**：违反 409 后必须重新人工确认的既定业务合同。
- **把 row snapshot live projection 一并修复**：属于另一个 owner 与独立 Task，混入会模糊验收边界。

## 8. 变更与回滚边界

预计只修改三个产品/测试文件：

1. `frontend/src/domains/geo/query-topic-list-page.tsx`
2. `frontend/tests/e2e/fixtures/geo-topics.fixture.ts`
3. `frontend/tests/e2e/geo-topics.spec.ts`

无需修改 backend、OpenAPI、generated client、数据库合同、Makefile、CI 或稳定业务设计文档。若实施核对发现必须修改上述边界文件，应停止并报告，而不是顺手扩大本 Task。

回滚可整体撤销 helper、两个调用点和对应 fixture/E2E 断言，不涉及数据迁移或公共合同兼容。
