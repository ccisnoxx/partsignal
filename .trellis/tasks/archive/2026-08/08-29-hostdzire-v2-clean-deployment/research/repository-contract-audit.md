# 仓库 Production 部署合同审计

## 审计范围与方法

审计时间：2026-08-29。完整读取任务要求的规则、spec index、Hostdzire 文档、Frontend V2 migration/testing/ADR 文档和 Production Compose；并只读核对 manifest、deploy、activate、data-state、frontend rollback、Nginx、安全检查、部署测试及 backend CLI owner。未执行部署、Docker mutation、远端写入、Git commit/push 或 `task.py start`。

## 当前权威合同

### Candidate provenance

- `deploy/scripts/create-release-manifest.py:85-126` 证明 candidate 来自 clean `main`、`HEAD == origin/main == commit` 和确定性 `git archive`。
- `create-release-manifest.py:16-24,132-188` 固定 tracked-file allowlist、release/commit/schema 格式、三类镜像 ID/RepoDigest 和排他 `0600` manifest。
- `deploy/scripts/prepare-production-data.py:157-280` 消费 manifest 时重新校验 manifest checksum、tracked files、release identity 和 backend/frontend image ID/RepoDigest。

### Compose and startup order

- `deploy/compose.prod.yaml:1-123` 固定 project `partsignal-staging`、API `127.0.0.1:19000`、frontend `127.0.0.1:19080`、PostgreSQL/Redis bind mount 和三个命名网络；Production 不声明 `fake-oss`。
- `compose.prod.yaml:43-67` 把 Worker/Scheduler 放入非默认 `production-async` profile。
- `deploy/scripts/deploy.sh:55-100` 的 clean-init 顺序为：状态绑定 → config/pull/image verify → PostgreSQL/Redis → config preflight → migration → integrity → account initialization → API/frontend → 回环探针 → `PRODUCTION_PREPARED`。
- `deploy/scripts/activate-production.sh:46-85` 要求同一 manifest、`PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET`、现有 API/frontend ready，随后只激活 Worker/Scheduler 并进入 `PRODUCTION_INITIALIZED`。

### Data state and recovery

- `prepare-production-data.py:20-25,90-115` 固定 Production data root `/root/partsignal-data`、quarantine `/root/partsignal-data-quarantine`、锁 `/run/lock/partsignal-production-maintenance.lock` 和叶子 `postgres/redis/objects`。
- `prepare-production-data.py:463-557` 在同 device 上逐叶原子 rename，重建空 `postgres/redis`，不重建 `objects`，不物理删除旧数据。
- `prepare-production-data.py:574-660` 定义 clean-init/upgrade 的准备与激活状态。
- `prepare-production-data.py:663-760` 恢复时把失败 Production 数据保留到 `failed-production/`，再恢复旧三叶；默认无删除。
- `deploy/scripts/rollback-production-frontend.sh:40-52` 只允许 manifest 冻结的 frontend image，使用 `--no-deps --no-build --pull never --force-recreate --wait`。

### Nginx and frontend artifact

- `deploy/nginx/partsignal.conf.template:1-63` 只代理 API `19000` 和 frontend `19080`，不声明 `19001`、`/object-storage/` 或静态 root。
- `deploy/nginx/partsignal-security-headers.conf:1-6` 是项目公网安全头唯一仓库权威。
- `deploy/scripts/test-frontend-container.sh:24-63` 验证 SPA fallback、HTML no-cache、hashed assets immutable、missing asset/`.map` 404、JS 无 `sourceMappingURL` 和镜像内无 `.map`。

### Account initialization

- `backend/app/cli.py:20-48` 幂等创建 `admin` 与 `content_editor`，不覆盖既有账号；密码至少 12 字符，ENGINEER 首次登录必须改密。
- `backend/app/cli.py:51-84,137-143` 的 Production preflight 只返回固定枚举和 configured 状态，不输出 URL、bucket 或 secret 值。

## Findings and Controls

### P0：Hostdzire local build 与无条件 registry pull 冲突

`deploy.sh:64-67` 无条件 `docker compose pull api worker scheduler frontend`。当前目标明确在 Hostdzire 构建，本次 inventory 只证明宿主本地 image/RepoDigest，没有已确认 registry owner/credential。

实施前必须修改权威脚本而不是绕过它：新增显式 local candidate mode；默认 registry 模式保持，local 模式跳过 pull、相关 create/run/up 强制 `--pull never`，并继续校验 manifest image ID/RepoDigest。同步部署测试、Runbook 和附录。

### P1：V2-only 主要依赖操作合同

Compose 和 manifest 接受任意 image repository，只校验 reference/ID/RepoDigest；rollback verifier 不解析 V2 语义。candidate package 必须固定 build context `frontend/`、repository `partsignal-frontend` 和当前活动 V2 rollback image；出现 `partsignal-frontend-v1` 即停止，并添加负向脚本测试。

### P1：Production env metadata 未由主脚本完整强制

`deploy.sh:47-53`、`activate-production.sh:62-67` 和 rollback 只检查 `test -f`，未检查 canonical path、symlink、owner/mode。Configuration Gate 必须独立验证 `/root/partsignal/shared/.env.production` 为非 symlink、`root:root 0600`；是否把检查同步加入脚本在实施时以最小 diff 决定，但不能跳过。

### P1：manifest schema head 未自动绑定实际 DB revision

manifest 记录 `schema_head`，但 deploy script 不查询 `alembic_version`。migration 后、账号初始化前必须只读比较实际 revision；不匹配立即停止，不启动 API/frontend，不 downgrade。

### P1：真实 AI/OSS Gate 只是字符串

`activate-production.sh:26-29` 只判断 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET`。实施证据必须绑定 release/manifest checksum；只有当前 candidate 的真实测试完成后才传入 `MET`，不能继承历史 Gate。

### P1：失败后不会自动恢复部分服务

deploy/activate 使用 `set -eu`，没有 failure trap。每阶段必须在下一命令前保存 container/state evidence；失败时停止新写入，保留日志和身份，再按 data/Nginx/application 层恢复。

### P2：状态文件与容量边界未完全自动化

- `read_state()` 不验证已有 state file owner/mode 和全部结构字段。
- quarantine 在目标创建后、首次状态落盘前存在可能留下空 run 目录的失败窗口。
- `RESTORED` 后不能直接重新 clean-init；需要新评审，不能手改 state。
- 脚本没有 disk/memory threshold。

维护前必须重新验证 state/run/path/device/mount/owner 和容量；失败或 restore 后的第二次尝试不在同一窗口自行重开。

## Implementation Required Validation

```sh
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production.sh
uv run --project backend pytest backend/tests/unit/test_cli.py
make test-deploy-scripts
git diff --check
```

`make verify` 是共享部署合同变更的 optional full-suite validation；若跳过必须说明替代检查和剩余风险。
