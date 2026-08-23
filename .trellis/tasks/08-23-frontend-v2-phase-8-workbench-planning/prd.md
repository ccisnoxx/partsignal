# Frontend V2 Phase 8 Workbench 规划

## 1. 目标

审计 Phase 8 Workbench 的现有业务事实、API、Frontend V2 route/domain 边界、测试 owner 与迁移约束，形成可逐项批准和实施的最小任务图。本 Task 只交付规划与审计证据，不实施产品代码、不启动 Phase 8 子任务。

## 2. Phase 8 产品目标

`/` 从 App Shell 占位页升级为 Operations Inbox，只回答“现在最需要我处理什么”，并由一个独立、服务端权威的 Workbench aggregate read model 提供：

- `fact_reviews`
- `content_reviews`
- `publication_verifications`
- `publication_actions`
- `content_issues`
- `geo_accuracy_issues`
- workflow health
- GEO summary
- recent attention items

每个计数必须进入 canonical 筛选页，每条 attention item 必须进入具体 Workspace/Detail。浏览器不得请求多个分页 endpoint 后自行 join、计算资格或重建 domain state machine。

## 3. 已验证的共享 invariant

1. 依赖保持 `routes → domains → design-system/shared`；Design System 不导入 Workbench 或其他业务 DTO。
2. 服务端继续拥有 permission、action eligibility、状态转换、当前版本/链尾、输入验证与聚合口径；前端只做展示和导航。
3. Workbench 只有一个 TanStack Query aggregate owner，不建立全局 store、第二 auth owner 或跨 domain cache 副本。
4. Product、Content、Publication、GEO 仍各自拥有状态机、动作映射与 mutation invalidation；Workbench 不复制或导入这些 domain registry。
5. GEO 只统计当前 correction chain tail；准确率保留 numerator/denominator/value 与 nullable“暂无数据”，不把未知填成 `0`。
6. Workbench 是只读入口，不新增业务 mutation、快捷入口宫格或通用 Dashboard/Admin/CRUD/Workflow framework。
7. V1 `frontend/` 与旧 `/api/v1/dashboard/summary` 保留到 Phase 9；V2 新 read model 不改变 V1 行为。
8. strict fixture、backend integration、既有 real-stack workflow 和最终 gate 分别证明不同边界，不复制业务编排。

## 4. In scope

- 定义 V2 独立 `GET /api/v1/workbench` 契约及 backend schema/service/router owner。
- 定义六类 actionable count、四类 workflow health、30 日 GEO summary 与最多 10 条 recent attention item 的精确语义。
- 定义 V2 `domains/workbench` 的 query/model/page 以及 `/` 薄 route composition。
- 迁移 Foundation smoke，使其继续只证明 App Shell；新增 Workbench 独立 strict fixture owner。
- 在既有 Product Facts、Content Review、Publication Workspace、GEO real-stack 流程的自然检查点验证 Workbench，禁止另建一套跨域 mutation orchestration。
- 规划 Phase 8 abstraction review / Exit Gate：先运行独立阶段，候选全绿后只运行一次 `make verify`。
- 规划 OpenAPI、Frontend V2 05/07/08/09 文档更新。

## 5. Out of scope

- Phase 9 cutover、部署切换、删除或修改旧 `frontend/`。
- 新增 Workbench mutation、通知中心、个性化排序、用户自定义卡片、自动刷新、实时推送或缓存层。
- 修改数据库 schema、权限合同或已有业务状态机。
- 扩展或替换 V1 `/api/v1/dashboard/summary`；为 V1/V2 添加兼容 alias。
- 通用 Dashboard、MetricTile、PageHeader、Admin、CRUD、Permission、Audit、Workflow 或跨 domain action framework。
- 因页面相似或文件较长机械抽象/拆分。
- 在本父 Task 中创建子 Task、分支、产品代码、测试、提交、PR 或归档。

若实现审计证明必须改变数据库、权限或既有公共业务合同，停止相应子 Task，提出独立 blocker；不得借 Workbench 扩大范围。

## 6. 任务图

按以下顺序逐个创建、规划、批准、实施、验证、提交并合入 `main`：

1. `frontend-v2-workbench-aggregate-read-model`
2. `frontend-v2-workbench-ui`
3. `frontend-v2-workbench-e2e`
4. `frontend-v2-workbench-abstraction-review`

每个子 Task 从最新 clean `main` 开始，按当前单分支规则直接工作；前一 Task 经用户确认提交后再开始下一个。除非用户另行明确授权，不创建临时分支。当前不预建额外 recheck Task；只有第四项发现独立 blocker 或最终 gate 失败时，才基于完整诊断结果决定是否另建。

## 7. 本规划 Task 验收条件

- [x] 已按用户授权移除两个纯空行差异，主工作区在 clean `main` 上创建 Task。
- [x] Phase 7 已为 `MET`，Phase 8 尚未开始；没有创建 Phase 8 分支或运行 `task.py start`。
- [x] 已完整阅读项目规则、Trellis workflow/spec、Frontend V2 01–09 文档和当前 Workbench 相关实现。
- [x] `research/audit.md` 记录 API、backend、V1/V2、deep link、GEO tail、fixture 与 E2E owner 证据。
- [x] `design.md` 定义单一 aggregate owner、最小响应语义、依赖方向、测试职责、文档和回滚边界。
- [x] `implement.md` 给出四个可独立批准的子 Task、精确 Required/Optional Validation、最终 gate 时机和停止条件。
- [x] 没有规划通用 framework、数据库变更、V1 修改、重复 real-stack 编排或 Phase 9 工作。
- [x] 用户已批准本任务图，可以进入父规划 Task 收尾和第一个子 Task。

## 8. Phase 8 Exit Gate 规则

### `MET`

同时满足：

1. 独立 Workbench API、V2 UI、互补 E2E 与 abstraction review 均已合入 `main`。
2. 六类 count、workflow health、GEO summary 和 recent attention 的服务端口径及 deep link 全部有直接证据。
3. 没有客户端 join、domain state machine/action registry 复制、业务 DTO 下沉、第二 cache owner、V1 回归或敏感产物。
4. Phase 8 无未关闭 P0/P1；任何保留 P2 有明确 owner、非阻塞证据和批准。
5. 独立 gate 阶段全绿后，唯一一次最终 `make verify` 退出 `0`。
6. 05/07/08/09、OpenAPI、generated types 与实际实现一致。

### `NOT_MET`

任一 Required Validation 非零或无法安全运行，存在未关闭 P0/P1、独立 blocker、错误聚合/链接、第二来源、重复编排、敏感信息泄漏，或最终 `make verify` 非零，即判为 `NOT_MET`。先完成仍可独立执行的安全诊断并批量归因，不机械重跑 gate。
