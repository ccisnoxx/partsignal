# I03-1 Canonical 源码与集成引用审计

## Goal

只读审计 canonical 前端源码、构建/运行/CI/Compose/OpenAPI 生成类型引用、未跟踪维护文件与 clean-checkout 恢复边界；只写 Trellis 记录和审计报告。

## Requirements

- 只修改 I03/I03-1 Trellis 记录与审计报告；不修改生产代码、测试、Makefile、CI、Compose、合同或稳定 spec。
- 清点 canonical 前端源码、构建目录、历史迁移目录，并区分活动引用、历史记录、测试反例和镜像名称。
- 核对 Makefile、`.github/workflows/ci.yml`、三套 Compose、Dockerfile、nginx、部署脚本、环境变量与 E2E isolation 引用。
- 核对 `contracts/openapi.yaml`、`api:generate`、`api:check`、生成文件及 Makefile/CI 调用；输入未变化时复用 I02-3 证据，不重新生成。
- 精确比较本地 `make verify` 与远端手动 CI 执行图，只记录后续最小修复范围。
- 重新清点 `.trellis/tasks/` 之外全部未跟踪维护文件，逐文件记录 owner、引用、候选必要性、产物/敏感分类和遗漏影响。
- 记录双工作区、基线、tracked/untracked、Git 恢复证据与 clean-checkout 边界；不执行任何 Git 写操作。
- 安排 fresh 独立只读复核；审查代理不得修改文件或执行 Git 写操作。

## Acceptance Criteria

- [x] 审计矩阵覆盖 canonical 源码、Makefile、CI、dev/staging/prod Compose、Docker/nginx、部署脚本、生成类型、未跟踪文件和恢复点。
- [x] 所有确认缺口具有准确 owner 和最少数量的后继任务建议；本会话不创建或实施 I03-2。
- [x] 独立只读审查无未解决阻断，且没有遗漏活动前端引用、误分历史字符串、遗漏未跟踪维护文件或低估 clean-checkout 风险。
- [x] `git diff --check` 通过，本任务除 Trellis 记录和审计报告外没有新增代码差异。
- [x] I03-1 标记 `completed` 并记录下一任务；I03 与总体交付父任务继续保持 `in_progress`。

## Notes

- I02-3 的完整绿色证据和独立复核记录是本审计的输入，不把未运行的远端 GitHub Actions 表述为通过。
- 审计报告：`research/canonical-source-integration-audit.md`。
- 独立复核审计包：`20260925T193252Z-i03-1-canonical-source-reference-audit-independe-27cfb4fb`，状态 `closed/passed`，结论 `NO BLOCKER`。
