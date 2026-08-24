# Phase 8 Exit Gate Recheck 审计

## 1. 当前结论

冻结候选具备进入纯验证 Recheck 的静态前提，但尚不能宣告 Phase 8 `MET`：A25/A26 已关闭并位于当前 `main`，父任务 blocker 为 0；当前候选尚未运行本 Task 的独立阶段或最终 `make verify`。

规划阶段只完成仓库事实核对与 Task artifacts；没有运行门禁、创建分支、执行 `task.py start` 或修改产品/`07/08`。

## 2. Git、Task 与候选证据

| 检查 | 观察结果 |
| --- | --- |
| 创建 Task 前分支/状态 | `main`，clean |
| 冻结产品候选 | `52da9f45ceb606ed86a7348a4960bf94e63f4c76` |
| blocker 分支 | `git branch --list 'codex/frontend-v2-*'` 无输出 |
| worktree | 只有 `/Users/sc/PycharmProjects/partsignal` 的 `main` |
| A25 实施/归档 | `c7d0a2ed` / `3642cb9e`，均为候选祖先 |
| A26 实施/归档 | `73f5807a` / `08592cbc`，均为候选祖先 |
| 父状态同步 | `2d2eccf4` 为候选祖先 |
| 父任务 | `blocker_count=0`、`current_gate=NOT_MET` |
| 当前 child | 已由 `task.py create --parent` 追加为 `children` 最后一项 |

Task 创建后的预期 dirty set 仅包括当前 Task artifacts 与父 Task child metadata；它们不改变冻结产品 SHA。

## 3. 历史 Gate 与 findings

### Workbench abstraction review

- 首次最终结论为 `NOT_MET`；`make test-unit` 因 A25 失败，`make e2e` 因 A26 失败，因此没有运行 `make verify`，也没有更新 `07/08` 完成状态。
- A19 已关闭：dev-storage 使用 Uvicorn `--no-access-log`；GEO `requestfailed` 只记录 method/pathname，完整 upload URL equality 不展开 operands。
- A20 是文档保证纠偏：`08` 必须准确区分实际安全 owner，不得声称 `e2e-local.sh` 或共享 helper 提供全局 secret scan。
- A17/A21/A23 是归档中明确保留、非阻断、仅在真实 change pressure 下提升的观察项；本纯验证 Task 不把它们伪写为已修复，也不将其升级为新 blocker。

### A25 关闭证据

- 根因：进入 `/` 的 App Shell unit/Auth/Platforms fixture 未声明 Workbench aggregate 合同。
- 实施提交 `c7d0a2ed` 只调整四个测试 owner；归档提交 `3642cb9e` 已在候选。
- 实际验证：App Shell `1 file / 6 tests`，完整 V2 unit `81 files / 463 tests`，Auth mobile/desktop `2 passed`，Prompt mobile/desktop `8 passed`，typecheck/lint/diff/task validate 均通过。

### A26 关闭证据

- 唯一运行时四元组为 `navigate-to-system-users + GET + /api/v1/workbench + net::ERR_ABORTED`；根因是硬导航取消旧 document 的在途请求，不是 logout QueryClient 清理或服务端业务失败。
- 实施提交 `73f5807a` 只在 `auth-session-real-stack.spec.ts` 窄识别四元组，并补真实 Workbench 200/成功态断言；归档提交 `08592cbc` 已在候选。
- 实际验证：定向 real-stack `1 passed`，Workbench GET 200、Auth/System/最终 `/login` 通过；secret scan 无命中，database/Redis/storage/process/ports cleanup 完整，typecheck/lint/diff/task validate 通过。

## 4. 文档现状

- `docs/frontend-v2/07-migration-plan.md:500-506` 仅描述 Phase 8 Workbench 目标与退出条件，未写 `MET`。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:386-392` 只记录四个 Workbench real-stack owner、脱敏输出与 cleanup 要求，未写 Phase 8 Exit Gate 完成结论。
- 成功路径必须新增实际候选 gate 证据并纠正 A20；失败路径不改变上述完成状态。

## 5. 实际门禁 owner

| 阶段 | 权威 owner / 归因起点 |
| --- | --- |
| `make contract-check` | runtime OpenAPI、V1/V2 generated types |
| `make lint` | Ruff、V1 ESLint、V2 ESLint 各报错文件 |
| `make typecheck` | backend mypy、V1/V2 TypeScript 各报错文件 |
| `make test-unit` | backend unit、V1 unit/visual contract、V2 unit 的具体 test owner |
| `make test-integration` | Compose backend-test、PostgreSQL integration 与迁移 owner |
| `make build` | backend image、V1 image、V2 production artifact |
| `make e2e` | V2 real-stack → V1 E2E → V2 fixture，以及 E2E isolation/cleanup owner |
| dev/prod Compose config | 对应 deploy compose 文件与环境引用 |
| `make verify` | 根 Makefile fail-fast 总门禁，仅在独立阶段全绿后执行一次 |

## 6. E2E 隔离审计

- `e2e-local.sh` 要求 `DATABASE_URL`/`REDIS_URL`，在创建资源前调用 `e2e-environment.py preflight`。
- preflight 明确拒绝 Redis DB 0、非空 DB、同 logical DB 外部客户端以及固定端口占用。
- cleanup 只删除精确 Celery/Kombu allowlist keys，禁止 `FLUSHDB`/通配删除；脚本 stop/wait 自己启动的进程，验证端口释放后 drop allowlist 数据库并删除本次 `mktemp` storage。
- 当前 runner 固定端口为 `8000/9001/5173/4173/4174`，对象存储默认 `19009`；报告只记录端口与状态，不记录连接 URL。
- 当前安全 owner 是 config trace policy、已有 Auth/System sentinel scan、dev-storage `--no-access-log` 与 GEO pathname/boolean assertion；不存在全局通用 secret scanner。

## 7. Phase 7 组织方式复用与差异

复用：冻结 SHA、先独立阶段后唯一总门禁、失败继续安全诊断、逐阶段归因、E2E cleanup、成功/失败条件性文档范围和无机械重跑。

不复制：Phase 7 的候选 hash、suite 计数、Redis logical DB 编号、数据库名、端口运行结果、耗时或历史环境修正。Phase 8 所有运行值必须现场观察。

## 8. 规划风险

1. 当前候选可能暴露 A25/A26 之外的新 owner；本 Task 只能归因，不能修复。
2. E2E 和最终 `make verify` 都会占用真实隔离资源；Redis DB 必须每次由当前环境动态选择并经 preflight 确认，不能沿用历史 14/7 等编号。
3. A20 只能在最终 Gate 成功后随 `08` 一并关闭；在此之前它是条件性文档义务，不是允许提前宣称 `MET` 的依据。
4. 任何 cleanup 不完整或敏感 capability 回显都会直接阻止最终 gate/`MET`。

## 9. 规划阶段未执行项

- 未运行九个独立阶段、`make verify`、`git diff --check` 或 Task validate。
- 未读取/输出 `.env` 值，未探测 Redis/database/ports，未启动 Docker 或浏览器。
- 未创建 `codex/frontend-v2-phase-8-exit-gate-recheck`，未运行 `task.py start`。
- 未修改产品、测试、合同、配置、runner、`07/08` 或归档历史。

## 10. 固定候选与执行边界

- 执行分支：`codex/frontend-v2-phase-8-exit-gate-recheck`。
- 固定产品候选：`52da9f45ceb606ed86a7348a4960bf94e63f4c76`；全部阶段结束后 `HEAD` 未变化。
- A25/A26 实施、归档与父状态同步提交仍全部是候选祖先。
- 执行前后的 dirty set 仅包括当前 Task artifacts 与父 Task metadata；未修改产品代码、测试、合同、配置、runner、数据库行为或旧 `frontend/`。
- 执行期间未 pull、commit、push、PR、merge、历史改写、创建额外 worktree、归档父任务或开始 Phase 9。

## 11. 九个独立阶段结果

全部时间为北京时间；九个 root stage/Compose stage 各执行一次且全部退出 `0`。

| 阶段 | 开始 | 结束 | 耗时 | Exit | 实际结果 |
| --- | --- | --- | ---: | ---: | --- |
| `make contract-check` | 10:57:55 | 10:57:57 | 2s | 0 | FastAPI/OpenAPI 语义、V1 冻结类型、V2 根合同类型均一致 |
| `make lint` | 10:58:05 | 10:58:15 | 9s | 0 | Ruff、V1 ESLint/theme、V2 ESLint 全部通过 |
| `make typecheck` | 10:58:22 | 10:58:30 | 8s | 0 | mypy 80 files；V1/V2 TypeScript 均通过 |
| `make test-unit` | 10:58:37 | 11:03:14 | 277s | 0 | backend 201；V1 28 files/205；V1 visual 24；V2 81 files/463，合计 893 passed |
| `make test-integration` | 11:03:22 | 11:05:51 | 148s | 0 | backend/PostgreSQL integration 120 passed |
| `make build` | 11:05:57 | 11:06:35 | 37s | 0 | backend images、V1 image、V2 production build 均完成；V2 仅有非阻断 chunk warning |
| `make e2e` | 11:08:29 | 11:20:07 | 697s | 0 | V2 real-stack 16 passed；V1 52 passed；V2 fixture 383 passed/33 skipped，合计 451 passed/33 skipped |
| dev Compose config | 11:20:22 | 11:20:22 | <1s | 0 | `config --quiet` 通过 |
| prod Compose config | 11:20:29 | 11:20:29 | <1s | 0 | 指定测试 image/version 后 `config --quiet` 通过 |

E2E 环境准备曾有一次只发生在 helper 本身的 shell/Python 引号错误；它在建立连接、启动服务或运行 `make e2e` 前退出。修正该 helper 后环境发生了预期变化，因此重新运行现有 preflight；这不构成 `make e2e` 重跑。实际 E2E 的 Redis logical DB 由运行时扫描动态选择为 7，preflight 通过，没有沿用规划中的历史编号。

独立 E2E cleanup：临时 PostgreSQL database 已 dropped；Redis DB 7 删除 1 个 allowlist key 后为空；临时 storage 已 removed；runner 启动的 API/storage/AI/worker/scheduler/V1/V2 进程均结束；`8000/9001/5173/4173/4174/19009` 均 released。没有清理外部任务资源，也未启用额外 trace/video 或 Playwright CLI。

## 12. 唯一最终 `make verify`

- 执行条件检查：九个独立阶段全绿、独立 E2E cleanup 完整、候选/dirty allowlist 未变化、A25/A26 closed、父 `blocker_count=0`、正式 open P0/P1/P2=`0/0/0`。
- 最终 preflight 动态选择 Redis DB 14（明确排除本轮独立阶段使用的 DB 7），结果 `PASS`。
- `make verify` 运行次数：1；开始 `2026-08-24 11:23:17 +0800`，结束 `11:23:43 +0800`，总耗时 26s，exit `2`。
- fail-fast 可见结果：`contract-check`、`lint`、`typecheck` 通过；backend unit 为 `200 passed / 1 failed`，随后阶段均未进入。
- 精确失败：`backend/tests/unit/test_security_and_publication.py::test_production_rejects_development_session_secret` 预期命中 session secret 校验，但最终 gate 命令包装把 `.env` 的 production/本地 AI HTTP 配置一并导入测试进程，先命中 `AI_ALLOW_LOCAL_HTTP` 校验，导致异常文本断言不匹配。
- 归因：首要 owner 是本 Recheck 最终门禁的环境包装，而不是候选文件变化；同一冻结候选的独立 `make test-unit` 已以 201 passed 退出 `0`。依规则不修复、不更改环境后重跑，也不自动创建 blocker。
- 敏感输出边界：失败 traceback 自动包含截断的开发连接配置表示。具体值未复制到本 evidence，但“不得输出连接 URL/credential”的保证已被破坏，因此 Gate 不能为 `MET`；该输出 owner 等待用户决定是否另建独立 blocker。
- 最终 cleanup：失败发生在 E2E 之前；只建立并关闭了 preflight helper 连接，未创建 PostgreSQL 测试 database、storage 或服务进程。复核 Redis DB 14 为空，六个固定端口均 released。

## 13. Exit Gate 判定与文档范围

Phase 8 Exit Gate=`NOT_MET`。直接原因是唯一最终 `make verify` exit `2`，并伴随敏感输出边界未满足；候选 SHA 保持不变。正式已登记 open P0/P1/P2 仍为 `0/0/0`，父 `blocker_count` 保持 0，但存在两个待用户定级的 failure owner：最终 gate 环境包装、失败 traceback 输出边界。

依失败路径：

- 不修改 `docs/frontend-v2/07-migration-plan.md` 或 `08-testing-quality-and-acceptance.md`，不提前完成 A20 文档纠偏；
- 保留 abstraction review 首次 `NOT_MET` 与 A19/A20/A25/A26 历史；
- 只更新当前 Recheck Task artifacts 和父 Task gate/child/failure metadata；
- 不修复、不重跑 `make verify`、不创建 blocker、不进入 Phase 9。

## 14. Post-check

- `git diff --check`：exit `0`。
- `task.py validate frontend-v2-phase-8-exit-gate-recheck`：`implement.jsonl` 5 entries、`check.jsonl` 4 entries，全部通过。
- 最终 Git 状态：分支仍为授权临时分支；只有当前 Recheck Task 和父 Task metadata 变更。
