# PartSignal 前端重新开发完整任务清单

> 状态：待实施的完整 backlog；不是当前代码的完成状态
>
> 记录日期：2026-09-21
>
> 执行入口：[10 前端重新开发方案](./10-frontend-redevelopment-plan.md)

## 1. 使用方式

本清单覆盖 [02 的全部 canonical 路由](./02-information-architecture-and-routing.md)及认证、共享组件、业务闭环、旧链接和最终接替。编号是稳定的规划 ID，不是已创建的 Trellis task，也不表示历史 V2 Task 需要重跑。现有 `frontend/` 已实现 V2；每一项都要针对**本轮候选实现**核对合同与可观察结果，再记录保留、重写或补齐的实际工作和证据，不能直接继承 `07` 的历史 Gate 状态。

后续 Codex 会话按以下顺序使用 Trellis：

1. 检查工作树、活动任务与本清单；保留其他会话的改动。为本轮开发创建一个只记录总体目标和集成验收的父任务，或复用已创建的同一父任务。当前 GEO 后端任务不充当前端父任务。
2. 按编号选择下一项尚未有**本轮验收证据**的交付；为该项创建可独立审查的 Trellis 实施任务。`prd.md` 写可观察结果、范围与验收；仅在边界或执行依赖确实复杂时增加 `design.md`、`implement.md`。将本清单 ID、相关蓝图段落、受影响合同与前置任务写进任务资料。
3. 规划完成且用户已授权本地实施时，在同一会话启动该任务并完成代码与必要验证。R00 是启动准备；若它未发现实质阻塞，同一会话继续 F01，不以清单或页面卡作为唯一成果。
4. 每项收口时记录实际修改、测试结果、未通过项和下一编号。已有实现满足该项时，用当前候选的直接证据关闭该项，不制造重复代码；未满足时完成修复。进度与证据归 Trellis 任务，本清单只维护稳定范围和依赖。

每个实施任务使用 [10 的单页开发循环和验证节奏](./10-frontend-redevelopment-plan.md)。本清单中的“前置”表示验收依赖，不要求所有任务串行；能够独立实施的项可按文件所有权并行。业务 API 的最终权威是 `contracts/openapi.yaml`、`contracts/database.md` 和服务端；页面仅消费服务端 `workflow_stage`、`primary_task`、`available_actions`。发布、部署和远端操作另外核对授权。

## 2. 启动与 Foundation

来源：[01 技术架构](./01-technical-architecture.md)、[02 路由](./02-information-architecture-and-routing.md)、[04 Design System](./04-design-system-and-interaction-spec.md)、[06 代码架构](./06-code-architecture-and-project-structure.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| R00 | 开发基线与候选工作区 | — | 记录基准 commit、未提交改动归属、候选源码位置和恢复点；形成全站轻量路由表及 `/products` 页面卡；不覆盖现有工作。 |
| F01 | 应用启动、类型化 API 与状态 Provider | R00 | React/Vite/TypeScript、TanStack Router/Query、OpenAPI generated client、环境入口与生产构建可运行；生成类型有合同检查。 |
| F02 | Token 与核心 primitives | F01 | 字体、间距、surface/text/border/semantic token 和实际需要的 Base UI/shadcn primitives 在桌面与窄屏一致；焦点与语义可访问。 |
| F03 | 登录、会话、改密与退出：`/login`、`/account/security` | F01、F02 | 登录和强制改密流程可用；受保护路由、登出缓存清理、CSRF 与服务端权限边界成立；凭据不进入 URL、缓存或日志。 |
| F04 | App Shell、导航、面包屑、URL schema 与 404 | F01–F03 | 生命周期导航、`navId`、移动导航、direct/refresh/Back/Forward 和未知路径 404 正确；route 保持薄。 |
| F05 | Table Kit 与行操作 Pattern | F02 | TableShell、FilterBar、分页、空/错/加载、RowActions 和移动列表可组合；行至多一个 Primary，主单元格进入详情，筛选状态由 URL 持有。 |
| F06 | Workspace、Form、Readonly Detail 与 Markdown 基础 Pattern | F02 | 主 artifact 在四档宽度可用；RHF/Zod、DirtyGuard、Sticky Action Bar、CodeMirror/Preview 和不可变 Detail 形成可复用的实际交互。 |
| F07 | 前端质量入口 | F01–F06 | lint、typecheck、unit/component、Storybook、相关 Playwright 和 production build 有可运行入口；检查与当前单一 canonical 前端路径一致。 |

## 3. Product Facts

来源：[03 第 3 节](./03-page-and-workflow-blueprint.md)、[05 Product 合同](./05-business-actions-state-and-api-contract.md)、[08 Product 验收](./08-testing-quality-and-acceptance.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| P01 | 产品事实列表 `/products` | F04、F05 | 服务端分页/筛选/排序、URL 恢复、状态摘要、唯一主操作、详情链接及空/错/加载可用；桌面与移动样板确认视觉规则。 |
| P02 | 新建产品 `/products/new` | P01、F06 | 三字段表单、校验、DirtyGuard、pending 防重、结构化错误和成功后按响应 ID 进入详情。 |
| P03 | 产品详情 `/products/$productId` | P01 | 单一 Detail read model 显示事实、内容、发布、GEO 和 Activity 摘要；编辑使用 revision，动作仅取服务端投影。 |
| P04 | 事实工作区 `/products/$productId/facts` | P03、F06 | Markdown 是唯一编辑源；保存/提交带 expected revision；冲突保留草稿，提交产生不可变待审 snapshot。 |
| P05 | 事实审核 `/products/$productId/facts/review` | P04 | 单一审核上下文展示只读 snapshot、Diff 与记录；approve/request changes 由 action token 决定，409 不自动重放。 |
| P06 | 事实版本历史 `/products/$productId/facts/versions` | P03、F05 | 产品专用服务端分页、URL 页码恢复、六列只读表格、版本链接和产品 identity 边界成立。 |
| P07 | 事实历史版本 `/products/$productId/facts/versions/$versionId` | P06 | 单版本只读 Markdown、版本身份校验、审批信息与 canonical 返回链接；无编辑或业务命令。 |
| P08 | Product Facts 真实业务闭环 | P02–P07 | 由候选前端完成 create → enter → submit → review/return → revise → approve，证明下一步 ContentTask handoff；复核 Product domain 的重复映射和共享 Pattern。 |

## 4. Content

来源：[03 第 4 节](./03-page-and-workflow-blueprint.md)、[05 Content 合同](./05-business-actions-state-and-api-contract.md)、[08 Content 验收](./08-testing-quality-and-acceptance.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| C01 | 内容任务列表 `/content/tasks` | F05、P08 | 服务端阶段/归档/平台筛选与分页、当前主线摘要、生命周期动作、URL 恢复和永久删除范围确认可用。 |
| C02 | 创建内容任务 `/content/tasks/new` | C01、P08、F06 | creation-options、产品/批准事实/平台选择、Product handoff、幂等键、DirtyGuard 和响应 ID 导航可用。 |
| C03 | 任务详情 `/content/tasks/$taskId` | C02 | 单一 Detail snapshot 显示产品、事实、当前内容、生成/审核/发布摘要及 Activity；只按服务端 token 展示动作。 |
| C04 | 内容编辑核心 `/content/tasks/$taskId/editor` | C03、F06 | 人工首稿、Markdown 保存、修订、Preview/Split/Diff、提交与 DirtyGuard 可用；以 `current_content_version_id` 判定当前主线。 |
| C05 | 编辑器内 AI 生产与自然化 | C04 | 生成选项按需读取、模型明确确认、真实 job 生命周期、失败与 exact snapshot retry、自然化及服务端结果刷新可用；无固定成功路径。 |
| C06 | 内容审核 `/content/tasks/$taskId/review` | C04 | 单一 Review Context 展示不可变正文和依据；批准/退回带 revision，冲突不重放，审核记录追加且刷新消费者。 |
| C07 | 内容历史版本 `/content/versions/$versionId` | C03、C04 | 独立只读 Detail 展示来源、Fact 与 AI lineage、版本状态及审核历史；不改变 current pointer。 |
| C08 | Content 真实业务闭环 | C05–C07 | 人工与 AI 流程分别证明创建、编辑、审核、修订、批准、历史不变及进入 Publishing；复核 Content domain 的状态 owner 与共享组件边界。 |

## 5. Publishing

来源：[02 发布路由](./02-information-architecture-and-routing.md)、[03 第 5 节](./03-page-and-workflow-blueprint.md)、[05 发布合同](./05-business-actions-state-and-api-contract.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| U01 | Ready Queue 与发布工作列表 `/publishing/work` | C08、F05 | 待发布候选、工作列表、服务端筛选/分页及开始发布命令可用；身份摘要与主操作来自服务端。 |
| U02 | 发布工作区 `/publishing/work/$workId` | U01、F06 | 正文与平台/账号上下文、结果登记、核验、失败后的修订交接和事件可追溯；成功按 canonical Article ID 交接。 |
| U03 | 发布成果列表 `/publishing/articles` | U02、F05 | 服务端搜索/排序/分页、固定只读列、URL 恢复及详情链接可用；没有业务操作列。 |
| U04 | 发布成果详情 `/publishing/articles/$articleId` | U03 | 已核验成果、冻结来源 Markdown、Fact/生成 lineage、核验 snapshot 和时间线只读；问题入口按服务端 token。 |
| U05 | 内容问题列表 `/publishing/issues` | U04、F05 | 服务端阶段/状态筛选、问题摘要、主操作和详情导航可用；状态变化刷新 canonical 列表。 |
| U06 | 内容问题工作区 `/publishing/issues/$issueId` | U05、F06 | Issue、Article 与 repair task 的一致上下文、创建修复/解决、冲突保留输入和显式刷新可用。 |
| U07 | Publishing 真实业务闭环 | U02–U06 | Ready → 登记 → 核验成功 → Article → Issue → 修复/解决，以及失败核验 → 内容修订 → 重登记；不可变历史和动作权威得到验证。 |

## 6. GEO

来源：[03 第 6 节](./03-page-and-workflow-blueprint.md)、[05 GEO 合同](./05-business-actions-state-and-api-contract.md)、[08 GEO 验收](./08-testing-quality-and-acceptance.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| G01 | 观测列表 `/geo/observations` | U07、F05 | correction chain 当前尾摘要、服务端搜索/筛选/排序/分页、URL 恢复和 token 动作可用。 |
| G02 | 新建观测 `/geo/observations/new` | G01、F06 | Product/Topic/Article 候选、逐篇结果、证据上传、DirtyGuard、冲突刷新和 POST ID handoff 可用。 |
| G03 | 观测详情 `/geo/observations/$observationId` | G02 | Legacy/Manual 历史、证据、文章与 actor actions 只读展示；identity、404/403/409、删除确认与四档布局正确。 |
| G04 | 更正工作区 `/geo/observations/$observationId/correct` | G03 | 服务端 correction context、冻结字段、append-only 更正、文章 ID 合并、证据和 stale 409 恢复可用；历史不被原地改写。 |
| G05 | GEO 问题库 `/geo/topics` | G01、F05 | Topic 服务端列表与管理命令、引用数量/删除条件、筛选分页、冲突反馈和移动布局正确。 |
| G06 | GEO 洞察 `/geo/insights` | G01、F06 | 七参数 URL、服务端聚合/KPI/趋势/建议、drill-down、优化任务命令和空/部分/不可用状态可用。 |
| G07 | 洞察打印 `/geo/insights/print` | G06 | 同一只读 read model 和筛选人类标签进入打印布局；精确表格、分页与 print media 正确，无命令入口。 |
| G08 | GEO 真实业务闭环 | G02–G07 | 创建观测 → Detail → 更正 → 当前尾/历史读取，Topics 与 Insights 的关键跳转和错误边界可验证；复核 GEO domain 的状态与证据归属。 |

## 7. Configuration 与 System

来源：[03 第 7、8 节](./03-page-and-workflow-blueprint.md)、[05 配置与用户合同](./05-business-actions-state-and-api-contract.md)、[08 验收](./08-testing-quality-and-acceptance.md)。配置与 System 可按真实前置条件穿插在业务域之间；表中只写必要依赖。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| A01 | 平台列表 `/settings/platforms` | F05、F04 | 服务端 readiness、账号数量、筛选分页、启停/删除条件与确认可用；ADMIN/ENGINEER 投影正确。 |
| A02 | 平台工作区概览与生成配置 `/settings/platforms/$platformId` | A01、F06 | `overview|generation` URL tab、revision 编辑、Logo 与 Prompt 绑定、按需读取和 409 显式恢复可用。 |
| A03 | 平台工作区账号区 `?tab=accounts` | A02 | 账号列表按需读取，创建/编辑/启停/删除按当前账号 revision 与 blocker 处理；无跨平台数据串扰。 |
| A04 | 平台分类 `/settings/platforms/types` | A01 | 分类表、引用数量、创建/编辑/删除及服务端阻断原因可用；不增加一级导航。 |
| A05 | Prompt Library 与编辑 `/settings/prompts` | A02、F06 | 列表、按需 Detail、Markdown 唯一编辑源、revision/DirtyGuard 与绑定平台摘要可用。 |
| A06 | Prompt 预览与真实生成 | A05 | 明确选择 Task/模型并确认真实生成副作用；只跟踪返回 Job，terminal 后展示不可变 ContentVersion；失败不伪装成功。 |
| A07 | AI 渠道列表 `/settings/ai` | F05、F04 | ADMIN-only、服务端筛选分页、安全摘要、创建/启停/删除和 revision 冲突可用；不回显 secret。 |
| A08 | AI 渠道 Basic/Request 工作区 `/settings/ai/$channelId` | A07、F06 | `basic|request` 共用草稿、replacement-only credential/header、DirtyGuard 与显式 409 reload 可用。 |
| A09 | AI 渠道 Models tab | A08 | 按需模型读取、发现、创建、编辑、真实测试、启停/删除及各自 revision 边界可用。 |
| A10 | AI 渠道 Usage/Logs tab | A08 | period/page URL 恢复、服务端聚合与分页、安全审计 Detail Sheet 和未知字段显式错误可用。 |
| A11 | Configuration 真实业务闭环 | A03、A04、A06、A09、A10 | 平台/账号/分类、Prompt 预览及 AI 渠道配置的关键命令与权限得到验证；复核 secret、revision 和按需 query 边界。 |
| S01 | 用户管理 `/system/users` | F03、F05 | ADMIN-only 列表、摘要、创建/编辑/reset/启停/删除、revision-bound selection、bulk partial feedback 与临时密码保护可用。 |
| S02 | 系统审计 `/system/audit` | F03、F05 | ADMIN-only metadata 列表、URL 筛选与 `logId`、按需安全 Detail、桌面 Pane/移动 Sheet 和焦点返回可用。 |
| S03 | Auth 与 System 真实业务闭环 | F03、S01、S02 | 创建用户、强制改密、权限拒绝、reset 后旧会话失效、bulk partial 和审计追溯可验证；复核敏感值没有进入产物。 |

## 8. Workbench 与最终集成

来源：[03 工作台](./03-page-and-workflow-blueprint.md)、[09 ADR-017/046/047](./09-architecture-decisions.md)、[08 完成标准](./08-testing-quality-and-acceptance.md)。

| ID | 交付任务 | 前置 | 当前候选的验收结果 |
|---|---|---|---|
| W01 | 工作台 `/` | P08、C08、U07、G08、A11、S03 | 单一 Workbench aggregate 展示六类待办、关注队列、四域健康与 GEO 摘要；服务端 href 直达可操作页面，不在浏览器重算资格或数量。 |
| I01 | 旧深链接与根路由收敛 | P08、C08、U07、G08、A11、S03、W01 | `02` 登记的 legacy URL 通过显式 replace 进入 canonical route；return-to、权限、query 白名单、404 与 direct/refresh/Back/Forward 正确。 |
| I02 | 全站候选验收与质量收敛 | W01、I01 | canonical route 覆盖、跨域主链路、关键 Pattern、四档响应式、键盘/焦点、错误合同、production artifact、依赖方向与相关完整质量门禁通过；保留真实失败记录。 |
| I03 | Canonical 源码接替与本地集成 | I02 | 在已确认的源码接替范围内，唯一 `frontend/`、Makefile/CI/Compose/生成类型/构建引用一致，当前工作与回退点受保护；仓库级检查通过。 |
| I04 | 发布准备与实际部署 | I03；另行确认发布范围 | 按届时目标环境重新定义候选、备份/回退、部署 smoke 与观察；只记录实际执行证据，不继承开发阶段的 Production Gate。 |

## 9. 任务边界与完成判据

- 一项任务围绕一个可审查结果；表中较大的闭环或工作区可按独立行为再拆 Trellis 子任务，但要在其父项记录完整验收。不要因文件数量机械拆分，也不要把所有编号先建成空任务。
- 页面任务依 [03](./03-page-and-workflow-blueprint.md) 和 [04](./04-design-system-and-interaction-spec.md) 核对真实交互，依 [05](./05-business-actions-state-and-api-contract.md) 核对动作/错误，依 [08](./08-testing-quality-and-acceptance.md) 选择直接证明结果的测试。只有合同、权限、持久化、并发或发布边界受影响时扩大验证。
- 每个任务只在本轮候选的可观察结果、必要验证和 diff 复核完成后关闭。Fixture Playwright、真实栈 E2E、生产构建与远端运行分别记录，不能互相冒充。
- `I03` 的源码接替和 `I04` 的部署是独立边界；后续会话在有相应授权并完成前置验收时执行。本文不据任务清单宣称任何页面、切换或发布已经完成。
