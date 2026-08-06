# 推送并部署已删平台发布成果修复：技术设计

## 1. 发布边界

严格复用 `docs/Hostdzire部署上线流程.md` 与 `docs/Hostdzire部署附录.md`，不建立第二套部署机制：

```text
本地 main -> 非强制 push -> origin/main
origin/main -> git archive -> Hostdzire 不可覆盖 release
release -> 迁移前备份 -> full deploy -> 0039
固定 Compose 栈 -> 公网/浏览器/主机验收 -> current
```

`current` 只是最后验收记录，不是流量开关；迁移或容器替换后不能只切换软链接回滚。

## 2. 本地与推送

- 先激活并提交本任务规划。发布前暂存既有 `.playwright-cli/` 到任务专用 `mktemp -d`，以退出恢复动作保护用户文件。
- 运行与候选风险匹配的合同、类型、Lint、Nginx 安全和 diff 门禁；已有目标 PostgreSQL/前端回归证据不重复扩展为完整套件。
- fetch 后要求 `0 behind`，非强制推送并再次验证 `HEAD == origin/main`。
- release ID 使用秒级时间戳与权威提交 12 位 hash；发布包不包含代理目录、Trellis、环境文件、密钥或 AppleDouble。

## 3. 备份、迁移与启动

- 上传只到 `hostdzire`，确认 root 身份、共享环境权限和目标 release 不存在后解包并链接环境文件。
- `0039` 只替换检查约束、不重写数据，但由于数据库契约改变仍执行非空迁移前备份；不要求有损迁移的隔离恢复演练。
- 运行默认 full 部署；成功后查询 `alembic_version` 并检查固定 Compose 栈。
- Nginx 文件未变化，因此不安装、不 reload，只执行 `nginx -t` 和公网安全头复核。

## 4. 验收数据流

- 命令行：DNS、smoke、首页标题、真实 hash asset、`index.html`、SPA fallback、缓存头、六类安全头和对象存储代理。
- 浏览器：真实公网登录，检查 Dashboard、`/configuration/ai` 和 `/publications?tab=articles`；不得点击删除确认或修改数据。
- 主机：只读检查容器、Nginx、内存和磁盘；全部通过后原子更新 `current` 并再次 smoke。

## 5. 失败矩阵

| 阶段 | 处理 |
| --- | --- |
| fetch/push 分歧或工作树异常 | 停止，不 push、不部署 |
| SSH、环境、release、备份门禁失败 | 不迁移，保留旧运行栈 |
| preflight 或迁移失败 | 停止，保留 release、备份和现场 |
| 0039 后容器或验收失败 | 不 downgrade、不更新 `current`，优先前滚 |
| Hostdzire 正常但公网失败 | 仅允许 `dmit` 只读诊断 |

## 6. 记录边界

只记录发布 commit、release ID、归档摘要、备份非空、迁移版本、验收结论和剩余风险；不记录密码、Cookie、CSRF、环境变量或完整敏感日志。
