# 完整发布与上线回归执行计划

## Required Validation

### 发布前

```sh
git status --short --branch
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
node deploy/scripts/check-nginx-security.mjs
make test-deploy-scripts
```

### Hostdzire 完整发布

- 只读确认主机、`current`、共享环境 `0600`、磁盘、内存、容器和 `nginx -t`。
- 创建不可覆盖 release，链接共享环境。
- 运行 `backup.sh` 并确认备份非空。
- 运行默认 `PARTSIGNAL_VERSION=<release-id> ./scripts/deploy-staging.sh`。
- 安装同 release 的 staging Nginx 模板和项目安全 snippet，`nginx -t` 后 reload。

### 公网与浏览器

- `deploy/scripts/smoke.sh https://geo.962850.xyz`。
- 检查 `/`、`/index.html`、哈希资产的缓存与安全头，以及 `/object-storage/` 非 502。
- 连续 6 次、间隔 6 秒请求 live，随后只读核对 Nginx 时间窗。
- 使用 `playwright-cli -s=deploy-20260730-4e4672f` 的 1440×900 持续会话验证管理员和工程师权限路径、请求和控制台；隔离工程师账号只按授权完成创建、首次改密、403、停用和删除，保留审计。
- 退出账号、关闭会话并删除浏览器数据。

## 完成条件

全部必需验证通过后更新 `current`，将 release ID、备份路径的脱敏标识、探针结论、浏览器结论和残余风险写入任务记录；随后提交并归档本任务。部署过程中不修改项目代码。
