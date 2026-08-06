# 推送并部署已删平台发布成果修复：实施计划

## 阶段 0：启动与工作树收敛

- [x] 激活任务并提交规划/状态，排除 `.playwright-cli/`。
- [x] 将 `.playwright-cli/` 暂存到任务专用临时目录，确保失败或结束时恢复。
- [x] fetch 并确认本地 `0 behind`，复核 `origin/main..HEAD` 无未知业务提交。

## 阶段 1：发布前门禁与推送

- [x] 运行：

```sh
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run lint
npm --prefix frontend run typecheck
node deploy/scripts/check-nginx-security.mjs
git diff --check
```

- [x] 非强制 push `main`，再次 fetch 并断言 `HEAD == origin/main`。

## 阶段 2：完整 release、备份与迁移

- [x] 从 `origin/main` 生成唯一 release ID 和安全归档，上传到 `hostdzire` 并创建不可覆盖 release。
- [x] 链接现有 `0600` 环境文件，运行 `backup.sh` 并确认备份非空。
- [x] 运行默认 full `deploy-staging.sh`，确认 preflight、迁移和服务健康。
- [x] 断言数据库 revision 为 `0039_article_delete_platform`；只运行 `nginx -t`，不 reload。

## 阶段 3：公网与浏览器验收

- [x] 验证 DNS、smoke、首页、缓存头、安全头、SPA fallback 与对象存储代理。
- [x] 通过本机浏览器只读检查登录、Dashboard、AI 配置和发布成果页；不执行业务写入。
- [x] 只读复核主机容器、Nginx、内存和磁盘；全部通过后更新 `current` 并再次 smoke。

## 阶段 4：收尾

- [x] 恢复 `.playwright-cli/`，记录 release、备份、迁移与验收结果。
- [x] 执行 `trellis-check`，提交部署记录，然后归档任务并记录会话；不自动重复部署或推送维护提交。

## 部署结果

- 权威提交：`c34c935131c6a80e3e0dab6d86d1f80d4b53004c`，非强制推送后精确等于 `origin/main`。
- Release：`mvp-20260806-163501-c34c935131c6`；归档 SHA-256 为 `ce1fd18b41c130331eb67c9f3d9fbf4077b5026ae353c710e300905ce4c9baad`。
- 迁移前备份：`partsignal-20260806T083605Z.sql.gz`，31,226 字节，位于受控备份目录且非空。
- 完整部署：`preflight-integrity` 返回空问题集；Alembic 从 `0038_published_article_delete` 升级到 `0039_article_delete_platform`；全部服务健康，容器 restart 为 0 且无 OOM。
- 公网验收：DNS、live、ready、首页、真实 hash 资源、SPA fallback、缓存头、六类安全头和对象存储只读 404 探针通过；六次间隔 ready 探针期间无新增 upstream 错误，Nginx 配置有效。
- 浏览器验收：管理员登录、Dashboard、AI 配置和发布成果页正常；目标成果的永久删除预览返回 200，新状态文案与外部页面边界可见，确认按钮保持禁用；未执行删除或其他业务写入，控制台 0 error/0 warning，已退出并关闭命名会话。
- 最终状态：`/root/partsignal/current` 精确指向 `releases/mvp-20260806-163501-c34c935131c6`，切换后 smoke 再次通过。
- 未执行 Nginx reload、Alembic downgrade、生产数据恢复、DMIT 写操作或任何资产清理；用户原有 `.playwright-cli/` 已恢复。

## 回滚点

- push 前失败：不产生远端发布。
- 迁移前失败：保留旧运行栈。
- 迁移后失败：不 downgrade、不更新 `current`，保留现场并优先前滚。
- 不执行主库恢复、环境修改、Nginx reload、DMIT 写操作或资产清理。
