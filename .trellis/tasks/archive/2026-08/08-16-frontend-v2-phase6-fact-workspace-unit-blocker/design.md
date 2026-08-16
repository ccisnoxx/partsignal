# Frontend V2 Phase 6 Fact Workspace unit blocker 设计

## Status

`implemented`。本文件定义的测试边界修复与验证已完成，等待提交确认。

## 1. Invariant and authority

权威状态链为：

```text
CodeMirror user input
  -> EditorView.updateListener
  -> MarkdownEditor.onChange
  -> React Hook Form body_markdown
  -> MarkdownEditor controlled value / Preview / counters
  -> PUT ProductFactsDraftUpdate
```

`EditorView` 维护浏览器编辑表面，但 `.cm-content.textContent` 是其内部增量 DOM 投影，不是 RHF 草稿合同。Fact Workspace production 的业务权威是 RHF controlled value；真实浏览器交互由已有 Playwright 覆盖。

## 2. Root cause

- 失败 unit 在 `user.type()` 后立即缓存 `editor.textContent`，随后等待 409 UI 并拿同一 CodeMirror DOM 比较。
- 完整 suite 的资源/渲染时序使两次读取落在不同增量 DOM 帧，因而出现 `AO...` 与 `LCL...`；两者都不是完整 Markdown。
- 单文件 9/9 通过、production 无 reset、state-management spec 与 real-browser E2E 全部一致，因此不能为该 unit failure 修改 production。
- sibling search 找到三个相同风险点：Fact Workspace 409、Fact Workspace background refetch、MarkdownEditor readonly toggle。

## 3. Minimum correction

### Fact Workspace revision conflict

- 输入已知 Markdown 后通过现有 Preview/统计或 mutation payload 锁定 RHF controlled value。
- 409 后在具名 Preview 中精确断言本地正文仍存在，同时保留 conflict、request ID、dirty 断言。
- 显式 reload 后在同一公开表面断言 canonical 正文出现、本地正文消失、dirty 清除。

### Fact Workspace background refetch

- 删除即时缓存 CodeMirror DOM 的做法。
- refetch failure 后通过现有 Preview/统计证明 dirty controlled value 仍保持，并保留 refresh error/request ID/DirtyGuard 断言。

### MarkdownEditor readonly toggle

- 先通过现有 controlled counters/Preview 确认输入已进入 React value，再切换 readonly。
- 在 readonly 的公开 Preview/状态上精确证明最新受控值和不可编辑状态；不读取即时缓存的内部 DOM。

不新增 helper，因为三处均可直接复用已有 tabs、Preview、统计和 mutation 可观测面。

## 4. Exact writable scope

- `frontend-v2/src/domains/product/fact-workspace-page.test.tsx`
- `frontend-v2/src/design-system/editor/markdown-editor.test.tsx`
- `.trellis/spec/frontend/quality-guidelines.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Task artifacts

明确不修改两个对应 production TSX、API/generated/backend/database/deploy/dependencies。

## 5. Spec decision

在 frontend quality spec 的 jsdom 能力边界追加一条可执行约束：CodeMirror controlled value 不得用输入后立即捕获的 `.textContent` 证明；component unit 使用 controlled Preview、统计或 mutation payload，真实编辑 DOM exact text 由 Playwright 验证。

## 6. Gate decision

原 B-03 关闭、全部 required validation 和唯一最终候选 `make verify` 完整通过、cleanup 完整且 open P0/P1/P2 为 `0/0/0` 时，Engineering 与 Phase 6 Exit Gate 改为 `MET`。否则记录新 owner并保持 `NOT_MET`。

## 7. Risks and controls

- **断言变弱**：必须同时证明本地 exact content、dirty/request ID 和显式 reload，不只断言 conflict banner。
- **越权改 production**：diff review 禁止 `fact-workspace-page.tsx`、`markdown-editor.tsx` 及跨层文件变化。
- **只修一个症状**：同根三处捕获同时收口，但不扫描/改写无关 `textContent`。
- **门禁继续暴露新失败**：只归因，不自动扩大 Task 或第二次运行完整门禁。
