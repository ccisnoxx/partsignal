# GEO-1010-UI：补齐 MANUAL GEO 核心业务页面闭环

## 基本信息与执行门禁

- 展示 ID：GEO-1010-UI；Trellis ID/slug：`geo-1010-ui-business-closure`。
- 初始状态：ready；本次只规划，未开始实施、未运行应用测试。
- 父任务：[GEO-1010](../10-07-geo-1010-manual-pilot/prd.md)。
- 依赖（必须全部 done）：GEO-1009、GEO-1006、GEO-704、GEO-705、GEO-706、GEO-707。
- 关联能力：CAP-GEO-12；沿用现有 Opportunity/Action/Retest 合同，不新增业务规则。
- 实施主范围：`frontend/src/domains/geo-opportunities/`、对应路由和前端测试。根合同仍由主代理拥有；发现现有契约实质缺口须另行明确，不在本任务重写领域规则。

## 目标与当前行为

公司内部用户无需手工调用 API，就能完成管理员评估 Opportunity、从 Opportunity 创建 Content Task、预览及创建 Retest、查看比较并显式解决或继续处理。

当前 API 已支持上述领域能力；现有页面主要是列表/详情、acknowledge/dismiss、行动历史，以及已有复测上的比较和 resolve/continue。管理员评估、行动创建、Retest preview/create 的页面操作尚未形成闭环。`geo-loop-real-stack.spec.ts` 的部分验收操作使用 `page.request`，不能算页面操作通过。

## 范围内

1. 管理员显式评估表单：时间窗口、规则版本、Subject/Product、Surface/Profile、Collection Mode；使用服务端幂等请求合同，保留 created/reused/skipped/unavailable 摘要，明确展示低样本、不可比、无依据等未生成机会原因。
2. Opportunity 行动创建：第一版至少支持 Content Task。展示来源 Opportunity、当前 revision、产品、FactVersion、PlatformProfile、创建结果和目标任务链接。复用既有 Content Task 服务/API，不绕过事实资格或审核。
3. Retest：选择 baseline batch，调用 preview 并展示 comparable、differences、requires_new_baseline；不可比较时禁止创建，不静默换基线。可比较后由用户确认创建，展示结果并跳转新 Batch 或 Run Center。
4. 展示前后比较、样本/排除原因、冻结恢复判断和实际环境/模型/模式差异；复用现有显式 resolve/continue。行动完成不自动解决，复测变化不宣称因果。
5. 权限与状态：ADMIN 才可执行评估；ENGINEER 只看到服务端允许的读取和业务操作。消费 available_actions，不在前端重建资格或状态机；服务端 mutation 再验权限/revision/幂等。
6. 409、403、422、5xx 有可理解反馈；覆盖 loading、empty、error、stale revision。保留本地输入和幂等键，按现有合同处理未知提交结果；过期响应不覆盖新意图，操作未结束不重复提交。按现有语义/键盘/焦点/状态提示合同实现。
7. 测试：运行现有前端单元与 TypeScript typecheck、受影响组件测试、目标真实栈 Playwright。将现有 geo-loop-real-stack 的管理员评估、创建 Action、Retest preview/create 等被验收用户动作改为真实页面操作；测试 setup 可继续用 API，不能以 API 编排代替被验收操作。

## 范围外

Opportunity CSV、Browser Adapter、CRON、自动 Opportunity 调度、公共管理员重分析、自动发布；evaluator/Action/Retest 领域规则重写；无关安全强化；全站视觉重构；部署和真实 UAT 数据。

## 独立验收

- [ ] ADMIN 全程通过页面完成显式评估，回执和未生成原因可解释；ENGINEER 没有评估操作权限。
- [ ] 用户通过页面创建 Content Task，来源/revision/产品/FactVersion/PlatformProfile 可核对，目标任务可导航。
- [ ] 页面完成 Retest preview 和 create；不可比较的 preview 无可用创建入口，服务端拒绝反馈正确。
- [ ] 比较和冻结恢复判断可读；用户显式 resolve 或 continue，页面明确“不证明因果”。
- [ ] 关键流程不再要求手工调用 API；409/403/422/5xx、加载/空/错误/旧 revision 的实际可达状态可理解。
- [ ] API 契约和历史数据语义保持；目标真实栈 E2E 通过，无未处理 P0/P1 业务流程缺陷。
- [ ] 实际变更、命令/结果、覆盖边界、截图或 trace（需要时）记录完成；人工接受后才 done。

## 验证计划（尚未执行）

从仓库根目录使用现有入口：

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run test -- src/domains/geo-opportunities
PARTSIGNAL_E2E_SPEC=tests/e2e/geo-loop-real-stack.spec.ts deploy/scripts/e2e-local.sh
git diff --check
```

实施时核对入口当前筛选格式、独占测试资源和现有 secret-scan；目标组件检查与全前端单元各自记录实际结果，避免把 mock 结果当真实栈。候选级完整门禁归 DEPLOY，在 UI done 后的新候选执行；不能用 GEO-1009 的旧 SHA 结果证明新增页面。

## 必读导航与设计依据

- [根 AGENTS](../../../AGENTS.md)、[前端 AGENTS](../../../frontend/AGENTS.md)
- [父任务设计](../10-07-geo-1010-manual-pilot/design.md)、[WBS](../../../docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md)
- [核心 PRD](../../../docs/geo-monitoring/01-product/02-geo-core-prd.md)、[能力矩阵](../../../docs/geo-monitoring/01-product/05-v1-release-capability-matrix.md)
- [业务状态机](../../../docs/geo-monitoring/02-business/03-workflows-and-state-machines.md)、[前端架构](../../../docs/geo-monitoring/03-technical/04-frontend-architecture.md)、[测试质量](../../../docs/geo-monitoring/03-technical/07-testing-and-quality.md)
- [OpenAPI](../../../contracts/openapi.yaml)、[数据库合同](../../../contracts/database.md)、[ADR-008](../../../docs/geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)
- 当前源码/测试入口：`frontend/src/domains/geo-opportunities/`、`frontend/src/routes/_app/geo/opportunities.tsx`、`frontend/tests/e2e/geo-loop-real-stack.spec.ts`；`backend/app/routers/geo_opportunities.py`、`geo_retests.py` 及对应服务。

当前规划复用父任务设计与现有领域合同。必要的局部 UI 设计在实施前补入本任务，不能以规划文档存在冒充实现或验收。
