# I03-4 最终 clean-checkout 本地集成复验

## Goal

从固定候选 commit 创建独立 clean validation worktree，单次运行完整本地门禁、核对资源清理并完成独立高风险复核。

## Requirements

- 固定验证对象为 `88992307cdf42b3935f30938bc73f750dd9cde4b`，tree 为 `209bde2da6f8df6163b8a5370d4d277645cbf91a`；从 Git 对象创建新的 detached clean validation worktree，不复制候选依赖、缓存或产物。
- 候选工作区只允许产生本任务、I03 父任务和总体交付父任务的 Trellis 收尾记录；原检出区只读并保持 `main@9100774b0e124d1d834f8c726cf85f2c0e171e5e` clean。
- validation bootstrap 使用仓库现有入口；只创建 ignored 本地环境/依赖，任何 tracked diff 都是阻断。
- 门禁前确认固定端口、Redis DB 14、`partsignal_e2e_%` 数据库、E2E storage 与 secret 临时资源为空；只向单次 `make verify` 子进程导出宿主 PostgreSQL `DATABASE_URL` 和 `REDIS_URL=redis://127.0.0.1:56379/14`。
- 使用 `bash -o pipefail` 保存完整日志 `/tmp/partsignal-i03-4-clean-verify.log` 与退出状态 `/tmp/partsignal-i03-4-clean-verify.status`；失败先归因，不无变化重跑完整门禁，不在本任务修改生产代码、测试、Makefile、CI、Compose、合同或依赖。
- 门禁后核对全部资源释放、validation tracked tree 无变化、候选与原检出区边界不变，并运行 `git diff --check`。
- 只有门禁退出 0、secret scan clean、资源清理完成且代码 tree 未变化后，才安排 fresh `critical_reviewer` 对固定候选、完整日志和清理证据做独立只读高风险复核。
- 不运行远端 GitHub Actions、真实 staging/production 部署或发布；不创建、启动或实施 I04，不 push、不建 PR、不 merge、不 rebase、不 reset。

## Acceptance Criteria

- [x] 固定 commit/tree 从独立 clean Git worktree 完整重建，I03-1 列出的 21 个维护文件均 tracked，且不存在候选所需的未跟踪源码、脚本或测试。
- [x] `make verify` 单次退出 0，记录合同/类型/静态检查、backend unit、frontend Vitest、PostgreSQL integration、Docker/production build、real-stack/fixture Playwright、两轮 secret scan、六项统一 harness 和 Compose config 的真实结果。
- [x] I03-2 的统一 Make 入口实际只执行一次 frontend Docker build 和一次 backend Docker build，六项 harness 均真实执行且失败未被吞掉。
- [x] 四个固定端口释放、Redis DB 14 为 0 key、`partsignal_e2e_%` 数据库为 0、临时 storage/secret/fixture 资源为 0，validation tracked tree 无漂移。
- [ ] fresh 独立高风险复核结论为 `NO BLOCKER`，并记录实际覆盖与未运行边界。
- [ ] I03-4、I03 和总体前端重新开发任务在全部条件满足后标记 `completed`；I04 保持未创建、未执行。
- [ ] 最多创建一个只含 I03-4、I03、总体交付和必要 Trellis 会话收尾记录的本地提交；候选与原检出区最终均 clean，validation worktree 安全移除，验证日志保留。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-canonical-local-integration/`。
- 前置任务：I03-1、I03-2、I03-3；原子候选 commit 为 `fa285837425c66041da8e53f6e150912283d50ed`，基线为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
