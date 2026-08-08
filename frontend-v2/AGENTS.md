# PartSignal Frontend V2 Rules

本文件只定义 `frontend-v2/` 特有规则。项目通用规则继续继承根 `AGENTS.md`，不要在这里复制。

## 必读上下文

每个 V2 Task 开始前依次读取：

1. 根 `AGENTS.md` 与本文件；
2. `docs/frontend-v2/07-migration-plan.md`；
3. 当前 Trellis task 的 `prd.md`、`design.md`、`implement.md`（存在时）；
4. `07` 最小上下文矩阵指定的专项蓝图，以及当前变更直接涉及的 OpenAPI、数据库合同或稳定 spec。

不要为“熟悉项目”加载全部蓝图。V1 只作为业务行为、API、字段与回归场景参考，不复制其 UI、路由、组件或页面状态结构。

## 技术栈与依赖

- 固定主栈：React 19、TypeScript、Vite、TanStack Router、TanStack Query、TanStack Table、shadcn/ui + Base UI、Tailwind CSS 4、React Hook Form + Zod、OpenAPI generated types/client。
- 测试栈：Vitest、Testing Library、Playwright、Storybook。TanStack Virtual、CodeMirror、ECharts、Zustand 等只在真实消费者证明需要时引入。
- 依赖方向固定为 `routes -> domains -> design-system/shared`。禁止 `design-system -> domain`、`shared -> domain/route`、`domain -> route`。
- Route 只负责 search validation、loader/prefetch、permission、metadata 和 composition；业务逻辑归 Domain。
- Domain 不导入其他 Domain 的内部组件。跨域展示通过 API summary DTO 或 route/application composition 完成。
- OpenAPI generated types 是 API 类型权威，不手写重复 DTO；Form Schema 和 UI View Model 可独立存在，但不得成为第二套 API 合同。

## 状态所有权

- **Server State**：TanStack Query，只管理列表、详情、Workspace context、aggregate、mutation 与 cache invalidation。
- **URL State**：TanStack Router，管理刷新、Back/Forward、复制链接或新标签页后需要恢复的 search、filter、sort、pagination、date range、view 与 workspace section。
- **Form State**：React Hook Form；Zod 负责客户端输入与 URL schema，服务端仍是业务校验权威。
- **Transient UI State**：React local state，管理 modal/sheet/menu、hover、临时 selection 和未提交的局部交互。
- TanStack Table 只拥有表格引擎状态；可恢复部分同步 URL，column visibility/order 和 density 属于用户偏好。

默认不使用全局 Store。只有跨路由状态无法由 URL、Query 或现有 Provider 拥有且已有真实需求时，才单独评估 Zustand。

## 服务端流程与 Action Registry

- 服务端返回的 typed `workflow_stage`、唯一 `primary_task` 和 `available_actions` 是业务阶段与可尝试动作的权威投影。前端不得从 status、role、权限 Hook、关联集合或分页结果重新计算资格。
- `primary_task` 决定资源唯一高频主入口；`available_actions - primary_task` 用于 overflow 或 Workspace 次级动作。页面级 create action 不属于资源 `primary_task`。
- 每个 Domain 的 Action Registry 只做 typed token 到 label、href、command、intent、disabled reason、confirmation 和 presentation 的穷尽映射，不计算 eligibility。
- Design System 只消费 resolved actions，不识别 Domain 状态。Status Registry 只映射显示语义，不提供动作资格。
- `available_actions` 不是授权凭证；mutation 必须由服务端重新校验。成功后使用 canonical response 或精准失效 query，竞态拒绝后展示真实错误并刷新资源。
- 未知 token、错误码或缺失字段必须通过类型、合同检查或显式错误暴露；不得解析 message、补默认值、创建字符串别名或按旧状态猜测兼容。

## Table、Workspace 与 Detail

- 一般业务表格使用 TanStack Table + 可组合 Table Kit；每个 Domain 自己组合 TableShell、FilterBar、Pagination、RowActions 等 Pattern。
- 禁止堆叠开关与变体的万能 DataTable。表格行最多一个 Primary，其他动作进入统一 overflow；对象主单元格承担详情链接，不增加冗余“查看详情”。
- 可恢复的搜索、筛选、排序和分页写入 URL；筛选变化通常回到第一页，不重置用户列偏好。
- Workspace 保证 Main artifact 始终可用，侧栏在窄屏转为 Tabs/Sheet，Sticky Action Bar 不遮挡正文。长工作流使用 Page/Workspace，不塞入 Modal。
- 只有已证实的 API waterfall 或 snapshot 一致性问题才新增专用 Workspace context endpoint；禁止客户端 join 多个接口拼业务快照，也不为未来页面预建 endpoint。
- Fact submitted snapshot、Content history、PublishedArticle、verification snapshot、audit record、GEO history 等不可变对象统一使用 readonly Detail，明确显示 snapshot/readonly 语义，不提供原地编辑入口。

## 固定开发节奏

所有 V2 Task 固定遵循：

```text
先阅读 -> 说明计划 -> 修改 -> 自测 -> 自审 -> 报告
```

- **阅读**：核实现有实现、contract、服务端投影和可复用 Pattern。
- **计划**：只保留一个可 review 目标，明确不做什么、预计文件、依赖层级和验证命令。
- **修改**：按 `contract/model -> query/action -> components -> route` 的顺序；发现 contract 缺口先修权威来源，不写前端临时兼容。
- **自测**：运行能直接证明变更的最小 unit/component、lint/typecheck、受影响 build；自 `/products` 起的业务 slice 留下相关 Playwright Test。页面按适用范围验证 375/768/1024/1440、keyboard、focus、Back/Forward、direct URL 和 refresh。
- **自审**：检查 contract、依赖方向、动作资格、URL state、可访问性、响应式和最终 diff；确认没有夹带下一 Task。
- **报告**：包含 Outcome、Changed Files、Contract / Architecture Decisions、Validation Run and Results、Documentation Updated or Unchanged、Residual Risks / Deferred Items、Recommended Next Task、Branch / Commit / Merge Status。下一 Task 只建议，不自动创建或实施。

## 禁止模式

- Redux；无真实跨页需求的全局 Store。
- Next.js 或第二个应用服务层。
- 万能 DataTable、万能筛选 Schema、跨领域通用业务 Action Registry。
- 客户端页面状态机，或从 status/role/message 推导动作、权限和流程。
- 猜测性兼容逻辑、静默默认值、重复 API DTO、客户端业务 join 和固定成功占位实现。
