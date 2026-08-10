# Frontend V2 Phase 3.1 — Content Task List

## 目标

实现 Frontend V2 第一张 Content 页面 `/content/tasks`，让用户通过服务端权威的分页列表搜索、筛选和扫描内容任务，并从服务端 `workflow_stage`、`primary_task`、`available_actions` 执行或进入当前任务动作。

## 已确认事实

- Phase 2 exit gate 为 `MET`，本任务是 Phase 3 的第一项。
- 既有 `GET /api/v1/content-tasks` 是固定次数批量投影，不存在逐行 N+1；服务端已经生成 `workflow_stage`、`primary_task`、`available_actions`。
- 现有 `ContentTaskListItem` 缺少 `identifier`、当前内容摘要和 `updated_at`；endpoint 也缺少服务端搜索、阶段筛选和分页。
- V1 依赖同一 endpoint 在省略分页参数时返回完整 `{items}`，并在浏览器执行本地搜索、状态统计和分页。
- `ContentTask.current_content_version_id` 是当前内容主线唯一权威指针。
- 用户确认 `identifier` 使用服务端派生的 `CT-` + UUID 前 8 位大写，仅用于显示和搜索，不新增业务编号列。

## 需求

- 页面严格包含任务、目标平台、当前阶段、当前内容、最近更新、操作六列；当前内容为空时显示“暂无”。
- 普通列表不得同时展示 Task、Generation、Content、Publication raw status，也不得从它们推导阶段或动作。
- URL 支持并恢复 `q`、`workflowStage`、`archiveStatus`、`platformId`、`page`、`pageSize`；默认 canonical URL 保留 `archiveStatus=ACTIVE&page=1&pageSize=20`。
- 搜索、筛选、分页和稳定排序由服务端完成；浏览器不得抓取全量后做业务分页/搜索/筛选。
- 行数据只能来自 Content Task list read model；不得逐行请求 ContentVersion、GenerationJob、Product、Platform 或 Publication 补列。
- Page Primary 链接 `/content/tasks/new`；任务名称链接 `/content/tasks/$taskId`；不增加“查看详情”。
- 每行最多一个 Primary，只消费 `primary_task`；overflow 只消费 `available_actions`。
- 列表直接实现 `CANCEL`、`DELETE`、`ARCHIVE`、`RESTORE`、`PERMANENT_DELETE`；生成和人工首稿 token 只进入后续 Editor，不在列表复制表单。
- 生命周期命令使用 CSRF、canonical revision、服务端最终复核和 structured error；409 不自动重放，Dialog 关闭后恢复焦点。
- 复用既有 Table Kit、Status/Badge primitives、Dialog 与 Error/Empty/Skeleton pattern；Content domain 拥有自己的 query keys 和 typed action registry。
- 保持 V1 可运行；不增加 endpoint 版本开关、客户端版本判断、兼容 fallback、第二套写合同或手写 API DTO。
- fixture Playwright 使用 generated types，拒绝所有未声明 API，并测试 production build artifact。

## 验收标准

- [ ] `ContentTaskListItem` 一次响应足以绘制六列和动作；current summary 只来自 `current_content_version_id`。
- [ ] 同一 `GET /api/v1/content-tasks` 在显式 `page + page_size` 时服务端分页，两者都省略时保留 V1 完整集合语义。
- [ ] response 包含 `items/page/page_size/total`；服务端按 `updated_at DESC, id DESC` 稳定排序。
- [ ] server search、workflow/platform/archive filter 和 pagination 均有 contract/backend 测试。
- [ ] 列表/详情复用同一服务端 workflow/primary projection，并以固定查询数证明无 N+1。
- [ ] 普通 DELETE 使用 `expected_revision` 并在锁内复核；V1 调用同步适配。
- [ ] `/content/tasks` 的 URL canonicalization、refresh、Back/Forward 和 query key 均由 Content domain 控制。
- [ ] 固定列、服务端 stage/primary/overflow、loading/empty/filtered-empty/error/retry、archived view 和 lifecycle 状态均有 component coverage。
- [ ] Playwright 覆盖 direct/refresh、search/filter/pagination、Back/Forward、canonical links、生命周期、409 单次请求、四档响应式、keyboard/focus 和 runtime error audit。
- [ ] V1 targeted tests、contract-check、backend tests、V2 unit/component、build 和 Content Playwright 全部通过。
- [ ] contracts、database contract、generated V1/V2 types、实现、测试和 V2 权威文档一致。

## 排除项

- `/content/tasks/new`、`/content/tasks/$taskId` 的页面实现。
- Content Editor、Review、Version readonly Detail、History、AI generation UI、Publication UI。
- 批量操作、通用 workflow framework、通用 ContentTable、未来 Workspace context endpoint。
- 无关 V1 重构、无关质量修复、新依赖、生产切换和完整 Content real-stack E2E。
