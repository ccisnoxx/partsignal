# Frontend V2 Phase 8 Exit Gate Final Recheck

## Goal

在 A27/A28 已关闭后，对固定 `main` 产品候选 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce` 执行一次完整、可归因的 Phase 8 最终复核：先逐项完成九个安全独立阶段，仅当全部通过且环境清理完整时运行唯一一次 `make verify`，据实判定 Exit Gate=`MET` 或 `NOT_MET`。

本 Task 是纯验证和文档收口，不拥有新的产品、测试、合同、配置、部署或 runner 修复。

## Background

- Phase 8 aggregate read model、UI、E2E、abstraction review、A25、A26 均已提交、归档并包含在当前 `main`。
- 首次 abstraction review 和第一次 Exit Gate recheck 的历史结论均为 `NOT_MET`，必须保留，不能回写归档证据。
- A27 已关闭最终 gate 的 `.env` 批量导出问题：验证子进程只接收 `DATABASE_URL` 与 `REDIS_URL` 两个 `.env` 键，并使用现有 preflight 选择独占非 0 Redis logical DB。
- A28 已关闭 Settings 失败输出安全问题：七个敏感字段不进入 Settings repr，Pydantic validation error 隐藏输入值；保证范围不是全局 secret scanner。
- 当前父任务 `blocker_count=0`，07/08 尚未宣称 Phase 8 完成，Phase 9 尚未开始。

## Requirements

1. 固定候选为创建本 Task 前的 `main` HEAD `306f70f9ab6c84a2732d7d5aa69001982e2d39ce`。规划/证据文件可以变化；任何产品代码、测试、合同、配置、Makefile 或 runner 变化都会使候选失效并停止本轮验证。
2. 启动前确认主工作区仍在 `main`，除当前 Task 和父任务 metadata 外无 dirty 文件；确认 A27/A28 的实施与归档提交均为候选祖先，且不存在遗留 `codex/frontend-v2-*` 分支或额外 worktree。
3. 不 pull、push、创建 PR、改写 Git 历史或自动 commit。项目默认单分支；除非用户另行明确授权，实施阶段不创建临时分支。
4. 按既定顺序各运行一次九个独立阶段：`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`、`make build`、`make e2e`、dev Compose config、prod Compose config。
5. 每个阶段记录命令、开始/结束、耗时、退出码、可见 suite 计数、最小失败症状与 owner。一个阶段失败后仍执行其他安全且独立的阶段；代码、配置和环境没有相关变化时不得重跑失败命令。
6. 根 Make 阶段在 A27 定义的脱敏子进程环境中执行：先移除 `.env` 的全部键，再只注入 `DATABASE_URL` 与 `REDIS_URL`；不得输出任何值。Compose config 继续显式使用项目 `.env` 文件，prod 仅额外注入既有 image/version 变量。
7. 独立 `make e2e` 与最终 `make verify` 分别动态选择一个当时空闲、非 0、独占的 Redis logical DB；两次不得复用同一编号，也不得沿用历史编号。每次都必须通过现有 `e2e-environment.py preflight`，不得清理其他任务或外部 owner 的数据。
8. E2E 使用现有 `deploy/scripts/e2e-local.sh` 生命周期，不创建临时 Playwright CLI 流程，不额外启用 trace/video。证据必须覆盖临时 database、Redis、storage、服务进程与固定端口的 cleanup 状态。
9. 报告不得包含 password、Cookie、CSRF、Authorization、数据库/Redis URL、request header/body、storage state、签名 URL或敏感正文。敏感信息保证只按实际 owner 表述：runner/Playwright artifact 规则、A27 环境 allowlist、A28 Settings failure-output boundary 与人工输出复核；不得宣称不存在的全局 scanner。
10. 只有九阶段全部退出 `0`、cleanup 完整、候选未变化、open P0/P1/P2=`0/0/0` 且没有敏感输出时，才运行一次且仅一次最终 `make verify`。
11. 最终 `make verify` 非零时，不修复、不立即重跑，也不创建“一个 blocker、一次 gate 重跑”的循环；完成尚未执行且安全的独立诊断，记录精确阶段、owner、cleanup 和候选，等待用户决定。
12. Gate=`MET` 时才更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`；Gate=`NOT_MET` 时两份长期文档保持未完成，只更新当前 Task evidence 与父任务 metadata。
13. 不改写归档 abstraction review、第一次 recheck、A27 或 A28 的历史结论；不归档 Phase 8 父任务，不开始 Phase 9 或 Cutover。

## Acceptance Criteria

- [x] 启动时 `main` HEAD 等于固定候选，A27/A28 实施与归档提交均为其祖先，dirty set、分支与 worktree 检查符合要求。
- [x] 九个独立阶段均恰好运行一次；每项都有实际退出码、耗时、suite 计数或不适用说明、cleanup 与失败 owner 证据。
- [x] 独立 E2E 使用动态空闲非 0 独占 Redis DB，并通过现有 preflight；database、Redis、storage、服务进程和固定端口完成精确 cleanup。
- [x] 失败阶段不因无相关变化被重复执行；其他安全独立阶段仍完成。
- [x] 只有独立阶段全绿且前置条件全部满足时，最终 `make verify` 恰好运行一次；否则明确记录为 `NOT RUN`。
- [x] 最终 gate 未执行，因此新的 Redis DB、suite 计数、总耗时与 cleanup 要求不适用，执行次数据实记录为 `0`。
- [x] open P0/P1/P2 与 A25/A26/A27/A28 状态据实记录；敏感信息结论不超过实际 owner 的保证范围。
- [x] 按判定算法得到唯一 `MET` 或 `NOT_MET`，父任务 metadata 与当前 evidence 一致，且历史 `NOT_MET` 任务保持只读。
- [x] 仅 `MET` 路径更新 07/08；`NOT_MET` 路径不把 Phase 8 标记完成。
- [x] 最终 diff 未包含产品代码、测试、合同、配置、runner、旧 `frontend/` 或无关文件修改；收尾校验结果记录完整。
- [x] 未自动 commit、push、创建 PR、归档父任务或开始 Phase 9。

## Out of Scope

- 修复本轮发现的产品、测试、环境、配置、部署或清理问题。
- 修改 backend、frontend、frontend-v2、OpenAPI、generated types、数据库行为、Makefile 或 E2E runner。
- 重做 Workbench、启动新的 blocker、重复 targeted blocker 验证或重跑失败 gate。
- `make test-deploy-scripts`、Storybook、Lighthouse、staging deploy、Phase 9 rehearsal 或 Cutover。
- 自动提交、推送、创建 PR、归档父任务或执行任何 Git 历史改写。
