# F06 Workspace、Form、Readonly Detail 与 Markdown 基础 Pattern

## Goal

完成清单 F06：以已有真实页面消费者验收 Workspace、Form、DirtyGuard、StickyActionBar、只读 Detail 与 Markdown 编辑/预览基础交互。

## Requirements

- 前置 F02 本轮通过。来源：`docs/frontend-v2/11-frontend-redevelopment-task-list.md` F06、`04-design-system-and-interaction-spec.md` 第 15–23 节、`06-code-architecture-and-project-structure.md` 的 Form/Editor 所有权，以及视觉系统规范。
- 表单状态由 RHF/Zod 与 Domain schema 持有；DirtyGuard 对未保存导航给出明确选择并恢复焦点；危险动作须确认；窄屏工作区保留主 artifact、草稿与操作栏。
- Markdown 仅作为正文可编辑来源，预览安全且只读快照不可编辑；Conflict 提供明确重新加载入口。不可变 Detail 按合同展示快照，无编辑控件。
- 当前实现已有独立组件与 Product/Content 页面消费者。本轮优先验证，发现明确缺口才做最小修复。

## Acceptance Criteria

- [x] 基础组件测试证明上述交互，包含安全预览、DirtyGuard、动作确认及只读语义。
- [x] 至少一个真实 Workspace/Detail 的生产 artifact 场景在 375/768/1024/1440 验证，无根级横向溢出；明确 fixture 与真实栈的边界。
- [x] 记录实际代码、验收证据、未覆盖项与 F07 下一步。

## Scope

主代理拥有 F06 的 `frontend/src/design-system/forms/`、`workspace/`、`editor/` 及必要的直接消费者修复；若需越界更改，先按合同重新判断影响。保持其他任务与会话改动。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：现有 `FormField`、`DirtyGuard`、`WorkspaceShell`、`StickyActionBar`、`DetailSection` 与 `MarkdownEditor/Preview` 已满足本轮检查的合同，未修改生产代码。RHF/Zod 由 Product 等 Domain 消费者持有。
- 四个设计系统组件测试文件 24/24 通过，覆盖字段错误关联、导航离开保护、动作禁用/确认、焦点恢复、窄屏面板草稿保留、只读编辑器和安全预览。
- 生产构建预览下 `fact-workspace.spec.ts` 与 `fact-version-detail.spec.ts` 两个 Playwright project 合计 20/20 通过；测试含 375/768/1024/1440 宽度、无根级横向溢出、DirtyGuard、保存/提交冲突与只读 snapshot。此为严格前端 fixture，不能替代真实后端不可变性或全流程联调。
- 下一步 F07 验证质量入口；各业务页更深的状态、权限与 API 验收留在对应 P/C/U/G/A 子任务。
