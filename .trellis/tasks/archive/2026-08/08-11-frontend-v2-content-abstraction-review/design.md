# Frontend V2 Content Abstraction Review — Design

## 1. 设计判断

本次审计没有发现需要公共 API、数据库、权限、状态机、read model 或跨 domain 重构的问题。Content slice 的核心所有权成立：route 组合、Content domain 业务映射、Design System 纯 UI、shared generated contract、TanStack Query server state、Router URL state、RHF form state 和 local transient state 彼此没有形成第二 owner。

最小实现只处理两个证据充分的结构问题：

1. 提升四个 Content route 已重复验证的通用意外错误 UI。
2. 删除两个没有行为的 `StatusBadge` 转发 wrapper。

其余重复外观不构成稳定抽象，保持局部。

## 2. Invariant

### 2.1 Route invariant

Content route 只负责：

- route params/search/head；
- 构造 domain query options；
- 条件 prefetch；
- 组合 domain page 与通用 route error boundary。

route 不解释业务错误码，不持有 Content status/action mapping，不从 status 推导资格，不 join DTO。

### 2.2 Domain invariant

- `content.api.ts` 是 Content API/query key 唯一 owner。
- `content-task-actions.ts` 是 Content List/Detail action mapping 唯一 owner。
- 各 surface model 拥有自己的 form/error/view projection；不建立跨 domain registry。
- `primary_task` / `available_actions` 决定入口；status 只用于显示或服务端投影的 readonly 描述。
- `current_content_version_id` 是当前主线唯一权威；浏览器不按 version、time 或 lineage 重新选择主线。

### 2.3 Design System invariant

Design System 只拥有可复用视觉、交互和可访问性。新 Pattern 不接收 Content DTO、status、action、权限、query client 或 route 对象。

## 3. 最小变更设计

### 3.1 `RouteError`

新增 `frontend-v2/src/design-system/workspace/route-error.tsx`：

```ts
type RouteErrorProps = {
  title: string;
  error: Error;
  onRetry: () => void;
};
```

职责仅为：

- 渲染既有 panel 样式；
- 保留 `role="alert"`；
- 展示调用方提供的标题与 `error.message`；
- 提供“重试”按钮并调用 `onRetry`。

不做：

- error code/status/request ID 分类；
- 路由跳转或 Query refetch；
- Content token/DTO 处理；
- registry、factory、variant config 或跨 domain 批量迁移。

四个 Content route 的 `errorComponent` 保持 route-local composition function 或直接闭包式组合（以 TanStack Router 类型允许的最短形式为准），但删除重复 JSX 与直接 `Button` 依赖。标题继续留在各 route，因为它属于页面语境。

### 3.2 删除 `StatusBadge` wrapper

`content-task-detail-page.tsx` 与 `content-review-page.tsx` 在现有调用点直接渲染：

```tsx
<Badge variant={presentation.tone}>{presentation.label}</Badge>
```

状态/阶段 registry 仍由 Content model 拥有。不得因此创建全局 `StatusBadge`、跨 domain status registry 或新的 presentation type。

## 4. 明确不采用的方案

- 不创建 `ReviewWorkspace`、`Editor framework`、`VersionDetail framework` 或 workflow engine：surface 合同与恢复语义不同。
- 不创建通用 API/error parser：现有 create/editor/review 的字段与冲突处理不同。
- 不提升 Metadata/EmptyValue：布局和 props 尚未收敛，共享后不会减少复杂度。
- 不拆分 `content.api.ts` 或 `content.fixture.ts`：文件长度不是 ownership 变化证据。
- 不删除 real-stack spec：与 component/fixture 的证明层级不同。
- 不顺手迁移 Product route 的同类错误 UI：超出批准的 Content slice 提交边界；可由后续真实消费者按同一 Pattern 自主采用。

## 5. 数据流与依赖方向

```text
TanStack Route
  ├─ params/search/head/loader/prefetch
  ├─ RouteError (Design System, pure UI)
  └─ Content Page
       ├─ content.api.ts / contentKeys (TanStack Query server state)
       ├─ Content model/action registry (business presentation)
       ├─ RHF (form state where applicable)
       ├─ local state (dialog/focus/pending/announcement/stale only)
       └─ Design System primitives/workspace/table/editor

OpenAPI generated DTO ← shared/api/generated
```

禁止的反向依赖：`design-system/shared → domains/content`、`domain → routes`、`page → 第二 API/DTO owner`。

## 6. 测试设计

- 在现有 `workspace-kit.test.tsx` 增加一个 `RouteError` 最小测试，证明 alert、标题、message 与 retry callback；不新建大套件。
- 复用 Content Detail/Review component tests 证明 `Badge` 内联不改变可见标签/tone 所在页面行为。
- 运行四个受影响 route 的 fixture Playwright，证明 direct route、错误/重试矩阵、请求边界和浏览器 runtime 审计未回归。
- 不重复运行 Content real-stack：计划内变更不触及 API、query keys、action mapping、current pointer、mutation 或 snapshot；已归档真实栈证据继续有效。若实际 diff 触及这些边界，停止并重新规划，而不是临时扩大测试。

## 7. 风险与回滚点

| 风险 | 控制 | 回滚点 |
| --- | --- | --- |
| 通用错误组件丢失 route-specific 标题或 retry | 标题由 route 显式传入；最小 component test + 四 route Playwright | 单独回退 `RouteError` 及四 route 替换 |
| Design System 被业务语义污染 | props 仅 `title/error/onRetry`；禁止 Content import | 删除新组件，恢复 route-local JSX |
| Badge 内联改变 tone/label | 完全复用现有 registry 值与 `Badge` | 恢复两个 page-local helper |
| 审计范围扩张到 Product/Phase 4 | 文件白名单与 9 文件上限；触发即停止 | 保留审计报告，撤销未批准的扩张 |
| 历史 real-stack 证据失效 | diff 审核确认不触及业务/数据流；否则停止重规划 | gate 判 `NOT_MET`，不开启夹带修复 |

所有计划内代码变更均为可逆的 UI 结构简化，不涉及数据迁移或兼容窗口。
