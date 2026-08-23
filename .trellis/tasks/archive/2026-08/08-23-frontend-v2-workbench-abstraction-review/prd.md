# Frontend V2 Workbench Abstraction Review

## Goal

完整审计已交付的 Workbench vertical slice，确认业务与状态 owner、依赖方向、测试分层、抽象边界和敏感信息边界，并以一次固定候选的最终门禁给出 Frontend V2 Phase 8 Exit Gate 的 `MET` 或 `NOT_MET` 结论。

## Background

- 父 Task：`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/`。
- 前三个 child Task 已分别以提交 `545ecde2`、`59e9e76b`、`07c4a431` 完成实施，并以提交 `13f2449b`、`d3603678`、`f3a9d8f7` 归档。
- 本 Task 创建前，主工作区位于 clean `main`；未发现 `codex/frontend-v2-workbench-e2e` 本地/远端分支或遗留 worktree。
- 本轮仅完成规划。规划获批前不得运行 `task.py start`、创建分支、修改产品代码或运行完整门禁。

## Requirements

### R1. Backend read model ownership

- `backend/app/services/workbench.py` 必须继续作为六类 actionable count、四域 health、30 日 GEO summary、attention item、稳定排序和 canonical href 的唯一 Workbench 业务 owner。
- router 只拥有 HTTP、认证与 `REPEATABLE READ` 边界；schema 只拥有响应结构与数据完整性校验，不得复制排序业务定义。
- Publication/Issue/GEO 的既有状态机、available actions 与 current correction-chain tail 查询继续由原领域 owner 持有；Workbench 只消费其投影，不建立第二套状态机或 registry。
- GEO 统计必须只使用 current correction-chain tail；任一 rate 分母为 `0` 时 `value` 必须保持 `null`。

### R2. Frontend ownership and dependency direction

- 依赖方向保持 `route -> workbench domain -> design-system/shared`；Design System/shared 不得导入 Workbench DTO、category、权限或业务状态。
- 浏览器只消费一个 `GET /api/v1/workbench`，且只由一组 TanStack Query options/key 拥有；不得增加多 endpoint join、全局 store、第二 cache/source 或隐藏 query owner 的 hook。
- 前端不得复制 Product、Content、Publication、GEO 状态机或 action registry；服务端 canonical href 必须原样消费，不重建筛选条件或 Workspace 资格。
- 删除 Workbench API/model 内确认为单文件消费、无行为价值的公开表面时，不得新建 wrapper、helper 或 framework。

### R3. Security and artifact boundary

- Workbench 响应、UI、日志、错误、trace、video、Playwright assertion 和测试产物不得暴露正文、notes、prompt/answer、凭据或对象存储签名 capability。
- 开发对象存储成功请求不得把签名 query 写入真实栈 access log；GEO real-stack 的失败收集与 URL 一致性断言不得回显完整签名 URL。
- 使用 Uvicorn 原生 access-log 开关与 `URL.pathname`/布尔断言完成最小修正；不得新增日志脱敏 framework、第二产物扫描器或修改签名协议。

### R4. Test responsibility

- model、component、strict fixture、backend integration、既有四条 real-stack workflow 与根 gate 的职责必须互补；不得新建第二条 Workbench real-stack 编排，也不得为本次审计机械重跑前三个 Task 已提交的定向命令。
- 最终固定候选必须分别运行所有安全独立阶段；一个阶段失败不阻止其他安全阶段完成诊断，且代码和环境未改变时不得重跑同一失败命令。
- 只有独立阶段全部通过且候选合理预期成功时，才运行一次 `make verify`。

### R5. Compatibility and abstraction boundary

- V1 dashboard、旧 `frontend/`、现有 OpenAPI 与 V1/V2 generated types保持不变，除非审计发现真实合同不一致。
- 不新增 Dashboard、Metric、PageHeader、Workflow、Admin、CRUD 或跨 domain framework；不因文件长度拆分，不推广 one-consumer shared component。
- 跨 domain transport guard、real-stack 局部 glue 与 exact href 补充覆盖仅记录为非阻断 P2，等待真实 change pressure 或独立授权，不在本 Task 批量迁移。

### R6. Documentation and exit gate

- `research/audit.md` 必须给出完整审计矩阵、每个 shared invariant 的证据、当前 owner、建议 owner、严重级别与八类 finding 分类。
- 只有最终 Exit Gate 为 `MET` 时，才在 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md` 保留 Phase 8 完成状态；`08` 同时必须把敏感产物保证收敛到真实 owner。
- `05`、`09`、OpenAPI 与 generated types 仅在发现实际不一致时修正；当前静态审计未发现这类不一致，因此计划不修改。
- 任一未关闭 P0/P1、敏感信息泄漏、required stage 失败、cleanup 不完整或合同漂移，最终结论必须为 `NOT_MET`。

## Finding Baseline

| Severity | 数量 | 处置 |
| --- | ---: | --- |
| P0 | 0 | 无。 |
| P1 | 1 | `EINF-01`：签名对象存储 URL 可进入 Uvicorn access log 和 GEO 失败输出；在本 Task 做两文件根因修正。 |
| P2 | 6 | 三项局部简化/文档纠偏在本 Task 关闭；三项跨域 guard/glue/覆盖残余明确保留且不阻塞。 |

当前规划基线为 `NOT_MET`。未发现数据库、权限、既有状态机或公共合同的独立 blocker；若实施中出现，停止相应修改并提出独立 Task，不在本任务发明兼容层。

## Acceptance Criteria

- [x] Backend service 仍是六类 count、四域 health、GEO summary、attention、排序与 canonical href 的唯一业务 owner；schema 中重复 attention 排序 validator 已删除。
- [x] Workbench 前端仍只有一个 aggregate query owner；未消费的公开 query key/custom error 字段/model label 导出已最小收敛，行为未改变。
- [x] Design System/shared 未导入 Workbench 业务语义，前端未复制状态机、action registry、canonical filter 或 Workspace eligibility。
- [x] GEO current-tail、`0/0 -> null`、top-10 稳定排序与 V1 dashboard 保留边界继续成立。
- [x] 开发对象存储 Uvicorn access log 已关闭；GEO request failure 与 URL equality assertion 不再回显签名 query，真实上传语义仍被验证。
- [x] 没有新增 shared/framework/helper、第二 cache/source、第二 Workbench real-stack flow 或旧 frontend 修改。
- [ ] 九个独立阶段各有一次固定候选结果；失败已批量归因，未形成“一 blocker、一重跑”循环。
- [ ] 独立阶段全绿后，唯一一次 `make verify` 通过；随后 `git diff --check`、Task validate 与最终 Git 状态检查通过。
- [x] `07`、`08` 仅在最终 `MET` 时保留 Phase 8 完成状态；当前 `NOT_MET`，因此未写入完成声明。
- [x] 最终记录 P0/P1/P2 关闭/保留状态、独立 blocker、Exit Gate 结论与残余风险。

## Out of Scope

- 新增 Workbench 产品能力或进入 Phase 9 Cutover。
- 修改/删除旧 `frontend/`，重设计冻结合同，修改数据库、权限或既有状态机。
- 新增通用 Dashboard/Admin/CRUD/Metric/PageHeader/Workflow framework。
- 批量统一所有 domain 的 ErrorEnvelope guard 或 real-stack helper。
- pull、push、PR、Git 历史改写，或规划批准前创建分支/启动实施。
