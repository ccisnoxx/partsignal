# Frontend V2 Content Abstraction Review

## Goal

完成 Frontend V2 Phase 3 Content vertical slice 的抽象回顾与退出审计：以现有实现、测试和已归档交付结果为证据，确认所有权与依赖方向，删除已证实的重复或无意义包装，避免把 Content 业务规则提升为通用框架，并给出可复核的 Phase 3 exit gate 结论。

本任务不新增业务能力；如果审计结果不要求代码修改，允许只以审计报告、文档状态更新和 gate 判定完成。

## In Scope

- Content Task List、New Content Task、Content Task Detail。
- Content Editor Core、Content AI Production、Content Review。
- Content Version readonly Detail。
- Content domain 的 fixture、component、Playwright 与 real-stack E2E 证明边界。
- Content 使用的 Design System、shared API、TanStack Router、TanStack Query、React Hook Form、TanStack Table 与 local state 所有权。
- 有直接证据的少量 Content/domain/design-system 简化、对应测试及 Phase 3 状态文档。
- 审计台账、所有权矩阵、退出判定和后续 defer trigger。

## Out of Scope

- 新业务页面、Content History、Publishing、GEO、Configuration、System。
- backend、OpenAPI、database、migration、generated API、V1、Cutover。
- 公共 API、权限、状态机或服务端 read model 修改。
- 视觉重设计、无证据重命名、按文件长度拆分、目录重排。
- 通用 DataTable、ReviewWorkspace、Editor、VersionDetail、workflow engine、server-list hook。
- 跨 domain action/status/error registry、Content 业务映射进入 Design System。
- 新依赖与只转发参数的 wrapper。

## Requirements

1. 逐项完成用户指定的 15 项固定检查，并把证据持久化到 `audit.md`。
2. 每项 ledger 记录 `severity`、`file:line`、`evidence`、`impact`、`current owner`、`recommended owner`、`decision`、`proposed change`、`validation`、`defer trigger`。
3. findings 必须归入：Keep in Content Domain、Keep in Design System/shared、Simplify locally、Promote only after proven consumers、Confirmed defects requiring change、Deferred product/UX decisions。
4. 只有真实重复、稳定所有权、明确测试边界或可复现缺陷才能触发代码修改；优先删除与局部简化。
5. route 只保留 search/loader/prefetch/head/composition；业务资格只消费服务端 `primary_task` / `available_actions`。
6. `content.api.ts`、Content query keys 和 Content action registry 保持唯一 owner。
7. `current_content_version_id` 保持当前内容主线唯一权威；历史 ContentVersion、ReviewRecord 和 Generation snapshot 保持不可变。
8. fixture、component、Playwright、real-stack 测试只保留互补证明，不以测试数量替代边界证据。
9. 依赖方向保持 `route → domain → design-system/shared`，Design System 不得导入 Content DTO、token、权限或状态机。
10. 规划批准前不得运行 `task.py start`、创建分支或修改业务代码。

## Stop Conditions

出现以下任一条件时，不在本任务夹带实现；记录证据并建议独立 Task：

- 需要修改公共 API、数据库、权限或状态机。
- 需要新增业务 route/read model。
- 需要跨 domain 大规模重构。
- 预计修改超过 `implement.md` 批准的文件数量上限。
- 同一失败在没有新证据时重复。
- 发现属于 Phase 4 或其他后续阶段的问题。

## Acceptance Criteria

- [x] `audit.md` 已记录审查基线、提交范围、15 项固定检查、findings ledger、所有权矩阵、可删除重复、保留项、提升项与 defer trigger。
- [x] `design.md` 只描述证据支持的最小设计，没有新增业务抽象或依赖。
- [x] `implement.md` 列出精确文件上限、required validation、可选验证、停止条件、回滚点与 Phase 3 exit gate 算法。
- [x] 批准后的实现最多处理：通用 route 意外错误 UI 的稳定共享边界，以及 Content 内无意义的 `StatusBadge` 转发包装。
- [x] 未创建通用 DataTable/Editor/Review/Detail/Workflow/API abstraction，未建立跨 domain action/status/error registry。
- [x] Content action eligibility、query keys、API、current pointer 和不可变历史所有权未改变。
- [ ] required validation 全部通过；失败按归因规则处理，不无证据重复运行。
- [x] `trellis-check`、实现后自审和规划内 Phase 3 gate 报告完成。
- [x] Phase 3 gate 已按批准算法判为 `NOT_MET`，并记录唯一范围外 blocker、owner 与独立 Task 建议。

## Delivery Constraints

- 当前仅处于 planning；不运行 `task.py start`，不创建分支，不修改业务代码。
- 用户批准规划后，先确认最新且干净的 `main`，再创建 `codex/frontend-v2-content-abstraction-review`。
- 实施完成后先展示 commit plan 并等待确认；不自动 push。
- 本任务的 Trellis 规划文件不计入批准后的实现文件数量上限，但仍属于最终提交范围。
