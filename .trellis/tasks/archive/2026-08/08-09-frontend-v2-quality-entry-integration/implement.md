# Frontend V2 Quality Entry Integration — Implementation Plan

## 精确文件范围

实现文件：

- `Makefile`
- `.github/workflows/ci.yml`
- `frontend-v2/package.json`
- `frontend-v2/package-lock.json`
- `frontend-v2/playwright.config.ts`
- `frontend-v2/vite.config.ts`
- `frontend-v2/tsconfig.node.json`
- `frontend-v2/tests/e2e/fixtures/foundation.fixture.ts`
- `frontend-v2/tests/e2e/foundation-smoke.spec.ts`

权威文档/spec：

- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/infra/ci-execution.md`
- `.trellis/spec/infra/e2e-isolation.md`
- 本 Task 的 `task.json`、`prd.md`、`design.md`、`implement.md`

只读审计、不修改：`deploy/scripts/e2e-local.sh`、`deploy/compose*.yaml`、nginx、Dockerfile、根 `.gitignore`、V1 Playwright/tests 与部署脚本。

## Make target 修改前后

### `bootstrap`

修改前：

```make
@test -f .env || cp .env.example .env
$(UV) sync --project backend --all-extras
npm --prefix frontend ci
```

修改后末尾追加：

```make
npm --prefix frontend-v2 ci
```

### `contract-check`

修改前：backend contract check、`npm --prefix frontend run api:check`。修改后末尾追加：

```make
npm --prefix frontend-v2 run api:check
```

### `lint`

修改前：backend Ruff、V1 lint。修改后末尾追加：

```make
npm --prefix frontend-v2 run lint
```

### `typecheck`

修改前：backend mypy、V1 typecheck。修改后末尾追加：

```make
npm --prefix frontend-v2 run typecheck
```

### `test-unit`

修改前：backend unit、V1 test。修改后末尾追加：

```make
npm --prefix frontend-v2 run test
```

### `build`

修改前：backend Docker build、V1 frontend Docker build。修改后末尾追加：

```make
npm --prefix frontend-v2 run build
```

### `e2e`

修改前：

```make
deploy/scripts/e2e-local.sh
```

修改后：

```make
deploy/scripts/e2e-local.sh
npm --prefix frontend-v2 run e2e
```

### `verify`

target 与 recipe 保持不变：

```make
verify: contract-check lint typecheck test-unit test-integration build e2e
	$(COMPOSE) config --quiet
	PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

其 V1/V2 覆盖来自上述既有 target；不复制命令。

## CI dependency cache/install

1. `verify` job 的 `cache-dependency-path` 改为两行 lockfile。
2. 在 V1 `npm ci` 后增加 `npm ci --prefix frontend-v2`。
3. 保留 backend unit 与 V1 visual-contract；增加 `npm --prefix frontend-v2 run test`。
4. 保留两路 V1 Vitest shard，不在 `verify` job 重跑 V1 Vitest，不给 V2 建 shard。
5. 保留 Playwright Chromium 安装步骤，把 V1-only E2E 调用替换为 `make e2e`。
6. 保持 `workflow_dispatch`、job 名、Compose 静态检查和所有失败默认传播。

## V2 Playwright 实施

1. 添加与 V1 当前版本一致的 `@playwright/test`，生成 lockfile 变更；不添加其他依赖。
2. 添加 `e2e` npm script。
3. 添加 Playwright config：两个 viewport project、单 worker、真实 build + `vite preview` webServer、固定 4174、禁止复用已有 server、失败 trace 写 `.cache`。
4. 在保留 Vitest 默认 exclude 的基础上排除 `tests/e2e/**`，确保 unit 与 Playwright suite 互不导入。
5. 将 config/tests 纳入 `tsconfig.node.json`。
6. 添加 `foundationApi` fixture：只允许匿名 `auth/me`，其他 API 显式失败。
7. 添加单个 Foundation smoke：`/`、`/products` deep link/refresh、App Shell、desktop/mobile navigation、breadcrumb/active、runtime/static resource failure audit。

## V1/V2 失败传播

- Make 每个命令独立一行，无忽略失败语法；V1 失败时停止，V2 失败时根 target 非零。
- GitHub Actions 每个 step 使用默认 fail-fast；任一 `verify` step 或 shard 失败使 workflow 失败。
- fixture 未声明 API、console error、page error、request failure 或失败静态资源均使 V2 smoke 非零。

## 必需验证顺序

### 1. Targeted V2 smoke

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/foundation-smoke.spec.ts
```

### 2. V1/V2 npm scripts

```bash
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
npm --prefix frontend run lint
npm --prefix frontend-v2 run lint
npm --prefix frontend run typecheck
npm --prefix frontend-v2 run typecheck
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend run build
npm --prefix frontend-v2 run build
```

### 3. 修改后的 Make targets

```bash
make bootstrap
make contract-check
make lint
make typecheck
make test-unit
make build
make e2e
```

### 4. CI YAML / Compose 静态检查

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend python -c "import pathlib, yaml; data=yaml.load(pathlib.Path('.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader); assert set(data['on']) == {'workflow_dispatch'}; assert set(data['jobs']) == {'verify', 'frontend-test'}"
docker compose --env-file .env.example -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test docker compose --env-file .env.example -f deploy/compose.prod.yaml config --quiet
```

### 5. Phase 1 最终门禁

```bash
make verify
```

分层聚合会按批准要求再次覆盖较小检查；失败后只有根因证据、代码或环境发生相关变化才重跑对应失败命令。

## 失败归因与停止条件

- 先记录精确命令、首个失败、退出码和日志，再判断是当前改动、既有 V1 缺陷或环境阻塞。
- 只修复由本 Task 引入且位于授权范围内的失败；不修改测试隐藏产品缺陷。
- 不过滤 console、不放宽断言、不增加任意 timeout/retry、不跳过测试。
- Docker、PostgreSQL、Redis、浏览器或网络不可用时，列出已通过检查和未运行门禁；`make verify` 未通过不得声明 Phase 1 退出。
- 同一失败在没有新证据或相关修改时不得重跑；修复开始产生无关失败时停止并报告。
- 不 push，因此 CI 只做本地 YAML/Compose 静态验证，不声称远端 workflow 已运行。

## Rollback Point

实施分支创建时记录最新、干净 `main` 的 HEAD 作为 rollback point。未 merge 前反向撤销当前 Task diff 或放弃临时分支；不得 `git reset --hard`、覆盖用户改动或修改 V1/部署入口。

## 文档/spec 同步

- `08-testing-quality-and-acceptance.md`：补充 Foundation artifact smoke、viewport 与 fixture 边界。
- `quality-guidelines.md`：记录根双前端门禁和 V2 Playwright 命令合同。
- `ci-execution.md`：记录双 lockfile、V2 unit/smoke、V1 shard 保留和失败矩阵。
- `e2e-isolation.md`：区分 V1 真实隔离 E2E 与 V2 fixture smoke，并记录 `make e2e` 顺序。
- `07-migration-plan.md` 当前描述已与设计一致，不重复维护相同事实。

## 明确非目标

- Products List、Product Facts、业务数据、workflow、后端/OpenAPI/数据库变更。
- Compose、nginx、Dockerfile、生产静态目录、部署接管、release/cutover。
- 删除或弱化 V1、删除 `frontend/`、修改 CI trigger、增加 shard/并行框架。
- 根 npm workspace、新 orchestrator、commit、merge、push、archive 或 Phase 2。
