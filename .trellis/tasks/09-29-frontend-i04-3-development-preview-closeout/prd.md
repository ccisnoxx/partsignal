# I04-3 开发预览部署收口与总体任务关闭

## Goal

只读复核当前 Hostdzire 开发预览，证明既有门禁和独立复核输入连续性，终止旧 Production 路线并关闭 I04 与总体交付；不部署或接入真实外部服务。

## Requirements

- 权威工作区为 `/Users/sc/PycharmProjects/partsignal`；基线 `HEAD=main=origin/main=66976eb05dcc153f60bcca334f96076e82da6c71`，运行源码为 `4e85aaf9f8c4f96dc121658f08ca49aa74810409`。先证明其后的差异仅为 Trellis 首次部署记录与 `docs/development-preview.md`。
- 只用 SSH alias `hostdzire` 进行远端只读核对：current/release、七服务与一时容器、三网络物理名/逻辑 label、公网 root/资产/live/ready 精确 200 与六项安全头、pending marker、`nginx -t`、其他容器和历史失败冻结证据。
- 复用首次部署已通过的 `make verify` 与最终独立高风险复核；若运行输入变化或线上实质漂移，记录 blocker 与恢复点后停止，不在本任务重跑完整门禁、修复或部署。
- 将旧 I04-2 Production 路线作为被当前授权开发预览目标取代的历史路线终止；真实 AI、真实 Aliyun OSS、Production cutover 与 External Services Gate 均不得伪报通过。
- 仅在证据和子任务状态一致后完成 I04、R00–I04 总体任务；记录实际退出码、时间、日志路径、bytes/SHA-256 和覆盖缺口。旧候选工作区只读检查，不实施、合并、变基、清理或归档。
- 仅提交必要 Trellis 收口记录及确因状态变化失效的稳定文档；可一次 non-force fast-forward push 到 `main`。不创建 I05，不执行运行环境写入或 Production 操作。

## Acceptance Criteria

- [x] 本地主工作树和 Git 身份符合基线；R00–I03 与已完成 I04 子任务实际状态可验证；旧候选前后未变。
- [x] Hostdzire 只读复查全部通过，结果可由脱敏日志复核。
- [x] 首次部署完整门禁和独立复核的输入连续性成立，真实 AI/OSS 和 Production 覆盖缺口明确。
- [x] I04-2 准确终止，I04 与总体任务完成，所有修改后的 JSON 可解析；diff、secret scan 与工作树范围通过。
- [x] 一次收口提交以非强制 fast-forward 推送，local main 等于 origin/main 且工作树 clean。

## Coverage boundary

当前开发预览运行确定性 AI 和开发 fake-oss。真实 AI/OSS、Production maintenance、quarantine、clean-init、External Services Gate、activation 与 observation 都属于后续另行授权的范围，不是本次预览收口的验收项。
