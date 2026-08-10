# Frontend V2 Content Version Detail

## Goal

实现 `/content/versions/$versionId` 不可变 Content Version 详情页，使用户可通过稳定直链读取一个版本的 canonical 内容、来源与生成链路、审核结论和归属 Content Task，同时保证当前版本与所有历史版本都没有编辑或业务命令入口。

## User Value

- 从 Content Task 的现有版本链接进入同一个只读历史快照，并可复制直链、刷新或使用浏览器前进/后退。
- 清楚区分 HUMAN / AI、当前 / 历史、生成 / 自然化来源以及审核结果，而不需要进入 Editor 或 Review Workspace。
- 对旧快照缺失的 Prompt、模型、生成、审核或更新时间明确显示“未记录”，不猜测或补造。

## Confirmed Facts

- `ContentTask.current_content_version_id` 是当前内容主线唯一权威；页面不得切换该指针，也不得以最大版本号判断当前版本。
- `ContentVersion` 的六种合同状态均可能出现在详情页；状态只决定显示文案，不决定动作。
- 当前基础 `GET /api/v1/content-versions/{content_version_id}` 不能一次返回本页所需字段与一致快照；详细证据见 `research/gap-analysis.md`。
- Content Task Detail 已有当前版本和 Activity 中历史版本的 canonical 链接；Editor 与 Review 当前没有版本详情链接，本任务不为实现页面而扩张其 Workspace。
- OpenAPI 变化会让 V1/V2 两份 generated schema 同时漂移；实施批准必须同时明确是否允许仅更新 `frontend/src/shared/api/schema.d.ts`，其他 `frontend/` 文件仍禁止修改。

## In Scope

1. 新增只读路由 `/content/versions/$versionId` 和 Content domain 页面。
2. 新增一次返回页面实际消费字段的 compact Content Version Detail read model，并在单个一致读请求中形成快照。
3. 展示 title、summary、canonical Markdown、tags、version、status、source type、对应 Fact Version、Prompt/model snapshot、generation/source lineage、content hash、creator、change summary、review result、review timeline、创建时间与可空更新时间。
4. 展示版本是否为任务当前主线，但无论当前或历史、HUMAN 或 AI、何种状态都保持只读。
5. 提供返回所属 Content Task 的 canonical link；现有 Task Detail 版本链接在新路由落地后成为有效入口。
6. 覆盖后端合同/迁移/查询测试、Frontend V2 component 与 production-artifact Playwright，以及一条独立 real-stack 只读流程。
7. 同步直接受影响的 OpenAPI、数据库合同和 Frontend V2 蓝图/测试/ADR/路线状态。

## Requirements

### R1 — 单一一致读

- 浏览器首屏只请求一个 version-scoped detail endpoint，不请求 ContentVersion、Review Context、GenerationJob、FactVersion、Task Detail 或版本列表自行 join。
- 服务端只返回目标版本、所属任务/Fact 的紧凑 identity、该版本真实 AI lineage、页面需要的 Prompt/model snapshot 和审核时间线；不返回完整 Task、Fact Markdown、Diff、全部 GenerationJob 或 Content History。

### R2 — 不可变只读

- 页面没有 form、CodeMirror、DirtyGuard、StickyActionBar 或 mutation。
- 页面不渲染 `SAVE`、`DELETE`、`APPROVE`、`REQUEST_CHANGES`、`ABANDON`、切换 current version 或其他业务命令。
- 不读取或解释 `primary_task` / `available_actions`，不根据 status、source、current/historical 或账号类型生成动作。

### R3 — 真实快照与缺失语义

- HUMAN 与 AI 版本使用服务端真实来源与 lineage；仅返回与目标版本祖先链相关的生成/自然化步骤。
- 历史 snapshot 允许缺失 Prompt 元数据、模型元数据、生成 lineage、审核记录或更新时间；缺失必须以明确空态显示。
- legacy ContentVersion 不补造更新时间；只有数据库真实记录的更新时间才显示具体时间。

### R4 — 导航、错误与可访问性

- direct URL、refresh、Back、Forward 均恢复同一 `versionId`。
- loading、404、403、generic error、retry 与后台刷新失败使用可访问语义；有缓存快照时刷新失败不清空正文。
- 页面提供唯一明确的 canonical Content Task 返回链接。
- Markdown 使用现有 sanitized `MarkdownPreview`；状态、时间线、详情区和反馈复用现有纯 UI Pattern。

### R5 — 响应式与运行时质量

- 375 / 768 / 1024 / 1440 下长 Markdown、长 title/summary/change summary、tags、UUID、hash 和 snapshot 不造成页面级横向溢出。
- 键盘可访问正文滚动区、折叠 snapshot 与返回链接，焦点可见，状态不只依赖颜色。
- fixture 明确拒绝未声明 API；无非预期 `console.error`、`pageerror`、`requestfailed`。

## Acceptance Criteria

- [x] AC1：direct URL、refresh、Back、Forward 始终按 URL `versionId` 读取同一版本。
- [x] AC2：页面仅调用一个 detail read model；fixture 对任何跨资源 join 或 mutation 请求直接失败。
- [x] AC3：HUMAN 与 AI，以及 `DRAFT`、`PENDING_REVIEW`、`CHANGES_REQUESTED`、`APPROVED`、`SUPERSEDED`、`ABANDONED` 均展示正确状态与“只读 · 不可变快照”，且无写入口。
- [x] AC4：当前版本与历史版本都不会修改 `current_content_version_id`，页面只显示服务端投影的 `is_current`。
- [x] AC5：正文、tags、hash、creator、change summary、Fact Version、创建时间以及存在时的更新时间完整可读。
- [x] AC6：AI lineage 只包含目标版本祖先链相关的原始生成和自然化步骤；Prompt/model snapshot 有值与缺失两种情况均有明确展示。
- [x] AC7：review result 来自目标版本的实际最后一条审核记录，review timeline 保持服务端顺序；无记录时显示空态。
- [x] AC8：404、403、loading、generic error、retry 与 stale refresh 均有明确、可访问且不伪装成功的 UX。
- [x] AC9：返回链接精确指向 `/content/tasks/{task_id}`；Task Detail 现有当前/历史版本链接能进入本页。
- [x] AC10：375 / 768 / 1024 / 1440、keyboard、visible focus、语义结构、长内容与浏览器运行时错误审计通过。
- [x] AC11：独立 real-stack 流程经真实登录、FastAPI、PostgreSQL 和 V2 production preview 读取一个真实 ContentVersion；不依赖 fixture 或其他 real-stack spec 的数据。
- [x] AC12：合同、迁移、后端、generated types、Frontend V2 页面与直接受影响文档一致，required validation 全部通过。

## Out of Scope

- Content History 列表、Publication Workspace、Editor / Review Workspace 功能扩展。
- 新增或修改任何版本 mutation、审核命令、发布命令、current-version 切换命令或动作资格。
- 返回完整 Task、完整 Fact、Fact Markdown、Diff、全部 GenerationJob、全部版本历史或 Publication aggregate。
- 通用 Version Detail / Timeline / Snapshot framework、跨 domain status registry、全局 store、新依赖或 V1 UI 行为变更。
- 修改除 generated `frontend/src/shared/api/schema.d.ts` 之外的任何 `frontend/` 文件；该唯一生成文件例外仍须在实施批准中明确确认。

## Planning and Delivery Gate

- 本轮只完成规划；不运行 `task.py start`、不创建分支、不修改业务代码。
- 用户批准最新规划并确认 generated-only V1 schema 例外后，才从最新、干净的 `main` 创建 `codex/frontend-v2-content-version-detail`。
- 实施按“阅读 → 计划 → 修改 → 自测 → trellis-check → 自审 → 抽象回顾 → 报告”执行。
- 提交前展示 commit plan 并等待确认；不 push。
