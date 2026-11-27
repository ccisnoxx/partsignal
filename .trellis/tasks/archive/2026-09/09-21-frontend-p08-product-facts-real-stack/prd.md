# P08 Product Facts 真实业务闭环

## Goal

用本轮候选前端与隔离真实服务验证 Product Facts 主链：创建、录入、提交、退回、修订、批准、历史和 ContentTask handoff。

## Requirements

- P02–P07 均有本轮页面验收记录。权威为 `docs/frontend-v2/11-frontend-redevelopment-task-list.md` P08、`08-testing-quality-and-acceptance.md` 的 Product real-stack flow、`contracts/openapi.yaml` 与 Product/Facts 服务端状态合同。
- 从本轮候选 production artifact 经真实 FastAPI/PostgreSQL 执行 Flow A/B/D：创建产品与事实、提交/审核、退回修订形成新版本、批准、只读历史、revision 冲突和下一步 ContentTask handoff；不得以 fixture 测试替代。
- 真实测试须使用隔离、可清理的本地数据和服务，记录启动方式、实际通过/失败项。若环境缺少依赖，记录确切阻塞与可复现的下一步，P08 不虚报完成。
- 复核 Product domain 与共享 Pattern 的重复映射/状态 owner；只有具体缺口才修改代码或合同。

## Acceptance Criteria

- [x] 隔离真实栈运行 P08 目标 E2E 并记录当前候选结果。
- [x] 对发现的 in-scope 缺口做最小修复并运行对应检查；本轮未发现需再修改的缺口。
- [x] 检查 Product domain/Pattern 边界并记录后续 C01 前置状态。

## Scope

P08 负责 Product Facts 主链与其最窄必要修复；不发布、不部署、不改远端状态。真实测试仅在隔离本地服务中运行。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：本项未修改生产源码、API 或测试。复核 `domains/product`：Product 的 primary task/available action 文案与 href 由 `product.model.ts` 统一解析；List/Detail 分别消费专用 read model，事实工作台、审核和历史各自拥有对应状态与动作，没有发现必须合并的重复业务映射或越界共享 Pattern。
- 在隔离候选工作区安装 `backend/.venv`，用本轮新起的开发 PostgreSQL/Redis 执行 `PARTSIGNAL_E2E_SPEC=tests/e2e/product-facts-real-stack.spec.ts deploy/scripts/e2e-local.sh`。脚本从当前候选构建 production frontend、对临时数据库运行 Alembic、启动真实 FastAPI/Celery 与本机 fake AI/存储；Playwright `foundation-desktop` 4/4 通过（Flow A 批准事实并交接 ContentTask/只读版本、Flow B 退回修订 v2 与审核历史归属、Flow D 真实 revision 409 不重放、Flow C 人工首稿保存并提交审核）。
- 运行输出确认 `E2E_CLEANUP`：Redis DB 14 的 1 个键已删除；端口 8000/9001/4174/19009 均释放；临时数据库 `partsignal_e2e_20260921_53890` 已删除；临时存储已移除。随后对本轮新建的 Compose postgres/redis 执行 `down -v --remove-orphans`，容器、网络和本轮新卷均移除。
- 本轮真实栈 4 场景是 Product Facts 交付证据，不等于完整 `make e2e` 或全站 `make verify`。P08 前置已满足，下一项 C01 内容任务列表；其他可独立的 A01/S01/S02 仍依各自前置启动。
