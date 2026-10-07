# GEO-1010：MANUAL GEO 内部试运行与人工验收（聚合父任务）

## 目标与规划前提

以三个可独立执行、独立验收的子任务交付核心业务页面、内部候选部署、真实 MANUAL 业务与性能验收。规划阶段仅建立任务与治理。2026-10-07 UI 已实施、验证并获用户人工接受，标记 done；用户随后授权开启 DEPLOY 会话。DEPLOY 依赖满足，移交时转为 ready；新会话发布准备已开始，因候选/目标/授权与恢复输入缺失现为 blocked；UAT 尚未开始。当前实际状态与证据见 implement.md。

规划基线为 clean pushed main `360aabe8a83e66398d801ba0bbe48b0663aed4a1`，已 fetch，HEAD=origin/main。GEO-1009 已基于当前会话用户的显式范围调整及[人工接受记录](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)正式 done。被验证的完整 SHA 仍为 `e5949ab66989c1277424cfe9ab8b93e10ce10046`；规划基线及后续治理提交没有重新执行完整应用门禁。前置事实见 [preflight](./evidence/planning-preflight.json)。

## 标识、父子关系与执行顺序

顶层 manifest 仅保留数字 ID GEO-1010，使用稳定 children 路径引用。Trellis parent/children 为父子关系权威，ID/name 使用无日期 slug，parent/children 使用任务目录名；展示后缀 ID 不登记为顶层 manifest ID。不新增 GEO-1011～1013，不修改 validator/schema。

| 展示 ID | Trellis ID/slug | 当前状态 | 必须 done 的依赖 | 独立交付 |
|---|---|---|---|---|
| [GEO-1010-UI](../10-07-geo-1010-ui-business-closure/prd.md) | geo-1010-ui-business-closure | done | GEO-1009、GEO-1006、GEO-704、GEO-705、GEO-706、GEO-707 | 管理员评估、Content Task 行动、Retest preview/create/比较及显式决定的真实页面闭环 |
| [GEO-1010-DEPLOY](../10-07-geo-1010-internal-pilot-deploy/prd.md) | geo-1010-internal-pilot-deploy | blocked | GEO-1009、GEO-1010-UI | UI 完成后的固定候选工件、门禁、内部部署、smoke 和最小停止/恢复闭环 |
| [GEO-1010-UAT](../10-07-geo-1010-manual-uat-performance/prd.md) | geo-1010-manual-uat-performance | planned | GEO-1010-UI、GEO-1010-DEPLOY | 受控真实数据、至少一个闭环、可用性/性能及具名内部 Go/No-Go |

父任务保留原 manifest 前置依赖 GEO-1009、GEO-904、GEO-905、GEO-906，规划时均为 done；旧 done 不代表目标现场验证。DEPLOY 不与 UI 并行。环境准备与候选部署可在 DEPLOY 内分阶段，但不增加第四个子任务；规划阶段未执行任何阶段；UI已本地实施、验证并获人工接受，尚未部署。

## 父任务治理规则

1. 创建子任务后父任务 ready，UI ready；DEPLOY/UAT 保持 planned，依赖全部 done 并具备对应执行授权后才可 ready。
2. 任一子任务开始实施时父任务同步 in_progress；本规划会话不得开始任务。
3. 每个子任务按自身 brief 独立工作验收，实施完成先 review，人工接受才 done。不能因代理完成、测试通过或依赖 done 自动接受。
4. 三个子任务全部 done，并具备集成工作验收后，父任务才可 review；父任务必须另有显式人工接受记录才能 done。
5. UAT 内部 Go/No-Go 必须是具名显式人工结论，子任务完成不等于生产 Go；保留 NOT_MET/NOT_VERIFIED，正式生产及公开流量需另有相应授权。

## 聚合验收

- [x] UI 页面全程评估、创建 Content Task、preview/create Retest、比较与显式 resolve/continue；真实栈 E2E 通过，无 P0/P1 流程缺陷，契约/历史语义保持。
- [ ] DEPLOY 的同候选身份、完整门禁、archive/images/manifest/schema/hashes、核心健康、MANUAL smoke、关闭 API/Browser 自动采集及最小备份/停止/恢复可核验。
- [ ] UAT 120～180 个目标 Run 有解释或具名批准缩量；至少一个真实闭环、指标可追溯、无未处理 P0、P1 有 owner/处置、主要性能有实测、内部反馈和具名 Go/No-Go 齐全。
- [ ] 三项独立接受、集成工作验收、父任务人工接受分别记录；旧来源证据、现场未知和生产 NO-GO 不被治理提交改写。

## 范围外

Browser 自动化、API 自动采集供应商接入、CRON、自动 Opportunity 调度、Opportunity CSV、公共管理员重分析、自动发布、领域规则重写、全站视觉重构、无关安全强化、生产开放、大规模公网/多租户/计费、排名提升保证和因果承诺。UAT 期间的代码问题建立独立缺陷任务，不混入 UAT 实现。

## 文档导航

- [治理设计](./design.md)、[聚合进度](./implement.md)、[manifest](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml)、[roadmap](../../../docs/geo-monitoring/04-delivery/01-implementation-roadmap.md)、[WBS](../../../docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md)、[执行顺序](../../../docs/geo-monitoring/04-delivery/codex-prompts/EXECUTION_ORDER.md)
- [根 AGENTS](../../../AGENTS.md)、[GEO README](../../../docs/geo-monitoring/README.md)、[核心 PRD](../../../docs/geo-monitoring/01-product/02-geo-core-prd.md)、[能力矩阵](../../../docs/geo-monitoring/01-product/05-v1-release-capability-matrix.md)
- [状态机](../../../docs/geo-monitoring/02-business/03-workflows-and-state-machines.md)、[前端架构](../../../docs/geo-monitoring/03-technical/04-frontend-architecture.md)、[测试质量](../../../docs/geo-monitoring/03-technical/07-testing-and-quality.md)、[部署运维](../../../docs/geo-monitoring/03-technical/08-deployment-and-operations.md)、[Runbook](../../../docs/geo-monitoring/03-technical/10-core-rollout-runbook.md)
- [Codex 指南](../../../docs/geo-monitoring/04-delivery/04-codex-execution-guide.md)、[ADR-006](../../../docs/geo-monitoring/05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)、[ADR-007](../../../docs/geo-monitoring/05-decisions/ADR-007-manual-first-v1-release-scope.md)、[ADR-008](../../../docs/geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)

GEO-1010-UI 已按用户显式[人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1010-ui-acceptance.md)标记 done；DEPLOY 新会话已开展发布准备，必需候选/目标/授权与恢复输入缺失，现为 blocked。后续执行以各 task.json/implement.md 为准；父任务与 UAT 没有被一并接受。
