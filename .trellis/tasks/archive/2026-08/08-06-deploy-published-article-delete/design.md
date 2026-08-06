# 推送并重新部署生产环境：技术设计

## 1. 发布边界

本任务不建立新部署机制，严格复用 `docs/Hostdzire部署上线流程.md` 与 `docs/Hostdzire部署附录.md`。公网虽由仓库称为 staging/预发布，用户当前的“重新部署上线”目标即唯一公开环境 `https://geo.962850.xyz`。

权威关系：

```text
本地干净 main
  -> 非强制 push
origin/main（唯一发布提交）
  -> git archive + 安全检查
Hostdzire 不可覆盖 release
  -> 迁移前备份 + full deploy + 0038
固定 partsignal-staging Compose 栈
  -> 公网/浏览器/主机验收
/root/partsignal/current（最后验收记录）
```

`current` 不是流量开关。容器在更新 `current` 前已经替换，因此任何失败都必须根据实际迁移阶段处理，不能只切回软链接。

## 2. 发布候选与本地准备

- 实施时先把任务从 `planning` 切为 `in_progress`，提交本任务规划与状态；该提交只包含 `.trellis/tasks/08-06-deploy-published-article-delete/`。
- 当前业务候选至少包含 `fdfadea` 与 `4949929`。push 前以 `git log origin/main..HEAD` 重新确认完整提交集合；发现未知业务提交时停止并重新审阅范围。
- `.playwright-cli/` 属于未跟踪的既有临时目录。使用任务专用 `mktemp -d` 暂存并设置退出恢复，避免删除用户数据，也不通过 `.gitignore` 永久隐藏工作树事实。
- 本地门禁复用已完成的功能验证证据，并补跑发布时效性最高的 `make contract-check`、后端 mypy、前端 lint/typecheck、Nginx 安全检查与 `git diff --check`。不重复运行已在隔离 PostgreSQL/E2E 通过的完整套件，除非这些检查暴露漂移。

## 3. 推送与 release 生成

1. `git fetch origin main`，确认 `main`、无 dirty path、`origin/main` 是 `HEAD` 祖先且本地 behind 为 0。
2. `git push origin main`，随后再次 fetch 并断言 `HEAD == origin/main`；任何非快进拒绝立即停止。
3. 以 `origin/main` 生成 `mvp-<yyyyMMdd-HHmmss>-<12位提交>`，使用 `git archive` 制作临时包。
4. 检查包非空、包含 `.env.example`，不包含 `.agents`、`.codex`、`.playwright-cli`、`.trellis`、真实环境文件、私钥、证书密钥或 AppleDouble 文件。
5. 上传到 `hostdzire:/root/partsignal/.incoming-<release-id>.tar.gz`，创建不可覆盖 release 并链接共享环境文件。

release ID 和归档 SHA-256 可记录；临时归档上传后从本机移除。不得输出环境文件内容。

## 4. 备份、迁移与启动

- 在新 release 的 `deploy/` 中加载共享环境到远端进程，仅用于仓库脚本，不回显变量。
- `BACKUP=$(./scripts/backup.sh)` 后只检查路径受控且文件非空。`0038` 升级不删除列或重写业务数据，因此不创建临时恢复数据库；备份仍是迁移失败和不可降级边界的必要恢复点。
- 执行 `PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh`，禁止设置 fast 模式。
- 脚本成功后，通过 Compose 内 PostgreSQL 查询 `alembic_version`，精确断言 `0038_published_article_delete`；同时检查目标 Compose 项目服务健康。
- 本次没有 Nginx 文件变化，不安装或 reload 配置，只运行 `nginx -t`。如果生效配置或安全头漂移，停止上线而不是借机修改宿主机配置。

## 5. 验收数据流

命令行验收：

- `dig @8.8.8.8` 确认既有公网入口。
- `deploy/scripts/smoke.sh https://geo.962850.xyz` 验证 `live`、`ready` 与首页。
- 验证首页、`index.html`、真实 hash asset 和 SPA fallback 的缓存头及六类项目安全头。
- 对 `/object-storage/` 执行现有非写入代理探针；不上传文件。
- SSH 只读复核 PartSignal 容器、`nginx -t`、内存与根分区。

浏览器验收使用项目 Browser 能力从本机访问真实公网：

- 未登录路由落到 `/login`，随后用运行时读取的现有管理员凭据登录。
- 只读检查 Dashboard、`/configuration/ai`、GEO 问题库和 `/publications?tab=articles`。
- 观察控制台、页面错误和失败请求；不截图密码输入态，不保存凭据，不点击任何确认型删除按钮。
- 结束时退出登录、关闭浏览器任务并清除内存中的凭据引用。

## 6. 停止与回滚矩阵

| 失败阶段 | 处理 |
| --- | --- |
| fetch/push 非快进、工作树不干净 | 不 push、不部署；保留本地状态并报告精确差异 |
| SSH 身份、环境文件、release 或备份门禁失败 | 不运行迁移；保留旧运行栈，删除动作仅限上传脚本已有的临时包 trap |
| preflight 或迁移失败 | 停止；保留新 release、备份和错误现场，旧应用继续运行，不跳过迁移 |
| 0038 已成功但新容器/公网/浏览器失败 | 不执行 downgrade，不更新 `current`；优先前滚修复。若选择旧应用，必须接受旧版管理员发布历史删除命令与新守卫不兼容并重做完整验收 |
| 数据异常且必须恢复 | 停止写流量和 Scheduler；另行确认维护窗口、数据取舍和主库恢复方案，本任务不自动覆盖主库 |
| Hostdzire 正常但公网入口异常 | 仅用 `dmit` 做只读 Nginx/listener/WireGuard 诊断，不执行写操作 |

## 7. 完成记录

只有 `current` 已切换且全部验收通过，任务才可完成。任务记录保存：发布 commit、release ID、备份非空、迁移版本、容器/公网/浏览器结论与任何未解决风险；不保存密码、Cookie、CSRF、环境变量或完整日志正文。
