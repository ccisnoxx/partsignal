# E2E 运行隔离契约

## 1. Scope / Trigger

本地或 CI 运行根 `make e2e` 时适用。canonical Frontend 的 AI Channel Configuration、Product Facts、Content Editor、AI Production、Content Review、Content Version Detail、Publishing、GEO、Auth 与 System Admin 真实栈 Playwright 使用真实 PostgreSQL、Redis、API、Worker、对象存储和浏览器，每次运行必须拥有独立数据库与临时存储；fixture-based 页面测试继续只验证 production build artifact，不冒充真实业务闭环。对象存储 upload intent 的签名 query 属于临时 capability；真实文件流的 access log、Playwright failure message 和保留产物不得回显该 query。

## 2. Signatures

```text
make e2e
deploy/scripts/e2e-local.sh [playwright arguments...]
PARTSIGNAL_E2E_SPEC=tests/e2e/<name>-real-stack.spec.ts deploy/scripts/e2e-local.sh
deploy/scripts/e2e-database.py create partsignal_e2e_YYYYMMDD_PID
deploy/scripts/e2e-database.py drop   partsignal_e2e_YYYYMMDD_PID
npm --prefix frontend run e2e -- [playwright arguments...]
backend/.venv/bin/uvicorn app.dev_storage:app --host 127.0.0.1 --port "$PARTSIGNAL_E2E_STORAGE_PORT" --no-access-log
```

## 3. Contracts

- `DATABASE_URL`、`REDIS_URL` 必填；`PARTSIGNAL_E2E_STORAGE_PORT` 可选，默认 `19009`。
- `PARTSIGNAL_E2E_SPEC` 未设置时运行完整 canonical real-stack；设置时复用同一隔离数据库、Redis、存储、进程与 cleanup，只运行指定真实栈 spec。定向模式只用于独立诊断，不能替代完整 `make e2e` 或最终门禁。
- `REDIS_URL` 必须指向启动前为空且本次运行独占的非 0 logical DB；DB 0、同库外部客户端或未知残留键直接失败。CI E2E 固定使用 DB 14，backend integration 继续使用 DB 15。
- 数据库名必须匹配 `^partsignal_e2e_\d{8}_\d+$`；创建和删除都拒绝其他名称。业务服务、Alembic 和种子命令只使用本次创建的数据库。
- 对象存储和 Celery beat 文件只写入本次 `mktemp -d` 创建的目录。
- E2E runner 启动 Celery worker/beat 时使用顶层 `--quiet` 关闭会回显 broker 连接值的 lifecycle banner/关闭诊断；业务 `WARNING` 日志、进程退出码、PID stop/wait 与 cleanup 输出仍须保留。不得用 logfile、输出重定向、事后过滤或全局 scanner 替代 owner 修复。
- 退出时无论测试成功、失败或收到信号，都停止并 `wait` 本次进程；只删除枚举后符合 allowlist 的精确 Celery/Kombu 键，并证明 Redis 为空和固定端口释放，再 drop 本次数据库和删除临时目录。
- 清理输出分别使用数据库 `status=dropped`、存储 `status=removed`、Redis `status=deleted` 与端口 `status=released`；测试成功但任一清理失败时，脚本仍以非零状态退出。禁止 `FLUSHDB`、通配删除、broad kill 或候选路径清理。
- 根 `make e2e` 先通过 `e2e-local.sh` 在同一隔离栈运行全部 canonical 真实 flow，成功并精确清理后再运行 canonical fixture-based 页面 suite；任一阶段失败时根 target 非零。
- Playwright `webServer` 必须执行 production build 后通过 `vite preview` 服务当前 artifact，不使用 Vite dev server。真实栈 external base URL 模式复用 orchestration 已启动的 4174 preview，不得再启动第二个 `webServer`。
- 真实栈 spec 只允许测试 API 登录、读取最终投影和前端尚无页面的最小前置配置；已有页面覆盖的业务 mutation 必须通过 UI，禁止 `page.route`、`route.fulfill` 或固定成功状态。既有专项 flow 为建立独立读取或后续状态前置所需的 API mutation不得扩展为第二套业务编排。
- Playwright config 在 `PARTSIGNAL_E2E_REAL_STACK=1` 时统一关闭 trace；普通 fixture suite 继续 `retain-on-failure`，不得让 credential 进入失败产物。
- `foundationApi` 只允许 active ADMIN 的 `GET /api/v1/auth/me` 与 `GET /api/v1/auth/csrf`；任何其他 API 请求、页面异常、失败请求或失败静态资源使 smoke 失败。匿名、首次改密、自助改密与退出由 `auth-session.spec.ts` 显式验证。
- dev-storage 必须关闭 Uvicorn access log，避免完整签名 URL 进入终端或 CI 日志；Playwright `requestfailed` 只记录 method 与 pathname。浏览器上传仍严格使用 upload intent 返回的完整 URL，但 assertion 只能比较 boolean 或其他不展开 operands 的值。

## 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 必填连接变量缺失 | 启动前失败，不创建资源 |
| Redis DB 为 0、非空或存在同库外部客户端 | preflight 失败，不创建数据库或临时存储 |
| Redis cleanup 枚举到 allowlist 外键 | 拒绝删除未知键，清理非零退出 |
| 8000、9001、4174 或对象存储端口已占用/重复 | preflight 或 cleanup 失败并报告确切端口 |
| 数据库名不满足 allowlist | 拒绝创建或删除 |
| 迁移、构建、种子、服务就绪或 Playwright 失败 | 保留原失败码并执行清理 |
| `PARTSIGNAL_E2E_SPEC` 指向不存在的测试文件 | Playwright 非零退出并执行同一精确清理 |
| 删除数据库或临时目录失败 | 输出失败目标并以非零状态退出 |
| 临时目录不在本次前缀下 | 拒绝递归删除 |
| 共享开发库中存在历史 E2E 数据 | 不做广泛清扫，另行按所有权调查 |
| build/preview、fixture、真实业务 flow 或浏览器断言失败 | 根 `make e2e` 非零退出，并执行同一数据库与临时存储精确清理 |
| fixture 发起未声明业务 API | 显式记录并使测试失败，不补固定成功响应 |
| 日志、错误、trace、video 或测试产物出现对象存储签名 query | Gate 失败；在 owner 关闭回显，不修改签名协议、不增加静默成功路径 |

## 5. Good / Base / Bad Cases

- Good：canonical 真实 flows 在同一独立数据库栈完成并精确清理；随后 fixture suite 对同一类 production artifact 完成页面矩阵。
- Base：真实 flow 或 artifact 缺陷使根入口失败；已创建资源仍完整清理并保留真实失败。
- Bad：真实 flow 对共享开发库运行、fixture suite 连接未受控后端、运行时加入 mock fallback，或过滤失败请求。
- Good：真实上传仍精确比较完整 intent URL，同时终端日志和失败产物只含 pathname，不含 `signature`、`expires` 或 `operation` query。

## 6. Tests Required

- `bash -n deploy/scripts/e2e-local.sh`。
- `PARTSIGNAL_E2E_SPEC=tests/e2e/<目标>-real-stack.spec.ts deploy/scripts/e2e-local.sh` 只运行目标 spec，仍输出 database `status=dropped`、storage `status=removed`、Redis `status=deleted` 与 port `status=released`；完整门禁仍由未设置变量的 `make e2e` 验证。
- `python -m py_compile deploy/scripts/e2e-database.py deploy/scripts/e2e-environment.py`。
- 至少运行一个真实 Playwright 用例，确认 production artifact 壳层按需就绪。
- 分别验证成功和测试失败路径都输出数据库 `status=dropped`、存储 `status=removed`、Redis `status=deleted` 与端口 `status=released`，且对应资源已不存在。
- `npm --prefix frontend run e2e -- tests/e2e/foundation-smoke.spec.ts` 必须在 375×900 与 1440×1000 均通过，并确认 `/`、`/products` deep link/refresh、App Shell、导航和静态资源错误审计。
- `deploy/scripts/e2e-local.sh` 必须实际运行 `tests/e2e/ai-channel-configuration-real-stack.spec.ts`、`product-facts-real-stack.spec.ts`、`content-ai-real-stack.spec.ts`、`content-review-real-stack.spec.ts`、`content-version-detail-real-stack.spec.ts`、`publication-workspace-real-stack.spec.ts`、`geo-real-stack.spec.ts`、`auth-session-real-stack.spec.ts` 与 `system-admin-real-stack.spec.ts --project=foundation-desktop`。
- 真实 GEO 上传成功后检查 dev-storage 输出和 Playwright 保留产物不含 `signature=`；同时断言浏览器 PUT 的完整 URL 与 upload intent 完全相等。
- 最后运行 `make e2e`；完整门禁运行 `make verify`。

## 7. Wrong vs Correct

```text
Wrong: 共享 Redis 或固定端口被外部进程占用仍继续 → 运行时 mock fallback → 忽略清理或浏览器失败
Correct: 先确认固定端口与非 0 Redis logical DB 独占 → allowlist 数据库与 mktemp 精确清理 → canonical 真实 flow → 清理后运行 fixture suite → 任一失败使根入口失败

Wrong: dev-storage 默认 access log 或 Playwright matcher 打印完整签名 URL → capability 进入日志/失败产物
Correct: dev-storage 使用 --no-access-log，失败只记录 method + pathname，完整 URL 只做不展开 operands 的严格 equality
```
