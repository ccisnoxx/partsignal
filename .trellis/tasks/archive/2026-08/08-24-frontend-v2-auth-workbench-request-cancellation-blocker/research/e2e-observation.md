# Research: A26 E2E collector 与 runner 静态证据

- Query: 完整审查 Auth fixture/real-stack 与 System Admin real-stack 的 `requestfailed` 收集方式、Playwright phase/errorText 可观测性、`e2e-local.sh` 定向运行与 secret/cleanup 证据，给出不启动真实栈前可执行的最小诊断方案。
- Scope: internal
- Date: 2026-08-24

## Findings

### 1. 文件范围

- `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts`：A26 失败的真实栈 collector 和 login → forced change → Workbench → System 403 → logout 流程。
- `frontend-v2/tests/e2e/auth-session.spec.ts`：production-artifact Auth fixture 的相邻 collector、精确 Workbench fixture 与 secret scan。
- `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`：现有 method + pathname 局部排除、运行时原始值扫描与 Cookie/CSRF secret 扩充方式。
- `frontend-v2/tests/e2e/secret-artifact.ts`：调用方提供已知 secret sentinel 后递归扫描 Playwright `outputDir`。
- `frontend-v2/playwright.config.ts`：single worker、list reporter、real-stack trace off、external preview 与产物目录 owner。
- `frontend-v2/package.json`、`frontend-v2/package-lock.json`、`frontend-v2/node_modules/playwright-core/types/types.d.ts`：本地安装 Playwright Test 1.61.1 及 `requestfailed`/`request.failure()` 合同。
- `deploy/scripts/e2e-local.sh`：唯一真实栈定向入口、production preview、进程生命周期与 cleanup 调度。
- `deploy/scripts/e2e-environment.py`：Redis allowlist、独占检查与固定端口释放证明。
- `.trellis/spec/frontend/quality-guidelines.md`、`.trellis/spec/infra/e2e-isolation.md`：失败请求、脱敏输出、定向诊断与 cleanup 的稳定合同。
- 归档 Workbench abstraction review / A25 blocker：A26 的已有失败、Gate 与不扩围证据。

### 2. A26 当前可确定与不可确定的事实

可确定：

- 真实 Auth spec 在注册 collector 后依次执行 login、首次改密、等待 `/` 和“工作台”heading、`page.goto('/system/users')`、403 UI、点击 logout 并等待 `/login`（`frontend-v2/tests/e2e/auth-session-real-stack.spec.ts:14-51`）。
- collector 对失败请求只保留 method + pathname；仅按 `POST` + change-password/logout pathname 排除，既不读取 `request.failure()?.errorText`，也不记录当前流程 phase（`frontend-v2/tests/e2e/auth-session-real-stack.spec.ts:16-27`）。
- 归档固定候选的 `make e2e` 得到 V2 real-stack `15 passed, 1 failed`，失败归为 A26；数据库、storage、Redis、ports cleanup 全部完成（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:120-136`）。归档 finding 只保存 `requestfailed: GET /api/v1/workbench`，并明确承认无法判断它发生在离开首页还是 logout（同文件 `:52-53`）。
- A25 已把 fixture 中的精确 `GET /api/v1/workbench` 补齐，且明确未改 real-stack collector/production lifecycle；A26 仍开放（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-workbench-root-fixture-convergence-blocker/research/audit.md:101-115`）。因此 A26 不是 strict fixture 的 501。

不可确定：

- 当前仓库和归档没有保存该失败的 `request.failure().errorText`；全仓只找到上述 method/path 文本，未找到可复用的失败产物或 trace。
- 当前 collector 没有 phase 状态，因此不能从既有输出区分：首次改密后进入 Workbench、离开 Workbench 到 `/system/users`、停留在 403 页、或 logout。
- 静态 collector 证据不能判定生产 Auth/query lifecycle 是否错误。必须先取得一次 phase + errorText 证据，才能在 production owner 与 test collector owner 之间决策。
- Playwright 明确说明 HTTP 404/503 属于成功完成的 HTTP request，会触发 `requestfinished` 而不是 `requestfailed`（本地 `frontend-v2/node_modules/playwright-core/types/types.d.ts:20180-20196`、`:1139-1156`）。因此 `requestfailed` collector 只能证明客户端/网络层失败，不能单独证明“所有错误状态都已审计”；本任务不得把窄排除描述成通用 HTTP 状态审计。

### 3. 三个 collector 的实际边界

#### 3.1 Auth real-stack

- 未知 console error/pageerror 会加入 `runtimeErrors`（`auth-session-real-stack.spec.ts:16-20`）。
- `requestfailed` 只记录 method + pathname（`:21-27`），不会泄漏 query，但也丢失 `errorText` 和 phase。
- 对 change-password/logout 的排除只看 method/path；真实 DNS、连接重置、超时等同 endpoint 失败也会被排除。现有页面 URL/结果断言降低误报风险，但该 predicate 本身不是安全的通用取消识别。
- 最终 `runtimeErrors === []` 在 logout 成功和 `/login` 之后断言（`:48-51`）；密码扫描位于 `finally`（`:52-54`）。

#### 3.2 Auth fixture

- fixture 明确且仅对 `GET /api/v1/workbench` 返回 typed `emptyAggregate`，其余未知 API 501 并在 teardown 失败（`frontend-v2/tests/e2e/auth-session.spec.ts:33-57,96-105`）。
- 相邻 collector 与 real-stack 同形：只按 Auth POST method/path 排除，不读 errorText/phase（`:110-122`）。该文件能证明 fixture 行为和两个 browser project，不提供 A26 真实网络时点证据。
- 密码 sentinel 的 artifact scan 位于 `finally`（`:160-163`）。

#### 3.3 System Admin real-stack

- `watchRuntime` 证明仓库已有 spec-local predicate：change-password POST 或用户 DELETE 的 method/path 可被局部排除（`frontend-v2/tests/e2e/system-admin-real-stack.spec.ts:75-93`）。
- 该实现仍不检查 `request.failure()?.errorText`，也没有 phase；因此只能复用“本 spec 内精确 predicate、其他 failure 继续失败”的形状，不能原样复用到 A26。
- 它把完整 `request.url()` 放入仅用于 secret 检查的 `runtimeValues`（`:84-92`）。A26 的安全诊断不应复制这一行；应只解析并保存 pathname。
- System Admin 在结束前扫描安全响应、DOM/URL/Web Storage/runtime values，并在 `finally` 读取 contexts 的 Cookie value 加入 secret set、再次扫描 Cookie/CSRF 和产物（`:459-479`）。这比 Auth real-stack 只传两个 password sentinel 更广，但本任务没有理由复制整套 System Admin harness 或新增 shared collector。

结论：现有 System Admin 处理不是可直接采用的 A26 修复。唯一可复用的是局部、明确、默认失败的 predicate 结构；A26 最终排除必须额外同时满足 phase + `GET` + `/api/v1/workbench` + 已观测的准确 `errorText`。

### 4. Playwright 本地 API/版本证据

- `@playwright/test` 与 `playwright-core` 均锁定为 `1.61.1`（`frontend-v2/package-lock.json:2966-2979,9689-9700`；声明位于 `frontend-v2/package.json:43-46`）。
- 当前类型定义说明 `requestfailed` 在请求网络失败时触发；listener 获得 `Request`（`frontend-v2/node_modules/playwright-core/types/types.d.ts:1139-1156`）。
- `Request.failure()` 在失败请求上返回 `{ errorText: string }`，类型示例为 `net::ERR_FAILED`；非失败时可为 `null`（同文件 `:20214-20233`）。因此诊断可直接使用公开 API `request.failure()?.errorText`，不需要私有字段、CDP、trace 或浏览器插件。
- phase 不是 Playwright 原生字段，但测试流程串行（Playwright config `fullyParallel: false`、`workers: 1`，`frontend-v2/playwright.config.ts:7-12`），可由当前 spec 内一个字符串变量在每个用户动作前更新，并在同步 `requestfailed` callback 中采样。无需 helper/class/framework。

### 5. 安全的最小定向诊断

只临时修改 `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts`：

1. 在测试内增加一个当前 phase 字符串；至少在以下动作前设置明确 label：login、forced-password-change → Workbench、Workbench ready、`page.goto('/system/users')`、System 403 ready、logout click、login ready。
2. `requestfailed` callback 只构造 `{ phase, method, pathname, errorText }`；`pathname` 继续用 `new URL(request.url()).pathname`，`errorText` 用公开 `request.failure()`。不得保存/输出完整 URL、query、headers、postData、Cookie、CSRF 或密码。
3. 诊断阶段不增加任何 ignore：所有 failed requests 仍进入失败数组，使一次定向运行的失败断言安全显示上述四个非敏感字段。若 `failure()` 意外为 `null`，记录明确的 `missing-errorText` 并继续失败，不把它当预期取消。
4. 在 `page.goto('/system/users')` 之前设置 `leave-workbench-for-system-users`，待 403 heading + focus 均完成后设置 `system-users-ready`；在点击退出前设置 `logout`。事件 callback 采样的是失败被 Playwright 观察到的时点，正好区分用户要求的离页与 logout 两个窗口。
5. 只运行一次：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/auth-session-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
```

6. 取得可归因记录后停止；把证据写入当前 Task `research/audit.md` 和 `design.md`，向用户报告并等待 production/test owner 选择确认。代码或环境未改变时不重复同一失败命令。
7. 若一次运行没有复现，或者 phase/errorText 仍不能唯一归因，A26 保持开放；不加入 filter、不扩大真实栈次数、不打开 trace/video/storage state。

该方案不需要运行 `auth-session.spec.ts`、System Admin、完整 `make e2e` 或 `make verify`；也不需要 `playwright-cli`。真实栈定向模式本身会构建 V2 production artifact 并运行 `foundation-desktop`（`deploy/scripts/e2e-local.sh:93-96,116-123,149-158`）。

### 6. 诊断后的决策门

- 若唯一记录为 phase=`leave-workbench-for-system-users` 或 phase=`logout`、method=`GET`、pathname=`/api/v1/workbench`、errorText=`net::ERR_ABORTED`，且相邻页面/服务端 logout/cookie/CSRF/`/login` 断言均通过：test collector 可在 `auth-session-real-stack.spec.ts` 内加入四条件局部识别。不要忽略所有 `ERR_ABORTED`，不要忽略所有 Workbench GET，不要改 `auth-session.spec.ts` 或 System Admin，除非它们各自出现相同、独立证明的语义。
- 若 phase/errorText/endpoint 任一不同，或事件伴随 UI/session/logout 失败：不加 collector 排除，交给 production Auth/query owner 做最小修复，并增加 AuthProvider unit test。
- 若结果不稳定、没有复现、`failure()` 缺失、或同一运行出现多个不同 phase/errorText：保持 A26 open，停止。
- 无论选择哪一侧，未知 console/pageerror、其他 method/path/errorText 和其他 phase 的 failure 都继续进入 `runtimeErrors`。窄 predicate 不能改变 HTTP 状态处理、logout 服务端请求或 `/login` 断言。

### 7. Runner、secret scan 与 cleanup 证据

#### Runner

- shell 强制 `DATABASE_URL`/`REDIS_URL`，接受 `PARTSIGNAL_E2E_V2_SPEC` 定向值（`deploy/scripts/e2e-local.sh:4-9`）。
- 定向模式跳过 V1 build/server，只构建 V2、启动真实 FastAPI/storage/fake AI/worker/scheduler 和 V2 production preview（`:87-123`），随后只运行指定 V2 spec + `--project=foundation-desktop`（`:149-158`）。
- external base URL 使 Playwright config 不再启动第二个 webServer；real-stack 统一 trace off（`frontend-v2/playwright.config.ts:23-30`）。

#### Secret/output

- `expectSecretsAbsent` 递归读取调用者 `testInfo.outputDir`，只检查调用方明确传入的 sentinel；命中时仅报告相对文件名，不输出 secret（`frontend-v2/tests/e2e/secret-artifact.ts:4-25`）。
- Auth real-stack 当前只传 `initialPassword` 和随机 `newPassword`（`auth-session-real-stack.spec.ts:15,52-54`）。`e2e-local.sh` 本身没有全局 artifact secret scan；归档 E2E 审计已明确这一边界（`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/e2e-infra-audit.md:67-80`）。
- 因此诊断必须从源头限制为 phase/method/pathname/errorText；不能依赖 scanner 清理完整 URL、headers、body、Cookie 或 CSRF。保留 trace off，且不打开 video/screenshot/storage state。

#### Cleanup

- `cleanup` trap 先按已记录 PID `kill` + `wait` 全部本次进程，再运行 environment cleanup、drop 精确 E2E database、删除仅匹配本次 `mktemp` 前缀的 storage dir；原测试失败码优先保留，测试成功但 cleanup 失败也非零（`deploy/scripts/e2e-local.sh:34-85`）。
- Redis helper 拒绝 DB 0、同 DB 外部客户端、非空 preflight；cleanup 只删除精确 Celery keys/`_kombu.binding.` 前缀，拒绝未知键，复核 DB 为空并逐端口 bind 证明释放（`deploy/scripts/e2e-environment.py:11-35,38-89`）。
- 预期定向运行结束证据必须同时包含 database `status=dropped`、storage `status=removed`、Redis `status=deleted`、ports `status=released`。任何一项缺失或非成功均使诊断无效并停止（`.trellis/spec/infra/e2e-isolation.md:24-31,45-63,74-80`）。

### 8. 最小文件范围与无需修改项

- 第一阶段诊断：仅 `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts`，随后只更新当前 Task 的 `research/audit.md` 与 `design.md` 证据。
- 若证据归 test owner：仍只需该 real-stack spec；不要抽 helper，不修改 `auth-session.spec.ts`、System Admin、Playwright config 或 runner。
- 若证据归 production owner：产品文件范围由 Auth/query 静态调用链研究决定；E2E 侧仍只保留上述 spec 的精确 audit/断言，不修改 runner。
- `deploy/scripts/e2e-local.sh`、`e2e-environment.py`、`secret-artifact.ts`、`playwright.config.ts` 现有能力已覆盖本次定向运行，不需要改动。

## External References

- 未使用互联网资料。第三方行为以本地锁定 Playwright Test / Playwright Core 1.61.1 的 package lock 与公开类型定义为准：`frontend-v2/package-lock.json:2966-2979,9689-9700`；`frontend-v2/node_modules/playwright-core/types/types.d.ts:1139-1156,20180-20233`。

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md:100-101`：real-stack trace 与独占 Redis/cleanup。
- `.trellis/spec/frontend/quality-guidelines.md:121-147`：production preview、未知 runtime failure 默认失败；只有已声明主动生命周期的 `net::ERR_ABORTED` 可排除。
- `.trellis/spec/infra/e2e-isolation.md:22-43`：定向 spec、独占资源、external preview、trace 与 pathname-only 输出。
- `.trellis/spec/infra/e2e-isolation.md:45-80`：失败也 cleanup、四项 cleanup 结果与定向验证。
- Phase 8 archived audit A26：`.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:52-53,120-145`。

## Caveats / Not Found

- 本研究没有启动真实栈、浏览器或任何测试；没有修改产品代码、spec、runner、归档 Task 或 Git 状态。
- 现有静态/归档证据不足以给出 A26 的实际 errorText、失败 phase 或最终 root owner；任何直接 production 修复或 collector ignore 都早于证据。
- Playwright `requestfailed` 不代表 HTTP error status；若后续任务需要“所有 4xx/5xx 都被统一审计”的新要求，应另行验证现有 response/UI owner，不能借 A26 增加通用 E2E error framework。
- Auth real-stack 的 artifact scanner只覆盖两个密码 sentinel，不扫描未知 Cookie/CSRF 值；当前安全性依赖 trace off、未记录 headers/body/full URL，以及服务端/页面断言。诊断不得扩大输出面。
- phase 记录表示 Playwright 观察到失败事件的时间窗口，不表示 request 的发起时间；A26 已知 request 是 Workbench GET，当前需要的正是它在离页还是 logout 时失败。若一次运行跨多个 phase 产生同 endpoint failure，不能据此选择窄 filter。
