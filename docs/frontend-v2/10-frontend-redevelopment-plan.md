# PartSignal 前端重新开发执行方案

> 状态：规划基线；前端重新开发尚未启动
>
> 记录日期：2026-09-21
>
> 用途：供后续会话恢复目标、实施顺序与验收边界。本文不记录每个实施任务的实时进度。

## 1. 目标与范围

按本目录的产品和工程蓝图重新开发 PartSignal 前端，交付完整的内容运营工作台。重新开发的对象是前端页面、交互、视觉系统和必要的前端代码结构；现有 FastAPI、OpenAPI、PostgreSQL、Celery、Redis 与对象存储继续提供业务能力。API 或 read model 确有缺口时，按合同优先流程修改对应权威 owner。

当前 `frontend/` 已是 V2 的唯一 canonical 源码。旧 V1→V2 迁移、双前端保护和 Phase 退出门禁属于 [07 迁移记录](./07-migration-plan.md)；本方案是一轮新的前端开发，不从历史 Phase 0 重新判定已完成的迁移。现有前端可作为行为、接口和回归场景的参考，具体代码的保留或替换由启动盘点决定。

本次请求只交付规划文档。后续代码实施、源码接替、提交、发布、部署或远端操作按用户届时的请求与项目规则执行。

## 2. 权威资料与冲突处理

| 决策对象 | 首要资料 |
|---|---|
| 技术栈、状态归属 | [01 技术架构](./01-technical-architecture.md) |
| 导航、路由、URL 状态 | [02 信息架构与路由](./02-information-architecture-and-routing.md) |
| 页面内容和业务流程 | [03 页面与工作流蓝图](./03-page-and-workflow-blueprint.md) |
| Token、组件、响应式、无障碍 | [04 Design System 与交互](./04-design-system-and-interaction-spec.md) |
| 业务动作、read model、错误 | [05 业务动作与 API](./05-business-actions-state-and-api-contract.md) |
| 目录、依赖方向、模块 owner | [06 代码架构](./06-code-architecture-and-project-structure.md) |
| 验收证据 | [08 测试与验收](./08-testing-quality-and-acceptance.md) |
| 已确定的结构性决策 | [09 ADR](./09-architecture-decisions.md) |
| API 与持久化事实 | `contracts/openapi.yaml`、`contracts/database.md` |

`07` 仅用于迁移、legacy route、Cutover 或历史门禁问题。具体页面任务只读取所涉蓝图和合同。页面蓝图与现行 API 不一致时，先确认实际业务需求，再在权威文档中解决冲突；不能靠前端猜测字段、动作资格或错误含义。现有实现是盘点证据，不自动覆盖上述合同。

## 3. 启动阶段：形成可执行基线

### 3.1 保护当前工作

新会话先检查 `git status`、当前 Trellis 任务和相关未提交改动的归属。候选实现使用不覆盖这些改动的独立工作区；开始修改前记录基准 commit、候选文件范围和可恢复点。分支与提交方式依据当时用户指示和根 `AGENTS.md` 选择，不能直接套用 `07` 的历史临时分支例外。候选完成前，当前 `frontend/` 仍是仓库的 canonical 源码。

### 3.2 做页面与接口差距清单

以 [02 路由表](./02-information-architecture-and-routing.md) 为全集，先做一张轻量清单：route、页面 Pattern、现有页面位置、明显缺口和依赖。详细核对只针对即将开发的业务链展开，不在启动时审计所有页面。当前页面卡至少记录：

| 字段 | 要回答的问题 |
|---|---|
| Route / Pattern | 是 Table、List、Workspace、Detail 还是 Analytics？ |
| 页面结果 | 用户在此页要查看、编辑或推进什么？ |
| 数据合同 | 首屏 read model、按需读取与 mutation 分别是什么？ |
| 状态 owner | 哪些在 URL、Query、表单或局部 UI 中？ |
| 动作与错误 | `primary_task`、`available_actions`、revision 和稳定错误码如何呈现？ |
| 当前差距 | 可保留、需替换、缺失，及其具体原因 |
| 验收证据 | 页面行为、浏览器场景、响应式和无障碍需要证明什么？ |

将当前业务链的差距拆成独立、可审查的交付任务。优先修复阻塞首条业务链的合同缺口，不提前为后续页面建立未被证明需要的 read model、组件或抽象。进入下一业务链时再补充该部分的详细页面卡。

### 3.3 确认视觉样板

`04` 定义了组件层级与交互原则，但没有逐像素的成品页面。先用 `/products` 制作桌面与窄屏样板，确认信息密度、字体、色彩、表格与操作层级，再把经过真实页面验证的通用规则沉淀到 Design System。视觉样板的结论记录在对应实施任务中，不以一张静态图代替可操作页面。

## 4. 交付顺序

| 顺序 | 交付 | 完成标志 |
|---|---|---|
| 1 | Foundation | 登录与 App Shell、路由和 URL schema、OpenAPI client、Query、Token 与必要 primitives 可运行；生产构建通过。已有合格实现经盘点可直接复用。 |
| 2 | Product Facts | `/products`、新建、详情、事实工作区、审核与只读历史构成真实操作闭环；Table、Form、Workspace、Detail 模式得到首次验证。 |
| 3 | Content | 创建任务、编辑 Markdown、审核和不可变版本详情贯通；当前内容主线与动作只消费服务端投影。 |
| 4 | Publishing | 发布工作、发布成果和内容问题三个资源边界清楚；登记、核验与问题处理可操作。 |
| 5 | GEO | 观测、详情、更正、问题库和洞察按服务端事实与历史边界实现。 |
| 6 | Configuration 与 System | 平台、Prompt、AI 渠道、用户与审计按权限和敏感数据合同交付。 |
| 7 | Workbench | 各业务域稳定后消费单一聚合 read model，提供实际待办入口与跨域摘要。 |
| 8 | 集成与接替 | 全部 canonical 路由和核心链路验收，检查构建、部署引用与回退点；按单独授权执行实际接替或发布。 |

每一行可分成多个独立任务；顺序表示依赖和验证重点，不要求机械复制 `07` 的历史任务数量。先完成真实消费者，再提升通用 Pattern。Workbench 最后交付遵循 [ADR-017](./09-architecture-decisions.md)。

## 5. 单个页面的开发循环

1. **定边界**：只读取该 route 对应的 `02/03/04/05` 段落、OpenAPI 类型、必要的数据库合同及现有实现。写明可观察结果与受影响文件。
2. **核合同**：列表首屏能否由一个 read model 绘制；Workspace 是否已有一致的 context；业务阶段、主任务和动作是否由服务端返回。缺口按 `OpenAPI/database → backend → generated types → frontend` 处理。
3. **实现**：遵守 `routes → domains → design-system/shared`；route 负责 URL、权限边界和组合，domain 负责业务展示与命令，Design System 只负责通用交互。Server State 用 Query，URL State 用 Router，Form State 用表单，临时 UI 用局部 state。
4. **检查真实页面**：覆盖首屏、空态、错误、关键操作与反馈；检查 375、768、1024、1440 宽度以及键盘与焦点。只在相关行为变化时扩展额外场景。
5. **留下证据**：运行受影响的测试、类型检查与构建；查看 diff，并记录实际通过项、未运行项与剩余问题。下一任务复用仍有效的证据。

每个可交付页面至少满足 `08` 的 Product、Architecture、Contract、Test、Responsive、Accessibility、Production Build 完成标准。Fixture Playwright 证明页面与前端产物；真实栈 E2E 证明跨服务业务闭环，两者在记录中明确区分。

## 6. 验证节奏

- 页面开发中先用直接覆盖行为的 unit/component 与相关 Playwright；静态检查和受影响 package build 在可审查候选形成时运行。
- 修改 OpenAPI、后端 read model、权限、状态流或 mutation 时，增加 `make contract-check` 与对应 backend 测试，并验证 generated types 一致。
- 共享合同、整体结构、接替或发布候选按项目门禁扩大验证；`make verify` 不作为每次低风险页面调整的固定步骤。
- 已通过且输入未变化的结果直接复用。失败先归因，只有代码、环境、依赖或诊断证据变化后才重跑；不因历史 Phase 曾有门禁而重演旧验收。
- 实际接替与远端发布分别核对当时的部署和授权边界；本规划不把开发阶段检查写成生产门禁已通过。

## 7. 首批任务与新会话入口

**首个规划交付**：生成第 3.2 节的轻量路由清单，并为 `/products` 写一张可执行页面卡。该卡须列出 URL 搜索/分页、服务端列表投影、唯一 row Primary、详情入口、空/错/加载状态、响应式与浏览器验收。同时指出当前基础层哪些可复用，哪些需要重建，并给出第一个代码任务的准确范围。

**首个代码交付**：根据盘点结论完成 Foundation 的实际缺口；随后交付可操作的 `/products` 样板页。不能把占位数据、固定成功命令或只有静态外观的页面算作完成。下一步进入 Product Facts 的其余页面和真实闭环。

后续新会话从以下步骤恢复：

1. 阅读本文件、[README](./README.md)、根与 `frontend/AGENTS.md`，并检查 Trellis 当前任务和工作树；本文件的日期与阶段顺序不能替代实时状态。
2. 找到上一项已完成任务的实际验收与未完成项。已有差距清单或页面卡时继续使用，不重新盘点已确认且未变化的内容。
3. 选择下一项可独立审查的目标，按本文件第 5、6 节实施与验证；每项任务记录其来源文档、范围、验收、实际证据和交接点。
4. 只有页面行为、公共合同或结构性决策确实变化时，更新本目录相应权威蓝图或 ADR；实时进度保存在 Trellis 任务中，不在本文复制第二套状态表。

可用于新会话的启动语句：

> 请从 `docs/frontend-v2/10-frontend-redevelopment-plan.md` 恢复前端重新开发。先核对当前工作树、Trellis 任务和已完成证据；按计划选择下一项可审查交付，从相关蓝图与 API 合同读取最小上下文，然后完成实现与对应验证。保留其他会话的未提交改动。
