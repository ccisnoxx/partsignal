# AI Channel Configuration E2E 实施计划

## 0. 实施启动门禁

本文件仅是已审计后的实施计划。当前 Task 保持 `planning`，本会话不得运行 `task.py start`、创建业务分支或修改业务代码。

用户批准实施后，在新的独立会话中：

1. 使用 `trellis-start`，确认主工作目录位于最新、clean 的 `main`。
2. 确认本 Task 仍为唯一活动 Task，且 `prd.md`、`design.md`、`implement.md` 已获批准。
3. 创建候选临时分支 `codex/frontend-v2-ai-channel-configuration-e2e`。
4. 仅在上述检查通过后运行 `task.py start`，按本文顺序实施。
5. 不 push、不创建 PR；提交前展示精确 commit plan 并等待确认。

## 1. 实施顺序

### 1.1 收紧 real-stack harness

- 新增聚焦的 `deploy/scripts/e2e-environment.py`，只提供 `preflight` 与 `cleanup`：
  - 拒绝 Redis DB 0、空 DB 编号和同 DB 的外部客户端；
  - 启动前检查 8000、9001、5173、4173、4174 与对象存储端口；
  - 停止进程并 `wait` 后，仅删除本套件可证明拥有的 Celery/Kombu 键；
  - 禁止 `FLUSHDB`、通配删除和候选路径兜底；
  - 最后断言 Redis DB 为空、相关端口已释放。
- 调整 `deploy/scripts/e2e-local.sh`：
  - 在创建测试数据库前运行 preflight；
  - cleanup 中先终止并等待本脚本启动的进程，再执行 Redis/端口检查，最后删除数据库与临时存储；
  - 给 V1 Playwright 命令显式传入 `PARTSIGNAL_E2E_REAL_STACK=1`；
  - 保留现有单命令串联 V2 与 V1 的结构，不另建 runner。
- 调整 CI E2E step 使用 Redis DB 14；backend integration 继续使用 DB 15，避免跨步骤污染。
- 两套 Playwright config 在 `PARTSIGNAL_E2E_REAL_STACK=1` 时统一 `trace: "off"`；fixture suite 继续 `retain-on-failure`。

### 1.2 最小扩展 fake Provider

- 复用现有 `/v1/models`、`/v1/chat/completions`、`/e2e/calls/{model_id}` 与 `/e2e/payloads/{model_id}`。
- 对 `e2e-config-model-{suffix}` 从 model ID 推导本次测试所需的初始/替换 credential，不新增 recorder、数据库或第二个 Provider。
- Provider 只做等值判断，不保存、不返回、不记录 API key 或 Header value。
- 初始 credential 的 model test 必须得到公开失败；通过 UI 替换 API key/Header 后再次 test 必须成功。
- 保持现有 timeout 与 exact-snapshot retry 行为不变，由现有 V2 content AI / V1 MVP flow 覆盖。

### 1.3 新增 V2 Configuration real-stack vertical slice

新增 `frontend-v2/tests/e2e/ai-channel-configuration-real-stack.spec.ts`，仅保留一个可 review 的主流程：

1. API 只负责登录和建立 Platform、Prompt、Product、Fact、ContentTask 等非目标前置数据。
2. 在同一 SPA 会话中先访问 Prompt Preview Options 与 Content generation-options，确认渠道为空并建立真实缓存状态。
3. 从 AI Channel List 进入 Create Dialog，通过 UI 创建渠道。
4. 依次通过 UI 完成 Basic、Request、API Key replacement、Header 创建/更新/删除。
5. 用 API 执行一次明确的并发写入制造 stale channel revision；UI 保存应收到 409、不得自动重放，reload 后显示服务端状态。
6. 通过 UI discovery/add；再创建、编辑一个 credential model，并删除发现模型。
7. 第一次 connection test 使用旧 credential，断言公开失败；替换 credential 后第二次 test 成功。
8. 通过 UI 启用 credential model 与 Channel，验证 `available_actions` 驱动的按钮状态。
9. 不刷新浏览器，重新进入 Prompt Preview 与 Content generation-options，确认新配置可用。
10. 正式生成前访问 Usage `30d`，确认 discovery/test 不计入 Usage。
11. 通过正式 Content UI 发起 generation，等待真实 worker 完成；Provider 对该 model 的 completion call 总数应为 3：失败 test、成功 test、正式 generation。
12. 切换到未预热的 Usage `all` 周期观察真实成功调用；Logs 只读展示配置审计动作与安全详情。
13. 通过 UI 删除 Header、关闭/删除相应模型与渠道，确认 List handoff 回到真实状态。

测试内不得：

- 用 API 代替 AI Channel Workspace 的目标 UI 行为；
- 在标题、step、附件、日志或断言失败消息中写入 secret 字面量；
- 复制生产 query key、action registry 或状态推导；
- 重复已有 fixture specs 的 375/768/1024/1440 响应式矩阵；
- 重复已有 timeout/exact-retry real-stack 流程。

### 1.4 同步测试文档

- 更新 `docs/testing.md` 的本地 real-stack 示例为隔离 Redis DB 14，并说明 DB 0 被拒绝。
- 记录 real-stack trace 关闭、fixture trace 保留的边界。
- 在 `docs/frontend-v2/08-testing-quality-and-acceptance.md` 收口 Configuration real-stack 验收层级，不重复页面 fixture 矩阵。
- 在 `.trellis/spec/frontend/quality-guidelines.md` 固化 secret-bearing real-stack 禁止 trace、Redis 必须独占且 cleanup 可证明的开发约束。
- 不修改 OpenAPI、生成类型、数据库文档或生产业务设计；本 Task 不改变任何业务合同。

## 2. 文件范围

预计主要文件 8–10 个，保持单 Task：

- `deploy/scripts/e2e-environment.py`（新增）
- `deploy/scripts/e2e-local.sh`
- `backend/app/ai_fake_server.py`
- `frontend/playwright.config.ts`
- `frontend-v2/playwright.config.ts`
- `frontend-v2/tests/e2e/ai-channel-configuration-real-stack.spec.ts`（新增）
- `.github/workflows/ci.yml`
- `docs/testing.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- 必要的聚焦测试文件（只有当 helper 的边界不能由单次 real-stack 命令充分证明时才新增）

不拆子 Task：这些改动共同构成“一条 Configuration 真实链路 + 可证明隔离的 harness”，拆开会让任一 PR 暂时处于假成功、secret trace 暴露或清理不完整状态。

## 3. Required validation

### 3.1 静态与合同检查

```bash
bash -n deploy/scripts/e2e-local.sh
uv run --project backend ruff check \
  backend/app/ai_fake_server.py \
  deploy/scripts/e2e-environment.py
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
make contract-check
git diff --check
```

### 3.2 唯一 Required real-stack 命令

```bash
task_dir=.trellis/tasks/08-15-frontend-v2-ai-channel-configuration-e2e
mkdir -p "$task_dir/evidence"
e2e_log="$task_dir/evidence/configuration-e2e.log"
e2e_marker="$task_dir/evidence/configuration-e2e.started"
: >"$e2e_marker"

DATABASE_URL='<host PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:56379/14' \
deploy/scripts/e2e-local.sh \
  tests/e2e/ai-channel-management.spec.ts \
  tests/e2e/mvp-flow.spec.ts \
  --project=e2e >"$e2e_log" 2>&1
```

该命令必须同时执行：

- 新增 V2 AI Channel Configuration real-stack spec；
- 现有全部 V2 real-stack specs，包括 content AI timeout/exact retry；
- V1 setup dependency；
- 指定的 V1 AI Channel management 与 MVP flow specs。

失败后，只有代码、配置或环境发生了足以影响结果的变化才允许重跑。

### 3.3 清理、trace 与 secret 证据

```bash
rg 'E2E_CLEANUP database=.*status=dropped' "$e2e_log"
rg 'E2E_CLEANUP storage=.*status=removed' "$e2e_log"
rg 'E2E_CLEANUP redis_db=14 .*status=deleted' "$e2e_log"
rg 'E2E_CLEANUP ports=.*status=released' "$e2e_log"

if rg -n 'e2e-config-(initial-key|replacement-key|initial-secret|replacement-secret)-' "$e2e_log"; then
  exit 1
fi

test -z "$(find frontend/test-results frontend-v2/.cache/playwright-results \
  -name trace.zip -newer "$e2e_marker" -print -quit 2>/dev/null)"
git status --short
```

验收时还要人工检查失败附件目录、Playwright HTML/report metadata 与 fake Provider 输出，不得出现 API key、Header value 或完整 Request 配置。

## 4. Optional validation

仅当 Required 结果或 diff 风险提示需要扩大验证时运行：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/ai-channel-workspace-core.spec.ts \
  tests/e2e/ai-channel-workspace-models.spec.ts \
  tests/e2e/ai-channel-workspace-runtime.spec.ts
make verify
```

- fixture Workspace specs 已拥有 component/route/dirty/revision/secret/responsive 矩阵，不是 real-stack Required 命令的重复条件。
- 真实第三方 Provider 验证不属于 Optional；fake Provider + 本地 worker 是确定性验收边界，真实外部调用应留给受控的人工 staging smoke。

## 5. 自审清单

- [x] 新 spec 的目标 Workspace 行为全部由 UI 完成，API 只做前置数据、并发写入与最终只读投影。
- [x] old credential failure、replacement success、正式 generation 各发生一次，没有自动重放。
- [x] discovery/test 不被错误断言为 audit action，Logs 仅验证真实服务端审计记录。
- [x] 409 后 UI 不自动重放 mutation，reload 使用服务端 revision。
- [x] Prompt Preview 与 generation-options 在同一 SPA 会话中完成空到可用的 handoff。
- [x] real-stack trace 全局关闭，fixture trace 策略未退化。
- [x] Redis 清理仅删除精确 allowlist，不使用 DB 0、`FLUSHDB` 或 glob delete。
- [x] cleanup 在进程 `wait` 后执行，并证明数据库、存储、Redis 与端口均已回收。
- [x] 日志、附件、快照、Provider state 与错误消息均不含 secret。
- [x] 无 OpenAPI、生成类型、数据库或生产业务代码变化。
- [x] diff 不含无关 dirty 文件、第二套 runner/recorder/framework 或 speculative abstraction。

## 6. 提交、合入与归档计划

Required validation 全部通过后，先向用户展示精确文件列表、diff 摘要与 commit plan，等待确认；不得提前 stage/commit。

候选单提交：

```text
test(e2e): close AI channel configuration real-stack flow
```

获准提交后：

1. 仅 stage 本 Task 文件并复核 staged diff。
2. 提交到 `codex/frontend-v2-ai-channel-configuration-e2e`，不 push、不创建 PR。
3. 按 Trellis finish-work 流程检查 code/contracts/tests/docs 一致性。
4. 经用户批准后归档 Task，fast-forward 合入当时最新 clean `main`。
5. 删除临时分支与 worktree，确认无遗留 `codex/frontend-v2-ai-channel-configuration-e2e*`。

## 7. 阻塞与回退边界

- 若 real-stack 暴露生产 API 合同、权限、revision 或持久化缺口，停止扩大范围，记录确切证据并请求授权；不得加入兼容字段或客户端 fallback。
- 若发现必须改变数据库结构，立即停止，先提交独立设计请求。
- 若 CI 无法提供独占 Redis DB 14，先修正隔离条件；不得降低为 DB 0 或共享 DB 的静默清理。
- 若 secret 已进入 trace/report，删除相关本地测试产物并修正 recorder 边界后再验证；不得提交或展示该产物。
- 回退单位是本 Task 的单一提交；不保留半套 harness 或只验证 UI 的假成功状态。

## 8. 实施与验证结果（2026-08-15）

### 已实施

- real-stack harness 增加 Redis/端口 preflight、精确 Redis cleanup、已登记进程 `wait`、四类 cleanup 结果标记，并让 V1/V2 real-stack config 统一关闭 trace；CI E2E step 独占 Redis DB 14。
- fake Provider 只为 `e2e-config-model-{suffix}` 比较 replacement credential，不保存或返回 Header；新增单一 V2 Configuration real-stack 主流程，真实覆盖 409/no replay、consumer handoff、Provider 三次调用、Usage、审计与 UI 删除收尾。
- 经用户追加授权，既有 GEO real-stack 用例改为按自定义 Select 的可见 label 断言，并通过 combobox/option 完成事实版本选择；未修改生产 GEO 实现。
- 经用户追加授权，V1 MVP real-stack 用例补齐当前 OpenAPI 要求的 DELETE revision、读取 Header 变更后的 canonical model revision，并把旧表头/安全掩码/Ant Select locator 对齐到现有可访问语义；未修改 V1 生产实现。
- 测试文档和 frontend/infra code-spec 已同步；OpenAPI、generated types、production backend、数据库结构、依赖均未修改。
- touched-scope 文档检查：新增 Python 模块/函数 docstring、异常和测试 JSDoc 使用中文；machine-readable cleanup 字段保持协议字面量。

### Required validation 实际结果

| 检查 | 结果 |
| --- | --- |
| shell syntax、backend Ruff、V1/V2 lint/typecheck、contract-check、`git diff --check` | 全部通过 |
| 新 `AI Channel Configuration 真实栈闭环` | 通过，`13.1s` |
| V2 real-stack | `13 passed (1.1m)`；Configuration `13.1s`，GEO Flow B `1.1s` |
| 指定 V1 E2E | `5 passed (1.4m)` |
| 唯一 Required real-stack 总命令 | 合计 `18 passed`，最终退出 `0` |
| secret / trace | log、附件与 metadata sentinel 扫描 clean；marker 后无 `trace.zip` |
| cleanup | Redis DB 14 清空、六端口释放、临时数据库 drop、storage 移除；运行后 preflight 通过，剩余 E2E 数据库 `0`、本次进程 `0` |

最终 Required 命令先完成全部 V2 real-stack，再完成指定 V1 AI Channel management 与 MVP flow；测试阶段和 cleanup 均零退出。V1 test-only 修复只同步已有 OpenAPI/revision 与 DOM 可访问合同，没有添加兼容字段、fallback 或业务测试接口。

### Optional validation 实际结果

- Required 的范围外失败触发 Configuration 聚焦扩大验证：Core/Models/Runtime 三份 production-artifact specs 在 mobile/desktop 共 `20 passed (22.3s)`。
- 未运行完整 V2 unit 与 `make verify`：本次未修改生产 UI，聚焦 fixture 与唯一 Required real-stack 已覆盖目标边界；最终 Required 已全绿，无结果或 diff 风险要求继续扩大验证。
