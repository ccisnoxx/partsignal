# Frontend V2 Phase 8 Workbench — Implementation Roadmap

## 0. 当前状态

- [x] 主工作区位于 clean `main` 后创建本规划 Task；当前仅有本 Task artifacts 为未跟踪内容。
- [x] Phase 7 Exit Gate=`MET`，没有开始 Phase 8/9。
- [x] 已完成 Workbench 权威文档、API/backend、V1/V2、deep link、GEO tail 与测试 owner 审计。
- [x] 未执行 `task.py start`、未创建分支、未修改产品代码、未运行测试或 `make verify`。
- [x] 用户已批准本任务图。

父 Task 只交付规划。批准后先按项目 Git 规则展示 planning artifacts 的 commit plan；获得提交确认后再完成父 Task bookkeeping。`task.py archive` / `add_session.py` 会产生自动 commit，执行前必须另行说明并获得授权。

## 1. 子 Task 共同启动规则

每个子 Task 都必须独立执行：

1. 从最新 clean `main` 确认上一 Task 已提交且没有未识别变更；不 pull/push/PR。
2. 创建 Task，补齐 `prd.md`、`research/audit.md`、`design.md`、`implement.md`、`task.json`，等待用户批准。
3. 批准后运行 `trellis-before-dev` 与：

```sh
python3 ./.trellis/scripts/task.py start <task-id>
```

4. 保持在 `main`，只实施该 Task；定向验证与自审通过后展示 commit plan，等待用户确认。
5. 用户批准并提交当前 Task 后才创建下一个 Task。除非用户另行明确授权，不创建临时分支。

不并行启动四个 Task：OpenAPI/generated types、UI、E2E 和最终 gate 有明确前后依赖；并行会制造重复 owner 与不稳定候选。

## 2. Task 1 — `frontend-v2-workbench-aggregate-read-model`

### Scope

- 新增 `GET /api/v1/workbench`、`WorkbenchAggregate` schema、独立 router/service。
- 实现六类 count/link、四域 health、30 日 current-tail GEO rates、最多 10 条 attention items。
- 更新 OpenAPI、V1/V2 generated types、05 contract 和 09 ADR。
- 新增唯一 backend integration test owner；不修改 V1 Dashboard、数据库或前端页面。

### Required Validation

```sh
make contract-check
uv run --project backend ruff check \
  backend/app/routers/workbench.py \
  backend/app/schemas/workbench.py \
  backend/app/services/workbench.py \
  backend/tests/integration/test_workbench.py
uv run --project backend mypy --config-file backend/pyproject.toml backend/app
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_workbench.py
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-aggregate-read-model
```

Integration 必须覆盖 empty/partial/full、ADMIN/ENGINEER、各状态边界、current GEO tail、30 日边界、`UNJUDGEABLE/null`、稳定 top 10、canonical href、固定查询次数和响应敏感字段 allowlist。

### Stop

需要 migration、权限/状态机变更、修改 V1 endpoint/页面、跨 endpoint client join、Redis/cache 或 per-item query 时停止并报告。

## 3. Task 2 — `frontend-v2-workbench-ui`

### Scope

- 新增 `domains/workbench` query/model/page，替换 `/` 占位页。
- 只消费 `getWorkbench`；复用 primitive/token/App Shell，不新增共享 Dashboard kit。
- 新增 component/model tests 和 Workbench strict fixture production-artifact spec。
- Foundation smoke 移到无业务 API 的受保护壳层 route，保持其 allowlist 只有 auth/me、auth/csrf。
- 必要时更新 03 页面蓝图；不改 backend、V1 或其他 domain action/cache owner。

### Required Validation

```sh
npm --prefix frontend-v2 run test -- \
  src/domains/workbench/workbench.model.test.ts \
  src/domains/workbench/workbench-page.test.tsx
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/workbench.spec.ts \
  tests/e2e/foundation-smoke.spec.ts
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-ui
```

Playwright 必须保留全部配置 project，覆盖 375/768/1024/1440 页面根无横向溢出、键盘链接、loading/error/empty/zero/null、重试、canonical href，并断言浏览器只发送 auth 与一个 Workbench business GET。

### Stop

需要客户端 join、role/status eligibility 推导、跨 domain registry import、全局 store、自动刷新、mutation、通用 PageHeader/Metric/Dashboard framework 或放宽 Foundation business API 时停止。

## 4. Task 3 — `frontend-v2-workbench-e2e`

### Scope

只在四个既有 real-stack workflow 的自然状态检查点增加 Workbench 读取与 navigation 断言：

- `product-facts-real-stack.spec.ts`：fact review count/item/filter/workspace。
- `content-review-real-stack.spec.ts`：content review count/item/filter/workspace。
- `publication-workspace-real-stack.spec.ts`：verification、action、open issue count/item/href。
- `geo-real-stack.spec.ts`：manual current-tail accuracy issue、30 日 rate 与 observation href。

不新建 `workbench-real-stack.spec.ts`，不通过 API 复制业务 mutation setup，不新增 orchestration/helper framework。更新 08 的 E2E owner 说明。

### Required Validation

依次运行每个被改 spec 的唯一 real-stack owner；一个失败后仍可运行其余独立 spec，集中归因，但环境/代码未改变时不重跑同一失败命令：

```sh
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/product-facts-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/content-review-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/publication-workspace-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/geo-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-e2e
```

每次必须保留既有 secret scan、database/Redis/storage/process/port cleanup 证据；输出与报告不得包含 password、CSRF、Cookie、request body/header、storage state 或业务敏感正文。

### Stop

需要第二套服务生命周期、API seed 已迁移业务、重复完整 workflow、宽泛 cleanup、关闭 trace/security assertion 或修改旧 frontend 时停止。

## 5. Task 4 — `frontend-v2-workbench-abstraction-review`

### Scope

- 审计 `route → workbench domain → design-system/shared`、backend read-model owner、六类语义、cache、deep link、敏感字段和测试编排。
- 优先删除薄 wrapper、重复 glue、死代码和错误抽象；只实施证据支持的最小修正。
- 明确 P0/P1/P2 与 Phase 8 Exit Gate=`MET|NOT_MET`。
- `MET` 时同步 07/08；新增合同/ADR 事实只由前序 Task 更新，不在 review 重写。

### Independent diagnostic stages

复用前三个 Task 已提交的定向证据，不机械重跑相同发现命令。先在固定候选上各运行一次所有安全独立 gate stage；fail-fast 前置失败不阻止其余独立阶段的诊断：

```sh
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

### Final required gate

只有独立阶段全部通过、candidate 合理预期成功时，运行一次：

```sh
make verify
```

随后：

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-abstraction-review
git status --short --branch
```

若最终 gate 意外失败，先完成仍安全且未运行的独立诊断，判 `NOT_MET` 并批量报告 owner；不立即进入一 blocker、一重跑循环。只有 blocker 已由独立 Task 全部关闭后，才规划纯验证 recheck。

## 6. Optional Validation

默认不运行，只有定向证据指向相关风险或用户明确要求时执行：

```sh
npm --prefix frontend-v2 run build-storybook
make test-deploy-scripts
```

不做 Lighthouse、staging deploy、Phase 9 rehearsal、临时浏览器 walkthrough 或性能优化。聚合固定 query count 由 backend integration 直接证明。

## 7. 自审清单

- 无 V1、database、permission、既有状态机或 mutation contract 修改。
- 无浏览器多 endpoint join、status/role action 推导、第二 query/cache owner或跨 domain registry import。
- 无通用 Dashboard/Admin/CRUD/Permission/Audit/Workflow framework、one-consumer shared component 或新依赖。
- 无 N+1、silent fallback、unknown→0、broad catch、重复 E2E orchestration 或测试预期放宽。
- 无 password/token/CSRF/Cookie/header/body/storage/trace/video/report 泄漏。
- OpenAPI/generated types、05/07/08/09、Task evidence 与实际结果一致。

## 8. 回滚策略

每个子 Task 都是独立提交边界。验证失败时保留 diff 供审查，仅用 `apply_patch` 反向撤销确切 hunks；不使用 `git reset --hard`、`git checkout --`、历史改写或宽泛删除。新 endpoint 无 DB migration，V1 不依赖它；因此前三个 Task 均可独立回滚。
