# I03-4-B2-C2 修复候选 clean-checkout 完整复验与 I03 收尾

## Goal

基于固定 cleanup 修复提交执行 detached clean-checkout 完整仓库门禁、资源清理、完整候选独立高风险复核，并在全部条件满足后完成 I03 与总体本地交付收尾。

## Requirements

- 固定验证对象为 `6aaf05a5ad5371493bb20c95b5cbdb5908a27cf9`，tree 为 `8a07b055bcb9f8d2b4038f7e31ac5fab71c815e1`；总体候选基线为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`，身份边界修复提交为 `bcd985251fabc15d02a4f3be9bde721f2fdd459f`。
- 从固定提交创建新的 detached validation worktree；bootstrap、完整门禁与运行时产物只位于 validation，候选工作区只写 Trellis 记录，原检出区保持只读。
- 门禁前后同时检查原始 `${TMPDIR}`、canonical realpath 与 `/tmp`，按真实目录去重；未知残留必须先确认 owner，不得广泛删除。
- 唯一完整门禁入口为一次 `make verify`；只向该进程覆盖指定 `DATABASE_URL` 与 Redis DB 14，不 source 或整体导出 `.env`。完整日志、状态、字节数与 SHA-256 固定保存到用户指定路径。
- 任何失败先区分候选缺陷、环境问题与非阻断警告；本会话不修改候选代码、测试、合同、依赖、Makefile、CI、Compose 或部署脚本，也不重复运行完整门禁。
- 只有完整门禁退出 0、secret scan clean、全部相关资源清零、validation commit/tree 未漂移且候选代码不变后，才派发 fresh `critical_reviewer` 复核基线到固定候选的全部 tracked 差异和本轮证据。
- 只有独立复核结论为 `NO BLOCKER` 才完成 cleanup blocker、B2、身份边界 blocker、I03-4、I03 与总体本地交付，并最多创建一个只含 Trellis 收尾记录的本地提交。
- 不创建或实施 I04；不执行 push、PR、merge、rebase、reset、archive、发布、真实部署、远端 CI 或其他远端写操作。

## Acceptance Criteria

- [x] validation HEAD/tree 精确匹配固定恢复点，tracked 与 non-ignored untracked 状态为空，候选所需维护源全部 tracked。
- [x] 门禁前相关临时目录、固定端口、Redis DB 14 与 `partsignal_e2e_%` 数据库均为 0，PostgreSQL/Redis 测试基础设施健康，三个工作区边界成立。
- [x] 单次 `make verify` 退出 0，实际覆盖 contract/runtime OpenAPI/generated types、静态检查、三层测试、production build、两次 Docker build、real-stack/fixture Playwright、secret scan、frontend container、process/database lifecycle、post-run secret、staging、C1 cleanup regression、production harness、Compose 与部署脚本检查。
- [x] I02-1、I02-2 与 C1 cleanup regression 均由本次顶层门禁实际执行；绿色结果不依赖事后手工删除。
- [x] 门禁后全部仓库相关临时目录、对象存储 fixture、secret key/manifest、固定端口、Redis DB 14 与 E2E 数据库清零；validation clean 且 `git diff --check` 通过，候选代码和原检出区未漂移。
- [ ] fresh `critical_reviewer` 对 `9100774b..6aaf05a5` 全量候选和本轮证据结论为 `NO BLOCKER`。
- [ ] C2、cleanup blocker、B2、身份边界 blocker、I03-4、I03 与总体本地交付全部标记 `completed`；明确未运行远端 CI、真实部署和 I04，外部 AI/对象存储仍为本地测试替身。
- [ ] 若创建收尾提交，staged/diff 仅含 Trellis 记录并记录 commit/parent/tree；提交后候选与原检出区 clean，validation worktree 已安全移除并 prune。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-b2-production-harness-tmpdir-cleanup-blocker/`。
- 本任务仅验收和收尾，不承担新的候选实现；旧 `bcd98525`/`88992307` 完整日志、I02 历史门禁以及 B1/C1 定向检查均不能替代本轮证据。
- 本轮前五项验收成立，但 fresh `critical_reviewer` 发现认证 session 跨快照拼接 P1 发布阻断；已建立 `09-25-frontend-i03-4-b2-c2-auth-session-cross-snapshot-blocker`。因此本任务和全部父链保持 `in_progress`，不创建收尾提交，不进入 I04。
