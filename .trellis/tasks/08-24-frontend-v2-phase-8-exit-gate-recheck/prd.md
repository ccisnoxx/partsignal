# Frontend V2 Phase 8 Exit Gate Recheck

## 1. 目标

在 A25、A26 已由独立 blocker Task 关闭并合入 `main` 后，对同一个冻结产品候选执行完整、可归因、不可机械重跑的仓库级验证；只有所有独立阶段、唯一一次最终 `make verify`、资源清理和收尾检查均满足条件，才将 Phase 8 Exit Gate 从历史 `NOT_MET` 更新为 `MET`。

本 Task 只负责验证、证据和条件性文档收口，不开发或修复产品能力，也不进入 Phase 9。

## 2. 已确认事实

- 父 Task 为 `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/`；本 Task 已作为其最后一个 child 创建，没有新建 Phase 8 父 Task。
- Task 创建前主工作区位于 clean `main`，冻结产品候选为 `52da9f45ceb606ed86a7348a4960bf94e63f4c76`。
- 未发现 `codex/frontend-v2-*` blocker 分支或额外 worktree。
- A25 实施/归档提交 `c7d0a2ed`、`3642cb9e` 与 A26 实施/归档提交 `73f5807a`、`08592cbc` 均为冻结候选祖先；父任务状态同步提交 `2d2eccf4` 同样已包含。
- 父任务当前 `blocker_count=0`，Phase 8 仍为 `NOT_MET`，尚未执行独立 Exit Gate recheck。
- `docs/frontend-v2/07-migration-plan.md` 的 Phase 8 仍只描述目标/退出条件；`08-testing-quality-and-acceptance.md` 只记录 Workbench 真实栈复用验收，均未宣称 Phase 8 完成。
- Workbench abstraction review 的首次 `NOT_MET` 是只读历史；A19 已关闭，A20 仍是成功路径文档纠偏，A25/A26 已由独立 Task 关闭。

## 3. Requirements

### R1. 固定候选与 Git 边界

1. 规划批准前不运行 `task.py start`、不创建分支、不执行任何门禁、不修改 `07/08`。
2. 批准后只创建用户已授权的临时分支 `codex/frontend-v2-phase-8-exit-gate-recheck`；不 pull、push、PR、自动 commit、历史改写或创建额外 worktree。
3. 产品候选始终固定为上述 SHA。Task evidence、父 Task metadata 以及成功路径的 `07/08` 是允许的非产品文档变化；任何产品代码、测试、合同、配置、runner 或依赖变化都会使候选失效并停止本轮。
4. 验证前后都核对 `HEAD`、分支和 dirty allowlist；不得吸收未识别文件。

### R2. 独立验证阶段

在同一候选上按计划逐项各运行一次：

```bash
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

- 每项记录命令、开始/结束时间、退出码、实际耗时、suite 通过/失败/跳过计数和权威 owner。
- 一个阶段失败后仍完成其余安全且独立的阶段；未知资源 owner、敏感输出或 cleanup 不完整时停止会继续触碰该资源的动作。
- 代码、配置和环境没有发生预期影响失败的变化时，不重复同一失败命令。
- 不通过单包或归档定向结果替代当前候选的根阶段。

### R3. E2E 隔离与敏感边界

1. 只使用现有 `.env`、`deploy/scripts/e2e-local.sh` 和 `deploy/scripts/e2e-environment.py preflight`；不创建临时 Playwright CLI 流程。
2. 运行时从当前环境动态选择空闲、非 0、无外部客户端的 Redis logical DB；不硬编码或沿用历史编号。最终以现有 preflight 对 Redis 和固定端口做权威确认。
3. 不输出或落盘 `DATABASE_URL`、`REDIS_URL`、password、Cookie、CSRF、Authorization、request headers/body、storage state、完整签名 URL或敏感正文。
4. 不启用额外 trace/video/report。真实栈继续使用 config owner 的 trace policy。
5. 对每次 E2E 记录 database `dropped`、Redis 精确 key `deleted` 且为空、storage `removed`、本次服务进程已 stop/wait、固定端口 `released`；不得清理其他任务或外部 owner 的 Redis/数据库/进程/端口。
6. 敏感保证只按真实 owner记录：Auth/System 已知 sentinel 由既有 `expectSecretsAbsent` 检查；对象存储签名 capability 由 dev-storage `--no-access-log` 和 GEO failure/assertion 输出边界保护。不得宣称存在全局 secret scanner。

### R4. 最终 Gate

只有以下条件全部满足，才运行一次且仅一次 `make verify`：

- 九个独立阶段全部退出 `0`；
- 候选 SHA 未变化，dirty set 仍在允许范围；
- E2E cleanup 完整，运行环境仍可由 preflight 安全使用；
- A25/A26 已关闭，没有当前开放的可执行 P0/P1/P2；
- 历史保留项 A17/A21/A23 仍按归档结论作为已接受、非阻断且无变更压力的观察项，不伪称已修复；A20 仅是 Gate 成功后的文档收口义务；
- 候选根据独立结果合理预期成功。

若最终 `make verify` 意外失败：不重跑、不修复、不创建 blocker Task；记录精确失败阶段、owner、候选 SHA、cleanup 和 `NOT_MET`，等待用户决定。

### R5. MET / NOT_MET 与文档

- `MET`：所有独立阶段通过，最终 `make verify` 唯一一次退出 `0`，cleanup 完整，当前开放 P0/P1/P2=`0/0/0`，收尾检查通过，代码/合同/测试/文档一致。
- `NOT_MET`：任一 required stage 非零或无法安全运行、存在当前开放 P0/P1/P2、候选变化、敏感信息泄漏、cleanup 不完整、合同漂移、最终 gate 非零或收尾状态不可接受。
- 只有 `MET` 才更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`，记录固定候选、实际计数/退出状态、最终耗时、cleanup、A25/A26关闭、open P0/P1/P2、真实敏感 owner 和 Phase 8=`MET`。
- `NOT_MET` 不把 `07/08` 标记完成，只更新当前 Task evidence 与父任务 gate/child metadata。
- 不修改已归档 abstraction review 或两个 blocker 的历史结论。

## 4. Acceptance Criteria

- [x] 批准后启动时 `HEAD` 仍为冻结候选，唯一临时分支按授权创建，dirty set 无未识别文件。
- [x] A25/A26 的实施与归档提交仍为候选祖先，父任务保持 `blocker_count=0`。
- [x] 九个独立阶段各有且仅有一次可归因结果；失败时其余安全独立阶段仍完成，未机械重跑。
- [x] E2E 使用动态选择并经现有 preflight 确认的空闲非 0 Redis DB；database/Redis/storage/process/ports cleanup 全部有实际结果。
- [ ] 运行输出未包含敏感连接配置表示。最终 gate 失败 traceback 自动展开了截断开发连接配置表示；具体值未写入 Task evidence，也未启用额外 trace/video。
- [x] 只有独立阶段全绿且 open P0/P1/P2=`0/0/0` 后，最终 `make verify` 才运行一次。
- [x] 最终 gate 的实际总耗时、退出码与全部可见 suite 计数已记录。
- [x] `NOT_MET` 路径未更新 `07/08` 完成状态，只更新当前 Task artifacts 和父任务 metadata。
- [x] `git diff --check`、当前 Task validate 与最终 Git 状态检查完成，允许范围外无修改。
- [x] 未修改产品代码、测试、合同、配置、runner、数据库、旧 `frontend/`，未开始 Phase 9/Cutover。
- [x] 完成后只报告建议 commit 范围，等待用户批准；不自动 commit、merge、push、PR、archive 或归档父任务。

## 5. Out of Scope

- 修复本轮发现的任何产品、测试、配置、合同、环境或部署问题。
- 修改 backend、frontend、frontend-v2 产品代码/测试、OpenAPI、generated types、数据库、Makefile、E2E runner 或旧 `frontend/`。
- Workbench 重设计、shared framework、build-storybook、Lighthouse、staging deploy、Phase 9 rehearsal 或 Cutover。
- 自动创建后续 blocker Task、自动提交/合并/推送/PR，或归档 Phase 8 父任务。

## 6. Blocking Questions

无。需求、范围、风险边界、Gate 算法和成功/失败提交范围均已由用户本轮明确；等待用户批准本规划后再进入执行。
