# 技术设计

## 1. Contract / Read-model readiness audit

### 1.1 `PublicationReadyItem`

字段足够，不新增第二个 Ready DTO：

- `content_version.title/version` 支持内容标题和 Approved Content version；
- `platform_profile_id/name` 支持具体平台；
- `matching_accounts` 支持明确账号选择；
- `available_actions` 与 `primary_task` 支持服务端资格和下一任务投影。

真实缺口位于唯一投影 owner `publication_queries.py`：当前候选 SQL 通过 active account `EXISTS` 提前过滤无账号内容，因此页面无法区分“没有待发布内容”和“有待发布内容但尚无可用账号”。调整为：

- 先按 approved/current content、approved fact、open task、active platform、无重复 work/content identity 选 Ready 候选；
- 再批量投影 active matching accounts；
- `matching_accounts` 非空且其余资格成立时返回 `available_actions=["START"]`，否则为空；
- `primary_task` 仍为 `START_PUBLICATION`，表示该候选的服务端下一任务，不等价于当前可执行 action；
- summary 的 `ready_count` 复用同一候选定义，不再以账号存在作为计数门禁。

这只修正 read-model 语义，不改变 `PublicationReadyItem` 字段 shape，也不让前端从账号数量反推 START。

### 1.2 `PublicationWorkListItem`

当前不足以绘制蓝图六列：

- 缺 Product compact summary；
- 只有 latest verification outcome/time，缺普通 CREATED、准备更新、登记结果等 latest event，不能表达“最近情况”。

合同调整：

```text
product: ContentTaskProductSummary
latest_event: PublicationWorkEvent
```

两者均复用现有 schema，不创建新的 Product 或 Event DTO。`product` 在主 work context query 通过 ContentTask → Product join 得到；`latest_event` 按 `(created_at DESC, id DESC)` 在当前分页 work IDs 上一次批量查询。现有 latest verification 字段保留，避免无关 V1 合同删改。

有效 PublicationWork 的 create transaction 总会追加 `CREATED` event。若数据库存在缺 event 的非法 work，projection 显式抛出 `PUBLICATION_CONTEXT_INCOMPLETE`，不返回 `null`、默认文案或客户端 fallback。

### 1.3 endpoint 与一致性结论

继续使用：

```text
GET /api/v1/publication-workbench-summary
GET /api/v1/publication-ready-items
GET /api/v1/publication-works
```

不新增 workbench context。理由：

- 三个 endpoint 对应三个独立 surface，页面不需要把它们 join 成一行或一个命令 payload；
- 每个 endpoint 内部都是一个独立数据库事务视图，现有查询次数不随行数增长；
- summary 与列表可能在相邻请求间短暂变化，但页面没有依赖“计数必须等于当前列表长度”的业务决策；
- mutation 成功或冲突后统一失效三类 query，START POST 在事务锁内复核全部资格，因此短暂 snapshot 差异不会放宽命令边界。

页面只并发挂载三个独立 React Query，不在 route/page 层 `Promise.all` 后拼业务 DTO。

### 1.4 N+1、分页与筛选

- Ready 当前通过批量 `content_versions_out` 与 `platform_accounts_out` 投影，虽然 payload 偏宽，但不是 N+1；本任务不做无证据的 compact Ready 重构。
- Work list 当前 count + page + latest verification 均为固定查询；新增 Product join 和一次 latest-event batch 后仍为固定查询。
- work list 已有 `page`、`page_size`、`status` 和稳定服务端排序，足够本页。
- V2 只暴露四个非终态 status；不新增全文搜索、复合 filter、客户端分页或 Ready pagination。

### 1.5 Error contract

- 三个 GET 补 `401 ErrorResponse`。
- POST `/publication-works` 补实际可返回的 `401/403/404/409/422 ErrorResponse`。
- `ErrorEnvelope`/request ID 继续使用现有共享合同，不创建 Publication 专用错误 DTO。

## 2. 单一页面边界

本页只负责“发现待开始内容、创建工作、扫描 active work、导航到 canonical 后续 surface”。

- START 是本页唯一 command。
- Work 行 primary/overflow 只把服务端 token 解析为 `/publishing/work/$workId` 或其稳定 section hash；不渲染或提交 preparation/result/verification/close 表单。
- 不注册 `$workId` 路由，不创建占位 Workspace。链接可以指向 Phase 4 后续 canonical URL，与现有 Content handoff 约定一致。
- `CLOSE` 在列表只导航到未来 Workspace 的 close section，不作为 destructive command，因此本页不提前实现确认逻辑。

## 3. Component hierarchy

```text
PublishingRoute (navId + breadcrumb + Outlet)
└── PublicationWorkRoute (breadcrumb + Outlet)
    └── PublicationWorkIndexRoute (search canonicalization/composition)
        └── PublicationWorkPage
            ├── PageHeader
            ├── PublicationSummary
            │   └── 4 × local metric <dl> item
            ├── ReadyQueue
            │   ├── ReadyQueueSkeleton / ReadyQueueError / ReadyQueueEmpty
            │   └── ReadyItem
            │       └── StartPublicationDialog
            │           ├── account Select
            │           ├── ErrorSummary + request ID
            │           └── submit/cancel actions
            └── ActiveWorkSection
                ├── TableToolbar
                │   ├── status Select
                │   └── reset filter
                ├── TableShell / TableRegion
                │   ├── TableSkeleton / TableError / EmptyTable
                │   └── fixed six-column semantic table
                │       └── RowActions
                └── TablePagination
```

复用现有 `Badge`、`Button`、`Select`、`Dialog`、`ErrorSummary`、`TableShell`、`TableToolbar`、`RowActions`、`TablePagination`、`EmptyTable`；没有通用 `StatusBadge` 或 Metric 组件时使用 Publication domain 本地 registry/markup，不新增薄包装或万能组件。

## 4. URL search schema

Canonical schema：

```text
page: positive integer, default 1, canonical URL 必显式保留
pageSize: 10 | 20 | 50, default 20, canonical URL 必显式保留
status?: PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED
```

规则：

- 非法、重复或额外 search 值以 `replace` 归一；
- status/pageSize 改变时回到 page 1；
- pagination 只修改 page；
- Dialog open、账号选择、成功提示不进入 URL；
- direct URL、refresh、Back、Forward 都从 search schema 恢复服务端查询参数。

不增加 `q`：endpoint 没有服务端搜索，本页蓝图也未要求；因此不强行复用带 mandatory search input 的 `FilterBar`，改用既有 `TableToolbar + Select`。

## 5. Table projection 与 actions

固定六列：

1. 内容：`content_title` → approved Content Version canonical link；`product.brand + product.part_number` → Product canonical link。
2. 平台 / 账号：server snapshot name/label/identifier。
3. 当前阶段：只使用 `workflow_stage`，通过 domain registry 映射为中文 label + `Badge`。
4. 最近情况：`latest_event.action/comment/created_at`，action token 只做展示文案映射。
5. 更新时间：`updated_at` 相对时间，tooltip/可访问文本保留完整时间。
6. 操作：只解析 `primary_task` 和 `available_actions`；primary 最多一个，其余进入 `RowActions` overflow。

所有六列保留在同一语义 table；窄屏通过 `TableRegion` 局部横向滚动，不复制 card/mobile DTO，也不让 body 横向溢出。摘要在 375 使用 2 列、768 起 4 列；Ready Queue 使用 mobile-first 单列并在宽屏增加列数。

## 6. START mutation 与 cache invalidation

### 6.1 资格、请求与防重

- START trigger 只检查 `available_actions.includes("START")`；不读取 ContentVersion status 推导，也不把账号数量当资格规则。
- 用户必须在当前 Ready Item 的 `matching_accounts` 中明确选择账号。
- body 精确为 `{content_version_id, platform_account_id}`。
- `Idempotency-Key` 以 body JSON signature 缓存在 `useRef`；同 payload 手动重试复用 key，账号改变才生成新 key。
- `X-CSRF-Token` 来自既有 auth context；缺失时显式失败。
- mutation pending 与同步 submitting ref 同时阻止重复 click/submit。
- 服务端继续在锁内复核 approved content、current pointer、task/platform/account 状态、平台匹配和重复 work/content identity。

### 6.2 失败

- 403/404/409/422 统一映射现有 structured error；Dialog 保持打开、保留账号选择并显示 request ID。
- 409 不自动 replay；刷新 summary/work list 与该 task 的直接 Content projections，并把 Ready cache 标记 stale 但不在 Dialog 打开时 refetch，确保结构化错误和账号选择不会因 Ready item 消失而被卸载；后续成功或窗口重新聚焦再读取 Ready。
- 仅 `IDEMPOTENCY_CONFLICT` 丢弃当前 key，下一次人工提交生成新 key；其他同 payload 人工重试继续复用稳定 key。
- Ready Item 若出现 `START` 但没有任何 matching account，Dialog 显示合同不一致错误且无法提交；不请求其他账号或猜测资格。

### 6.3 成功

采用 POST response 的 canonical `PublicationWork.id`，不在客户端构造 WorkListItem：

1. 记录 canonical ID 用于成功提示与服务端回传行的定位；
2. URL 切换到 `status` 未设置、`page=1`，保留 `pageSize`；
3. invalidate/refetch `publicationKeys.summary()`、`readyItems()`、全部 `workLists()`；
4. 由 route composition 层失效 `contentKeys.lists()`、该 task 的 detail/editor/review context；不失效不可变 Content Version detail；
5. 关闭 Dialog，并在新列表含 canonical ID 时高亮/提示；若 refetch 失败，仍只显示 canonical ID 和明确列表错误，不插入伪造行。

Publication domain 不导入 Content domain internals；跨 domain invalidation 由 route 传入 callback，保持依赖方向。

## 7. Loading、empty、error 与可访问性

- Summary、Ready、Work 各有独立 `isPending/isError/data` 分支和 retry。
- Ready 空表示全局无待开始候选；Ready item 账号为空是 no-account 状态，不等于空队列。
- Work `total=0` 且无 status 是全局 empty；带 status 时是 filtered empty，提供清除筛选。
- GET/POST 错误使用 `role=alert`；成功与动态刷新使用 polite live region。
- Select 有可见 label；错误通过 `aria-invalid/aria-describedby` 关联；图标按钮有 accessible name。
- Base UI Dialog 显式提供 `finalFocus` 指向 START trigger，并在 `onOpenChangeComplete(false)` 后清理本地错误/幂等状态。
- Escape、Tab、Shift+Tab、Enter/Space 和可见 focus ring 使用现有 primitives；不自建 focus trap。

## 8. 风险与回滚点

- **V1 generated type 影响**：`PublicationWorkListItem` 新增必填字段会使 V1 的 typed test fixture 需要同步字段。默认仅允许生成文件和最小 test fixture 调整，不改 V1 runtime/UI；若批准范围禁止 fixture 变化，实施时必须停下报告，不能把新字段改成 optional 规避合同。
- **Ready 计数语义变化**：`ready_count` 将包含 no-account 候选，这是让摘要与 Ready Queue 一致且可呈现阻塞原因的有意 read-model 修正；不改业务状态。
- **latest event 不变量**：当前 create command 总是写 CREATED event，0034 迁移也不允许遗留旧 work；发现无 event 数据时显式失败，避免掩盖损坏。
- **三请求瞬时差异**：接受独立 snapshot 的短暂漂移；只有出现需要同一 snapshot 做业务决策的真实证据时才考虑聚合 endpoint。
- **未来 Workspace 链接**：链接先遵循 canonical URL，但本任务不保证目标页存在；Playwright 只检查 href，不点击并宣称 Workspace 可用。
- **回滚**：本任务无 migration。OpenAPI、backend projection、generated types 与 V2 page 必须作为一个提交单元回滚；回滚不会删除或改写 Publication/Content 历史数据。
