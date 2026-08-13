# 实施计划

## 0. 批准与启动 gate

- [x] 用户批准 `prd.md`、`design.md`、`implement.md`。
- [x] 用户明确批准 DELETE revision 所需的单一 V1 调用点/直接测试豁免。
- [x] 重新确认主工作目录、`main` 已包含前置业务提交 `12401d6`（建分支时 HEAD 为其 archive/journal 后继 `cde2236`）、无其他活动 Trellis Task，且只有本 planning task 文件属于已识别改动。
- [x] 创建并只使用 `codex/frontend-v2-platform-list`；不 push、不创建 PR。

## 1. 最小执行顺序

- [x] **Contract first**：在现有 PlatformProfile list 合同中增加 `PlatformReadinessStatus`、`readiness_status` query/row、enabled account count、summary、type options、nullable primary；为 DELETE 增加 required `expected_revision` 并修正 blocker 描述。
- [x] **Backend read owner**：复用现有 list predicate/summary/batch projection，一次聚合 total+enabled accounts，加入 readiness filter/summary、稳定 type options、actor-aware primary 和状态转换守卫；DELETE 锁后先校验 revision，再复核状态/blocker。
- [x] **Backend evidence**：增加一个平台列表专项 PostgreSQL integration test 模块和最小 projection/contract unit assertions，覆盖所有新增语义及固定查询次数。
- [x] **Generated + bounded V1 compatibility**：重新生成 V1/V2 types；仅让旧平台 DELETE 调用传行 revision，并更新直接 fixture/test，不迁移或重构 V1。
- [x] **V2 model/API**：实现 Configuration domain 自有 search schema、canonicalization、API params、query keys、mutation 与穷尽 action/status mapping。
- [x] **V2 page/route/navigation**：注册 settings/platforms thin routes、route metadata/nav、七列表格、summary、filters、pagination、states、actions/Dialog 与 canonical Workspace href；生成 route tree。
- [x] **Frontend evidence**：补 model/component/navigation tests 与 generated-type production-artifact fixture Playwright，先用现有响应式 primitives；仅在实测失败时加页面级样式。
- [x] **Docs + self-review**：更新直接相关 contract/spec/docs，检查 diff 中无客户端业务状态机、N+1、optional revision fallback、假 Workspace、通用框架、无关 V1 修改或未说明行为变化。
- [x] **结果报告**：报告 changed files、权威口径、实际验证、跳过项、风险和文档一致性；提交前另给 commit plan 等待确认。

## 2. Required validation

以下命令直接证明本任务，实施中按失败归因规则运行，不机械扩大范围：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_platform_profile_list.py

cd frontend && npm exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx
cd ..

npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/configuration/platform-list.model.test.ts \
  src/domains/configuration/platform-list-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-list.spec.ts
git diff --check
```

如专项 integration test 最终沿用仓库既有文件而非新建 `test_platform_profile_list.py`，执行时替换为实际精确 node/file；不得因此扩大为全 integration suite。

## 3. Optional validation

```bash
make verify
npm --prefix frontend-v2 run e2e
make test-integration
```

这些命令覆盖其他 domain 或全仓，只有共享合同回归、发布准备、targeted evidence 不足或用户明确要求时运行。Phase 6 完整 real-stack E2E 仍是后续独立 Task。

## 4. 第一个可提交 commit 的精确范围

本任务不做 planning commit 或半成品 commit。第一个且默认唯一的工作提交在所有 required validation 通过、diff 自审完成并获得用户 commit confirmation 后产生，建议 message：

```text
feat(frontend-v2): add platform list
```

该提交只包含：

- Platform List 所需的 OpenAPI/read-model/revision 修正与 targeted backend tests；
- 两套 generated schema；
- 经批准的 V1 DELETE revision 单点兼容及直接测试；
- `/settings/platforms` 的 V2 route/navigation/domain/page/tests/fixture；
- 直接相关的 V2 docs 与 backend spec 更新。

不包含 Trellis archive/journal bookkeeping commit、其他 V1 改造、Workspace/表单/账号/类型/Prompt/AI 页面、通用抽象、依赖或无关清理。

## 5. 交付与 Git gate

- 不自动提交、push、创建 PR、合并或归档。
- 实施验证完成后先报告 commit plan，等待用户确认再提交。
- 提交确认后按用户指定流程 fast-forward 合入 `main`、删除临时分支；运行 Trellis archive/journal 前先说明其可能产生 bookkeeping commit。
- 计划使用的唯一临时分支：`codex/frontend-v2-platform-list`。
