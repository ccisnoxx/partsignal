# 最新 Production 部署合同审计

## 审计边界

- 审计基线：`main == origin/main == d78b299069b222adb78507067334751737f679da`。
- `111a2b2b` 已实现 Host 本地候选交付、`--pull never`、manifest image identity 校验与 V1 repository hard reject；本任务不把该仓库事实写成远端 Gate=`MET`。
- 审计完整读取了当前任务要求的 Production Compose、deploy/activate/data-state/rollback/manifest/test 脚本、Nginx 模板、规范和 Hostdzire 文档。
- 本文件只记录仓库合同，不证明任何 2026-08-30 远端写入、部署、Nginx reload 或真实外部服务 Gate 已执行。

## 已建立的可执行合同

### Candidate 与镜像交付

- `deploy/scripts/create-release-manifest.py:16-24,90-193` 要求固定 tracked-file allowlist、clean `main`、`HEAD == origin/main == commit`、确定性 source archive、合法 image ID/非空 RepoDigest、排他 `0600` manifest。
- `deploy/scripts/prepare-production-data.py:157-289` 重新计算 manifest 摘要与 tracked files，绑定 release ID、backend/frontend/rollback image reference、image ID 和 RepoDigest，并拒绝 V1 repository。
- `deploy/scripts/deploy.sh:37-104`、`activate-production.sh:44-100` 保持 `registry` 默认；`local` 不 pull，在首个 Compose `run/up` 前验证候选镜像，相关 `run/up` 使用 `--pull never`。
- `deploy/scripts/rollback-production-frontend.sh:40-52` 只允许 manifest 冻结的上一份 V2 frontend，并执行 frontend-only recreate。

### Compose、数据状态与恢复

- `deploy/compose.prod.yaml:1-123` 固定 project `partsignal-staging`，Production service 为 PostgreSQL、Redis、migrate、API、frontend，以及非默认 `production-async` profile 中的 Worker/Scheduler；不声明 fake-oss、`19001` 或 objects mount。
- `deploy/scripts/prepare-production-data.py:20-23,73-148,393-566` 固定 data/quarantine/lock owner，拒绝 path alias、祖先 symlink、嵌套根、独立 mount、跨 device 和活动数据 mount，逐叶 rename 并以 `0600` 状态文件持久化 `QUARANTINING -> QUARANTINED`。
- `prepare-production-data.py:583-669` 把 clean-init/upgrade 绑定到候选 identity；`deploy.sh:87-135` 依次执行 candidate bind、config、image verify、PostgreSQL/Redis、Production config preflight、migration、integrity、账号初始化、API/frontend 和 `PRODUCTION_PREPARED`。
- `activate-production.sh:62-110` 只在 prepared 状态、同一候选和 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET` 时激活 Worker/Scheduler并进入 initialized。
- `prepare-production-data.py:672-769` restore 时把失败的新数据保留到 `<run-id>/failed-production/`，再恢复旧三叶；不执行删除。

### Nginx 与 V2-only

- `deploy/nginx/partsignal.conf.template:1-64` 只代理 `19000`/`19080`，不声明静态 root、`19001` 或 `/object-storage/`。
- `.trellis/spec/infra/production-image-delivery.md:9-48`、`docs/Hostdzire部署上线流程.md:18-24,51-88` 明确 canonical `frontend/` 是唯一源码 owner，V1 不进入 manifest、Production Compose 或 rollback。
- Nginx site 写入与 reload 目前没有仓库脚本 owner；Runbook 只规定精确备份、同目录临时文件、owner/mode/checksum、原子替换、`nginx -t` 与独立 reload 授权。

## 必须由本任务执行计划补强的边界

### F1：公网维护边界不是现有状态机的一部分

`deploy.sh:124-127` 会把新 API/frontend 直接绑定到旧运行态相同的 `127.0.0.1:19000/19080`。当前活动 Nginx 已代理这两个端口，因此新容器一旦启动，公网会在真实 AI/OSS Gate、Worker/Scheduler 激活和最终 Nginx 模板切换前恢复访问；这可能允许业务写入进入尚未完成 Gate 的新数据库。

控制：实施前新增一个仓库 owner 的 PartSignal maintenance Nginx 模板，并纳入 manifest tracked-file allowlist 与部署测试。维护站点只保留现有 TLS、安全 snippet 和 ACME 边界，对业务路径返回维护状态，不代理应用。T0 从该模板原子安装、`nginx -t` 和独立 reload 成功开始；最终 Production 模板仅在 external Gate 与 initialized 状态通过后安装并再次独立 reload。

### F2：Production env 文件身份不由 shell 主脚本强制

`deploy.sh:63-69`、`activate-production.sh:78-83` 和 rollback 只执行 `test -f`，没有固定 canonical path、symlink、owner 或 mode。

控制：Artifact/Configuration 和 Maintenance 两个 Gate 都必须重新证明 `/root/partsignal/shared/.env.production` 是普通非 symlink、`root:root 0600`；任一不匹配在 Compose 前停止。只输出元数据与 `*_configured`，不输出值。

### F3：真实 AI/OSS Gate 只是调用方字符串

`activate-production.sh:26-29` 只判断字符串 `MET`，不保存 release-bound 外部验证记录。

控制：只有本任务在 maintenance guard 下对同一 manifest 完成真实 AI 与真实 OSS 的权限、连通性、超时/失败、CORS、上传、HEAD、短期下载及无 fake-oss 证据后，才允许在当次命令环境中设置 `MET`。证据只保存 request ID、对象/作业 ID、状态码、结果状态、时间和 manifest SHA-256，不保存 credential、URL query、Header、Cookie 或正文。

### F4：运行容器 identity 存在验证后时间窗

Compose 仍按 tag 启动；manifest consumer 在 `run/up` 前验证 tag identity，但脚本没有在容器启动后重新读取实际容器 `.Image`。

控制：构建和维护阶段禁止并发改写候选 tag；prepared 与 initialized 后均按 container full ID 重新比较实际 image ID 与 manifest。任何不一致立即停止并恢复，不把状态文件成功当作 identity 成功。

### F5：manifest consumer 不复算 source archive

producer 在生成时验证 source archive；consumer 只复算 tracked files。

控制：Artifact package 在 manifest 生成后和 Maintenance package 开始前各自重新计算 archive SHA-256，与 manifest allowlist 字段比较；manifest、archive、release target 均不可覆盖。

### F6：schema head 与实际数据库 revision 未自动比较

manifest 绑定 `schema_head`，但 deploy script 在 migration 后没有读取 `alembic_version`。

控制：maintenance guard 保持公网不可写；deploy 返回 prepared 后立即只读查询实际 revision，并要求精确等于 manifest `schema_head`。不一致时不设置 external Gate、不激活异步服务、不切换 Production Nginx，直接进入保留现场与恢复。

### F7：restore 与第二次尝试的状态边界

- `RESTORED` 不是下一次 quarantine/upgrade 的合法入口。
- restore 的代码级 mount 检查只围绕活动 data root，未完整证明 quarantine/failed-production 未被其他容器挂载。

控制：restore 前额外枚举所有运行容器 mount，覆盖活动根、quarantine target 和 failed-production；本窗口一旦进入 `RESTORED`，本任务只验证旧运行态并收口，不在同一窗口手改 state 或重新 clean-init。再次尝试必须重新规划。

## 验证要求

仓库 maintenance guard 合同若获批准实施，required checks 为：

```sh
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production.sh
uv run --project backend pytest backend/tests/unit/test_cli.py
make test-deploy-scripts
git diff --check
```

`make verify` 是 optional full-suite；若本机 Docker 环境仍不可用，不重复同一环境失败，在 Hostdzire candidate build 后运行 frontend container artifact check 与 Production deploy script self-test作为替代，并报告剩余风险。
