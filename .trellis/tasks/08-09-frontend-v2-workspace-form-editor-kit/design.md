# 技术设计

## 1. 最小设计

实现三个相互独立但可组合的 Design System pattern：

```text
Product domain（后续）
  ├─ 提供 slots / resolved actions / RHF schema / mutation 结果
  ↓
Workspace + Form + Editor Kit
  ↓
现有 primitives / tokens / TanStack Router
```

组件保持受控、domain-neutral。Workspace 只拥有布局，Form 只适配 RHF，Editor 只拥有 CodeMirror view 与当前视图模式；业务数据、权限、revision 判定和状态转换均由未来 Product domain 与 Server 拥有。

## 2. Workspace 设计

### 固定三槽

`WorkspaceShell` 接收固定的 `main`、可选 `context`、可选 `reference`。每个槽只有 `label` 和 `content`，不接受 arbitrary region、layout preset、业务状态或 breakpoint 配置。

- `>=1280px`：三栏 Grid；Context 16rem、Main `minmax(0, 1fr)`、Reference 20rem。
- `<1280px`：使用 `WorkspaceTabs`，Main 为默认 tab；375/768/1024 共用同一降级路径。
- 缺失侧栏时自动省略对应列/tab，不生成空交互控件。
- Workspace loading/error 是 slot 内容，不是 shell 状态；调用方把 Skeleton 或 error/retry UI放进 Main，因此 shell 永远保留。

### Sticky actions

`StickyActionBar` 消费已经解析的 UI action：

```ts
type StickyAction =
  | {
      key: string
      label: string
      intent: "primary" | "secondary"
      enabled: boolean
      disabledReason?: string
      confirmation?: ActionConfirmation
      onSelect: () => void
    }
  | {
      key: string
      label: string
      intent: "danger"
      enabled: boolean
      disabledReason?: string
      confirmation: ActionConfirmation
      onSelect: () => void
    }
```

组件不读取 action token 或 status。危险动作使用现有 Design System confirmation dialog，disabled action 使用现有 Tooltip。底部 padding 使用 `max(1rem, env(safe-area-inset-bottom))`；action bar 保留在文档流中，再以 sticky 定位避免遮挡正文。

### Detail 与 Timeline

- `DetailSection`：`title`、`description?`、`actions?`、`children`，提供稳定 heading/section 关联。
- `Timeline`：接收 `{ id, title, description?, meta? }[]`，输出有序列表；不识别审核动作、业务状态或 actor DTO。

## 3. Form 设计

### RHF 边界

不创建自定义 `<Form>` wrapper。调用方使用 RHF `FormProvider` 和原生 `<form>`；`FormField<T>` 使用 `useController` 提供 field、fieldState 和稳定的可访问性 IDs：

```ts
type FormFieldProps<TFieldValues> = {
  name: FieldPath<TFieldValues>
  id?: string
  label: string
  description?: string
  required?: boolean
  render: (context: {
    field: ControllerRenderProps<TFieldValues>
    fieldState: ControllerFieldState
    inputId: string
    descriptionId?: string
    errorId?: string
  }) => ReactNode
}
```

`FormSection` 与 `FormActions` 只负责语义和布局。`ErrorSummary` 接收已经展开的 `{ id, message, fieldId? }[]`，避免递归猜测任意 schema；有 `fieldId` 时点击/聚焦对应控件。需要 summary 聚焦时，调用方用 `FormField.id` 固定控件 ID；省略时由组件生成唯一 ID。

服务端 field error 由 Domain 按稳定错误合同映射为 RHF `setError`。当前 OpenAPI `ErrorDetail.details` 是开放 object，没有稳定 `field_errors` schema，因此 Kit 不解析它，也不创建兼容 shape。

### DirtyGuard 与 Router

`DirtyGuard` 只接收 `when`，直接使用 `@tanstack/react-router` 的 `useBlocker`：

- `withResolver: true`：由现有 Dialog 呈现“留在此页 / 放弃修改并离开”。
- `enableBeforeUnload: when`：覆盖 reload、关闭标签页和外部导航。
- `shouldBlockFn` 仅在 pathname 离开时拦截 Router navigation；同一路由 search/hash 变化不视为离开。
- 不 import `app/router.ts`，不维护全局 dirty registry。
- 保存成功后调用方先 `reset(canonicalValue)`，令 `when=false`，再执行导航。

## 4. Editor 设计

### CodeMirror wrapper

`MarkdownEditor` 是受控组件。editable 分支必须提供 `onChange`；readonly 分支禁止 `onChange`。CodeMirror 使用 `basicSetup` 和 `markdown()`，不开放 extension/plugin 数组：

```ts
type MarkdownEditorProps =
  | {
      value: string
      onChange: (value: string) => void
      readOnly?: false
      ariaLabel: string
      defaultMode?: "edit" | "preview"
      dirty?: boolean
      revision?: number
      conflict?: { message: string; onReload: () => void }
      className?: string
    }
  | {
      value: string
      readOnly: true
      onChange?: never
      ariaLabel: string
      defaultMode?: "edit" | "preview"
      dirty?: false
      revision?: number
      conflict?: { message: string; onReload: () => void }
      className?: string
    }
```

- Edit/Preview mode 是组件本地 transient state，不进入 Query cache 或全局 store。
- `dirty` 和 `revision` 只显示调用方提供的 UI state，不负责计算或提交。
- conflict 显示固定标题、具体 message 和 reload button；不自动禁用业务 action，resolved actions 仍由调用方决定。
- readonly 同时启用 `EditorState.readOnly` 与 `EditorView.editable.of(false)`，显示“只读快照”。
- 字符数使用 Unicode code point 数，行数按换行计算；不引入统计依赖。

### 安全 Preview

`MarkdownPreview` 使用 `react-markdown` + `rehype-sanitize`，并遵循以下固定策略：

- `skipHtml`，不引入 `rehype-raw`。
- 使用默认安全 URL transform，不覆盖为任意 URL。
- 允许 CommonMark 基础 heading、paragraph、list、blockquote、link、code、pre、emphasis、separator、line break。
- 不允许 `img`、raw HTML、style、iframe、script 或事件属性。
- 不使用 `dangerouslySetInnerHTML`，不保存渲染 HTML。
- 不引入 `remark-gfm`；当前 Product Facts 没有已证实的 table/task-list 消费需求。

## 5. 依赖

- `react-hook-form@^7.85.0`：Form state、dirty、errors、submit。
- `@hookform/resolvers@^5.7.1`：复用现有 Zod 4 的官方 resolver。
- `codemirror@^6.0.2`：`basicSetup` 提供编辑器、搜索、history、undo/redo 和键盘基础。
- `@codemirror/lang-markdown@^6.5.2`：Markdown language support。
- `react-markdown@^10.1.0`：以 React elements 渲染 Markdown，不注入 HTML 字符串。
- `rehype-sanitize@^6.0.0`：显式 preview sanitizer。

不新增 Form、Editor、Markdown、state 或 responsive 领域的第二套库。

## 6. 兼容与回滚

- 不修改现有 route、App Shell、Table Kit 或 OpenAPI generated types；现有页面行为不变。
- 新组件没有业务消费者，仅由 Storybook/component tests 验证；后续 Product Facts 逐步接入。
- 回滚按依赖、Workspace、Form/DirtyGuard、Editor/Preview 四组独立删除；不需要 migration、兼容 wrapper 或 feature flag。
