# 开发期快速重部署流程

## Goal

为频繁前后端开发提供一条可重复执行的 Hostdzire 预发布快速重部署路径，将热缓存下的常规代码发布压缩到 5–8 分钟，同时保留发布来源校验、容器健康检查、公网冒烟和验证后 `current` 指针切换。

## Background

- 当前发布前会重复运行完整契约、lint、类型检查、单元测试和前端生产构建（`docs/Hostdzire部署上线流程.md:51-76`），其中前端单测本次实测约 7 分钟。
- CI 已执行契约、lint、类型检查、单元测试、集成测试、构建和 E2E（`.github/workflows/ci.yml:54-67`）；快速重部署应复用“提交已完成质量门”的事实，不在部署阶段重复完整测试。
- 现有预发布脚本固定执行镜像构建、历史完整性门禁、数据库迁移、服务启动和账号种子（`deploy/scripts/deploy-staging.sh:14-29`）。
- Compose 已为 PostgreSQL、Redis、API、Worker 和 Scheduler 定义健康检查（`deploy/compose.staging.yaml:25-124`），可继续作为快速路径的启动门禁。
- 当前 `current` 软链接只记录通过验收的 release；Compose 使用固定项目名和回环端口更新容器，因此它不是蓝绿流量切换器（`docs/Hostdzire部署上线流程.md:422-431`）。

## Requirements

- R1. 新增一个从本地主工作目录执行的单命令快速重部署入口；不得要求操作者手工串联打包、上传、远端解压、启动、冒烟和指针切换。
- R2. 快速路径只接受干净的 `main`，且本地 `HEAD` 必须等于 `origin/main`；发布包继续来自已提交版本并执行敏感文件与 AppleDouble 检查。
- R3. 快速路径默认不运行本地完整质量门、不创建数据库备份、不运行 Alembic 迁移、不重复创建验收账号。
- R4. 快速路径继续运行只读 `preflight-integrity`、Compose 配置校验、镜像增量构建、容器 `--wait`、API/前端本机探针、Nginx 语法检查和公网 `live`、`ready`、首页检查。
- R5. 快速路径必须在任何构建或容器替换前比较当前 release 与待发布 release；当迁移目录、环境模板、预发布 Compose、预发布 Nginx 模板或底层预发布部署脚本变化时明确停止，并指引使用包含备份与迁移的完整流程。
- R6. 所有快速验收通过后才原子更新 `/root/partsignal/current`；失败时保持指针不变并输出可定位的失败，不自动吞错或伪造回滚成功。
- R7. 现有完整部署命令保持默认行为：仍执行历史完整性门禁、迁移和账号种子，数据库变更继续走备份与完整 Runbook。
- R8. 不新增依赖、第二套部署系统、分支流程、业务配置或凭据存储；SSH 继续固定使用 `/Users/sc/.ssh/config` 的 `hostdzire` alias。
- R9. Runbook 与通用运维文档必须明确快速路径适用条件、停止条件、验证范围、完整流程入口及 `current` 指针的真实语义。

## Acceptance Criteria

- [x] AC1. 操作者可用一个仓库命令完成常规代码发布，脚本输出 release ID、阶段和总耗时。
- [x] AC2. 脚本在脏工作树、非 `main`、未同步 `origin/main`、缺少共享环境文件或发布包异常时，于修改服务器运行栈前失败。
- [x] AC3. 当 `backend/alembic/versions/` 等 R5 关键路径相对当前 release 有变化时，快速路径在镜像构建和容器重建前失败，且不切换 `current`。
- [x] AC4. 快速模式的远端部署调用中不存在数据库备份、`alembic upgrade head` 或 `seed-demo`，但存在 `preflight-integrity`、服务健康等待和 HTTP 探针。
- [x] AC5. 完整模式未传快速参数时的迁移与账号种子行为保持不变。
- [x] AC6. 公网 `live`、`ready` 和首页任一失败时命令非零退出且不更新 `current`；全部通过后 `readlink /root/partsignal/current` 等于新 release。
- [ ] AC7. 热 Docker 缓存、无关键部署文件变化且网络正常时，单命令端到端目标为 5–8 分钟；冷缓存或网络变慢允许超时目标，但必须打印实际耗时。
- [x] AC8. Shell 语法、模式分支的命令序列、Compose 展开和文档一致性通过定向验证；不要求为本次纯部署脚本变更重复运行全部前后端单测。

## Out of Scope

- 不实现蓝绿发布、双端口流量切换、Kubernetes、CI/CD 平台或自动推送。
- 不删除或放宽完整部署流程中的备份、迁移、恢复验证和浏览器全面验收。
- 不为快速路径自动执行数据库 downgrade、自动回滚容器或清理旧 release、镜像、备份和持久数据。
- 不修改 API、数据库契约、权限、业务字段、前端页面或运行时业务逻辑。
