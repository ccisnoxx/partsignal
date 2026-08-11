# Frontend V2 Publication ACTION_REQUIRED Content Revision

## 目标

在发布核验失败进入 `ACTION_REQUIRED` 后，让 Content Task 的服务端流程投影把用户带入现有 Content Editor/Review，完成“基于当前批准版本创建人工修订 → 保存 → 送审 → 批准”；批准后的当前版本继续由 Publication Workspace 作为唯一候选切换并完成真实栈 Flow B。

本任务只补齐失败核验与既有内容修订链之间的入口，不新增内容编辑、审核、发布命令或 API。

## 已确认事实

- `verify_publication_work()` 的 FAILED 分支只把 Publication Work 置为 `ACTION_REQUIRED`，不会也不得原地修改批准内容（`backend/app/services/publication.py:687-714`）。
- `content_task_workflow_projection()` 当前对任意未终态 Publication Work 优先返回 `PUBLISHING / CONTINUE_PUBLICATION`，遮蔽了当前内容的修订与审核阶段（`backend/app/services/projections.py:245-297`）。
- 当前批准版本已经由服务端投影 `CREATE_REVISION`；现有 Content Editor 只在 Content Task 的 `primary_task=REVISE_CONTENT` 时进入 revision mode（`backend/app/services/projections.py:382-399`、`frontend-v2/src/domains/content/content-editor.model.ts:55-68`）。
- 现有内容命令已经支持批准版本创建 HUMAN draft、保存、送审、退回、再修订和批准；批准新版本时旧批准版本转为 `SUPERSEDED`，Publication Work 仍绑定旧版本，直到显式 switch（`backend/app/services/content_production.py:721-753`、`backend/app/services/review.py:350-392`）。
- Publication Workspace 已提供 `/content/tasks/{task_id}` 修正入口，并只消费服务端 `switch_candidate`；无需增加跨 Domain 组件或版本列表请求（`frontend-v2/src/domains/publication/publication-workspace-page.tsx:319-337`）。
- Verification 子任务归档记录明确说明真实栈 Flow B 因上述投影缺口未实现（`.trellis/tasks/archive/2026-08/08-11-frontend-v2-publication-verification/implement.md:94-105`）。

## 需求

1. 服务端 Content Task 投影必须在 Publication Work 为 `ACTION_REQUIRED` 时反映当前内容的真实下一步：
   - 当前批准版本仍是 work 绑定版本，且该版本已有 FAILED verification：`PUBLISHING / REVISE_CONTENT`；
   - 新 HUMAN draft：`DRAFT / EDIT_AND_SUBMIT_REVIEW`；
   - 待审核版本：`REVIEW_PENDING / REVIEW_CONTENT`；
   - 被退回版本：`CHANGES_REQUESTED / REVISE_CONTENT`；
   - 新批准版本成为当前指针，或 work 已切换到尚无失败快照的新版本：`PUBLISHING / CONTINUE_PUBLICATION`。
2. 列表、详情、Editor Context 与 Review Context 必须继续复用同一个 `content_task_workflow_projection()`；前端不得从 Publication status 或 ContentVersion status 自行计算入口。
3. 内容创建与审核继续调用现有命令和页面；不得修改批准 Markdown、绕过审核、自动 switch 或创建第二套修订流程。
4. Publication Workspace 保持现有 task handoff 与 server-projected candidate 边界；不得请求全部 ContentVersion 或新增跨 Domain 依赖。
5. 真实栈 Flow B 必须使用独立记录，并通过 V2 UI 完成 FAILED → Content revision/review/approval → switch → result registration → PASSED；API 只用于测试前置数据与最终只读断言。
6. 不新增 OpenAPI 字段、数据库迁移、运行时依赖或全局状态；不修改任何 V1 运行时代码、测试或页面。若合同未变化，不机械更新 generated types。

## 验收标准

- [x] 失败核验后 Content Task 的 canonical 主入口为“修订内容”，Editor 可基于当前批准版本创建 HUMAN revision。
- [x] revision 创建后，Content Task 依次投影编辑、审核、退回修订或批准后的继续发布入口；所有写命令仍执行既有服务端守卫。
- [x] 批准替代版本后，Workspace Context 只暴露该 current approved version 为 `switch_candidate`，旧 work 绑定与旧 verification snapshot 在 switch 前保持不变。
- [x] 真实栈 Flow B 全程通过 V2 UI 完成业务命令，最终 Work/ContentTask 为 `COMPLETED`、PublishedArticle 与 work 同 ID，旧 verification 仍指向旧版本。
- [x] 原有正常发布中的 Content Task 仍投影 `PUBLISHING / CONTINUE_PUBLICATION`，已完成任务仍投影 `VERIFIED / VIEW_FULL_LINEAGE`。
- [ ] targeted backend integration、Frontend V2 component/production artifact、build、隔离真实栈和父任务最终门禁通过。
- [x] 无 OpenAPI/database contract 变更、无 V1 runtime/test/page 变更、无新 dependency、无客户端资格推导。

## Out of Scope

- 新 Content Editor/Review 页面、自动内容修复、自动抓取或比较公开页面、自动批准或自动 switch。
- 修改 Publication 状态机、ContentVersion 状态机、不可变历史、权限或数据模型。
- PublishedArticle 页面、GEO、完整 Phase 4 Publishing E2E checkpoint、通用 workflow/context abstraction。

## 依赖

- `frontend-v2-publication-workspace-core` 与 `frontend-v2-publication-verification` 已合并到 `main`。
- 本任务通过后，父任务才能执行最终集成门禁并归档。
