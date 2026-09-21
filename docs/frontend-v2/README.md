# PartSignal Frontend V2 文档索引

> 状态：已实现 / canonical frontend 设计基线
> 基线日期：2026-08-07  
> 适用仓库：`ccisnoxx/partsignal`  
> 建议落盘位置：`docs/frontend-v2/`

## 1. 文档目的

这组文档记录 PartSignal canonical frontend 的产品与工程设计。原 Frontend V2 已于 2026-08-29 在开发阶段提升为唯一 `frontend/` 源码 owner；目录名 `docs/frontend-v2/` 作为设计与决策历史入口保留。其目标不是把旧 Ant Design 页面“换皮”，而是围绕 PartSignal 的真实业务生命周期建立信息架构、路由、页面模式、Design System、服务端驱动业务动作模型、代码边界、迁移记录以及测试验收体系。

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
| [07-migration-plan.md](./07-migration-plan.md) | 已完成迁移的历史、分支决策、阶段门禁与 Cutover 记录；仅相关任务读取 |
| [08-testing-quality-and-acceptance.md](./08-testing-quality-and-acceptance.md) | 单测、组件测试、E2E、视觉与响应式验收 |
| [09-architecture-decisions.md](./09-architecture-decisions.md) | 关键 ADR / 不选方案 / 长期约束 |
| [10-frontend-redevelopment-plan.md](./10-frontend-redevelopment-plan.md) | 新一轮前端重新开发的启动、交付顺序、验证节奏与跨会话恢复 |

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

仓库 README 将系统定义为“面向电子元器件国产替代业务的多平台 GEO 内容运营系统”，当前 MVP 已实现产品事实、不可变事实版本、内容生成与版本管理、人工发布登记、发布验证、GEO 观测等纵向闭环。

当前 canonical `frontend/` 基线包含 React、TypeScript、Vite、TanStack Router、TanStack Query、TanStack Table、Tailwind CSS、shadcn/ui、Base UI、openapi-typescript 和 openapi-fetch。旧 Ant Design/React Router 前端源码与双前端 pipeline 已退役。

当前 canonical 路由按 Workbench、Product、Content、Publishing、GEO、Configuration 和 System 组织；旧入口只通过显式 legacy redirect 进入 canonical route，不保留第二套 V1 页面。

## 6. 开发使用方式

按问题选择资料，不为熟悉项目加载整套文档：

| 变更 | 读取 |
|---|---|
| 技术栈、依赖或代码边界 | `01`、`06`，涉及既有决策时再读 `09` |
| 路由、导航或 URL state | `02` |
| 页面、Workspace 或业务流程 | `03`，涉及动作资格时加 `05` |
| Design System、交互或响应式 | `04` |
| 测试策略或验收边界 | `08` |
| 迁移、legacy route、阶段门禁、分支或 Cutover | `07` |
| 新一轮前端重新开发或跨会话接续 | `10`，再按实际页面读取 `01`–`06`、`08`、`09` |

实现时确认所属 domain、状态 owner、服务端动作投影、可复用 Pattern 和受影响的验收边界。只有形成跨消费者的稳定模式时才提升到 `design-system/` 或记录 ADR。

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
