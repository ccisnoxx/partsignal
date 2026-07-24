# 开发期快速重部署流程设计

## 1. 边界

保留现有完整部署脚本作为安全默认值，在其上增加显式 `fast` 模式；新增本地编排脚本和 Make 入口负责把现有 Runbook 的机械步骤收敛为一个命令。快速路径只服务于“数据库与部署配置未变化的已提交代码发布”。

不引入新部署框架。继续使用 Git archive、OpenSSH、Docker Compose、宿主机 Nginx、现有 release 目录和 `current` 软链接。

## 2. 命令与数据流

```text
make staging-redeploy-fast
  → 校验 clean main 与 HEAD == origin/main
  → 从 HEAD 生成并检查 release archive
  → scp 到 hostdzire，新建 release 并链接共享 .env.staging
  → 与 current release 比较关键部署/迁移路径
  → PARTSIGNAL_DEPLOY_MODE=fast 调用 deploy-staging.sh
  → Nginx、容器、本机与公网健康检查
  → 全部通过后 ln -sfn 更新 current
  → 输出 release 与总耗时
```

快速模式只跳过：

- Alembic 迁移；
- 部署前数据库备份（本地编排本就不调用）；
- 幂等账号种子；
- 部署阶段重复的完整本地测试与前端预构建。

快速模式继续执行只读 `preflight-integrity`。完整模式是 `deploy-staging.sh` 的默认值，命令调用方不传模式时行为保持原样。

## 3. 快速路径资格门禁

远端解压后、构建前，将当前 release 与新 release 的以下路径逐一比较：

- `backend/alembic/versions/`
- `.env.example`
- `deploy/compose.staging.yaml`
- `deploy/nginx/partsignal.staging.conf.template`
- `deploy/scripts/deploy-staging.sh`

任一路径缺失或内容不同均停止快速部署，要求改走完整 Runbook。该门禁以服务器当前 release 为比较基线，不依赖提交消息或操作者记忆。

首个引入快速流程的版本会修改 `deploy-staging.sh`，因此应通过现有完整流程上线一次；从下一次普通代码提交开始使用快速入口。

## 4. 失败与回滚语义

- 本地或远端任一步失败立即非零退出，不继续后续阶段。
- 验收失败时不切换 `current`，并保留新 release 供排查。
- Compose 使用固定项目名和端口，容器更新发生在 `current` 之前；`current` 仅是“最后通过验收的 release”记录，不承诺蓝绿流量原子切换。
- 不自动重启旧容器，避免在数据库或运行状态不明时制造第二次变更；按现有 Runbook 人工选择兼容的旧 release 回滚。

## 5. 安全与兼容

- 发布来源仍限定为已推送的干净 `main`。
- 发布包继续阻断环境文件、私钥与 AppleDouble 文件；共享环境文件只在远端以 `0600` 复用。
- SSH 继续使用受 OpenSSH 配置管理的 `hostdzire` alias，不读取或输出凭据。
- 完整部署入口、数据库迁移流程和生产 Compose 不变。
- 快速路径不执行登录后浏览器全面验收；它保留公网 HTTP 冒烟。前端认证、路由或高风险 UI 变更仍按完整 Runbook 执行本地浏览器只读验收。

## 6. 取舍

选择“显式快速入口 + 完整入口默认不变”，避免把数据库安全建立在一个容易遗忘的反向开关上。选择关键路径自动比较而不是 `--skip-migrate` 裸参数，防止存在新迁移时误走快速路径。暂不实现蓝绿发布，因为它需要第二套端口、Compose 项目和 Nginx 上游切换，超出本次 5–8 分钟开发期重部署目标。
