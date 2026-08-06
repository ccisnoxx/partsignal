# 推送并重新部署生产环境：实施计划

## 阶段 0：启动与工作树收敛

- [x] 用户在本规划摘要之后明确批准执行完整发布。
- [x] 运行 `task.py start`，确认任务进入 `in_progress`；使用 `trellis-before-dev` 加载 infra 与部署约束。
- [ ] 提交本任务规划/状态，提交计划为 `chore(task): plan production deployment`；不得混入业务代码或 `.playwright-cli/`。
- [ ] 将既有 `.playwright-cli/` 移入任务专用临时目录并注册恢复动作；确认 `main` 工作树为空。
- [ ] 重新 fetch 并核对 `origin/main..HEAD` 的全部提交，要求本地 behind 为 0，候选仍包含 `fdfadea` 与 `4949929`，没有未知业务提交。

## 阶段 1：发布前验证与 push

- [ ] 运行发布前最小门禁：

```bash
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run lint
npm --prefix frontend run typecheck
node deploy/scripts/check-nginx-security.mjs
git diff --check
```

- [ ] 若门禁失败，只处理能证明由候选引起且属于发布范围的问题；规划或代码改变后重新提交并重新展示必要的发布差异。
- [ ] 执行 `git push origin main`，再次 fetch 并断言 `HEAD == origin/main`；不 force push。

## 阶段 2：完整 release、备份与迁移

- [ ] 按附录 4.1 从 `origin/main` 生成唯一 release ID 和安全归档，验证不包含代理/Trellis/浏览器目录、环境文件、密钥或 AppleDouble。
- [ ] 仅上传到 `hostdzire`，确认 root 身份、共享环境文件存在且权限 `0600`、目标 release 不存在，解包并链接现有环境文件。
- [ ] 在迁移前运行 `backup.sh`，确认返回文件位于 `/root/partsignal/backups` 且非空；不输出环境或备份内容。
- [ ] 运行默认 full 模式 `deploy-staging.sh`，不跳过 `preflight-integrity`、迁移、健康等待或种子步骤。
- [ ] 查询并断言 `alembic_version=0038_published_article_delete`，检查 `partsignal-staging` 全部服务健康。
- [ ] 因 Nginx 文件未变化，不安装或 reload；仅运行 `nginx -t` 并验证当前配置继续有效。

## 阶段 3：公网与浏览器验收

- [ ] 运行公共 DNS、`deploy/scripts/smoke.sh`、首页标题、缓存头、安全头、SPA fallback 与对象存储代理只读检查。
- [ ] 使用 Browser 从本机真实公网登录，检查 `/`、`/configuration/ai`、GEO 问题库与 `/publications?tab=articles`；确认新删除能力按投影出现，但不执行任何生产写入。
- [ ] 验证浏览器控制台无应用级 error/warning、关键请求无失败；退出登录并关闭本任务浏览器状态。
- [ ] SSH 只读复核 PartSignal 容器、Nginx、内存与磁盘；不清理 release、镜像、备份或持久数据。
- [ ] 全部通过后原子更新 `/root/partsignal/current`，并核对链接精确指向本次 release。

## 阶段 4：收尾

- [ ] 恢复本地 `.playwright-cli/`，确认没有丢失或覆盖原目录。
- [ ] 记录发布 commit、release ID、备份非空、迁移版本和验收结果；敏感信息不得进入任务或日志。
- [ ] 使用 `trellis-check` 核对完成条件；失败现场按 `design.md` 矩阵处理，不把部分成功标记为完成。
- [ ] 完成后执行 `trellis-finish-work` 归档任务并记录会话。归档/日志提交不自动进行第二次生产部署。

## 风险与回滚点

- push 前：任何远端分歧或未知 dirty path 都停止。
- 迁移前：旧 release 仍是权威；备份为空时停止。
- 迁移后：禁止 downgrade；新代码失败时优先前滚，旧 release 仅在接受发布历史删除兼容限制后使用。
- `current` 更新前：新容器可能已承载流量，不能只切换软链接回滚。
- 任何真实主库恢复、环境文件变更、Nginx reload、DMIT 写操作或资产清理都需要新的明确授权。

## 完成条件

- [ ] `prd.md` 全部验收标准满足。
- [ ] 推送、完整部署、0038 迁移、公网验收、浏览器只读验收和 `current` 更新均有实际证据。
- [ ] 没有生产业务写入、凭据泄露、未授权清理、静默绕过或未说明的兼容风险。
