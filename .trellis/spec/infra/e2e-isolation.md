# E2E 运行隔离契约

## 1. Scope / Trigger

本地或 CI 运行根 `make e2e` 时适用。V1 与 V2 AI Channel Configuration/Product Facts/Content Editor/AI Production/Content Review/Content Version Detail/Publishing/GEO/Auth 真实栈 Playwright 使用真实
PostgreSQL、Redis、API、Worker、对象存储和浏览器，每次运行必须拥有独立数据库与临时
存储；V2 fixture-based 页面测试继续只验证 production build artifact，不冒充真实业务闭环。
对象存储 upload intent 的签名 query 属于临时 capability；运行真实文件流时还必须保证服务 access log、Playwright failure message 和保留产物不回显该 query。

## 2. Signatures

```text
make e2e
deploy/scripts/e2e-local.sh [playwright arguments...]
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/<name>-real-stack.spec.ts deploy/scripts/e2e-local.sh
deploy/scripts/e2e-database.py create partsignal_e2e_YYYYMMDD_PID
deploy/scripts/e2e-database.py drop   partsignal_e2e_YYYYMMDD_PID
npm --prefix frontend-v2 run e2e -- [playwright arguments...]
backend/.venv/bin/uvicorn app.dev_storage:app --host 127.0.0.1 --port "$PARTSIGNAL_E2E_STORAGE_PORT" --no-access-log
```

## 3. Contracts

- `DATABASE_URL`、`REDIS_URL` 必填；`PARTSIGNAL_E2E_STORAGE_PORT` 可选，默认 `19009`。
- `PARTSIGNAL_E2E_V2_SPEC` 未设置时保留完整 V2 real-stack → V1 顺序；设置时复用同一隔离数据库、Redis、存储、进程与 cleanup，只构建/启动 V2 production preview 并运行指定 V2 spec，不构建、启动或运行 V1，也不运行其他 V2 spec。定向模式只用于独立诊断，不能替代完整 `make e2e` 或 Phase Exit Gate。
- `REDIS_URL` 必须指向启动前为空且本次运行独占的非 0 logical DB；DB 0、同库外部客户端或未知残留键直接失败。CI E2E 固定使用 DB 14，backend integration 继续使用 DB 15。
- 数据库名必须匹配 `^partsignal_e2e_\d{8}_\d+$`；创建和删除都拒绝其他名称。
- 业务服务、Alembic 和种子命令只使用本次创建的数据库。
- 对象存储和 Celery beat 文件只写入本次 `mktemp -d` 创建的目录。
- 退出时无论测试成功、失败或收到信号，都停止并 `wait` 本次进程；只删除枚举后符合 allowlist 的精确 Celery/Kombu 键，并证明 Redis 为空和固定端口释放，再 drop 本次数据库和删除临时目录。
- 清理输出分别使用数据库 `status=dropped`、存储 `status=removed`、Redis `status=deleted` 与端口 `status=released`；测试成功但任一清理失败时，脚本仍以非零状态退出。禁止 `FLUSHDB`、通配删除、broad kill 或候选路径清理。
- 根 `make e2e` 先通过 `e2e-local.sh` 在同一隔离栈运行 V2 AI Channel Configuration、Product Facts、Content Editor、AI Production、Content Review、Content Version Detail、Publishing、GEO 与 Auth 真实 flow，再运行 V1 suite；成功并清理后运行 V2 fixture-based 页面 suite，任一阶段失败时根 target 非零。
- V2 Product Facts 与 AI Production gate 必须早于 V1 suite；否则既有 V1 失败会在 `set -e` 下跳过 V2 真实闭环门禁。
- V2 `webServer` 必须执行 production build 后通过 `vite preview` 服务当前 artifact，不使用 Vite dev server。
- `deploy/scripts/e2e-local.sh` 必须在同一隔离数据库生命周期内以 `VITE_API_BASE_URL` 构建并启动 V2 production preview，再运行 AI Channel Configuration、Product Facts、AI Production、Content Review、Content Version Detail、Publishing、GEO 与 Auth 真实栈 spec；不得另建数据库、seed 或清理入口。
- V2 真实栈 spec 只允许测试 API 登录、读取最终投影和 V2 尚无页面的最小前置配置；Product Facts、ContentTask 创建、Editor manual/save/submit/revision、Review decision、generation/retry/humanization、Publishing 的 start/preparation/review/result/verification/issue/repair/resolve，以及 GEO 的目标 Observation/Correction/Optimization Task mutation 必须通过 V2 页面，禁止 `page.route`、`route.fulfill` 或固定成功状态。既有专项 flow 为建立独立读取或后续状态前置所需的 API mutation 不得扩展为第二套业务编排。
- V2 Playwright 在 external base URL 模式复用脚本已启动的 preview，不得再启动第二个 `webServer`；默认模式仍自行 build + preview，并跳过真实栈 spec。
- V1/V2 Playwright config 在 `PARTSIGNAL_E2E_REAL_STACK=1` 时统一关闭 trace；普通 fixture suite 继续 `retain-on-failure`，不得让 credential 进入失败产物。
- V2 `foundationApi` 只允许 active ADMIN 的 `GET /api/v1/auth/me` 与 `GET /api/v1/auth/csrf`；任何其他 API 请求、页面异常、失败请求或失败静态资源使 smoke 失败。匿名、首次改密、自助改密与退出由 `auth-session.spec.ts` 的显式 Auth fixture 验证。
- V2 Foundation smoke 不创建数据库、不启动 backend、不读取 Products 业务数据，也不替代 Auth 或 V1 真实 E2E。
- V1 运行前必须确认 `127.0.0.1:5173` 未被外部 listener 占用。当前 Vite 会在端口冲突时自动换端口，但 readiness 与 Playwright 仍固定访问 5173；遇到外部 listener 必须停止并报告所有者，不得连接外部服务或擅自终止未知进程。
- V1 的 `REDIS_URL` 必须指向本次运行独占的 broker 逻辑库，或确认没有其他 Worker/Scheduler 连接同一 broker 逻辑库；共享队列会让外部 Worker 抢占任务并访问错误数据库，不能作为有效 E2E 环境。
- dev-storage 必须关闭 Uvicorn access log，避免完整签名 URL 进入终端或 CI 日志；Playwright `requestfailed` 只记录 method 与 pathname。浏览器上传仍必须严格使用 upload intent 返回的完整 URL，但 assertion 只能比较 boolean 或其他不展开 operands 的值，不能在失败报告中回显 capability。

## 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 必填连接变量缺失 | 启动前失败，不创建资源 |
| Redis DB 为 0、非空或存在同库外部客户端 | preflight 失败，不创建数据库或临时存储 |
| Redis cleanup 枚举到 allowlist 外键 | 拒绝删除未知键，清理非零退出 |
| 固定端口或对象存储端口已占用/重复 | preflight 或 cleanup 失败并报告确切端口 |
| 数据库名不满足 allowlist | 拒绝创建或删除 |
| 迁移、构建、种子、服务就绪或 Playwright 失败 | 保留原失败码并执行清理 |
| `PARTSIGNAL_E2E_V2_SPEC` 指向不存在的测试文件 | Playwright 非零退出并执行同一精确清理 |
| 删除数据库或临时目录失败 | 输出失败目标并以非零状态退出 |
| 临时目录不在本次前缀下 | 拒绝递归删除 |
| 共享开发库中存在历史 E2E 数据 | 不做广泛清扫，另行按所有权调查 |
| V2 build/preview、fixture、真实业务 flow 或浏览器断言失败 | 根 `make e2e` 非零退出，并执行同一数据库与临时存储精确清理 |
| V2 发起未声明业务 API | fixture 显式记录并使测试失败，不补固定成功响应 |
| `127.0.0.1:5173` 已被外部 listener 占用 | 运行前停止并报告 PID/命令；不得让 Vite 自动换端口后继续测试外部 5173 |
| 其他 Worker/Scheduler 连接相同 Redis broker 逻辑库 | 改用已确认空闲的独占逻辑库，或停止明确归属的干扰进程；不得在共享队列上继续运行 |
| 日志、错误、trace、video 或测试产物出现对象存储签名 query | Gate 失败；在 access-log 或 failure-output owner 关闭回显，不修改签名协议、不增加静默成功路径 |

## 5. Good / Base / Bad Cases

- Good：V2 AI Channel Configuration、Product Facts、AI Production、Content Review/Revision、Content Version Detail、Publishing、GEO 与 Auth 在同一独立数据库栈完成真实 flow，再运行 V1 并精确清理；随后 V2 fixture suite 对 production artifact 完成页面矩阵。
- Base：V1 产品缺陷或 V2 artifact 缺陷使根入口失败；隔离栈已创建资源仍完整清理并保留真实失败。
- Bad：V1/V2 真实 flow 对共享开发库运行，或 V2 fixture suite 连接未受控后端、运行时加入 mock fallback、过滤失败请求。
- Good：真实上传仍精确比较完整 intent URL，同时终端日志和失败产物只含 pathname，不含 `signature`、`expires` 或 `operation` query。
- Base：非签名请求失败时保留 method、pathname 与浏览器错误文本，诊断能力不依赖完整 URL。
- Bad：为方便断言直接打印 request URL，或用全局日志脱敏层掩盖 dev-storage access log 的 capability 泄漏。

## 6. Tests Required

- `bash -n deploy/scripts/e2e-local.sh`。
- `PARTSIGNAL_E2E_V2_SPEC=tests/e2e/<目标>-real-stack.spec.ts deploy/scripts/e2e-local.sh` 只运行目标 V2 spec，仍输出 database `status=dropped`、storage `status=removed`、Redis `status=deleted` 与 port `status=released`；完整门禁仍由未设置变量的 `make e2e` 验证。
- `python -m py_compile deploy/scripts/e2e-database.py`。
- 至少运行一个真实 Playwright 用例，确认生产/开发壳层按需就绪。
- 分别验证成功和测试失败路径都输出数据库 `status=dropped`、存储 `status=removed`、Redis `status=deleted` 与端口 `status=released`，且对应资源已不存在。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/foundation-smoke.spec.ts` 必须在 375×900 与 1440×1000 均通过，并确认 `/`、`/products` deep link/refresh、App Shell、导航和静态资源错误审计。
- `deploy/scripts/e2e-local.sh` 必须实际运行 `tests/e2e/ai-channel-configuration-real-stack.spec.ts`、`tests/e2e/product-facts-real-stack.spec.ts`、`tests/e2e/content-ai-real-stack.spec.ts`、`tests/e2e/content-review-real-stack.spec.ts`、`tests/e2e/content-version-detail-real-stack.spec.ts`、`tests/e2e/publication-workspace-real-stack.spec.ts`、`tests/e2e/geo-real-stack.spec.ts` 与 `tests/e2e/auth-session-real-stack.spec.ts --project=foundation-desktop`；AI Channel Configuration 覆盖旧凭据失败、replacement-only 成功、正式生成与消费者/审计/Usage 收口，Product Facts 覆盖批准交接、退回修订和独立 Content Editor 人工首稿 → 保存 → 提交，AI Production 覆盖真实 Worker generation、人性化、超时失败和 exact snapshot retry，Content Review Flow A 覆盖 save → submit → approve → canonical Task/Version Detail → `START_PUBLICATION`，Flow B 覆盖 request changes → HUMAN revision → save/resubmit → approve 与版本/审核目标隔离，Version Detail 保留独立 HUMAN 只读证据，Publishing 覆盖成功成果、FAILED 换版恢复和 Article → Issue → repair task → resolve 的连续 UI 生命周期及只读历史断言；GEO Flow A 覆盖 New → root Detail → append-only Correction → tail Detail/List、真实附件与 root 不可变，Flow B 覆盖 Insights `CONTENT_DECLINE` → Optimization ContentTask 及不可变 GEO source；Auth 覆盖真实 V2 UI login → forced change → ENGINEER admin 403 → logout，并关闭 trace、扫描测试密码。
- V1 E2E 前运行 `lsof -nP -iTCP:5173 -sTCP:LISTEN`；存在非本次 listener 时记录 PID/命令并阻塞，不运行误指向外部服务的门禁。
- V1 E2E 前确认 `REDIS_URL` 对应逻辑库未被其他 Worker/Scheduler 使用；复用本机 Redis 时，先只读确认目标逻辑库为空，再把该独占 URL 传给本次 API、Worker 和 Scheduler。
- 最后运行 `make e2e`；完整 Phase 1 门禁运行 `make verify`。
- 真实 GEO 上传成功后检查 dev-storage 输出和 Playwright 保留产物不含 `signature=`；同时断言浏览器 PUT 的完整 URL 与 upload intent 完全相等，确保脱敏没有放宽传输合同。

## 7. Wrong vs Correct

```text
Wrong: 外部进程占用 5173 或共享 Redis 队列仍继续 V1 E2E → V2 dev server/运行时 mock fallback → 忽略清理或浏览器失败
Correct: 先确认固定端口与非 0 Redis broker 逻辑库由本次 E2E 独占 → allowlist 数据库与 mktemp 精确清理 → V2 AI Channel Configuration/Product Facts/AI Production/Publishing/GEO/Auth gate → V1 suite → 清理后运行 V2 fixture suite → 任一失败使根入口失败

Wrong: dev-storage 默认 access log 或 Playwright matcher 打印完整签名 URL → capability 进入日志/失败产物
Correct: dev-storage 使用 --no-access-log，失败只记录 method + pathname，完整 URL 只做不展开 operands 的严格 equality
```
