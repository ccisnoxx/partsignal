# Hostdzire 开发环境 V2 全量重建执行计划

## 1. 当前阶段

任务因需求实质变更从 Production cutover 收敛为开发环境全量重建。用户已批准单次破坏性执行边界，远端删除、重建和验收已于 `2026-08-30T13:41:50+08:00` 完成。A1 Production candidate build 仅保留为历史证据，不再继续 A2/Production cutover；当前进入本地质量核验和提交确认阶段，不再授权新的远端写操作。

## 2. 执行前固定值

- target：SSH alias `hostdzire` / hostname `scrapy`
- source：`origin/main`
- planning commit：`a663bcce9fd49da9c5aea7f257372fc318447234`
- Compose project：`partsignal-staging`
- Compose file：`deploy/compose.staging.yaml`
- deploy owner：`deploy/scripts/deploy-staging.sh`
- data root：`/root/partsignal-data`
- shared env：`/root/partsignal/shared/.env.staging`
- ports：`19000/19001/19080`
- Nginx：保持当前 target，不 write/reload

release ID 和全部 destructive full IDs 必须在最终执行前重新生成/读取并写入当次命令；任何与 `research/development-rebuild-inventory.md` 不一致的 owner 漂移都停止执行。

## 3. 单次远端执行批次

### Step 1：最终只读 re-freeze

- [x] 证明 hostname=`scrapy`、root 身份、`origin/main` commit 和容量可用。
- [x] 列出所有 Compose project，证明范围外四个项目仍存在且不属于目标。
- [x] 重新读取 `partsignal-staging` 全部 container full ID、service label、image ID、mount、state、health、restart/OOM，并检查 exited `migrate`。
- [x] 重新读取三个 data leaf 的 type/device/owner/mode、所有 running container mounts、三个端口 owner和 Nginx checksum。
- [x] 证明新 release directory、version tag 和临时 symlink path 均不存在。

完成条件：形成单一字面量执行命令；若 exact owner 漂移，停止并更新计划，不自动扩容目标。

### Step 2：停止并删除目标容器

- [x] 按 `scheduler -> worker -> api -> frontend -> fake-oss -> postgres -> redis` 使用重新核验的 full ID 停止。
- [x] 证明七个目标 stopped，`19000/19001/19080` 释放，无运行容器挂载三个 data leaf。
- [x] 只按 full ID 删除七个容器和同 project 的 exited `migrate` 容器。
- [x] 证明其他 Compose project 的 container ID/state 未变化。

禁止 `down --remove-orphans`、project-wide 模糊删除或任何 prune。

### Step 3：永久清空开发数据与旧运行镜像

- [x] 再次证明三个 leaf 是 `/root/partsignal-data` 直接子目录、同 device、非 symlink、无 mount。
- [x] 分别删除三个绝对 leaf path，不删除数据根。
- [x] 按固定 owner/mode 重建空目录：PostgreSQL `70:0 0700`、Redis `999:0 0755`、objects `0:0 0755`。
- [x] 只删除 re-freeze 记录的旧运行 backend/frontend full image ID；保留 PostgreSQL/Redis base、A1 candidate 和历史未使用 images。

完成条件：三个 leaf 为空且 metadata 正确，受保护镜像仍存在，其他项目未变化。该步骤完成后旧开发数据不可恢复。

### Step 4：从 clean main 创建新 release

- [x] fresh `git ls-remote` 冻结 `origin/main`，生成唯一 `mvp-<timestamp>-<short-commit>`。
- [x] 在 `/root/partsignal/releases/<release-id>` 排他 clone/checkout main，验证 `HEAD == origin/main` 且 clean。
- [x] 创建 `.env.staging -> /root/partsignal/shared/.env.staging` symlink，并只验证 target metadata，不输出内容。
- [x] 验证 compose config 和 canonical `frontend/` build context。

完成条件：new release 身份明确、不可覆盖、secret 未复制或披露。

### Step 5：执行 Staging full deploy

在新 release 的 `deploy/` 目录执行等价固定调用：

```bash
PARTSIGNAL_DEPLOY_MODE=full \
PARTSIGNAL_VERSION=<release-id> \
ENV_FILE=../.env.staging \
COMPOSE_FILE=compose.staging.yaml \
./scripts/deploy-staging.sh
```

- [x] 脚本完成 config、API/Frontend build、PostgreSQL/Redis/fake-oss、integrity、migration、Worker/Scheduler/API/Frontend 和账号初始化。
- [x] 不手工跳过失败步骤，不切换 Production script，不使用旧 image fallback。

### Step 6：验收并更新 current

- [x] Compose 七个服务和镜像版本正确；health/restart/OOM 无异常。
- [x] PostgreSQL `alembic_version` 等于仓库唯一 head；`admin`、`content_editor` 存在但不输出密码。
- [x] `19000/19001/19080` listener 恢复；loopback/public live/ready、首页、canonical deep link 成功。
- [x] 用唯一对象验证 fake-oss PUT、HEAD/complete、GET 字节一致与 DELETE，只清理本次对象和关联记录。
- [x] `nginx -t` 成功且 active target/checksum 未变化。
- [x] 其他 Compose project 的 container ID/state 未变化。
- [x] 全部验收通过后，用不可覆盖临时 symlink 原子更新 `/root/partsignal/current` 指向新 release。

完成条件：开发环境重新上线，`current` 与运行版本一致；失败时保留现场并明确失败阶段。

## 4. Required Validation

远端执行前，本地只运行与现有脚本合同直接相关的检查：

```bash
deploy/scripts/test-deploy-staging.sh
PARTSIGNAL_VERSION=validation docker compose --env-file /dev/null -f deploy/compose.staging.yaml config --no-env-resolution --quiet
git diff --check
```

本任务不修改业务代码或部署脚本，因此不要求完整 `make verify`。远端验证以 Step 6 的真实 Staging smoke、数据库 head、账号、fake-oss 文件流和公网入口为准。

## 5. 停止条件

- hostname、Compose project/service label、container/image ID、mount 或数据绝对路径不能唯一匹配；
- 任一范围外项目使用目标 container、network、port 或 data path；
- shared `.env.staging` 缺失、不是 regular `root:root 0600`，或新 release 中目标 symlink 已存在；
- `origin/main`、release identity、Compose config、build、migration、账号初始化或 health 任一失败；
- 删除目标需要扩大到数据根、其他 project、全局 prune、Nginx、DNS/TLS 或 Production artifact；
- 新 release/version/current temp target 已存在或需要覆盖。

## 6. 明确不执行

不执行 Production A2、manifest、quarantine、restore、previous V2 retag、maintenance/final Nginx write/reload、真实 Production AI/OSS Gate、历史镜像清理、release/archive 删除、Docker prune、自动 commit/push 或任务归档。
