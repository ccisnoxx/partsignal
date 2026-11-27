# C04 内容编辑核心

## Goal

验收 `/content/tasks/$taskId/editor` 的人工首稿、Markdown 保存/修订、预览差异、提交和当前主线归属。

## Requirements

- 前置 C03/F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.4 节、`05-business-actions-state-and-api-contract.md` ContentEditorContext/ContentVersion 命令、`08-testing-quality-and-acceptance.md` Editor 段及 OpenAPI。
- 首屏只读取一致的 Editor Context；current content 由服务端 `current_content_version_id` 指定。无当前版本时可创建人工首稿；已有 HUMAN DRAFT 可保存，AI DRAFT/退回版本通过新人工 revision 修订；只读版本不能原地改写。
- Markdown 为唯一正文编辑源，编辑/分屏/预览/Diff、sticky actions 和 DirtyGuard 可用。创建修订含 change summary，保存带 expected revision；提交审核只接受已保存当前主线。409 保留本地输入与 request ID，显式 reload 才采用 canonical；exact `CONTENT_REVIEW_PENDING` 独立阻断重试。
- 服务端 token 决定可用入口，前端不推导审核资格。AI 生成/自然化的额外行为归 C05；本项只确认其入口不会混入人工核心状态。

## Acceptance Criteria

- [x] model/组件测试证明人工首稿、保存、修订、提交、冲突、只读与 DirtyGuard。
- [x] 当前候选生产预览浏览器证明 Editor Context、核心路径、四档宽度/键盘；严格 fixture 与真实栈区分。
- [x] 记录实际代码、验收结果与 C05/C06 下一步。

## Scope

拥有 Content Editor 人工核心页面/model 与直接测试；AI 具体命令由 C05 验收。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：现有人工 Editor 页面/model/API 与当前合同相符，本项未修改生产代码或测试；C04 PRD 是本轮验收记录。
- `content-editor.model.test.ts` 与 `content-editor-page.test.tsx`：2 files / 21 tests 通过，覆盖 current pointer 与服务端 token、人工创建/保存 payload、迟到 context/冲突 blocker、提交审核和只读边界。
- 当前候选生产构建预览 `content-editor.spec.ts` 两个 Playwright project 全部 32/32 通过。其中人工核心场景覆盖 single Editor Context、no-draft 人工首稿、HUMAN DRAFT Ctrl/Cmd+S/Preview/Diff/DirtyGuard、AI/退回版本 based_on 人工 revision、409 本地保留与显式 reload、提交/删除/放弃后的 canonical 主线、375/768/1024/1440 及键盘与 sticky action。该文件同时包含 C05 的生成/重试/自然化场景，留待 C05 单独核对组件和真实栈。
- P08 本轮真实栈 Flow C 另证明独立 ContentTask 经人工首稿、保存、提交审核并由服务端 current pointer 维持主线。fixture 和真实栈证据分别记录。下一步 C05 编辑器 AI 生产；C06 内容审核在 C04 前置已满足后可进入。
