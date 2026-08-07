# PartSignal Frontend V2 技术架构

## 1. 目标

V2 技术架构优先解决：高密度业务工作台的长期可维护性、大量服务端筛选与 URL 恢复、表格逻辑与视觉解耦、复杂内容工作区、统一 Design System，以及服务端作为业务资格最终权威等问题。

V2 不以“最少迁移成本”为优化目标，而以“产品质量 + 长期架构质量”为优化目标。

## 2. 推荐技术栈

| 层 | 推荐 |
|---|---|
| UI Framework | React 19 |
| Language | TypeScript |
| Build | Vite |
| Router | TanStack Router |
| Server State | TanStack Query |
| Table Engine | TanStack Table |
| Virtualization | TanStack Virtual |
| Component Source | shadcn/ui |
| UI Primitives | Base UI |
| CSS / Tokens | Tailwind CSS 4 + CSS Variables |
| Icons | Lucide |
| Form State | React Hook Form |
| Validation | Zod |
| API Contract | OpenAPI |
| API Types | openapi-typescript |
| API Client | openapi-fetch |
| Markdown Editor | CodeMirror 6 |
| Markdown Render | unified/marked + DOMPurify |
| Charts | ECharts |
| Unit Tests | Vitest |
| Component Tests | Testing Library |
| E2E | Playwright |
| Component Workshop | Storybook |

版本策略：实现某个 Phase 时使用当时最新的兼容稳定版本，并通过 lockfile 固化，不在长期架构文档中锁死 patch 版本。

## 3. 为什么保留 React + Vite

PartSignal 是登录后的高度交互式业务工作台：SEO 不是核心、FastAPI 已经是明确后端、页面高度依赖客户端筛选/编辑/审核/状态推进。因此保持：

```text
Browser
  │
  ▼
Static React Application
  │
  ▼
FastAPI
  │
  ├── PostgreSQL
  ├── Redis
  ├── Celery
  └── Object Storage
```

不引入 Next.js Server 作为第二个应用服务层。

## 4. 为什么切到 TanStack Router

PartSignal 有大量应进入 URL 的状态：query、业务筛选、pagination、sort、date range、analytics dimensions、workspace section。

TanStack Router 适合原因：

1. 路由与 search params TypeScript 类型安全；
2. Search Params 是一等状态；
3. 可通过 Zod 校验 URL；
4. 文件路由天然形成业务层级；
5. 链接、导航和 search 状态统一类型推导。

原则：刷新、Back/Forward、复制 URL、打开新标签页后仍应恢复的状态，优先进入 URL。

## 5. TanStack Query 只管理 Server State

负责：列表、详情、workspace context、dashboard aggregate、mutations、cache invalidation。

不负责：modal open、未提交表单、列偏好、pathname/search params。

Query Key 以 domain 为第一层：

```ts
productKeys.list(search)
productKeys.detail(productId)
contentKeys.task(taskId)
publicationKeys.work(workId)
geoKeys.observation(observationId)
```

## 6. TanStack Table 是默认业务表格内核

TanStack Table 是 headless engine，负责：sorting、filtering、selection、visibility、sizing、pinning、pagination、controlled state。

PartSignal Design System 负责：markup、typography、density、hover、fixed action zone、status、empty/loading、responsive。

不做一个 100 props 的万能 `<DataTable />`，而做可组合 Table Kit：

```text
TableShell
TableToolbar
FilterBar
ColumnHeader
TablePagination
RowActions
BulkActionBar
EmptyTable
TableSkeleton
```

## 7. shadcn/ui + Base UI

定位不是“黑盒 npm UI 框架”，而是 PartSignal Design System 的高质量组件源码起点：

```text
Base UI
  ↓
shadcn/ui component source
  ↓
PartSignal primitives
  ↓
PartSignal patterns
  ↓
Domain UI
```

截至 2026-07，shadcn/ui 新项目默认使用 Base UI。V2 可直接修改组件源码、token、spacing、variant 和交互，不需要持续覆盖 Ant Design 默认设计。

## 8. Tailwind CSS 4

Tailwind 负责 spacing/layout/typography/responsive/component variants；核心品牌和语义值使用 CSS Variables。

禁止业务组件散落不可解释的颜色值。

## 9. 表单架构

统一使用 React Hook Form + Zod。

- Zod：客户端输入 schema、URL schema；
- RHF：dirty、errors、submit；
- OpenAPI generated types：API contract；
- Server：最终业务规则权威。

API DTO 不等同于 Form Schema；UI 可以有临时组合字段，但不得复制一套手写 API contract。

## 10. Markdown 编辑器

Markdown 是内容唯一可编辑正文源。V2 使用 CodeMirror 6，并提供：Edit / Split / Preview / Diff、搜索、快捷键、undo/redo、字数/行数、dirty state、revision state。

渲染结果必须安全 sanitization。

## 11. Charts

GEO Analytics 推荐 ECharts。Analytics table/chart 与 CRUD Table 是不同 Pattern，不为了“统一”强行共享所有布局。

## 12. 状态分层

| 状态类型 | 工具 |
|---|---|
| Server State | TanStack Query |
| URL / Navigation State | TanStack Router |
| Form State | React Hook Form |
| Table Engine State | TanStack Table；可恢复部分同步 URL |
| User UI Preferences | LocalStorage 或服务端 profile |
| Transient UI | React local state |
| Cross-page ephemeral | 只有确有需求再考虑 Zustand |

默认不引入 Redux。

## 13. Table State 的持久化边界

URL：search、filter、sort、pagination、date range、业务 view。  
User Preference：column visibility/order、density。  
Local：menu open、hover、temporary selection、modal/sheet。

## 14. 后端保持不变，但加强 Read Model

V2 不要求重写 FastAPI、PostgreSQL、Celery、Redis、OSS、OpenAPI contract-first 流程。

应加强 UI-oriented Read Model，避免前端展示一行 Table 需要请求多个 endpoint。例如 `ContentTaskListItem` 应直接返回 product/platform/workflow_stage/primary_task/current_content/updated_at。

复杂 Workspace 可提供专用 context endpoint，例如 review context 一次返回 content、diff、fact snapshot、generation snapshot、quality issues、timeline 和 actions。

## 15. 不作为 V2 主方案的技术

### Ant Design / Pro

成熟且适合标准企业后台，但 V2 目标是定制专业工作台；继续深度 override 会让框架默认体验与产品目标长期拉扯。

### Next.js

不解决主要问题，且会增加第二 server layer。

### Refine

适合资源型 CRUD/admin；PartSignal 已经是深领域 workflow，容易被 resource abstraction 反向限制。

### MUI X

能力强，但产品更依赖成品组件模型。

### AG Grid

保留为特种工具：十万行、Excel 式编辑、range selection、grouping/pivot。一般业务表格仍以 TanStack Table 为默认。

## 16. Foundation 验收

- [ ] TanStack Router 文件路由
- [ ] Search Params Zod validation
- [ ] Query key conventions
- [ ] OpenAPI generated types + client
- [ ] shadcn/Base UI primitives
- [ ] Tailwind token 基线
- [ ] TanStack Table Kit
- [ ] RHF + Zod Form Kit
- [ ] CodeMirror 基础编辑器
- [ ] Storybook
- [ ] Vitest + Testing Library
- [ ] Playwright
- [ ] lint / typecheck / unit / e2e / build CI

## 17. 参考

- 当前前端 package.json: https://github.com/ccisnoxx/partsignal/blob/main/frontend/package.json
- TanStack Router Search Params: https://tanstack.com/router/latest/docs/guide/search-params
- TanStack Router Type Safety: https://tanstack.com/router/latest/docs/guide/type-safety
- TanStack Table: https://tanstack.com/table/latest/docs/introduction
- shadcn Base UI default: https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
