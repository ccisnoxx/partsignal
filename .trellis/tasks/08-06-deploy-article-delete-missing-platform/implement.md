# 推送并部署已删平台发布成果修复：实施计划

## 阶段 0：启动与工作树收敛

- [x] 激活任务并提交规划/状态，排除 `.playwright-cli/`。
- [ ] 将 `.playwright-cli/` 暂存到任务专用临时目录，确保失败或结束时恢复。
- [ ] fetch 并确认本地 `0 behind`，复核 `origin/main..HEAD` 无未知业务提交。

## 阶段 1：发布前门禁与推送

- [ ] 运行：

```sh
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run lint
npm --prefix frontend run typecheck
node deploy/scripts/check-nginx-security.mjs
git diff --check
```

- [ ] 非强制 push `main`，再次 fetch 并断言 `HEAD == origin/main`。

## 阶段 2：完整 release、备份与迁移

- [ ] 从 `origin/main` 生成唯一 release ID 和安全归档，上传到 `hostdzire` 并创建不可覆盖 release。
- [ ] 链接现有 `0600` 环境文件，运行 `backup.sh` 并确认备份非空。
- [ ] 运行默认 full `deploy-staging.sh`，确认 preflight、迁移和服务健康。
- [ ] 断言数据库 revision 为 `0039_article_delete_platform`；只运行 `nginx -t`，不 reload。

## 阶段 3：公网与浏览器验收

- [ ] 验证 DNS、smoke、首页、缓存头、安全头、SPA fallback 与对象存储代理。
- [ ] 通过本机浏览器只读检查登录、Dashboard、AI 配置和发布成果页；不执行业务写入。
- [ ] 只读复核主机容器、Nginx、内存和磁盘；全部通过后更新 `current` 并再次 smoke。

## 阶段 4：收尾

- [ ] 恢复 `.playwright-cli/`，记录 release、备份、迁移与验收结果。
- [ ] 执行 `trellis-check`，提交部署记录，然后归档任务并记录会话；不自动重复部署或推送维护提交。

## 回滚点

- push 前失败：不产生远端发布。
- 迁移前失败：保留旧运行栈。
- 迁移后失败：不 downgrade、不更新 `current`，保留现场并优先前滚。
- 不执行主库恢复、环境修改、Nginx reload、DMIT 写操作或资产清理。
