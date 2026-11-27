# U07 Publishing 真实业务闭环

## Goal

在隔离真实服务上验收当前候选 Publishing 两条连续业务链，并核查状态与不可变历史由服务端拥有。

## Requirements

- 前置 U02–U06 均有本轮页面验收；U02 后补完整 Context 风险修复需复核通过。权威为 `docs/frontend-v2/08-testing-quality-and-acceptance.md` Publishing 真实栈章节、`11-frontend-redevelopment-task-list.md` U07、OpenAPI 与 Publication 服务端状态合同。
- Flow A 从 Ready Queue 开始发布，登记并核验成功，进入只读 Article，登记 Issue、创建修复任务、显式解决，核对 Article/Issue/repair 的身份、动作、事件和不可变来源快照。
- Flow B 从失败核验进入 Content 修订审批，切换批准版本并重新登记/核验，核对旧版历史不变、服务端 revision/动作及新 Article 来源。
- 在本轮候选 production artifact、隔离 PostgreSQL/Redis/FastAPI/Celery/对象存储上运行真实浏览器链路；环境与测试数据可清理。fixture 场景不得替代真实栈结果。
- 复核 Publication domain 的服务端状态 owner、Query/URL/Form/local 状态与共享组件边界；仅对实证缺口做最小修复。

## Acceptance Criteria

- [x] 当前候选两个真实栈 Flow A/B 通过，记录构建、迁移、服务、测试和清理结果。
- [x] 跨域 handoff、只读快照、修复与解决独立以及旧版历史核对完成；如发现缺口，修复并验证。
- [x] 记录实际代码、独立复核覆盖范围、残余风险和下一步 G01。

## Notes

- 本项不发布、不部署、不修改远端状态。运行结束清理本轮隔离数据与服务。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：仅扩充 `frontend/tests/e2e/publication-workspace-real-stack.spec.ts` 的 Flow B 只读断言。首次结果登记后读取完整 Context 固定旧标题/URL/发布时间；最终 FAILED verification 必须保持这些 snapshot，PASSED verification 绑定修订版本和新结果；Article 来源精确匹配新批准 Markdown/hash，原内容版本详情的标题/正文/hash 不变并按生命周期转为 `SUPERSEDED`。未修改生产代码、根 API/数据库合同。
- 当前候选由 `deploy/scripts/e2e-local.sh` 在本轮新建的隔离 PostgreSQL/Redis、临时数据库/对象存储、真实 FastAPI/Celery/fake AI 与 production frontend 上执行。初始 Flow A、Flow B、Article 列表→详情 3/3 通过。补充断言后的完整运行 Flow A、Article 2/2，Flow B 因把旧内容生命周期误写为 `APPROVED` 失败；日志证实旧正文/hash 未变、服务端正确返回 `SUPERSEDED`。修正测试期望后，仅重跑受影响 Flow B，1/1 通过。该失败已诊断，不记为生产缺陷；未重复无关场景。
- Flow A 验证 Ready→Work 准备/登记/核验→Article→Issue→repair task→显式解决，最终 Context/Article/Issue/repair 与服务端 token/事件/冻结来源相符；Flow B 验证失败核验→Content 修订审批→换版/重登记/再次核验及旧 snapshot 不变。另一个真实栈场景验证成果列表进入只读 Detail 单读。`npm test` 当前候选 83 files / 573 tests、`npm run lint`、`npm run typecheck`、最终测试文件定向 ESLint、`git diff --check` 均通过。production build 只有既存大 chunk 提示。
- 每次脚本均报告 Redis DB14 键删除、端口 8000/9001/4174/19009 释放、临时数据库删除、临时存储移除；随后本轮新建的 Compose postgres/redis 容器、网络和卷已移除。独立只读边界复核未发现 Publishing 状态 owner、跨域依赖方向的生产缺口，指出并促成上述 Flow B 历史断言补强；Workbench 客户端缓存回访留给 W01。
- 下一步 G01 GEO 观测列表。U07 真实栈结果不替代后续 GEO、系统管理或全站 I02 门禁。
