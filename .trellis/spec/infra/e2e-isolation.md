# E2E 运行隔离契约

## 1. Scope / Trigger

本地或 CI 运行根 `make e2e` 时适用。V1 与 V2 Product Facts/Content Editor/AI Production/Content Review 真实栈 Playwright 使用真实
PostgreSQL、Redis、API、Worker、对象存储和浏览器，每次运行必须拥有独立数据库与临时
存储；V2 fixture-based 页面测试继续只验证 production build artifact，不冒充真实业务闭环。

## 2. Signatures

```text
make e2e
deploy/scripts/e2e-local.sh [playwright arguments...]
deploy/scripts/e2e-database.py create partsignal_e2e_YYYYMMDD_PID
deploy/scripts/e2e-database.py drop   partsignal_e2e_YYYYMMDD_PID
npm --prefix frontend-v2 run e2e -- [playwright arguments...]
```

## 3. Contracts

- `DATABASE_URL`、`REDIS_URL` 必填；`PARTSIGNAL_E2E_STORAGE_PORT` 可选，默认 `19009`。
- 数据库名必须匹配 `^partsignal_e2e_\d{8}_\d+$`；创建和删除都拒绝其他名称。
- 业务服务、Alembic 和种子命令只使用本次创建的数据库。
- 对象存储和 Celery beat 文件只写入本次 `mktemp -d` 创建的目录。
- 退出时无论测试成功、失败或收到信号，都停止本次进程、删除本次数据库和临时目录。
- 清理输出使用 `E2E_CLEANUP target=value status=deleted`；测试成功但清理失败时，脚本仍以非零状态退出。
- 根 `make e2e` 先通过 `e2e-local.sh` 在同一隔离栈运行 V2 Product Facts、Content Editor、AI Production 与 Content Review 真实 flow，再运行 V1 suite；成功并清理后运行 V2 fixture-based 页面 suite，任一阶段失败时根 target 非零。
- V2 Product Facts 与 AI Production gate 必须早于 V1 suite；否则既有 V1 失败会在 `set -e` 下跳过 V2 真实闭环门禁。
- V2 `webServer` 必须执行 production build 后通过 `vite preview` 服务当前 artifact，不使用 Vite dev server。
- `deploy/scripts/e2e-local.sh` 必须在同一隔离数据库生命周期内以 `VITE_API_BASE_URL` 构建并启动 V2 production preview，再运行 Product Facts 与 AI Production 真实栈 spec；不得另建数据库、seed 或清理入口。
- V2 真实栈 spec 只允许测试 API 登录、读取最终投影和 V2 尚无页面的最小前置配置；Product Facts、ContentTask 创建、Editor manual/save/submit、generation/retry/humanization 等业务 mutation 必须通过 V2 页面，禁止 `page.route`、`route.fulfill` 或固定成功状态。
- V2 Playwright 在 external base URL 模式复用脚本已启动的 preview，不得再启动第二个 `webServer`；默认模式仍自行 build + preview，并跳过真实栈 spec。
- V2 `foundationApi` 只允许匿名 `GET /api/v1/auth/me`；任何其他 API 请求、页面异常、失败请求或失败静态资源使 smoke 失败。
- V2 Foundation smoke 不创建数据库、不启动 backend、不读取 Products 业务数据，也不替代 V1 真实 E2E。
- V1 运行前必须确认 `127.0.0.1:5173` 未被外部 listener 占用。当前 Vite 会在端口冲突时自动换端口，但 readiness 与 Playwright 仍固定访问 5173；遇到外部 listener 必须停止并报告所有者，不得连接外部服务或擅自终止未知进程。
- V1 的 `REDIS_URL` 必须指向本次运行独占的 broker 逻辑库，或确认没有其他 Worker/Scheduler 连接同一 broker 逻辑库；共享队列会让外部 Worker 抢占任务并访问错误数据库，不能作为有效 E2E 环境。

## 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 必填连接变量缺失 | 启动前失败，不创建资源 |
| 数据库名不满足 allowlist | 拒绝创建或删除 |
| 迁移、构建、种子、服务就绪或 Playwright 失败 | 保留原失败码并执行清理 |
| 删除数据库或临时目录失败 | 输出失败目标并以非零状态退出 |
| 临时目录不在本次前缀下 | 拒绝递归删除 |
| 共享开发库中存在历史 E2E 数据 | 不做广泛清扫，另行按所有权调查 |
| V2 build/preview、fixture、真实业务 flow 或浏览器断言失败 | 根 `make e2e` 非零退出，并执行同一数据库与临时存储精确清理 |
| V2 发起未声明业务 API | fixture 显式记录并使测试失败，不补固定成功响应 |
| `127.0.0.1:5173` 已被外部 listener 占用 | 运行前停止并报告 PID/命令；不得让 Vite 自动换端口后继续测试外部 5173 |
| 其他 Worker/Scheduler 连接相同 Redis broker 逻辑库 | 改用已确认空闲的独占逻辑库，或停止明确归属的干扰进程；不得在共享队列上继续运行 |

## 5. Good / Base / Bad Cases

- Good：V2 Product Facts、AI Production 与 V1 在同一独立数据库栈依次完成真实 flow 并精确清理，随后 V2 fixture suite 对 production artifact 完成页面矩阵。
- Base：V1 产品缺陷或 V2 artifact 缺陷使根入口失败；隔离栈已创建资源仍完整清理并保留真实失败。
- Bad：V1/V2 真实 flow 对共享开发库运行，或 V2 fixture suite 连接未受控后端、运行时加入 mock fallback、过滤失败请求。

## 6. Tests Required

- `sh -n deploy/scripts/e2e-local.sh`。
- `python -m py_compile deploy/scripts/e2e-database.py`。
- 至少运行一个真实 Playwright 用例，确认生产/开发壳层按需就绪。
- 分别验证成功和测试失败路径都输出数据库、存储 `status=deleted`，且对应资源已不存在。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/foundation-smoke.spec.ts` 必须在 375×900 与 1440×1000 均通过，并确认 `/`、`/products` deep link/refresh、App Shell、导航和静态资源错误审计。
- `deploy/scripts/e2e-local.sh` 必须实际运行 `tests/e2e/product-facts-real-stack.spec.ts`、`tests/e2e/content-ai-real-stack.spec.ts` 与 `tests/e2e/content-review-real-stack.spec.ts --project=foundation-desktop`；Product Facts 覆盖批准交接、退回修订和独立 Content Editor 人工首稿 → 保存 → 提交，AI Production 覆盖真实 Worker generation、人性化、超时失败和 exact snapshot retry，Content Review 使用独立任务覆盖 approve 与 request-changes canonical 闭环。
- V1 E2E 前运行 `lsof -nP -iTCP:5173 -sTCP:LISTEN`；存在非本次 listener 时记录 PID/命令并阻塞，不运行误指向外部服务的门禁。
- V1 E2E 前确认 `REDIS_URL` 对应逻辑库未被其他 Worker/Scheduler 使用；复用本机 Redis 时，先只读确认目标逻辑库为空，再把该独占 URL 传给本次 API、Worker 和 Scheduler。
- 最后运行 `make e2e`；完整 Phase 1 门禁运行 `make verify`。

## 7. Wrong vs Correct

```text
Wrong: 外部进程占用 5173 或共享 Redis 队列仍继续 V1 E2E → V2 dev server/运行时 mock fallback → 忽略清理或浏览器失败
Correct: 先确认 5173 与 Redis broker 逻辑库由本次 E2E 独占 → allowlist 数据库与 mktemp 精确清理 → V2 Product Facts/AI Production gate → V1 suite → 清理后运行 V2 fixture suite → 任一失败使根入口失败
```
