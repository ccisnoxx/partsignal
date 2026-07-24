# 部署 Runbook 收敛设计

## 1. 文档职责

- `docs/Hostdzire部署上线流程.md`：Hostdzire 预发布主 Runbook，只包含部署选择、快速/完整入口、停止条件、验收和回滚摘要。
- `docs/Hostdzire部署附录.md`：低频操作唯一附录，承接首次初始化、环境文件生成、完整手工打包、备份恢复和详细排障。
- `docs/operations.md`：只保存跨环境稳定运维原则，并链接 Runbook 与附录；不包含 shell 命令块，不复制 Hostdzire 操作步骤、历史迁移 revision 或首次生成密钥脚本。
- 部署脚本与 Compose：运行行为事实源。文档描述它们，不创建第二套隐含流程。

## 2. Runbook 目标结构

```text
1. 部署决策
2. 固定边界
3. 停止条件
4. 日常快速重部署
5. 完整发布入口
6. 验收
7. 回滚摘要
```

快速流程只展示操作者真正需要执行的命令：

```sh
git pull --ff-only origin main
make staging-redeploy-fast
```

脚本内部细节以简短步骤和停止条件说明，不复制 Shell 实现。主 Runbook 控制在约 100–150 行；低频命令全部链接到独立附录。

## 3. 部署决策

| 条件 | 路径 |
| --- | --- |
| 普通前后端代码；关键路径未变化 | 快速重部署 |
| Alembic、`.env.example`、staging Compose、staging Nginx 模板或 `deploy-staging.sh` 变化 | 完整发布 |
| 首次把当前部署机制上线；服务器无 `current` 或共享环境文件 | 完整发布/首次初始化 |
| 认证、权限、路由、全局壳层等高风险 UI 变化 | 完整发布并执行登录后浏览器验收 |
| 快速脚本主动拒绝 | 停止，不绕过；按提示走完整发布 |

关键路径列表只在决策表和快速章节定义一次，其他章节引用该定义。

## 4. 环境文件与凭据

真实 staging 配置唯一位置为 `/root/partsignal/shared/.env.staging`，权限 `0600`。每个 release 只建立指向该文件的软链接；正常部署不在本地创建 `.env.staging`，不重新生成数据库密码或 `AI_CREDENTIAL_ENCRYPTION_KEY`。首次生成逻辑保留在独立附录，并明确只能在 Hostdzire 上执行。

## 5. `current` 与回滚

`current` 是最后完成相应验收范围的 release 记录，不是流量开关。快速和完整部署均通过固定 Compose 项目与固定回环端口替换容器。失败后若容器已更新，应进入数据库契约兼容的旧 release，用旧镜像标签重启服务，再更新 `current`；不得只改软链接或默认执行 Alembic downgrade。

## 6. 删除与保留

删除：

- 未提交工作树部署；
- 本地 `.env.staging` 创建；
- 分钟级无 commit 的 release ID；
- 历史 revision 逐条回滚说明；
- “前端软链接切流”表述；
- 两份文档之间重复的 Hostdzire 命令。
- 主 Runbook 中的首次初始化、完整手工打包、备份恢复和详细排障正文。

保留：

- `/Users/sc/.ssh/config` 中 `hostdzire`（部署/运维）与 `dmit`（入口只读排障）的 SSH 边界；
- 发布包安全检查；
- 备份、恢复验证和主密钥边界；
- 快速脚本自动验收与完整流程浏览器验收差异；
- Nginx、缓存、对象存储、E2E 安全限制；
- 故障原因与恢复入口。

## 7. 兼容性

不改变任何运行行为。重写后的完整流程仍能用于当前首次上线快速部署机制；快速入口仍由脚本自动判断资格。README 现有 Runbook 链接保持有效，新增附录链接。

所有 SSH 示例显式传入 `-F /Users/sc/.ssh/config`。`hostdzire` 是唯一允许接收上传、release 创建、Compose、Nginx 和 `current` 写操作的 alias；`dmit` 只保留入口链路异常时的只读探测。
