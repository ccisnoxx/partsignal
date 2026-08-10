# Frontend V2 Phase 3.3 — Content Task Detail

## 目标

实现 `/content/tasks/$taskId` 的只读 Detail / Workspace Shell，让用户通过一次一致的服务端 read model 查看内容任务身份、锁定上下文、当前主线、生成、审核、发布、来源与 Activity，并继续从服务端 `primary_task` 进入后续 canonical workflow。

## 已确认事实

- 当前基础 `GET /api/v1/content-tasks/{content_task_id}` 只返回 `ContentTask`，不能完整绘制 V2 Detail。
- V1 Task Detail 会额外读取任务列表、FactVersion、ContentVersions、GenerationJobs 与 GenerationOptions；它只作为行为和数据需求证据，不复制其浏览器 join 架构。
- `ContentTask.current_content_version_id` 是内容主线唯一权威，不能用最大版本号替代。
- Content Task List 已具备服务端 workflow/action/deletion projection、Content domain query keys、生命周期命令、request ID、revision conflict 与 Dialog focus return。
- Product Detail 已实现独立 read model、PostgreSQL `REPEATABLE READ`、固定查询次数和服务端排序 Activity，可作为本任务的模式参考。

## 需求

1. 新增 `GET /api/v1/content-tasks/{content_task_id}/detail`；页面只请求该 endpoint，不调用列表、FactVersion、ContentVersion、GenerationJob、Review、Publication 或 GEO 接口拼装详情。
2. Detail response 只返回页面实际绘制的 compact projection：task、product、platform、fact、current content、latest generation、review、publishing、source、activity。
3. task 必须包含 identifier、status、workflow_stage、primary_task、available_actions、deletion、revision、created_by/created_at/archived_at。
4. platform 必须使用实时 identity 或 ContentTask 已有 name/website snapshot；历史平台删除时不得由前端猜测，Logo 没有 snapshot 时返回 null。
5. current content 严格按 `current_content_version_id` 解析，返回 compact title/summary/status/source/version；不存在时为 null。
6. latest generation 由服务端按 `created_at DESC, id DESC` 在任务的 GenerationJob 中确定，包含 job type、status、attempt、failure 和时间摘要；不提供虚构进度百分比，不轮询。
7. review 只描述当前主线版本；不加载完整 Review Context、Diff、正文或审核表单。
8. publishing 只描述唯一 PublicationWork 与可选 verified result；不加载 Publication Workspace 完整上下文。
9. source 只返回真实存在的 query topic、GEO optimization frozen source 或 published content issue；普通任务没有来源时返回 null，不制造空对象或假 GEO context。
10. Activity 由服务端产生 typed kind、timestamp、actor、summary、target，稳定排序并限制最近 10 条；前端不得合并或重新排序。
11. 页面唯一 Primary 原样消费服务端 `primary_task`；Editor、Review、Publication 等未实现页面只生成已批准 canonical link，不创建占位成功页。
12. 页面 overflow 复用 CANCEL、DELETE、ARCHIVE、RESTORE、PERMANENT_DELETE、deletion blockers、revision conflict、request ID 与 Dialog focus return。CREATE_GENERATION_JOB/CREATE_MANUAL_VERSION 只链接未来 Editor。
13. 新建内容任务成功后使用 POST response 的 `ContentTask.id`，清除 DirtyGuard 与幂等键，失效 Content Task List，导航 `/content/tasks/$taskId`；不得通过列表查找新 ID。
14. Detail query key 由 `contentKeys` 唯一拥有；command 成功或过期冲突同时刷新 detail/list canonical cache。Detail 与 List cache 互不写入。
15. loading、404、403、generic error + retry、section “暂无”、command pending、revision conflict、deletion blockers、readonly archived/cancelled/completed 状态都必须有明确 UI。
16. 页面满足 375/768/1024/1440、keyboard、focus、screen-reader 和非颜色状态表达；不增加 KPI、图表或无合同依据的百分比。

## 明确排除

- Content Editor、AI Generation Job 创建/重试、Manual Draft、Humanization。
- Content Review、Content Version readonly Detail、Publication Work/Workspace、Content History。
- Detail 内联编辑、隐藏轮询、客户端 workflow 推导。
- 通用 aggregate/detail framework、workflow engine、repository/service wrapper、新依赖和无关 V1 重构。

## 验收标准

- [ ] OpenAPI、FastAPI schema 与 V1/V2 generated types 定义独立 `ContentTaskDetail` 和 detail endpoint；基础 ContentTask endpoint/schema 保持兼容。
- [ ] Backend 在单次 PostgreSQL `REPEATABLE READ` 请求内固定次数组装完整 response，关联历史从 sparse 增长到 dense 不产生 N+1。
- [ ] current content pointer、latest generation、review/publishing/source、Activity source/order/limit 均有 PostgreSQL integration 证明。
- [ ] `/content/tasks/$taskId` 只请求一个 detail endpoint，并完整显示有数据与所有 compact “暂无”状态。
- [ ] 10 个 `primary_task` 与所有 lifecycle/overflow token 均有穷尽映射；页面不按 status/workflow_stage 推导替代动作。
- [ ] lifecycle 409 不自动重放，显示 request ID 并 refetch canonical detail/list；Dialog 关闭恢复真实触发器焦点。
- [ ] New Content Task 成功直接进入 canonical Detail，列表失效、DirtyGuard 和幂等键清除。
- [ ] Component 与 fixture Playwright 覆盖 404/403/retry、readonly 状态、四档宽度、键盘/focus、console/pageerror/requestfailed 和未声明 API 失败。
- [ ] 真实栈 Product Facts Flow A 通过 V2 UI 创建 ContentTask 后进入 Detail，显示真实 Product/Fact/Platform，`primary_task=CREATE_FIRST_DRAFT`，且不创建首稿或进入 Editor。

## 阻塞项

无。当前读取政策只有 `CurrentUser`，本任务不新增资源级角色规则；403 作为既有错误边界和前端状态覆盖。
