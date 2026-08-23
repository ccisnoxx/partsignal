# Frontend V2 Workbench UI 实施计划

## 前置门禁

当前仅规划。收到用户对本版规划的明确批准后：

1. 再次确认 primary working directory 仍在 `main`；未提交改动只能是已审阅的本 Task 规划 artifacts 和
   父任务 child metadata，出现其他改动则停止。
2. 运行 `python3 ./.trellis/scripts/task.py start frontend-v2-workbench-ui`。
3. 创建唯一临时分支 `codex/frontend-v2-workbench-ui`，并把 Task branch 记录更新为该分支。
4. 读取 Task 注入上下文，并完整复读因注入大小上限可能被截断的 `state-management.md`，然后才开始
   产品代码修改。

不执行 pull、push、PR、Git 历史改写或完整 `make verify`。

## 精确修改文件

### 新增

1. `frontend-v2/src/domains/workbench/workbench.api.ts`
2. `frontend-v2/src/domains/workbench/workbench.model.ts`
3. `frontend-v2/src/domains/workbench/workbench.model.test.ts`
4. `frontend-v2/src/domains/workbench/workbench-page.tsx`
5. `frontend-v2/src/domains/workbench/workbench-page.test.tsx`
6. `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts`
7. `frontend-v2/tests/e2e/workbench.spec.ts`

### 修改

8. `frontend-v2/src/routes/_app/index.tsx`
9. `frontend-v2/tests/e2e/foundation-smoke.spec.ts`
10. `docs/frontend-v2/03-page-and-workflow-blueprint.md`

### 明确不修改

- `frontend-v2/tests/e2e/fixtures/foundation.fixture.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `contracts/openapi.yaml`
- backend、数据库、V1 frontend、其他 domain、Design System 和 global CSS。

若实现必须超出上述十个产品/测试/文档文件，先停止并报告原因，不自行扩展范围。

## 实施步骤

### 1. Query 与 model

- 在 `workbench.api.ts` 定义唯一 aggregate query key 和 `queryOptions`，调用 generated
  `GET /api/v1/workbench`，沿用现有结构化错误模式和 `staleTime: 30_000`，`retry: false`，不设置轮询；
  该 stale window 让 loader 与页面挂载复用同一结果而不产生第二次 GET。
- 在 `workbench.model.ts` 用 generated types 对六类 count、六种 attention category、四域 health 和
  两种 status 做穷尽映射；仅格式化 date/rate，不推导业务状态、总数或 href。
- 添加 `workbench.model.test.ts`，先锁定 zero/null 与各 union 映射。

### 2. Page 与 route

- `workbench-page.tsx` 使用一个 query 渲染页面 header、六 count 区、attention queue、四域 health 和
  30 日 GEO summary。
- 使用现有 Button、Badge、Skeleton、semantic tokens 与 native anchors；不新增通用 wrapper/framework。
- 显式实现 loading、fatal error/retry、empty、zero count、nullable rate。
- `routes/_app/index.tsx` 保留 metadata ownership，只按共享 query key 预取并渲染 page。
- 添加最小 component tests，覆盖 contract-to-UI、canonical href、error/retry、empty/zero/null。

### 3. Strict fixture 与响应式 E2E

- 新建 generated-type-backed `workbench.fixture.ts`，只允许 auth/CSRF 与一个 Workbench aggregate GET，
  并在 teardown 汇总 unexpected API/runtime error。
- 新建 `workbench.spec.ts`，覆盖单聚合请求、六类 counts、attention/health/GEO、canonical href、
  每个链接可依次键盘聚焦、loading/error/retry/empty/zero/null，以及 375/768/1024/1440 无根横向溢出。
- 不创建 real-stack spec。

### 4. Foundation smoke 与文档

- 把 `foundation-smoke.spec.ts` 的目标改为无业务 loader 的受保护 `/publishing` 父路由，并只验证 App Shell。
- 不改 `foundation.fixture.ts`，以测试层继续证明 business API allowlist 为空。
- 更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 的 Workbench 部分，移除派生 total，补齐当前合同
  映射和 canonical href/aggregate-only 边界。

### 5. 收敛检查

- 检查 diff 没有客户端 join、资格推导、路由重建、global store、轮询、mutation、图表或通用 framework。
- 检查修改只落在精确清单与本 Task artifacts 内。
- 执行 Required Validation；只修复由本任务引入且属于范围内的失败。

## Required Validation

按最高价值定向检查执行，精确命令如下：

```bash
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

不运行完整 `make verify`；本任务没有 shared contract、backend、数据库、权限或状态机改动，上述定向检查和
Frontend V2 production build 足以覆盖当前风险。真实跨域行为的剩余风险由下一子任务 real-stack E2E 验收。

## 停止条件

出现任一情况立即停止实施并报告：

- generated contract 不能表达已批准 UI，因而需要修改 backend、OpenAPI、数据库或兼容字段。
- 需要从 role、status、原始 DTO、count 或其他 domain registry 推导 eligibility、health 或 href。
- 需要多个业务 endpoint join、修改其他 domain cache/mutation owner 或改变已有业务状态机。
- 需要新增全局 store、自动刷新、图表、Workbench mutation、通用页面 framework 或 one-consumer DS 组件。
- 需要放宽 Foundation fixture 的 business API allowlist、增加 real-stack spec、进入抽象回顾或 Phase 9。
- 工作区出现无法归属或会与本任务重叠的用户改动。

## 建议提交范围

用户在实施完成、验证通过并审阅 commit plan 后，再提交一个聚焦的工作提交：

`feat(frontend-v2): add workbench operations inbox`

该提交只包含上述 Workbench domain、根 route、定向 tests/fixtures、Foundation smoke、03 蓝图和本 child
Task 的规划/执行证据。归档与 journal 若产生 Trellis bookkeeping commit，应单独说明并处理；不自动 push。

## 执行证据（2026-08-23）

- 已在 `codex/frontend-v2-workbench-ui` 完成精确十文件范围；未修改 backend、contracts、generated schema、
  Foundation fixture、其他 domain、Design System 或 global CSS。
- `npm --prefix frontend-v2 run test -- src/domains/workbench/workbench.model.test.ts src/domains/workbench/workbench-page.test.tsx`：
  2 files、6 tests 通过。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/workbench.spec.ts tests/e2e/foundation-smoke.spec.ts`：
  mobile/desktop 两个 project 共 6 tests 通过；覆盖 375/768/1024/1440、键盘焦点顺序与 strict API 审计。
- `npm --prefix frontend-v2 run api:check`、`typecheck`、`lint`、`build`：全部通过。production build 仅保留既有
  超过 500 kB 的 chunk warning。
- `git diff --check`：通过。
- `python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-ui`：通过；只报告已知的
  `state-management.md` 注入大小 warning，实施前已完整复读该文件。
