# PartSignal Hostdzire 部署上线 Runbook

本文档是 `https://geo.962850.xyz` 预发布环境的主 Runbook。日常发布直接走快速重部署；首次初始化、完整手工发布、恢复和详细排障见[部署附录](./Hostdzire部署附录.md)，跨环境原则见[部署与运维](./operations.md)。

## 1. 部署决策

| 变更或现场条件 | 路径 | 入口 |
| --- | --- | --- |
| 普通前后端代码；快速门禁路径均未变化；无高风险认证、权限、路由或全局壳层变化 | 快速重部署（默认） | 第 4 节 |
| 任一快速门禁路径变化 | 完整发布 | 第 5 节 |
| 其他底层部署、备份或恢复脚本变化 | 完整发布 | 第 5 节，并验证对应运维能力 |
| 首次启用当前部署机制，或 Hostdzire 缺少共享环境文件、有效 `current` | 首次初始化 + 完整发布 | 附录第 3、4 节 |
| 认证、权限、路由、全局壳层等高风险 UI 变化 | 完整发布 + 登录后浏览器验收 | 第 5、6 节 |
| 快速脚本主动拒绝 | 停止 | 不绕过门禁；排除现场异常后走完整发布 |

快速脚本比较且只比较以下 6 个门禁路径：

- `backend/alembic/versions/`
- `.env.example`
- `deploy/compose.staging.yaml`
- `deploy/nginx/partsignal-security-headers.conf`
- `deploy/nginx/partsignal.staging.conf.template`
- `deploy/scripts/deploy-staging.sh`

## 2. 固定边界

| 项目 | 值或约束 |
| --- | --- |
| 公网入口 | DMIT，只做四层 SNI/端口转发和 `proxy_protocol` |
| 应用主机 | Hostdzire，运行固定 Compose 项目和宿主机 Nginx |
| WireGuard 地址 | DMIT `10.0.0.1`，Hostdzire `10.0.0.2` |
| release | `/root/partsignal/releases/<release-id>`，不可覆盖 |
| 最后验收记录 | `/root/partsignal/current` |
| 唯一真实 staging 配置 | `/root/partsignal/shared/.env.staging`，权限 `0600` |
| 持久数据 | `/root/partsignal-data`，不得放入 release |
| Compose 项目 | `partsignal-staging` |
| 回环端口 | API `19000`、开发对象存储 `19001`、前端 `19080` |
| 外层 Nginx | `1.29.3` 或更高；Hostdzire 当前已确认 `1.29.8` |
| 公网安全头权威 | 仓库 `deploy/nginx/partsignal-security-headers.conf`；宿主机运行副本 `/etc/nginx/snippets/partsignal-security-headers.conf` |

服务器连接只使用 `/Users/sc/.ssh/config`：`hostdzire` 是部署、上传、配置和常规运维的唯一写入目标；`dmit` 仅用于公网入口异常时的只读诊断。不得向 `dmit` 上传文件、修改配置或重启服务。

OpenSSH 配置负责主机、端口、身份文件、主机密钥验证和连接复用。不得读取、复制或输出私钥；主机密钥冲突时立即停止，未经可信渠道核对指纹不得删除旧记录或接受新密钥。

正常升级只复用 Hostdzire 的共享环境文件，不在仓库创建、复制或下载真实 `.env.staging`，也不重新生成数据库密码、会话密钥或 `AI_CREDENTIAL_ENCRYPTION_KEY`。staging 使用真实 PostgreSQL、Redis 和 Celery；Redis 只承担 Celery Broker，业务状态以 PostgreSQL 为准。对象存储是 `fake-oss` 开发适配器，不得注入生产 OSS 或生产模型凭据。

## 3. 发布前提与停止条件

开发阶段发布不依赖 GitHub Actions 打包，也不等待 GitHub CI 完成。GitHub Actions 只提供异步质量反馈，不是预发布上线门禁；快速和完整发布都从干净、已推送且与 `origin/main` 一致的本地主工作目录直接制作发布包。发布前只运行与本次改动相称的本地最小检查，上线后由操作者通过真实页面和业务流程继续人工验收。

任一路径出现以下情况时停止：

- 本地不是干净的 `main`，或 `HEAD` 与 `origin/main` 不一致。
- SSH 主机密钥冲突，或 `hostdzire` 指向的主机身份不符合预期。
- 发布包为空、缺少 `.env.example`，或包含环境文件、密钥、AppleDouble 文件。
- `preflight-integrity` 报告问题，Compose 配置无效、容器不健康或相应探针失败。
- `node deploy/scripts/check-nginx-security.mjs` 失败，Nginx 低于 `1.29.3`，或 `nginx -t` 失败。

快速发布还会在共享环境文件缺失或权限不是 `0600`、`current` 无效、任一快速门禁路径缺失或变化时停止。它不以数据库备份、迁移或登录后浏览器验收为前提。

完整发布中，正常升级若共享环境文件缺失或权限错误应停止；首次初始化按附录创建。已有数据的备份为空、有损迁移未通过隔离恢复验证、迁移或 Nginx 校验失败，以及登录页、认证路由、工作台、配置页或控制台验收失败时均停止。不得设置 `PARTSIGNAL_DEPLOY_MODE=fast` 绕过这些步骤。

## 4. 日常快速重部署

在本地主工作目录直接执行：

```sh
git pull --ff-only origin main
make staging-redeploy-fast
```

该入口不下载或使用 GitHub Actions 构建产物，也不查询 CI 状态。

不要重复手工打包、上传、构建或探测。`deploy/scripts/redeploy-staging-fast.sh` 会依次：

1. 校验本地命令、SSH 配置、干净的 `main`，获取并确认 `origin/main`。
2. 确认 Hostdzire 的 release 根目录、共享环境文件和有效 `current`。
3. 生成含秒级时间戳与 12 位 commit 的 release，从目标提交制作并检查安全归档。
4. 上传到 `hostdzire`，创建不可覆盖的 release，链接权限为 `0600` 的共享环境文件。
5. 在构建或替换容器前比较第 1 节的 6 个门禁路径，缺失或变化即拒绝。
6. 校验 Compose，构建镜像，启动 PostgreSQL、Redis、`fake-oss`，运行只读 `preflight-integrity`。
7. 等待 Worker、Scheduler、API、前端健康，并检查回环 API ready 和前端首页。
8. 执行 `nginx -t`，检查公网 `live`、`ready` 与首页标题；全部通过后原子更新 `current`。

快速模式不备份、不迁移、不创建种子账号，也不替代高风险变更的登录后浏览器验收。

任一步失败都会非零退出。公网检查通过前不会更新 `current`，但镜像构建或容器替换可能已经发生；旧 `current` 只表示最后验收记录。不要只切换软链接，按第 7 节处理应用回滚。新 release 可保留排障；清理 release、镜像、备份或持久数据是独立破坏性操作。

## 5. 完整发布入口

完整发布适用于第 1 节列出的迁移、关键部署配置、首次启用和高风险变更。远端写操作全部只在 `hostdzire` 执行。

按[附录第 4 节](./Hostdzire部署附录.md#4-完整手工发布)从头执行，不跳步：

1. 校验本地来源，制作并检查不可覆盖的 release 归档。
2. 上传并准备 release；正常升级只链接既有共享环境文件。
3. 已有数据先备份；有损迁移还要在隔离 PostgreSQL 验证恢复。
4. 运行默认 `full` 部署，完成只读门禁、迁移、健康检查和幂等种子账号。
5. 仅在首次安装或 staging Nginx 模板、项目安全 snippet 变化时更新独立站点与项目 snippet。
6. 完成公网、缓存、对象存储代理、登录后浏览器和主机验收，再更新 `current`。

首次空库可以跳过备份；已有数据时备份为空必须停止。有损迁移未通过隔离恢复验证、浏览器能力不可用或任一验收失败时，完整发布不得标记成功。

## 6. 验收

| 验收项 | 快速重部署 | 完整发布 |
| --- | --- | --- |
| Compose、镜像、容器、本机 ready/首页 | 脚本自动 | 部署脚本自动 |
| 公网 `live`、`ready`、首页标题 | 脚本自动 | 操作者执行 |
| 数据库备份与迁移 | 不执行 | 已有数据先备份，部署脚本迁移 |
| Nginx | 脚本自动 `nginx -t` | 模板或项目安全 snippet 变化时校验并 reload |
| 缓存头与项目安全头共存 | 安全配置无变化时沿用上次完整验收 | `/`、`/index.html`、`/assets/*` 必须逐项验证 |
| 缓存与对象存储代理 | 不单独扩展 | 操作者验证 |
| 登录后浏览器只读验收 | 非高风险变更不要求 | 必须执行 |
| `current` 更新 | 脚本在自动验收后更新 | 操作者在全部验收后更新 |

完整浏览器验收必须通过真实公网域名在本机执行，不在服务器或容器安装浏览器，不用 `curl` 代替真实渲染。只读检查 `/login`、工作台和 `/configuration/ai`；不得输出或持久化密码，不创建业务数据或修改线上配置。详细安全步骤见[附录第 4.6 节](./Hostdzire部署附录.md#46-完整验收与更新-current)。

公网环境固定 `AI_ALLOW_LOCAL_HTTP=false`。依赖回环 Mock Provider 的纵向 E2E 只在本地或 CI 隔离环境运行，不得为测试放宽公网安全策略。

项目安全头必须包含 CSP、`Strict-Transport-Security: max-age=31536000`、`Cross-Origin-Opener-Policy: same-origin`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: strict-origin-when-cross-origin`。CSP 内联主题脚本哈希以 `node deploy/scripts/check-nginx-security.mjs` 输出为准；不得手工猜测、改用 `script-src 'unsafe-inline'` 或依赖宿主机共享安全 snippet。

## 7. 回滚摘要

`current` 是最后完成相应验收的 release 记录，不是流量开关。固定 Compose 项目和回环端口上的容器在记录更新前已被替换；只切换 `current` 不能回滚运行容器。

应用回滚只在旧应用与当前数据库契约兼容时进行：进入已验证旧 release，用旧镜像标签重启固定 Compose 栈，重做完整验收后再更新 `current`。状态机或数据库契约不兼容时，先停止相关写流量与 Scheduler，由负责人确认数据处置。

数据库默认不执行 Alembic downgrade。有损迁移需要保留故障现场，确认恢复窗口和数据取舍，再恢复迁移前完整备份并启动兼容旧 release；备份必须与对应 `AI_CREDENTIAL_ENCRYPTION_KEY` 成对保护。具体命令和故障入口见[附录第 5、6 节](./Hostdzire部署附录.md#5-回滚与恢复)。

Nginx 回滚必须同时恢复同一个已验证 release 的 staging 模板和项目安全 snippet，`nginx -t` 通过后才能 reload；客户端已缓存的 HSTS 在一年有效期内不会被配置回滚立即撤销。任何回滚都不删除 release、镜像、备份或 `/root/partsignal-data`。
