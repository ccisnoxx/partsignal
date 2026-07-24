# 当前部署文档漂移证据

## 已确认冲突

- `docs/Hostdzire部署上线流程.md:53` 只允许已提交并推送的 `main`，`:171` 仍提供未提交工作树打包路径。
- `docs/Hostdzire部署上线流程.md:156-160` 的 release ID 缺少秒与 commit；`deploy/scripts/redeploy-staging-fast.sh:87` 使用秒级时间戳和 12 位短 commit。
- `docs/operations.md:58` 要求在仓库根目录创建 `.env.staging`；当前快速脚本只接受 `/root/partsignal/shared/.env.staging`（`deploy/scripts/redeploy-staging-fast.sh:79-85,128-165`）。
- `docs/operations.md:98` 称前端通过软链接切换；快速脚本先更新固定 Compose 容器，再在公网验收后更新 `current`（`deploy/scripts/redeploy-staging-fast.sh:182-218`）。
- Runbook 的完整质量门位于 `:66-76`，快速路径直到 `:347-365` 才成为例外，阅读顺序与日常使用频率相反。
- Runbook 的备份/迁移/浏览器停止条件混在共同停止条件 `:143-152`，没有区分快速与完整发布。
- 当前服务器连接只使用 `/Users/sc/.ssh/config` 中的 `hostdzire` 和 `dmit`；Runbook 基础设施表仍列出与本部署无关的 `aaitr`。

## 保留的事实源

- 快速资格与执行顺序：`deploy/scripts/redeploy-staging-fast.sh`
- 完整模式顺序：`deploy/scripts/deploy-staging.sh`
- 服务、端口、健康检查：`deploy/compose.staging.yaml`
- 备份与恢复：`deploy/scripts/backup.sh`、`deploy/scripts/restore-verify.sh`
- 公网健康端点：`deploy/scripts/smoke.sh`
