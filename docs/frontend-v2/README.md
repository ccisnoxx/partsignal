# PartSignal Frontend V2 文档索引

> 状态：Draft / V2 重构基线  
> 基线日期：2026-08-07  
> 适用仓库：`ccisnoxx/partsignal`  
> 建议落盘位置：`docs/frontend-v2/`

## 1. 文档目的

这组文档用于指导 PartSignal Frontend V2 的产品与工程重构。V2 的目标不是把现有 Ant Design 页面“换皮”，而是围绕 PartSignal 的真实业务生命周期，重新建立信息架构、路由、页面模式、Design System、服务端驱动业务动作模型、代码边界、迁移计划以及测试验收体系。

## 2. 核心结论

PartSignal 应从“后台管理系统”升级为“电子元器件内容生产、审核、发布与 GEO 反馈闭环的专业运营工作台”。

推荐技术栈：

- React 19
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- TanStack Table
- TanStack Virtual
- shadcn/ui
- Base UI
- Tailwind CSS 4
- React Hook Form
- Zod
- openapi-typescript + openapi-fetch
- CodeMirror 6
- ECharts
- Vitest
- Testing Library
- Playwright
- Storybook

后端继续保留现有 FastAPI / OpenAPI / PostgreSQL / Celery / Redis 架构。

## 3. 文档目录

| 文档 | 用途 |
|---|---|
| [01-technical-architecture.md](./01-technical-architecture.md) | 技术选型、状态分层、关键技术决策 |
| [02-information-architecture-and-routing.md](./02-information-architecture-and-routing.md) | 左侧导航、完整路由、URL 状态规范 |
| [03-page-and-workflow-blueprint.md](./03-page-and-workflow-blueprint.md) | 全部页面形态、表格列、操作与工作流设计 |
| [04-design-system-and-interaction-spec.md](./04-design-system-and-interaction-spec.md) | Design System、Table Kit、Workspace Kit、交互规范 |
| [05-business-actions-state-and-api-contract.md](./05-business-actions-state-and-api-contract.md) | `workflow_stage`、`primary_task`、`available_actions` 与 Action Registry |
| [06-code-architecture-and-project-structure.md](./06-code-architecture-and-project-structure.md) | V2 目录、Domain Vertical Slice、依赖规则 |
| [07-migration-plan.md](./07-migration-plan.md) | 分阶段重构顺序、交付物与退出条件 |
| [08-testing-quality-and-acceptance.md](./08-testing-quality-and-acceptance.md) | 单测、组件测试、E2E、视觉与响应式验收 |
| [09-architecture-decisions.md](./09-architecture-decisions.md) | 关键 ADR / 不选方案 / 长期约束 |

## 4. V2 八条不可破坏原则

1. **Navigation 按业务生命周期组织，不按数据库表或代码 feature 组织。**
2. **审核属于 Workflow，不属于 Sidebar。**
3. **Table 负责扫描与比较，复杂业务进入 Workspace。**
4. **对象名称/行本身就是详情入口，不再常驻“查看详情”按钮。**
5. **每行最多一个 Primary Action + 一个 Overflow Menu。**
6. **业务动作由服务端 `primary_task / available_actions` 决定，前端不重建领域状态机。**
7. **不可变历史对象使用只读 Detail，不伪装成可编辑 CRUD。**
8. **URL State、Server State、Form State、Transient UI State 必须分层管理。**

## 5. 当前项目基线

截至 2026-08-07，仓库 README 将系统定义为“面向电子元器件国产替代业务的多平台 GEO 内容运营系统”，当前 MVP 已实现产品事实、不可变事实版本、内容生成与版本管理、人工发布登记、发布验证、GEO 观测等纵向闭环。

当前前端基线包含 React、TypeScript、Vite、Ant Design、TanStack Query、React Router、openapi-typescript 和 openapi-fetch。V2 文档不以兼容现有 Ant Design 页面为约束。

当前主要路由包括：`/`、`/products`、`/tasks`、`/content/:contentVersionId`、`/publications`、`/observations`、`/settings`、`/users`、`/audit`、`/configuration/*`。V2 会重新定义页面边界，而不是机械迁移。

## 6. 开发使用方式

每一个 V2 PR 都应回答：

- 它属于哪个 domain？
- 它对应哪一种页面 Pattern？
- URL 中保存哪些可恢复状态？
- 服务端的 `primary_task` / `available_actions` 如何映射？
- 是否复用了 Design System，而不是在 feature 内新造通用 UI？
- 是否增加了必要的 Storybook / unit / E2E 覆盖？
- 是否满足对应 Phase 的退出条件？

任何新 Pattern 在被第二个业务页面使用前，应优先进入 `design-system/` 或形成明确 ADR。

## 7. 参考资料

### PartSignal

- Repository: https://github.com/ccisnoxx/partsignal
- 产品与业务方案：`docs/GEO多平台内容运营系统方案设计.md`
- OpenAPI：`contracts/openapi.yaml`
- 数据库与状态机：`contracts/database.md`

### 推荐技术官方文档

- TanStack Router: https://tanstack.com/router/latest
- TanStack Query: https://tanstack.com/query/latest
- TanStack Table: https://tanstack.com/table/latest
- shadcn/ui: https://ui.shadcn.com
- Base UI: https://base-ui.com
- Tailwind CSS: https://tailwindcss.com
- React Hook Form: https://react-hook-form.com
- Zod: https://zod.dev
- CodeMirror: https://codemirror.net
- Playwright: https://playwright.dev
