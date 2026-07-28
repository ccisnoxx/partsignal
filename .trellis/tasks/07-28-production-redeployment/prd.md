# 按部署文档重新部署上线

## Goal

依据仓库权威 Hostdzire Runbook，把最终确认并推送到 `origin/main` 的 PartSignal 版本完整发布到 `https://geo.962850.xyz` 预发布环境，在有损数据库迁移前取得可恢复证据，并完成公网、登录后浏览器与回滚边界验收。

## Confirmed Facts

- 文档把目标定义为 Hostdzire 预发布环境，Compose 项目为 `partsignal-staging`；本任务不授权部署另一套未记录的 production 环境。
- Hostdzire 当前 `current` 为 `mvp-20260727-214246-ccdab3b2f7f9`，数据库 revision 为 `0028_platform_logo_lifecycle`，共享环境文件权限为 `0600`，现有容器、Nginx 与公网健康检查正常。
- 待发布数据库 head 包含 `0029_geo_evidence_management` 和 `0030_publication_record_delete`。`0029` 会删除人工逐篇结果的 `recommendation_status/cited` 列，不能通过 Alembic downgrade 恢复旧值。
- 现场有 1 条人工观测和 1 条人工逐篇结果，该逐篇结果在待删除字段中存在非空值；批准本部署计划即确认接受已批准业务模型带来的这项旧字段删除。
- Hostdzire 共享环境没有 `VERIFY_DATABASE_URL`，宿主机也没有 `psql`；端口 `127.0.0.1:19002` 空闲，`postgres:16-alpine` 镜像已存在。
- 本地 `main` 当前 HEAD 为 `1417c02`，比 `origin/main=ccdab3b` 领先 5 个提交，同时存在 108 项其他并行工作改动，因此尚不满足制作 release 的门禁。

## Requirements

- 必须走完整发布，不得使用或强制开启 fast 模式；迁移目录变化和有损迁移均已关闭快速发布资格。
- release 只能从干净、已推送且与 `origin/main` 完全一致的本地主工作目录制作。不得部署脏工作树、临时 worktree、旧 release 或未推送提交。
- 不得覆盖、暂存、回退或清理当前 108 项并行改动。其所有者完成提交和验证后，再确定唯一待部署 commit；推送仍需用户明确确认。
- 在维护窗口开始前完成与目标 commit 相称的本地测试、迁移测试、契约检查和 Nginx 安全检查。
- 正常升级只链接 Hostdzire 既有 `/root/partsignal/shared/.env.staging`，不得读取整个文件、下载、重建或输出其中的任何凭据。
- 有损迁移前必须停止旧 API、Worker 和 Scheduler，生成权限受限的非空备份，校验 gzip 与 SHA-256，并在全新一次性 PostgreSQL 16 中恢复和执行 `0028 -> 0030` 迁移彩排。
- 一次性恢复库不得共享 staging 数据卷或数据库身份；其随机凭据只存在执行进程内存，验证结束后删除临时容器和网络，保留正式备份及校验和。
- Hostdzire 缺少文档要求的 PostgreSQL 客户端；执行阶段只允许从 Debian 官方仓库安装 `postgresql-client`，安装失败或版本不可用即停止。
- 维护窗口从停止旧写入口开始，到新版本完整验收并恢复 Worker/Scheduler 为止。期间不得由其他操作者创建或修改业务数据。
- 执行默认 full 部署，必须通过 Compose、镜像构建、`preflight-integrity`、Alembic、容器健康、回环探针和幂等种子账号。
- 若目标 commit 改动 staging Nginx 模板或项目安全 snippet，必须从同一个 release 更新二者，`node deploy/scripts/check-nginx-security.mjs` 与 `nginx -t` 通过后才可 reload。
- `current` 只能在公网、缓存、安全头、对象存储代理、登录后 Playwright CLI 和主机验收全部通过后原子更新。
- 不自动执行 Alembic downgrade、主库覆盖恢复、release/镜像/备份/持久数据清理或 DMIT 写操作。

## Acceptance Criteria

- [ ] 用户批准本计划、维护窗口和有损迁移边界，并在执行前批准最终 `origin/main` 推送。
- [ ] 本地主工作目录位于 `main`、工作树为空，`HEAD == origin/main`，目标 commit 与 release ID 被明确记录。
- [ ] 目标 commit 的定向测试、迁移测试、契约检查、构建及 Nginx 安全检查全部通过。
- [ ] Hostdzire 身份、目录、共享环境权限、磁盘、内存、Docker/Compose、Nginx 和 PostgreSQL 客户端前置条件全部通过。
- [ ] 最终备份非空、权限受限、`gzip -t` 与 SHA-256 通过；全新隔离数据库恢复后 revision、关键计数和旧字段计数与迁移前一致。
- [ ] 隔离数据库成功从 `0028` 升级到 `0030_publication_record_delete`；人工观测、逐篇结果和发布记录数量保持，只有批准删除的两列消失。
- [ ] 正式数据库 revision 为 `0030_publication_record_delete`，API、前端、Worker、Scheduler、PostgreSQL、Redis 和 fake-oss 健康。
- [ ] 公网 live/ready、首页、真实哈希资源缓存、SPA fallback、对象存储代理及六项项目安全头全部通过。
- [ ] Playwright CLI 使用真实公网域名完成未登录跳转、登录、工作台和 `/configuration/ai` 只读验收，控制台无应用级 error/warning；凭据不出现在命令输出、快照、截图、文件或 storage state。
- [ ] 全部验收后 `current` 指向新 release，Worker/Scheduler 恢复且最终主机资源正常；至少保留一个已验证旧 release、对应镜像和迁移前备份。

## Stop Conditions

- 本地工作树不干净、目标 commit 未推送、SSH 主机身份异常或主机密钥冲突。
- 用户没有确认维护窗口或旧字段删除，无法建立隔离恢复库，或者 `psql`、备份、恢复、迁移彩排失败。
- `preflight-integrity`、Alembic、容器健康、Nginx、安全头、公网、对象存储或浏览器任一验收失败。
- 迁移后出现故障且需要覆盖主库恢复：保留停写和现场，停止自动操作，等待负责人确认恢复点与数据取舍。

## Out of Scope

- 不部署未在 Runbook 中定义的正式 production 环境。
- 不借部署任务完成 PageSpeed、主题、安全头或其他并行代码改动。
- 不清理旧 release、镜像、备份、对象存储或 `/root/partsignal-data`。
- 不修改 DMIT、真实环境凭据、AI 渠道配置或业务数据。
