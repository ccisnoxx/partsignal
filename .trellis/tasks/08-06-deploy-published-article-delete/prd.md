# 推送并重新部署生产环境

## Goal

把当前 `main` 中已经完成并验证、但尚未推送的业务变更同步到 `origin/main`，再按 Hostdzire 完整发布流程部署到公网环境 `https://geo.962850.xyz`。上线必须完成迁移前备份、数据库 `0038` 升级、容器与公网健康检查以及登录后只读浏览器验收；任一门禁失败都停止，不把未验收 release 标记为 `current`。

## Background and Confirmed Facts

- 2026-08-06 只读预检确认：公网当前 release 为 `mvp-20260806-092110-c992510aef2c`，`origin/main` 也是 `c992510aef2c`，数据库 revision 为 `0037_simplify_deletion_lifecycle`。
- 当前 Hostdzire 的 PartSignal PostgreSQL、Redis、Worker、Scheduler、API 和前端容器健康，Nginx 配置校验通过；根分区约剩余 50 GiB，环境文件权限为 `0600`，备份目录已有 44 个文件。
- 本地 `main` 相对 `origin/main` 为 `0 behind / 8 ahead`。未推送候选不仅包含 `4949929 feat: 支持受控永久删除发布成果`，还包含 `fdfadea feat: 支持删除未引用的 GEO 问题`，其余为对应验收、归档和日志提交。
- 候选新增 `backend/alembic/versions/0038_published_article_delete.py`，因此命中 Runbook 的迁移门禁，禁止使用快速重部署，必须走完整发布。
- `0038` 的升级只替换归档状态约束并增加删除守卫函数/触发器，不删除或重写既有业务行；`downgrade()` 明确以 PostgreSQL `55000` 拒绝。已有数据仍必须先生成非空备份，但不满足“删除列、数据重写或其他有损升级”的隔离恢复强制条件。
- 候选未修改 `.env.example`、staging Compose、Nginx 模板、安全 snippet 或部署脚本；本次不更新或 reload Nginx，只执行 `nginx -t` 和公网安全头复核。
- 工作树还包含本任务规划目录和会话开始前已有的未跟踪 `.playwright-cli/`。部署来源必须在 `main` 上已提交、已推送且工作树干净；不得把该临时目录加入提交或发布包。

## Requirements

### 1. 发布来源与推送

- 实施获批后执行 `task.py start`，把本部署任务的规划/状态作为单独 Trellis 提交记录到 `main`；不得修改业务代码或重写现有提交。
- 在推送前重新 `git fetch origin main`，只允许本地保持 `0 behind`。远端出现新提交、非快进或未知 dirty path 时停止，不 force push、不自动合并。
- 临时、可恢复地移出 `.playwright-cli/`，部署结束或停止后恢复；发布包必须由已推送的 `origin/main` 使用 `git archive` 生成，并通过代理目录、环境文件、密钥和 AppleDouble 检查。
- `git push origin main` 成功后必须验证 `HEAD == origin/main`，以该提交的 12 位 hash 生成唯一 release ID。

### 2. 完整发布与数据库边界

- 写操作只允许通过 SSH alias `hostdzire`；`dmit` 仅在 Hostdzire 正常但公网异常时用于只读入口诊断。
- 正常升级只链接现有 `/root/partsignal/shared/.env.staging`，不得读取、下载、覆盖或重新生成密钥与环境配置。
- 创建不可覆盖的 release，迁移前调用仓库 `backup.sh` 并确认备份非空；不清理任何旧 release、镜像、备份或持久数据。
- 在新 release 中运行默认 `full` 的 `deploy/scripts/deploy-staging.sh`：Compose 校验、镜像构建、只读 `preflight-integrity`、`alembic upgrade head`、Worker/Scheduler/API/前端健康等待及幂等种子检查不得跳过。
- 迁移后必须只读确认 `alembic_version=0038_published_article_delete`。任何 preflight、迁移、构建、容器健康或回环探针失败都停止并保留现场。

### 3. 上线验收与 current

- 公网执行 DNS、`live`、`ready`、首页标题、缓存头、安全头与对象存储代理检查；持续失败不得用重试或固定成功掩盖。
- 使用本机浏览器通过真实公网域名完成只读登录验收：登录路由、Dashboard、`/configuration/ai`、GEO 问题库和发布成果页可正常渲染，控制台无应用级 error/warning，关键请求无失败。
- 浏览器验收只在运行时内存使用既有管理员凭据，不输出、不写临时文件；不创建、编辑或删除线上业务数据。
- 两项新能力只验证入口投影和页面可用性，不实际执行永久删除：GEO 问题库展示服务端删除/阻断动作，发布成果页展示永久删除或精确删除条件。
- 通过 Hostdzire 容器状态、Nginx、内存和磁盘的最终只读复核后，才原子更新 `/root/partsignal/current` 到本次 release。

### 4. 失败与回滚

- push 前失败不产生远端发布；release 上传后失败保留新 release 供诊断，不删除现场。
- 数据库迁移前失败时继续使用旧 release；迁移后失败时不得执行 Alembic downgrade。
- `0038` 后旧应用的大多数读取与业务流程仍可运行，但旧版本不设置新发布历史删除上下文，回滚会使部分管理员永久删除命令失败。因此迁移后优先前滚修复；只有明确接受该兼容限制并完成完整复验时才重启旧 release。
- 只有确认需要恢复迁移前数据且已批准维护窗口与数据取舍时，才使用迁移前备份设计主库恢复；本任务不自动覆盖生产数据库。

## Acceptance Criteria

- [ ] `main` 以非强制方式推送成功，推送后本地 `HEAD` 与 `origin/main` 完全一致，发布包来自该权威提交。
- [ ] Hostdzire 创建唯一新 release，链接既有 `0600` 环境文件，迁移前备份文件非空且未清理任何历史资产。
- [ ] 完整部署脚本成功，PostgreSQL revision 为 `0038_published_article_delete`，PartSignal 全部容器健康且回环 API/前端探针通过。
- [ ] 公网 `live`、`ready`、首页、缓存头、安全头和对象存储代理验收通过，Nginx 配置有效。
- [ ] 真实浏览器只读验收通过登录、Dashboard、AI 配置、GEO 问题库与发布成果页；控制台和关键请求无应用级失败。
- [ ] GEO 问题删除与发布成果永久删除入口按服务端投影显示，但线上验收不修改或删除任何业务数据。
- [ ] 只有全部验收通过后 `current` 才指向新 release；失败时保留旧 `current` 或按已确认兼容边界处理，不伪造成功。
- [ ] 部署结果记录 release ID、权威 commit、备份存在性、迁移版本、验收结论和剩余风险，不包含任何凭据。

## Out of Scope

- 修改本次候选的业务代码、API、数据库迁移、部署脚本、Nginx 或共享环境配置。
- 清理 `.playwright-cli/`、早期共享开发库 E2E 残留、线上测试数据、旧 release、镜像、备份或持久文件。
- 在生产实际执行 GEO 问题删除、发布成果永久删除或其他写入型业务回归。
- Alembic downgrade、生产主库覆盖恢复、DMIT 写操作、DNS/证书/防火墙调整或真实外部 AI 生成。

## Planning Status

- 阻断性产品、范围、兼容与风险问题：无。
- 用户已批准最新规划摘要，任务已进入执行阶段。
