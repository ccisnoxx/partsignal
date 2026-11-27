# I04-2 release freeze 与 clean-init cutover

> 2026-09-29 终止状态：`outcome=SUPERSEDED_BY_AUTHORIZED_DEVELOPMENT_PREVIEW_TARGET`。以下 Production 目标、要求和未勾选验收是历史方案，不表示已执行或已通过。当前授权目标由 I04-3 收口为 Hostdzire 开发预览；本任务不再继续 cutover。

## Goal

在最终 clean main 和已通过 Repository Release Gate 上冻结 release/archive/images/manifest，经 pre-cutover high-risk review 后在 Hostdzire 执行 maintenance、clean-init、真实 AI/OSS Gate、activation、生产验收与观察。

## Requirements

- 输入必须是已推送、无分叉、两个工作树 clean 的 `main`；本 task 创建前的产品候选 `e53b655b75b6d3418a96307d28f305c6bdb8245a` 已通过 fresh Repository Release Gate 和独立 `NO BLOCKER` 复核。
- 先提交并 non-force fast-forward 推送本 task 的 Trellis-only 记录，再重验最终 `HEAD == local main == origin/main == candidate`、范围 diff、工作树与 tracked secret scan。若后续出现产品代码、部署配置、依赖或环境输入变化，完整 Repository Release Gate 立即失效并必须重跑。
- 对 Hostdzire 的所有命令只使用既有别名 `ssh hostdzire '<command>'`；host-key 冲突立即停止，不绕过校验、不接受新指纹、不执行 `ssh-keygen -R`。
- 在任何维护写操作前完成远端只读 precheck，冻结唯一 release ID/run ID、可复现 source archive、backend/frontend image reference、image ID、全部 RepoDigest、platform、不可覆盖 0600 manifest、rollback frontend identity 与逐条执行/回滚命令。
- Production env 固定使用 `/root/partsignal/shared/.env.production`；不得输出、传输或记录 secret 值，不得修改 `.env.staging`。
- 真实 AI credential 只能由 credential owner 在 Hostdzire true TTY/no-echo 交互路径输入，不得经聊天、argv、环境变量、普通文件、日志或 Trellis。进入 maintenance 前必须证明该路径和非 secret provider 配置可用。
- release freeze 和完整 pre-cutover package 必须经过 fresh 独立 high-risk critical review；结论不是 `NO BLOCKER` 时停止。
- cutover 仅通过仓库 Production runbook 和脚本执行：maintenance、稳定 503/T0、精确停止旧服务、同设备 quarantine、clean-init prepare、真实 AI/OSS Gate、activation、原子 Nginx 切换、生产验收、观察和可恢复收尾。
- 任何 Gate 失败必须 fail-closed；不把结构 preflight 伪装成真实 External Services Gate，不删除或 retag 已冻结 rollback image，不清理 quarantine 或关键证据。
- I04 和总体前端任务在本 task 完成前保持 `in_progress`。

## Acceptance Criteria

- [ ] Trellis-only 收口已 commit 并 non-force fast-forward push；最终 main/origin/candidate identity、diff、clean tree 和 secret scan 通过。
- [ ] fresh Hostdzire 只读 precheck 通过，Production env/rollback identity 未漂移，远端执行前置条件完整。
- [ ] 唯一 release/archive/backend image/frontend image/manifest 已生成并以完整 SHA-256、image ID、RepoDigest、platform 和来源 commit 固定；没有覆盖既有 release。
- [ ] credential-owner true-TTY bootstrap 路径与全部非 secret AI provider metadata 已在 maintenance 前准备完成。
- [ ] pre-cutover high-risk review 为 `NO BLOCKER`。
- [ ] maintenance、quarantine、clean-init prepare、真实 AI/OSS Gate、activation 和 final Nginx 均按状态机成功，失败路径保留可恢复状态。
- [ ] 公网、回环、浏览器、权限、受控写、AI、OSS、artifact、security、runtime、migration 和 deploy-state 验收通过。
- [ ] 观察窗口完成；post-observation fresh review 无 blocker；保留规定 rollback/quarantine/evidence，不执行越权清理。
- [ ] I04-2、I04 和总体任务记录真实证据并完成最终 Git 收口。

## Stop conditions

- host-key、Production env、rollback identity、archive/image/manifest identity、credential-owner path、远端资源或 Nginx/data safety 任一不成立。
- 需要修改产品代码、部署脚本、migration 或公共合同；此时退回本地变更和 fresh Repository Release Gate，不在远端临时修补。
- 真实 AI 或 OSS Gate 失败、结果未知，或无法安全清理受控测试 artifact。
- fresh critical review 返回 blocker。
