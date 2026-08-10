# 技术设计

## 1. Gap 与兼容结论

现有 `ContentTaskListItem` 的 server-driven workflow/action 与批量投影可以复用，但列表字段和查询能力不足。继续扩展同一 item 和 endpoint，不新增 V2 endpoint 或客户端 DTO。

`GET /api/v1/content-tasks` 采用项目已有 Platform List 的双模式合同：

- 省略 `page/page_size`：返回完整匹配集合，保持 V1 行为；
- 同时提供 `page/page_size`：启用服务端分页；
- 只提供其中一个：422。

旧参数、默认 ACTIVE 和既有字段继续保留；response 增加 metadata 对旧 JavaScript 消费者无运行时破坏，generated V1 fixtures 同步补齐。

## 2. Contract 与后端投影

新增 query：`q`、`workflow_stage`、`page`、`page_size`。搜索覆盖派生 identifier、产品品牌/型号和平台名称；筛选和 count 在分页前执行。

`ContentTaskList` 必填 `items/page/page_size/total`。现有 item 增加：

```text
identifier: CT-XXXXXXXX
current_content: { id, version, source_type } | null
updated_at: datetime
```

`current_content` 只通过 `current_content_version_id` join。`content_tasks` 新增 `updated_at` 并以 `created_at` 回填；列表最近活动以任务时间为基线，合并当前内容、最新生成活动、审核记录和发布工作的真实时间。当前人工草稿原地保存必须触碰任务时间。

workflow stage 与 primary task 由一个 SQL projection owner 生成，旧列表、新分页列表和单项投影共用；action eligibility 继续由现有批量资格投影生成。排序固定为 `updated_at DESC, id DESC`。

普通 DELETE 增加必填 `expected_revision` query；服务锁任务后先校验 revision，再重算删除范围。V1 删除调用同步传现有行 revision，不增加兼容写 endpoint。

## 3. URL、组件与数据流

```text
/content/tasks?archiveStatus=ACTIVE&page=1&pageSize=20
  -> contentSearchSchema
  -> { search, workflow_stage, archive_status, platform_profile_id, page, page_size }
  -> contentKeys.list(params)
  -> GET /api/v1/content-tasks
  -> ContentTaskListPage
```

筛选变化和 pageSize 变化回 page 1；非法/多余值 replace 为 canonical URL。Platform filter 使用现有 `listPlatformProfiles` 完整参考集合，只提供选项，不参与行数据 join。

```text
Content route metadata
└── Content list route
    └── ContentTaskListPage
        ├── PageHeader
        ├── TableToolbar + FilterBar
        ├── TableShell
        │   ├── TableSkeleton / EmptyTable / error+retry
        │   ├── fixed columns + domain StatusBadge
        │   └── RowActions
        ├── Pagination
        ├── Cancel Dialog
        └── Permanent Delete Dialog
```

375/768/1024/1440 使用同一语义 Table；窄屏只允许 TableShell 内部局部横向滚动，不产生页面级横向溢出。

## 4. Action registry 与生命周期边界

Primary canonical links：

- `CREATE_FIRST_DRAFT`、`EDIT_AND_SUBMIT_REVIEW`、`REVISE_CONTENT` → `/content/tasks/$taskId/editor`
- `REVIEW_CONTENT` → `/content/tasks/$taskId/review`
- `START_PUBLICATION` → `/publishing/work`
- `VIEW_GENERATION_PROGRESS`、`HANDLE_GENERATION_FAILURE`、`CONTINUE_PUBLICATION`、`VIEW_FULL_LINEAGE`、`VIEW_CANCELLATION` → `/content/tasks/$taskId`

目标页未实现时只生成并测试 href，不注册占位路由、不点击为成功流程。

Overflow：

- `CANCEL`：用户输入 comment，发送 `expected_revision`；不伪造 comment。
- `DELETE`：静态后果确认，发送 CSRF + `expected_revision`。
- `ARCHIVE` / `RESTORE`：发送 CSRF + `expected_revision`。
- `PERMANENT_DELETE`：先 GET 实时 preview，显示 counts/external URLs，要求输入服务端 confirmation text，再发送 preview revision。
- `CREATE_GENERATION_JOB` / `CREATE_MANUAL_VERSION`：只链接 Editor。

成功统一 invalidate/refetch `contentKeys.lists()`；409 展示 request ID 并刷新列表但不自动重放，403/404/422 显式映射。Design System 只消费 resolved actions，不识别 Content token。

## 5. 回滚与风险

- 兼容风险由双模式 list、V1 targeted tests 和 generated typecheck 控制。
- `updated_at` 是新增可回滚列，不改写历史业务状态；downgrade 只删除新索引/列。
- offset pagination 接受并发写导致页间移动，服务端每次返回当前稳定顺序；不引入 cursor/snapshot framework。
- 已知范围外 full-suite 失败只报告，除非证据证明由本任务引入。
