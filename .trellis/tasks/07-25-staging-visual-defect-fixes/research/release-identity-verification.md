# Research: 预发布 release 与 Git 提交核对

- Query: 部署后怎样读取并核对 release 标识和 Git commit。
- Scope: internal
- Date: 2026-07-25

## Findings

### release 标识的来源

- release 格式固定为 `mvp-YYYYMMDD-HHMMSS-<12位commit>`。完整发布由本地 `origin/main` 生成完整 SHA，再把其 12 位短 SHA 写入 release ID：`docs/Hostdzire部署附录.md:157-191`。
- 快速脚本同样先确认本地 `HEAD == origin/main`，再用 `head_commit` 的 12 位短 SHA 生成 release：`deploy/scripts/redeploy-staging-fast.sh:73-87`。
- release 目录位于 `/root/partsignal/releases/<release-id>`，`/root/partsignal/current` 是最后完成相应验收的软链接记录：`docs/Hostdzire部署上线流程.md:24-36`。
- 快速脚本成功时会输出切换后的 `current` 相对目标：`deploy/scripts/redeploy-staging-fast.sh:202-219`。

### 只读读取与本地核对命令

Runbook 已给出的远端只读事实是：

```sh
ssh -F /Users/sc/.ssh/config hostdzire \
  'readlink -f /root/partsignal/current'
```

其中 `readlink -f /root/partsignal/current` 来自 `docs/Hostdzire部署附录.md:436-447`。若要同时把 release ID 的 12 位提交前缀与本地权威 `origin/main` 核对，可在本地主工作目录执行：

```sh
set -eu
CURRENT_RELEASE=$(
  ssh -F /Users/sc/.ssh/config hostdzire \
    'basename "$(readlink -f /root/partsignal/current)"'
)
DEPLOY_COMMIT=$(git rev-parse origin/main)
test "${CURRENT_RELEASE##*-}" = "$(git rev-parse --short=12 "$DEPLOY_COMMIT")"
printf 'release=%s\ncommit=%s\n' "$CURRENT_RELEASE" "$DEPLOY_COMMIT"
```

核对逻辑依据：

- `CURRENT_RELEASE##*-` 取 release ID 最后一段 12 位 SHA。
- `DEPLOY_COMMIT` 必须来自已推送的本地 `origin/main`；完整发布源校验要求 `HEAD == origin/main`：`docs/Hostdzire部署附录.md:155-168`。
- 上一次线上验收也使用 `readlink /root/partsignal/current` 与本地 Git 祖先关系核对，并记录了完整 SHA 与 release：`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:7-17`、`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:22-30`。

### 为什么不能只看 `current`

- `current` 只表示最后验收记录，不直接证明当前固定 Compose 栈仍运行同一镜像；它不是蓝绿流量开关：`docs/Hostdzire部署上线流程.md:114-120`。
- 部署后还必须核对容器、健康和公网资源。完整流程的最后只读主机复核为：

  ```sh
  ssh -F /Users/sc/.ssh/config hostdzire \
    "docker ps --format '{{.Names}}|{{.Status}}'; nginx -t; free -h; df -h /"
  ```

  见 `docs/Hostdzire部署附录.md:346-351`。
- 公网 `live`、`ready`、首页标题和带哈希资源/缓存的命令见 `docs/Hostdzire部署附录.md:303-332`。

### 主 Agent 必须完整阅读

1. `docs/Hostdzire部署上线流程.md`
2. `docs/Hostdzire部署附录.md`
3. `deploy/scripts/redeploy-staging-fast.sh`
4. `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`

## External References

- 无；Git/release 映射完全由仓库脚本和 Runbook 定义。

## Related Specs

- `docs/operations.md:5-10`：只部署干净、已推送且与远端权威提交一致的版本；release 不可覆盖。

## Caveats / Not Found

- release 由 `git archive` 创建，不包含 `.git`；仓库没有发现随 release 写入完整 40 位 SHA 的独立元数据文件或公网 release endpoint。服务器侧只能从 release 名读到 12 位 SHA，完整 SHA 必须在本地权威 Git 中解析并核对。
- 12 位 SHA 在该仓库现阶段足以定位，但严格身份仍应输出并记录本地完整 `origin/main` SHA。
- 本次研究未运行上述 SSH 或 Git 命令，因此没有声明当前线上 release 或 commit。

## 2026-07-25 线上执行结果

- 本地 `main` 与 `origin/main` 均为 `ad46f5e9201af1d046c702b71e09c4e924660910`。
- 已从该提交创建并完整部署不可覆盖 release `mvp-20260725-160540-ad46f5e9201a`；API、前端、Worker、Scheduler 和 fake-oss 容器均运行该 release 镜像。
- 公网 live/ready、首页、SPA fallback、带哈希资源缓存和对象存储代理检查通过；实际主资源为 `/assets/index-DK8pBprs.js`。
- 因当前线上不存在 `contentVersionId`，完整内容审核验收尚未完成，故 `/root/partsignal/current` 仍保留最后已完整验收记录 `mvp-20260725-132132-bee2ef4a69a`，未提前切换。
