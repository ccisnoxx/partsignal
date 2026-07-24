# 部署 Runbook 收敛

## Goal

以当前快速重部署脚本和完整部署脚本为事实源，重写 Hostdzire 预发布部署文档，使日常操作者先看到正确的部署决策与单命令入口，同时保留首次初始化、迁移、回滚和排障所需的安全信息。

## Background

- 日常快速入口已实现为 `make staging-redeploy-fast`，但 Runbook 直到 `docs/Hostdzire部署上线流程.md:347` 才介绍该路径，前 300 余行仍按首次/完整发布组织。
- `docs/Hostdzire部署上线流程.md:53` 要求只部署已提交并推送的 `main`，但 `:171` 仍保留“未提交验收版本”路径。
- `docs/Hostdzire部署上线流程.md:156-160` 的 release ID 仍只有分钟时间戳，与快速脚本的秒级时间戳和 commit hash 不一致。
- `docs/operations.md:58` 要求在本地仓库创建 `.env.staging`，与服务器唯一共享环境文件 `/root/partsignal/shared/.env.staging` 冲突，可能诱导凭据落入本地工作树。
- `docs/operations.md:98` 仍称前端通过软链接切换，但当前 Compose 在 `current` 更新前已经替换容器；`current` 只记录最后验收的 release。
- 两份文档重复维护 Hostdzire 命令、验收和回滚事实，已经发生表述漂移。

## Requirements

- R1. Runbook 顶部必须提供部署决策表，并把“普通前后端代码、无迁移/关键配置变化”明确路由到 `make staging-redeploy-fast`。
- R2. 快速部署章节必须位于完整部署之前，准确描述脚本已自动执行的来源校验、发布包检查、关键路径门禁、构建、健康检查、公网冒烟和 `current` 更新；不得要求操作者重复手工步骤。
- R3. 完整部署只用于首次启用、迁移、`.env.example`、预发布 Compose、Nginx 模板、底层部署脚本变化，以及认证/权限/路由等需要完整浏览器验收的高风险变更。
- R4. 删除未提交工作树部署路径。所有路径都只允许干净、已推送且与 `origin/main` 一致的 `main`。
- R5. 主 Runbook 只保留完整发布的适用条件、入口、停止条件和验收要求；“秒级时间戳 + commit hash”的 release ID、发布包检查、数据库备份、迁移和 Nginx 更新等低频操作统一放入独立附录。
- R6. 首次环境创建、密钥生成、基础设施安装、完整手工打包、备份恢复和详细排障统一移入独立附录；明确正常升级只复用服务器共享 `.env.staging`，不得在仓库创建或复制真实环境文件。
- R7. 把快速与完整流程的停止条件、验收范围和浏览器要求分开，不再把备份/迁移/UI 门禁描述成每次快速重部署的共同步骤。
- R8. 回滚描述必须反映固定 Compose 项目和端口的真实行为：切换 `current` 不能回滚运行容器；应用回滚需要从兼容的旧 release 用旧镜像标签重启，数据库默认不 downgrade。
- R9. `docs/operations.md` 只保留稳定原则和 Runbook/附录入口，不承载任何可执行部署命令；删除本地 `.env.staging`、旧迁移 revision 清单和“前端软链接切流”等重复或时效性事实。
- R10. 服务器连接统一显式使用 `/Users/sc/.ssh/config`：应用部署和常规运维只使用 `hostdzire`，`dmit` 只用于公网入口异常时的只读排障；删除无关 `aaitr`。保留 Hostdzire/DMIT 边界、端口、持久数据、对象存储、凭据保护、Nginx `proxy_protocol`、备份恢复和公网 E2E 安全边界。
- R11. 本任务只修改文档与 Trellis 任务记录，不修改脚本、Compose、Nginx、业务代码、契约或服务器状态。
- R12. `docs/Hostdzire部署上线流程.md` 控制在约 100–150 行，只保留部署决策、快速入口、完整发布入口、停止条件、验收和回滚摘要。
- R13. 新增一个部署附录作为首次初始化、完整手工发布、环境文件、备份恢复和详细排障的唯一事实源；主 Runbook 与 `operations.md` 只链接，不复制。

## Acceptance Criteria

- [x] AC1. Runbook 首屏能在一次阅读内回答“何时快速、何时完整、执行什么命令”。
- [x] AC2. `rg` 不再找到“未提交验收版本”、本地创建 `.env.staging`、分钟级无 commit release ID 或“前端通过软链接切换”旧表述。
- [x] AC3. 快速路径的资格门禁列表与 `deploy/scripts/redeploy-staging-fast.sh` 完全一致。
- [x] AC4. 完整路径的命令顺序与 `deploy/scripts/deploy-staging.sh`、`backup.sh` 和当前 Compose 一致。
- [x] AC5. 三份部署文档对共享环境文件、`current` 语义、浏览器验收和数据库回滚没有冲突。
- [x] AC6. 首次初始化、完整部署、快速部署、回滚和常见故障仍各有唯一可执行入口，没有丢失密钥保护、备份或恢复边界。
- [x] AC7. 所有仓库内 Markdown 链接与命令路径有效，`make test-deploy-scripts` 和 `git diff --check` 通过。
- [x] AC8. SSH 示例只使用 `/Users/sc/.ssh/config` 中的 `hostdzire` 与 `dmit`；任何部署写操作都不发送到 `dmit`。
- [x] AC9. 主 Runbook 为 100–150 行，日常操作者无需阅读附录即可完成普通快速重部署。
- [x] AC10. 独立附录完整承接首次初始化、环境文件生成、完整手工打包、备份恢复和详细排障，原有安全边界没有丢失。
- [x] AC11. `docs/operations.md` 不包含 shell 命令块或可执行部署步骤，只保存跨环境稳定原则以及 Runbook/附录链接。

## Out of Scope

- 不修改或重新设计快速/完整部署脚本。
- 不执行真实部署、推送、数据库备份、迁移、回滚或服务器清理。
- 不补建 CI/CD、蓝绿发布、第二套环境或新的凭据管理机制。
- 不重写与 Hostdzire 预发布无直接关系的产品、API、数据库或业务方案文档。
