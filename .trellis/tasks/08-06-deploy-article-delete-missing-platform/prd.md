# 推送并部署已删平台发布成果修复

## 目标

把当前 `main` 中已验证但未推送的发布成果删除修复同步到 `origin/main`，再按 Hostdzire 完整发布流程部署到公开环境 `https://geo.962850.xyz`。上线必须完成迁移前备份、数据库升级到 `0039_article_delete_platform`、容器与公网健康检查以及登录后只读浏览器验收。

## 已确认事实

- 本地 `main` 为 `79a82c6a62132206d465ba03110e3550e466359a`，相对 `origin/main=4829a858457457ebdd248c18427396bdc91a4f52` 为 `0 behind / 6 ahead`；业务修复提交为 `7966302`，其余为 Trellis 部署/修复归档和会话记录。
- 候选新增 `backend/alembic/versions/0039_published_article_delete_missing_platform.py`，因此命中完整发布门禁，禁止快速重部署。
- 当前公开环境 release 为 `mvp-20260806-152447-4829a8584574`，数据库 revision 为 `0038_published_article_delete`；PartSignal 容器健康，Nginx 配置有效，共享环境文件权限为 `0600`，根分区剩余约 50 GiB。
- 候选未修改 `.env.example`、staging Compose、Nginx 模板、安全 snippet 或部署脚本；本次不更新或 reload Nginx。
- 工作树只有本任务目录和会话开始前已有的 `.playwright-cli/`。该临时目录不得提交或进入发布包。

## 要求

### 1. 发布来源与推送

- 任务激活后先提交本任务规划与状态，不修改业务代码或重写历史。
- 推送前重新 fetch；只允许本地 `0 behind`，远端分歧、非快进或未知 dirty path 均停止，不 force push、不自动合并。
- 临时、可恢复地移出 `.playwright-cli/`，结束或失败时恢复；发布包必须由已推送的 `origin/main` 用 `git archive` 生成并通过敏感文件检查。
- `git push origin main` 后断言 `HEAD == origin/main`，以权威提交生成唯一 release ID。

### 2. 完整发布与数据库边界

- 远端写操作只通过 SSH alias `hostdzire`；不对 `dmit` 执行写操作。
- 正常升级只链接现有 `/root/partsignal/shared/.env.staging`，不得输出、下载、覆盖或重建配置和密钥。
- 创建不可覆盖 release；迁移前执行 `backup.sh` 并确认备份非空，不清理旧 release、镜像、备份或持久数据。
- 运行默认 `full` 的 `deploy/scripts/deploy-staging.sh`，不得跳过 Compose 校验、镜像构建、`preflight-integrity`、迁移、健康等待或种子步骤。
- 迁移后精确断言 `alembic_version=0039_article_delete_platform`。失败时保留现场，不执行 Alembic downgrade。

### 3. 验收与 current

- 验证公网 DNS、`live`、`ready`、首页、缓存头、安全头、SPA fallback 和对象存储代理。
- 从本机真实公网域名完成管理员登录后的只读浏览器验收，检查 Dashboard、AI 配置和发布成果页；不执行永久删除或其他生产业务写入，不输出或持久化凭据。
- 最终只读复核 Hostdzire 容器、Nginx、内存和磁盘；全部通过后才原子更新 `/root/partsignal/current`。

### 4. 停止与回滚

- push 前失败不产生远端发布；迁移前失败继续使用旧 release。
- 迁移成功后禁止 downgrade，优先前滚修复；只切换 `current` 不能回滚运行容器。
- 生产主库恢复、环境文件修改、Nginx reload、DMIT 写操作和资产清理均不在本任务授权范围。

## 验收标准

- [ ] `main` 非强制推送成功，`HEAD == origin/main`，发布包来自该权威提交。
- [ ] 新 release 不可覆盖，共享环境文件权限保持 `0600`，迁移前备份非空。
- [ ] 完整部署成功，数据库为 `0039_article_delete_platform`，全部服务健康。
- [ ] 公网健康、缓存、安全头、SPA 和对象存储代理检查通过，Nginx 配置有效。
- [ ] 登录后浏览器只读验收通过，发布成果页正常，不执行生产业务写入。
- [ ] 全部验收通过后 `current` 精确指向新 release，并记录 commit、release、备份、迁移和验收结果。

## 范围外

- 修改业务代码、API、迁移、部署脚本、Nginx 或共享环境配置。
- 清理 `.playwright-cli/`、旧 release、镜像、备份、线上测试数据或持久文件。
- 在生产执行永久删除、Alembic downgrade、主库恢复、外部 AI 生成或其他写入型业务回归。

## 批准状态

- 用户已明确批准创建本部署任务后立即开始执行。
