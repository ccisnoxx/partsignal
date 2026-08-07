# PartSignal Frontend V2 Design System 与交互规范

## 1. 目标

Design System 的目标不是做一套“漂亮组件”，而是把产品规则固化到 API 和 Pattern 中，避免每个业务页面自行决定按钮层级、action column、empty/loading/error、status color、workspace layout、dialog/sheet 和危险操作。

## 2. 分层

```text
Base UI
  ↓
Primitives
  ↓
Patterns
  ↓
Domain Components
  ↓
Routes
```

Primitives：Button、IconButton、Input、Textarea、Badge、Tooltip、Popover、DropdownMenu、Dialog、Sheet、Tabs、Select、Combobox、Checkbox、Radio、Switch、Skeleton、Separator。

Patterns：PageHeader、WorkspaceHeader、FilterBar、DataTable Kit、RowActions、BulkActionBar、DetailSection、Timeline、EvidenceViewer、MarkdownEditor、StickyActionBar、EmptyState、ErrorState。

Domain UI 不应重新实现这些基础交互。

## 3. Token 系统

Surface：`surface-app`、`surface-panel`、`surface-raised`、`surface-overlay`、`surface-selected`。  
Text：`text-primary`、`text-secondary`、`text-muted`、`text-disabled`、`text-danger`。  
Border：`border-subtle`、`border-default`、`border-strong`、`border-focus`。  
Semantic：`success`、`warning`、`danger`、`info`。

业务状态颜色必须通过 status registry 使用，禁止 feature 自行写颜色。

## 4. Typography

建议层级：`display`、`page-title`、`section-title`、`body`、`body-sm`、`label`、`mono`。产品界面不要靠大量粗体制造层级。

## 5. Page Header

标准：Breadcrumb → Title/Actions → Description/metadata。Page-level Primary 最多一个，例如 `[新建产品]`、`[创建任务]`、`[新建观测]`，其他进入 overflow。

## 6. Data Table Kit

```text
design-system/data-table/
├── table-shell.tsx
├── table-header.tsx
├── table-body.tsx
├── table-toolbar.tsx
├── filter-bar.tsx
├── column-header.tsx
├── column-visibility.tsx
├── pagination.tsx
├── row-actions.tsx
├── bulk-action-bar.tsx
├── empty-table.tsx
├── table-skeleton.tsx
└── types.ts
```

不要做 `showSearch/showFilter/type/variant` 堆叠的万能组件。每个 domain 自己组合 Table Kit。

## 7. Table 列角色

```ts
type ColumnRole =
  | "primary"
  | "status"
  | "metadata"
  | "numeric"
  | "date"
  | "actions"
```

Design System 根据角色提供默认 alignment、text treatment、truncation 和 responsive priority。

## 8. Table 行点击

- Primary object cell 一定是 link；
- 整行可点击时保证 keyboard accessibility；
- checkbox/menu/button 不触发行导航；
- 不依赖 double click。

## 9. Action Column

标准：`[Primary] [•••]`，建议 144px。

行内主操作默认用安静的 button/link variant；页面最强视觉 Primary 留给“新建/创建”。Overflow 统一 IconButton + Dropdown。

## 10. RowActions API

```ts
interface RowAction {
  key: string
  label: string
  intent: "primary" | "secondary" | "danger"
  enabled: boolean
  disabledReason?: string
  href?: string
  command?: string
  confirmation?: {
    title: string
    description: string
  }
}
```

`RowActions` 不知道 domain state，只消费已经解析后的 actions。

## 11. BulkActionBar

仅 selection > 0 时出现：

```text
3 selected        [Enable] [Disable] [Clear]
```

Destructive bulk action 必须明确确认；server 必须重新校验；partial failure 要清楚反馈。

## 12. FilterBar

默认：`Search | Primary filters | More filters | Reset`。

所有可恢复筛选进入 URL；filter change 通常回 page=1；Reset 只重置业务筛选，不清用户 column preference。

## 13. Status

建立统一 `StatusBadge` / `WorkflowStage` registry。禁止 feature 出现大量 `status === ... ? <Tag color=...>`。

Registry 只提供 label、semantic tone、optional icon、description，不提供业务动作资格。

## 14. GEO Outcome Indicators

Discovered / Mentioned / Accurate 使用紧凑 indicator，如 `●发现 ●提及 ●准确`，并保证不只依赖颜色，tooltip 有解释。

## 15. Workspace Kit

```text
design-system/workspace/
├── workspace-shell.tsx
├── workspace-header.tsx
├── workspace-pane.tsx
├── workspace-tabs.tsx
├── sticky-action-bar.tsx
├── context-panel.tsx
└── activity-timeline.tsx
```

Desktop 三栏推荐：Context 260–300px，Main flex(min 520px)，Reference 320–380px。宽度不足时 Reference 先转 Sheet/Tab，再收 Context，Main 永远保持可用。

## 16. Sticky Action Bar

适用于 Fact submit、Content submit、Review、Observation correction、Publication result/verification。

结构：左侧保存/状态/风险提示，右侧 actions。危险/不可逆动作必须说明后果。

## 17. Detail Pattern

标准顺序：DetailHeader → Summary → Metadata → Main Artifact/Snapshot → Evidence → Timeline/Activity → Related Objects。

不可变对象显示明显 readonly/snapshot 语义。

## 18. Empty / Loading / Error

区分：初始空、筛选后空、无权限、错误。

列表 loading 用 skeleton rows 保持宽度稳定，不用整页 spinner 抹掉上下文。Workspace 尽量保留 shell/header，主 artifact skeleton。

Error contract 统一解析 title/message/field errors/request id/retryability。Revision conflict 要显示“内容已被其他操作更新”，提供重新加载，而不是 generic toast。

## 19. Destructive Action

统一 Confirm Dialog，必须包含对象名称、实际后果、是否可恢复、dependency/reference 情况。

例如 GEO Topic 被引用时，UI 应展示不能删除的具体原因，而不是 generic 400。

## 20. Dialog vs Sheet vs Page

Dialog：短任务/简单确认/小型元数据编辑。  
Sheet：辅助详情、Audit detail、mobile reference。  
Page/Workspace：复杂 form/workflow。

禁止把长工作流塞进 Modal。

## 21. Responsive

至少测试 375 / 768 / 1024 / 1440。

窄屏 Table 保留 primary/status，metadata 可隐藏；极窄屏转 List，而不是无限压缩。Workspace side panes → Tabs/Sheet；Sticky action 适配 safe area。

## 22. Accessibility

至少：keyboard navigation、visible focus、icon aria-label、table header semantics、menu keyboard、dialog focus trap、status 不只依赖颜色、form error 关联 label、contrast、reduced motion。

## 23. Storybook 要求

必须有 Story：PageHeader、StatusBadge、TableShell、RowActions、FilterBar、BulkActionBar、EmptyState、WorkspaceShell、StickyActionBar、DetailSection、MarkdownEditor、EvidenceViewer、Timeline。

每个 Story 至少覆盖 default/loading/empty/error/long text/disabled/destructive/narrow viewport。
