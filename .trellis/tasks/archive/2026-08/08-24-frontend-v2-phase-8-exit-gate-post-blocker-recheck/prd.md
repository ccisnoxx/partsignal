# Frontend V2 Phase 8 Exit Gate Post-Blocker Recheck

## Goal

在 A25–A30 全部关闭后，对固定 `main` 产品候选 `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403` 执行一次独立、完整、可归因的 Phase 8 Exit Gate 复核：先逐项完成九个安全独立阶段，仅当全部通过且环境清理完整时运行唯一一次 `make verify`，据实判定 Gate=`MET` 或 `NOT_MET`。

本 Task 是纯验证与文档收口，不拥有新的产品、测试、合同、配置、部署或 runner 修复。

## Background

- Phase 8 Workbench aggregate、UI、E2E、abstraction review、A25/A26 已提交、归档并包含在候选历史中。
- 首次 abstraction review、第一次 Exit Gate recheck 与 A27/A28 后的 final recheck 均保留其历史 `NOT_MET` 结论，不得回写。
- A27/A28 已分别关闭两键验证环境与 Settings failure-output owner；A29 已关闭 V1 MVP Flow 删除菜单 locator；A30 已用 Celery 顶层 `--quiet` 关闭 runner lifecycle 的 Redis 连接值回显。
- 父任务当前 `blocker_count=0`、已知 open P0/P1/P2=`0/0/0`；07/08 尚未宣称 Phase 8 完成，Phase 9 尚未开始。

## Requirements

1. 固定候选为创建本 Task 前 clean `main` 的 HEAD `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403`。规划与结果 evidence 可变化；任何产品代码、测试、合同、配置、Makefile 或 runner 变化都会使候选失效并停止本轮验证。
2. 启动前确认主工作区仍在 `main`，dirty set 只允许当前 Task 与父任务 metadata；确认 A25–A30 的实施/归档证据均包含在候选中，且不存在遗留 `codex/frontend-v2-*` 分支或额外 worktree。
3. 不 pull、push、创建 PR、自动 commit、改写 Git 历史或创建临时分支；除当前 Task/父 metadata 外不修改文件，除非 Gate=`MET` 后按文档分流更新 07/08。
4. 严格按顺序各运行一次九个独立阶段：`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`、`make build`、`make e2e`、dev Compose config、prod Compose config。
5. 每个阶段记录开始/结束、耗时、exit code、可见 suite pass/fail/skip 计数、最小失败症状与 owner。一个阶段失败后仍执行其他安全且独立的阶段；代码、配置和环境没有相关变化时不得重跑失败命令。
6. 前七个 Make 阶段使用 A27 的两键子进程环境：从基础环境删除 `.env` 中全部键，仅注入宿主机可访问的 `DATABASE_URL` 与 `REDIS_URL`，不输出值。Compose config 继续显式使用 `.env`，prod 只额外注入既有 image/version 变量。
7. 独立 `make e2e` 与最终 `make verify` 分别动态选择一个当时空闲、非 0、独占且彼此不同的 Redis logical DB；不得硬编码或沿用历史编号。两次都必须通过现有 preflight，不清理其他任务或外部 owner 的数据。
8. E2E 只使用现有 `deploy/scripts/e2e-local.sh` 生命周期，不创建临时 Playwright CLI 流程，不额外启用 trace/video。证据覆盖 database、Redis、storage、服务进程及固定端口 cleanup。
9. 命令输出采用受控内存审查，不持久化原始日志；报告不得包含 password、Cookie、CSRF、Authorization、数据库/Redis URL、request header/body、storage state、签名 URL或敏感正文。
10. 敏感信息保证只按实际 owner 表述：A27 两键 allowlist、A28 Settings repr/ValidationError、dev-storage/Playwright artifact 规则、A30 Celery quiet 和本轮受控输出审查；不得宣称不存在的全局 secret scanner。
11. 只有九阶段全部 exit `0`、cleanup 完整、候选未变化、A25–A30 closed、open P0/P1/P2=`0/0/0` 且无敏感输出时，才运行一次且仅一次最终 `make verify`。
12. 最终 `make verify` 非零时不修复、不立即重跑、不自动创建 blocker；记录失败阶段、owner、cleanup、候选和执行次数，等待用户决定。
13. Gate=`MET` 时才更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`；Gate=`NOT_MET` 时两份长期文档保持未完成，只更新当前 evidence 与父 metadata。
14. 不归档 Phase 8 父任务，不开始 Phase 9、Cutover、staging rehearsal 或部署操作。

## Acceptance Criteria

- [x] 启动时分支、固定候选、dirty allowlist、A25–A30 祖先/归档状态、分支/worktree 与 blocker metadata 全部符合要求。
- [x] 九个独立阶段均恰好运行一次，每项都有实际 exit、耗时、suite 计数或不适用/未保留计数说明及 owner。
- [x] 独立 E2E 使用本轮动态选择的空闲非 0 独占 Redis DB；database、Redis、storage、服务进程和固定端口 cleanup 完整。
- [x] 独立阶段没有失败，不需要重跑或追加失败诊断。
- [x] 独立阶段全部通过且最终前置条件满足后，`make verify` 恰好运行一次。
- [x] 最终 Gate 记录了实际总耗时、exit、可见 suite 计数与第二次完整 cleanup。
- [x] A25–A30、blocker_count、open P0/P1/P2 与敏感输出保证均来自本轮观察，没有复制旧任务的运行值。
- [x] 判定算法结果为 `MET`，当前 Task 与父 metadata 一致，所有历史 `NOT_MET` evidence 保持只读。
- [x] 仅在 `MET` 后更新 07/08；文档包含固定候选、实际阶段/suite 结果、`make verify` 耗时、cleanup、A25–A30 closed、open P0/P1/P2 和真实敏感 owner。
- [x] 最终 diff 只包含成功路径允许的 docs/Trellis evidence，不含产品、测试、合同、配置、runner、旧 `frontend/` 或无关修改。
- [x] 收尾 `git diff --check`、当前 Task validate、父 metadata/JSON 与 `git status` 审计通过。
- [x] 未自动 commit、push、PR、归档父任务或开始 Phase 9。

## Out of Scope

- 修复本轮发现的产品、测试、环境、配置、部署或 cleanup 问题。
- 修改 backend、frontend、frontend-v2、OpenAPI、generated types、数据库行为、Makefile 或 E2E runner。
- 重做 Workbench、重复 A25–A30 targeted 验证、创建新 blocker 或形成“一 blocker、一次 gate 重跑”循环。
- `make test-deploy-scripts`、Storybook、Lighthouse、staging deploy、Phase 9 rehearsal 或 Cutover。
- 自动提交、推送、创建 PR、归档父任务或执行 Git 历史改写。
