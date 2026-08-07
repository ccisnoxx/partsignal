# PartSignal Frontend V2 Architecture Decisions

本文作为简化 ADR 索引。重大变化应继续追加 ADR，而不是只在 PR discussion 中达成。

## ADR-001：新建 `frontend-v2/`

**Decision**：V2 在独立前端目录开发，成熟后整体替换 V1。  
**Why**：Router/UI/CSS/Table 均是核心变更；避免旧 Ant Design styles 与新系统污染；V1 保持业务参考。

## ADR-002：保留 React + Vite，不切 Next.js

**Decision**：React SPA + FastAPI。  
**Why**：登录后业务工作台、SEO 非核心、FastAPI 已是明确后端、高交互，避免第二 server layer。

## ADR-003：使用 TanStack Router

**Decision**：从 React Router 切到 TanStack Router。  
**Why**：PartSignal 大量 filter/pagination/sort/date/workspace section 应进入类型安全 URL。

## ADR-004：TanStack Query 只管理 Server State

禁止把 URL/form/local UI state 混进 Query cache。

## ADR-005：TanStack Table 是默认业务表格 engine

所有一般业务表格使用 TanStack Table + PartSignal Table Kit。真正 spreadsheet/huge grid 才单独考虑 AG Grid。

## ADR-006：shadcn/ui + Base UI

用 shadcn component source + Base UI primitives 构建 PartSignal Design System，以获得产品级自定义和可访问性基础。

## ADR-007：V2 不继续以 Ant Design 为基础

不是因为 Ant Design 不成熟，而是 V2 要从“标准后台”升级为高度定制的专业工作台。

## ADR-008：审核不占 Sidebar

Fact Review / Content Review 是 Workflow route。入口来自 Workbench、row Primary Action、deep link。

## ADR-009：发布资源一拆三

```text
/publishing/work
/publishing/articles
/publishing/issues
```

前端与 `PublicationWork / PublishedArticle / PublishedContentIssue` 领域边界一致。

## ADR-010：内容编辑 route 以 Task 为入口

主编辑：`/content/tasks/:taskId/editor`。  
历史版本：`/content/versions/:versionId`。

原因：`ContentTask.current_content_version_id` 是当前内容主线权威指针。

## ADR-011：不可变对象统一 Detail

Fact submitted snapshot、Content history、PublishedArticle、verification snapshot、audit record、GEO history 等使用 readonly Detail。

## ADR-012：每行一个 Primary Action

Row 标准 `[Primary] [•••]`，最多一个 Primary。

## ADR-013：不显示冗余“查看详情”

对象名称/行承担详情导航。只有确有语义或可访问性原因时再例外。

## ADR-014：业务资格服务端权威

前端不从 status/role 推导另一套 action eligibility，消费 `workflow_stage / primary_task / available_actions`。

## ADR-015：Read Model 优先于客户端拼装

复杂列表/Workspace 由 API 提供 UI-oriented projection/context，避免 waterfall、snapshot 不一致和前端 join。

## ADR-016：Domain Vertical Slice

主要 domain：product、content、publication、geo、platform、generation、identity、audit。

## ADR-017：Workbench 最后实现

Dashboard 是所有 domain 的聚合，应在 Product/Content/Publishing/GEO 稳定后实现。

## ADR-018：Prompt 使用 Workspace

Prompt 使用 Library + Editor + Preview 三栏，不退化成普通表单。

## ADR-019：GEO Analytics 与业务 Table 分离

Analytics 使用自己的 Pattern/ECharts，不强行复用 CRUD Table 视觉。

## ADR-020：测试 Pattern，而不只测试页面

Design System Pattern 必须有 Storybook/component coverage；关键 domain workflow 用 E2E。

## 后续建议 ADR

未来以下问题单独建 ADR：是否引入 AG Grid、server-side user preferences、Command Palette、多租户、实时协作、WebSocket/SSE、错误监控平台、自动发布、i18n。
