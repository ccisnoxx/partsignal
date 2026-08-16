# Frontend V2 System Admin E2E — Design

## 1. 设计结论

采用最小结构：**一个新的原生 Playwright real-stack spec，接入一个既有 fixed list，更新两处 Phase 文档**。不新增 helper framework、fixture、page object、配置或 runtime owner。

当前设计仍不可直接实施：真实首次改密所需 V2 Auth UI 实现候选已通过验证，但尚未提交归档。blocker 归档后按本设计重新核对 selector/redirect，再请求单独实施批准。

## 2. Gap analysis

| 关注点 | 已验证实现 | 结论 |
| --- | --- | --- |
| Users UI | `user-list-page.tsx` 已从单一 `UserList` 读取行 revision、available actions 与 summary；create/reset/bulk/delete 使用现有合同 | 无需改产品 UI |
| Users backend | identity service 已实现 new user `must_change_password=true`、revision、session revoke、bulk partial、`LAST_ADMIN_REQUIRED`、delete history boundary | 能支持目标闭环 |
| Audit UI | 七列表格、无操作列、URL filter、按选中 `logId` lazy Detail 已交付 | 无需改产品 UI |
| Audit backend | List metadata-only、Filter Options、safe Detail registry、ADMIN-only 均已有 integration evidence | 能支持目标闭环 |
| Auth backend | login、cookie、CSRF、change-password、must-change allowlist 和 reset revoke 已实现 | 合同与状态机足够 |
| Auth V2 | 实现候选已有 `/login`、`/account/security`、session Query route guard、账户改密与 logout，并通过 strict/real-stack 验证 | 待提交归档后重新审计 |
| ADMIN boundary | `_admin/route.tsx:15-45` 由真实 auth 投影隐藏/阻止并聚焦 403 | UX 证据已具备 |
| Orchestration | `e2e-local.sh:17-151` 已拥有 DB/storage/process/preview/cleanup；V2 fixed list 位于 139-147 行 | 只追加 spec 路径 |
| Sensitive artifact | `playwright.config.ts:23-26` 在 real-stack 统一 `trace: off`；未配置 video | 复用，不增加局部覆盖 |
| Deletion history | identity 业务引用不含 AuditLog；`AuditLog.actor_id` 为 `ON DELETE SET NULL` | 登录/改密审计不会阻止删除；仍由 UI 真实验证 |
| Extra services | 新 System 场景只需 PostgreSQL/FastAPI/V2 preview；完整 owner 为既有 AI/Publishing/GEO 场景继续启动 Worker/Beat/storage/fake AI | 不新增或复制依赖 |

## 3. 单测试状态序列

新文件：`frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`。只定义一个串行闭环测试，以便两个 context、两组内存 password sentinel、Request ID 和 cleanup 同属一个明确 owner。

| 步骤 | owner | 操作与观测 | canonical 状态 |
| --- | --- | --- | --- |
| 1 | ADMIN page/context | 通过 `/login` UI 登录 seed ADMIN，进入 `/system/users` 与 `/system/audit` | ADMIN cookie session 有效 |
| 2 | ADMIN page | Users UI 创建唯一 ENGINEER；等待 create response，仅读 status、safe JSON、`x-request-id` | ENGINEER enabled, must-change, revision 0 |
| 3 | ENGINEER context/page | 独立 context 打开 `/login`，用临时密码登录，被真实状态引导到 `/account/security` | ENGINEER cookie session 建立，业务访问仍受限 |
| 4 | ENGINEER page | 自助改密 UI 提交 old/new password 和真实 CSRF，随后读取 canonical session | ENGINEER enabled, must-change false, revision 1 |
| 5 | ENGINEER page/request | 证明无 System nav；两个直接 URL 聚焦 403；以同一 cookie jar 请求 Users List/Bulk/Export 与 Audit List/Options/Detail，均为 403 | 前端 UX + 后端 authority 同时成立 |
| 6 | ADMIN page | 回到 Users，按唯一 username 找行；打开 reset，提交页面当前 revision；只读 safe response 与 request id | ENGINEER must-change true, revision 2；其全部 session revoked |
| 7 | ENGINEER context.request | 对受保护 `/api/v1/auth/me` 发起下一请求 | 401 `AUTH_REQUIRED`，旧 session 不可继续 |
| 8 | ADMIN page | Users `status=ENABLED` 下选择新 ENGINEER 与 seed ADMIN 两行 checkbox，点击批量停用 | 请求携带两行当前 revision |
| 9 | ADMIN page | 读取真实 bulk response/UI | ENGINEER disabled/revision 3；ADMIN `LAST_ADMIN_REQUIRED`；成功 1/失败 1 |
| 10 | ADMIN page/request | UI 保留 partial failure；`auth/me` 和 Users row 证明 ADMIN 仍 enabled/session valid | 唯一有效 ADMIN 不变 |
| 11 | ADMIN page | 在 `/system/audit` 分别按 create/reset/bulk request ID 服务端筛选；检查真实字段 | 三类成功 mutation 可追踪，last-admin failure 无伪成功记录 |
| 12 | ADMIN page | 对 create Request ID 检查七列/无操作列，记录 list response，点击行后才出现一次 detail GET | List/Detail 指向相同 audit id/request id/target |
| 13 | ADMIN page | 检查 Detail 允许投影及全局 secret scan | 无 password/raw change_summary/未知字段 |
| 14 | ADMIN page | 回 Users，定位 disabled ENGINEER，由 V2 UI 删除并确认 safe 204 | ENGINEER、其 session 被删除；审计历史保留 |
| 15 | ADMIN page | Audit UI 按 target/action 验证原 `user.password_changed` 仍存在且 actor 为 nullable/已删除语义 | append-only 历史成立 |
| 16 | test finally | 扫描 test output，再关闭 ENGINEER context；Playwright 回收 ADMIN context | browser resources 清理 |
| 17 | shell EXIT trap | 停止本次 PID、cleanup Redis、drop unique DB、删 mktemp storage、检查端口 | 宿主无本次业务状态 |

任何步骤不得直接写数据库。API 只用于：同一 BrowserContext 的权限请求、读取 safe canonical 投影和结束断言；核心 create/login/change/reset/bulk/delete 均通过 V2 UI。

## 4. Context 与 session 所有权

### ADMIN

- 使用 Playwright Test Runner 提供的默认 desktop `page/context`，继承 production `baseURL`、1440 viewport 与 real-stack trace policy。
- 通过 V2 login UI 建立 cookie；后续 `page.request` 自动共享该 context cookie jar。
- 由 Playwright fixture teardown 关闭，不手工复用 storage state。

### ENGINEER

- 测试用 `browser.newContext` 创建一个明确 owner 的 context，显式提供同一 V2 baseURL 与 desktop viewport。
- 使用自己的 V2 login UI、cookie、CSRF 和 page；不得复制 ADMIN cookie、CSRF 或 storage state。
- 权限 API 使用 `engineerContext.request`，确保 403/401 来自该真实 session。
- 在 `finally` 中只关闭本测试创建的 ENGINEER context；不调用 `close-all`/`kill-all`。

两个 context 仅通过数据库中的用户状态发生业务关联，不共享内存 auth 对象。

## 5. Setup、UI、API read 与 cleanup 边界

| 类别 | 允许 | 禁止 |
| --- | --- | --- |
| 环境 setup | `e2e-local.sh` 创建 DB、migration、seed、build/preview | 第二数据库、手工 seed、fixture import |
| 用户 mutation | V2 UI 的 create/change/reset/bulk/delete | `page.request` 直接制造核心成功、DB 写入 |
| 权限验证 | ENGINEER context 的真实 API request | `page.route`、mock 403、客户端预判替代后端 |
| 状态验证 | safe response、Auth Me、Users/Audit read endpoint、DOM | request body、cookie dump、storage state 导出 |
| 测试 cleanup | UI 删除临时用户；context finally；shell trap drop whole temp DB | 专用 cleanup endpoint、绕过删除约束、广泛进程终止 |

UI 删除是业务闭环；即使该步骤失败，临时数据库仍由 shell owner drop。后者是环境清理，不冒充业务删除成功。

## 6. Bulk partial 的确定性安排

- 数据库每次是唯一新库，seed 后只有一个有效 ADMIN `admin`；此前 real-stack specs 不创建用户。
- 本测试新增一个 enabled ENGINEER，并在 bulk 前通过 Users 当前列表读取两行及 revision。
- 选中集合固定为“本次唯一 ENGINEER + seed ADMIN”，不依赖行号、数据库顺序或固定 UUID；locator 使用唯一 username。
- 服务端对 items 按 UUID 稳定加锁，但结果不依赖 UUID 顺序：停用 ENGINEER 不改变有效管理员数，停用唯一 ADMIN 必然触发 `LAST_ADMIN_REQUIRED`。
- 断言按 `user_id`/username 匹配 `succeeded` 与 `failures`，不按 response array 偶然顺序匹配。
- 浏览器不预判最后管理员；必须实际提交两项并读取服务器 partial response。

## 7. Request ID → Audit 证据链

1. 在点击 create 之前用 `page.waitForResponse` 匹配 method + pathname；不注册 request-body listener。
2. response 成功后读取 `x-request-id` 与合同 safe JSON；错误 helper 只输出 status/path。
3. 导航 `/system/audit?requestId=<encoded>&page=1&pageSize=20`（以当前 route model 的实际 key 为准，实施前复核）。
4. 等待 Audit List GET，确认 query 携带同一 request id，列表仅返回对应真实记录。
5. 断言七个表头和该行的 actor/module/action/target/outcome/request ID；断言不存在“操作”列。
6. 点击前记录 Audit Detail GET 数量为 0；点击行后恰好发出该 audit id 的一次 GET。
7. Detail 的 `id`、`request_id`、`target_id` 与 List/create response 链一致；检查 safe projection。
8. reset 与 bulk request id 重复 List 级筛选断言，避免只证明 create 一类 mutation。

不把 request ID 与 password、cookie 或 CSRF 放在同一日志对象中；最终用户报告只记录可公开的 pass count、耗时和 cleanup，不打印凭据。

## 8. Secret handling 与 artifact scan

- 使用 `randomUUID()` 生成本次 username 后缀、temporary password 与 changed password；只保存在测试局部变量。
- 不在代码里硬编码真实凭据；seed ADMIN credential 只从现有环境变量读取，并只填入 UI。
- response helper 不调用失败 response 的 `.text()`；不监听或保存 POST body，不保存 request headers。
- console/pageerror/requestfailed 监听只记录无敏感值的类别标志；发现 sentinel 时只报告固定标签，例如“检测到敏感值泄漏”，不回显值或原消息。
- 收集用于扫描的范围仅包含 safe response JSON、GET response body、DOM text、URL、local/session storage 值与安全化浏览器事件；断言两个 sentinel 均不存在。
- `testInfo.outputDir` 在 `finally` 中用 Node 标准库递归读取现有文件并按 bytes 查找 sentinel；不创建附件或持久扫描日志。
- real-stack trace 由 config 关闭，video 默认关闭；测试不截图、不 attach、不导出 storage state。

## 9. 修改文件与职责

| 文件 | 最小职责 |
| --- | --- |
| `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts` | 单个真实 ADMIN/ENGINEER 生命周期、权限、revision/bulk/audit/secret/UI cleanup 场景 |
| `deploy/scripts/e2e-local.sh` | 在既有 V2 fixed list 追加该 spec；不改 owner、服务、端口或 cleanup |
| `docs/frontend-v2/07-migration-plan.md` | 实现后记录 System Admin E2E 实际结果，并把 Phase 7 下一项指向 abstraction review |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | 实现后记录真实权限、Request ID、secret scan、pass/duration 与 cleanup 证据 |
| 当前 Trellis task artifacts | 保存审计、设计、实施/验证结果，归档前与代码一致 |

预计不修改 Users/Audit/Auth/backend、OpenAPI、database contract、Playwright config、Makefile、package manifest/lockfile 或 `.trellis/spec`。现有隔离原则不变，没有形成新架构决策，因此不新增 ADR/spec；若实施证据要求这些文件变更，先停止并重新规划。

## 10. Cleanup matrix

| 资源 | 创建/所有者 | 成功/失败清理 | 实际证据 |
| --- | --- | --- | --- |
| PostgreSQL database `partsignal_e2e_<date>_<pid>` | `e2e-local.sh` + `e2e-database.py` | EXIT trap force/drop 精确库名 | `E2E_CLEANUP database=... status=dropped`，事后无该库 |
| Redis logical DB | 调用方先确认独占；`e2e-environment.py` 只认 allowlisted keys | 停 worker/beat 后删除 allowlisted keys并断言 DB 空/无本次 client | cleanup 输出 key count/DB size；不 `FLUSH` 共享库 |
| 临时对象存储目录 | `mktemp partsignal-e2e-storage.*` | 前缀校验后删除 | `E2E_CLEANUP storage=... status=removed` |
| API 8000 | shell 精确 PID | `kill`/`wait` 本次 PID | cleanup 后 port preflight 可用 |
| fake AI 9001 | shell 精确 PID | 同上 | 同上；System spec 不直接使用 |
| V1 dev 5173 / preview 4173 | shell 精确 PID | 同上 | 同上；由既有 V1 suite 需要 |
| V2 preview 4174 | shell 精确 PID | 同上 | 同上 |
| storage 19009 | shell 精确 PID | 同上 | 同上 |
| Celery worker/beat | shell 精确 PID | 同上 | wait 完成；System spec 不新增 worker |
| ADMIN context | Playwright fixture | Runner teardown | spec 退出后无 context |
| ENGINEER context | 当前 test | `finally context.close()` | finally 完成；不影响其他任务 |
| 临时用户/session/audit | 本次 unique DB；用户由 UI 建立 | UI 停用/删除；最终 DB drop 兜底环境隔离 | UI删除与审计历史断言 + DB drop |

未知端口占用、非 allowlist Redis key 或其他 client 会让 preflight/cleanup 失败并停止；不得自动终止或删除。

## 11. 失败归因与停止规则

- **测试局部缺口**：selector、wait 条件、安全扫描 helper、fixed list 漏接，可在本 Task 最小修正。
- **既有 orchestration 局部缺口**：只在 owner 内修复，并保持一套 lifecycle；若涉及新资源/广泛进程管理，停止重规划。
- **产品/API/权限/状态/数据库缺陷**：记录症状、最小复现、root owner、影响，停止并建议独立 blocker；不在测试里 fallback。
- **Auth prerequisite 未归档**：当前已触发，故本 Task 保持 planning/BLOCKED。
- **最终 gate 意外失败**：不在环境/代码未改变时重跑；先执行尚未运行的安全独立诊断，再统一归因。
- **无关 V1/既有 real-stack failure**：完成其后仍可安全执行的诊断与 cleanup 证据，只报告，不扩大修复范围。

## 12. Phase 7 handoff

本 Task 完成后只把 Phase 7 下一项指向 `frontend-v2-system-abstraction-review`。后续 review 负责检查 Users/Audit 的重复 query/action/state 映射和 Phase 7 exit gate；本 Task 不提前抽象 helper 或运行 `make verify`。

## 13. Git / commit / archive / merge 方案

1. 用户先批准本规划，并单独解决 Auth UI blocker；blocker 归档后重新核对本设计并再次取得实现批准。
2. 回到 `main` 确认除当前已识别的 planning artifacts 外没有脏文件，从当前 HEAD 创建唯一临时分支 `codex/frontend-v2-system-admin-e2e`，让 planning artifacts 随工作树进入该分支，然后才运行 `task.py start`；不处理其他分支/worktree。
3. inline 实施和验证；不 dispatch implement/check subagent，不 push、不建 PR。
4. 完成 diff/self-review 后先展示 commit plan（文件、提交边界、验证结果），等待用户确认。
5. 用户确认后提交实现；运行 `task.py archive` 前单独说明其可能创建 Trellis bookkeeping commit，并等待需要的确认。
6. 在主工作目录切回 clean `main`，以 `git merge --ff-only codex/frontend-v2-system-admin-e2e` 合入。
7. 确认 main 包含归档与实现提交后删除本地临时分支；由于不 push，不存在远程分支删除。

所有 Git 状态、命令结果和 commit id 只在实际观察后报告。
