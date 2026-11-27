# I03-2 CI 门禁一致性修复

## Goal

让 GitHub Actions verify job 复用 Makefile 的 test-deploy-scripts 统一 owner，补齐四项门禁并移除重复 deploy harness。

## Requirements

- 只在候选工作区修改 `.github/workflows/ci.yml`、本任务 Trellis 记录；只有统一目标依赖复用确有必要时才允许最小修改 `Makefile`。
- `verify` job 必须调用 Makefile 中唯一拥有 deploy/test harness 列表的统一目标，优先复用 `make test-deploy-scripts`，不得在 workflow 重复展开子脚本。
- 统一入口必须覆盖 frontend container smoke、process lifecycle、database lifecycle、post-run secret regression、staging deploy script 与 production deploy script 六项门禁。
- 删除 workflow 中被统一目标覆盖的 staging/production 直接调用，所有非零退出继续由 GitHub Actions 默认语义直接使 job 失败。
- 保留 contract、lint、typecheck、backend/frontend unit、PostgreSQL integration、backend/frontend build、E2E、dev/prod Compose config、Redis DB 14/15 隔离、`frontend-test` 分片、Node cache 和 canonical `frontend/` 工作目录。
- 复用 I02-3 的真实 `make test-deploy-scripts` 通过证据；在 Makefile 与相关脚本输入未变化时，不重跑 Docker build、完整目标或 `make verify`。
- 不修改业务代码、测试内容、Compose、部署脚本、OpenAPI 或生成类型，不执行 Git staging/commit/branch/archive/push、发布或部署，不进入候选原子组装、clean-checkout 复验、I03 收尾或 I04。

## Acceptance Criteria

- [x] workflow YAML 语法检查通过，`verify` 通过统一 Make owner 覆盖六项门禁且不再直接重复调用 staging/production harness。
- [x] `make -n` 与 Make 目标图证明六项门禁覆盖、`verify` 必经关系和默认非零失败传播；不存在 `continue-on-error`、`|| true` 或结果覆盖。
- [x] 既有 contract、静态检查、unit、integration、build、E2E、Compose、Redis 隔离、前端分片/cache/canonical 路径均保持。
- [x] `git diff --check` 通过，任务差异仅包含允许的 CI 接线与 I03-2 Trellis 记录；原检出区保持不变。
- [x] fresh `critical_reviewer` 独立只读高风险复核结论为 `NO BLOCKER`。
- [x] PRD、实施记录与 `task.json` 记录真实修改、验证、未运行的远端 Actions 和下一任务；I03-2 标记 `completed`，I03 与总体交付保持 `in_progress`。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-canonical-local-integration/`。
- 前置任务：I02-2、I02-3、I03-1；其输入未变化时直接复用证据。
- 下一任务固定记录为“候选文件原子组装与恢复点”，本会话不创建或实施。
