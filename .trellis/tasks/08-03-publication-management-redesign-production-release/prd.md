# 发布管理重构生产上线

## 目标

按现有 Hostdzire Runbook，将已推送的本地 `main` 直接重新部署到 `https://geo.962850.xyz`，并确认公网健康；不新建另一套 production 环境。

## 已确认事实

- 本地 `main` 已干净并与 `origin/main` 一致，发布管理重构、E2E 恢复及 Trellis 归档提交均已推送。
- 发布管理重构把旧混合状态机替换为发布工作、追加核验、只读发布成果和发布后问题；数据库 head 为 `0034_publication_redesign`。
- 本地与 Hostdzire 预发布数据库已按批准边界重建；预发布 UAT 已通过“首次核验失败后复核成功”和“带原因显式关闭”两条分支。
- 部署目标固定为现有 `https://geo.962850.xyz`、SSH 别名 `hostdzire`、Compose 项目 `partsignal-staging` 和共享配置 `/root/partsignal/shared/.env.staging`。
- Hostdzire 当前验收版本为 `mvp-20260803-174950-deb4286ea0c8`，公网 `live`、`ready` 与首页冒烟检查通过。
- 当前 `HEAD` 与 `origin/main` 均为 `ae8633b6cd804544d02a14aaeea948d8a6f5d25b`；相对已部署代码提交只新增 Trellis 归档与日志，没有运行时代码、数据库迁移或快速发布六个门禁路径变化。
- 数据库已经在上一任务中重建并迁移至 `0034_publication_redesign`，同版本发布链路 UAT 已通过；本次不再次重建、恢复或迁移数据库。

## 需求

- R1：仅执行 `make staging-redeploy-fast`，由脚本完成来源、目标、归档、配置、镜像、容器、Nginx、公网探针和 `current` 门禁；不得手工绕过快速发布拒绝条件。
- R2：部署来源必须是干净、已推送且与 `origin/main` 一致的 `main`；新 Trellis 任务文件需先形成独立规划提交，不能把脏工作树带入 release。
- R3：正常升级只复用 Hostdzire 现有受保护共享配置，不读取、下载、输出或重建真实秘密。
- R4：本次不修改、清空、恢复或迁移数据库，不创建业务数据，不重复执行已经完成的发布链路 UAT。
- R5：快速脚本或公网冒烟任一失败即停止，不手工更新 `current`，不清理 release、镜像、备份或持久数据。

## 验收标准

- [ ] AC1：部署前工作区干净，分支为 `main`，且 `HEAD == origin/main`。
- [ ] AC2：`make staging-redeploy-fast` 成功完成并产生不可覆盖的新 release，`current` 指向该 release。
- [ ] AC3：部署后容器、API `live`、API `ready`、PostgreSQL、Redis 与前端首页均通过脚本检查。
- [ ] AC4：再次执行 `deploy/scripts/smoke.sh https://geo.962850.xyz` 通过，并记录 release ID；全过程不输出秘密。

## 范围外

- 不继续修改发布管理业务逻辑或部署脚本。
- 不新建 production 环境，不修改 DMIT、公网 DNS、Nginx 模板或其他 Hostdzire 项目。
- 不执行完整发布、数据库备份/重建/恢复、浏览器写入式 UAT 或生产凭据接入。
- 不新增 CI/CD、蓝绿发布或其他发布框架。
