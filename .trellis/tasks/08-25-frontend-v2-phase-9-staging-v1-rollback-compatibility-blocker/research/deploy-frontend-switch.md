# Research: Staging frontend 单服务切换合同

- Query: 审计现有 Staging Compose、部署脚本、定向测试与 Hostdzire Runbook，判断能否只切换固定 V1/V2 frontend artifact，同时不操作 backend、database 或 migrations；给出精确命令、停止条件和最小定向测试。
- Scope: internal / external / mixed
- Date: 2026-08-25

## Findings

### 1. 结论

现有 Compose 原生命令足以表达安全的 frontend 单服务切换，不需要新增部署脚本，也不需要第二套 Compose 文件或 deployment framework。合同必须同时固定：

1. 从目标 artifact 自身的 release 目录调用其 `compose.staging.yaml`；
2. 显式注入 `PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend` 与该 frontend release 的 `PARTSIGNAL_VERSION`；
3. `up` 只选择 `frontend`，并同时使用 `--no-deps --no-build --pull never --force-recreate`；
4. 用冻结的 Docker image ID 做切换前存在性检查和切换后容器核对；
5. 切换前后比较 PostgreSQL、Redis、`fake-oss`、API、worker、scheduler 的 container ID/image ID/state，以及数据库 revision 与 `current`；任何变化都判失败并停止。

`--no-deps --no-build` **还不够**：`--no-build` 只禁止构建，不禁止 pull；当前 `frontend` 同时声明 `image` 与 `build`，且没有 `pull_policy`。Docker 官方合同表明缺少显式 pull policy 时仍可能解析/拉取 image，所以精确本地 artifact 还需 `--pull never`。`--force-recreate` 只作用于选中的 `frontend`，用于保证切换确实重建该容器；`--wait` 只证明容器进入 running/healthy，不替代 HTTP、artifact marker 与浏览器验收。

当前主 Runbook 和附录仍描述“旧 release 整栈回滚”，与 `0043` 后的安全不变量冲突，必须改为 frontend-only 合同：

- 主 Runbook `docs/Hostdzire部署上线流程.md:133-141` 要求旧应用与当前数据库兼容后整栈回滚；
- 附录 `docs/Hostdzire部署附录.md:459-488` 的实际命令会重启 `worker scheduler api frontend fake-oss`；
- 已归档审计已经证明该整栈命令在 `0043` 后不安全：旧 backend 不写 `platform_profile_id_snapshot`（`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:104-110`）。

### 2. Files found

| 文件 | 作用与本任务证据 |
| --- | --- |
| `deploy/compose.staging.yaml:1-149` | 固定项目名、全部 service、镜像插值、依赖、网络与端口的唯一 Compose owner。 |
| `deploy/scripts/deploy-staging.sh:4-43` | full/fast 整栈部署入口；会 build、启动基础服务、执行 preflight，full 还 migrate/seed，并替换 worker/scheduler/API/frontend。不能用于 UI-only 切换。 |
| `deploy/scripts/test-deploy-staging.sh:14-133` | 现有 staging 静态合同与 full/fast mock 命令序列 owner；适合追加最小 frontend-only 合同检查，无需新测试框架。 |
| `deploy/scripts/redeploy-staging-fast.sh:167-185` | 把 Compose、migration、部署脚本列为关键路径，随后仍调用 `deploy-staging.sh`；不能作为 UI-only 入口。 |
| `docs/Hostdzire部署上线流程.md:26-48,66-90,133-141` | Staging owner、固定项目/端口、日常发布及旧整栈回滚摘要。回滚摘要已经过期。 |
| `docs/Hostdzire部署附录.md:306-325,455-498` | 完整发布、当前旧整栈回滚与数据库恢复边界的可执行事实源。frontend-only 精确命令应写在这里。 |
| `Makefile:60-79` | `test-deploy-scripts` 已串联 V2 container test 和 `test-deploy-staging.sh`，可直接复用。 |
| `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-9-staging-integration/design.md:19-46` | P9.1 只改 frontend build context；service 名、镜像变量、端口、网络和发布 owner 保持不变。 |
| `.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:96-116` | 冻结 V1 release/tag/image ID、DB revision、`0043` 不兼容原因，以及 V1/candidate Compose 唯一差异。 |
| `docs/frontend-v2/07-migration-plan.md:514-552` | Phase 9 顺序、Cutover Gate 与当前 P9.1/外部 Gate 状态。 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md:408-418` | Staging deployment smoke 与 P9.1 artifact/cache/source-map 门禁。 |

### 3. 镜像与 tag 所有权

- Backend repo/tag：`deploy/compose.staging.yaml:3-6` 的 `${PARTSIGNAL_BACKEND_IMAGE:-partsignal-backend}:${PARTSIGNAL_VERSION}`。
- `fake-oss` 复用 backend repo/tag：`deploy/compose.staging.yaml:57-61`。
- Frontend repo/tag：`deploy/compose.staging.yaml:126-129` 的 `${PARTSIGNAL_FRONTEND_IMAGE:-partsignal-frontend}:${PARTSIGNAL_VERSION}`；同一 service 的 build context 现在是 `../frontend-v2`。
- 共享 Staging env 首次初始化把 repo 固定为 `PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend`，不持有 release tag（`docs/Hostdzire部署附录.md:173-176`）。release tag 由每次命令的 `PARTSIGNAL_VERSION` 持有（`docs/Hostdzire部署附录.md:306-314`）。Shell 环境变量优先于 `--env-file` 的插值值，因此 UI-only 命令应把 repo 与 release 都显式写在命令前缀中。
- 已确认 V1 artifact：
  - release/tag：`mvp-20260806-195740-afb1b8c82f40`；
  - image ref：`partsignal-frontend:mvp-20260806-195740-afb1b8c82f40`；
  - image ID：`sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec`；
  - evidence：`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:96-103`。
- V2 artifact 必须在后续激活时冻结为唯一 `<V2_RELEASE>`、`partsignal-frontend:<V2_RELEASE>` 和实际 `<V2_IMAGE_ID>`；当前仓库证据尚不能填写这两个值。

当前 Compose 没有独立 `PARTSIGNAL_FRONTEND_VERSION`。这不是 blocker：使用 release 自身 Compose、单 service 选择和 `--no-deps` 时，命令虽然会把未选中的 backend 模型插值为同一 release tag，却不会重建或启动未选中的服务。为这一个已被原生命令覆盖的流程新增 tag 变量会扩大配置面，暂不需要；定向测试和前后 container identity 比较必须把这一行为冻结。

### 4. `docker compose up frontend` 的实际影响边界

- `frontend` 没有 `depends_on`、`links`、volume 或 backend/internal network；它只连接 `partsignal-staging-edge` 并绑定 `127.0.0.1:19080:80`（`deploy/compose.staging.yaml:126-140`）。因此按当前模型，即使只写 `up frontend` 也没有 application/database dependency 可启动。
- Docker 官方 `up` 合同允许在选定 service 外启动 linked/dependency services；所以安全 Runbook 仍必须显式带 `--no-deps`，不能只依赖“今天恰好没有依赖”。
- Service selector `frontend` 把 recreate 作用域限制到 frontend；`--force-recreate` 不会扩大 selector。命令不得出现 `--always-recreate-deps` 或 `--remove-orphans`。
- `up` 仍可能确保 project network 存在；在当前活动栈中 edge network 应已存在。若 network 缺失或 Compose 计划创建异常资源，应在 dry-run/前置检查停止，而不是让 UI fallback 修复基础设施。
- 本机 Docker Compose `5.3.1` 的 `config --format json frontend` 实测只在 `services` 下渲染 `frontend`；其 image 精确解析为传入的 `partsignal-frontend:<tag>`。输出仍包含非 service 的 `x-backend` extension，但 extension 不会创建容器。
- `deploy-staging.sh` 不能复用为 UI-only 入口：`deploy/scripts/deploy-staging.sh:23-35` 会依次 config、build API/frontend、启动 PostgreSQL/Redis/fake-oss、preflight、可能 migrate、替换 worker/scheduler/API/frontend、可能 seed。
- `redeploy-staging-fast.sh` 也不能复用：它最终设置 fast mode 并调用同一整栈脚本（`deploy/scripts/redeploy-staging-fast.sh:183-185`）；fast 仅跳过 migrate/seed，不会保留 backend containers。

### 5. 建议冻结的精确命令形状

以下是 Runbook 应固定的命令形状，不是本任务的远程执行授权。实际激活前必须先填入并冻结 `<V2_RELEASE>` 与 `<V2_IMAGE_ID>`。

```sh
set -eu

ps_frontend_repo=partsignal-frontend
ps_v1_release=mvp-20260806-195740-afb1b8c82f40
ps_v1_image_id=sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec
ps_v2_release='<V2_RELEASE>'
ps_v2_image_id='<V2_IMAGE_ID>'

ps_v1_dir="/root/partsignal/releases/${ps_v1_release}"
ps_v2_dir="/root/partsignal/releases/${ps_v2_release}"
test -d "$ps_v1_dir"
test -d "$ps_v2_dir"
test "$(docker image inspect --format '{{.Id}}' \
  "${ps_frontend_repo}:${ps_v1_release}")" = "$ps_v1_image_id"
test "$(docker image inspect --format '{{.Id}}' \
  "${ps_frontend_repo}:${ps_v2_release}")" = "$ps_v2_image_id"
```

V1 UI fallback：

```sh
cd "$ps_v1_dir/deploy"
test "$(PARTSIGNAL_FRONTEND_IMAGE="$ps_frontend_repo" \
  PARTSIGNAL_VERSION="$ps_v1_release" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  config --images frontend)" = \
  "${ps_frontend_repo}:${ps_v1_release}"

PARTSIGNAL_FRONTEND_IMAGE="$ps_frontend_repo" \
PARTSIGNAL_VERSION="$ps_v1_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

恢复固定 V2 UI：

```sh
cd "$ps_v2_dir/deploy"
test "$(PARTSIGNAL_FRONTEND_IMAGE="$ps_frontend_repo" \
  PARTSIGNAL_VERSION="$ps_v2_release" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  config --images frontend)" = \
  "${ps_frontend_repo}:${ps_v2_release}"

PARTSIGNAL_FRONTEND_IMAGE="$ps_frontend_repo" \
PARTSIGNAL_VERSION="$ps_v2_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

两条 `up` 命令都必须满足：

- 最后唯一 service 参数是 `frontend`；
- 不调用 `deploy-staging.sh`；
- 不出现 `api`、`worker`、`scheduler`、`fake-oss`、`postgres`、`redis` 或 `migrate`；
- 不出现 `build`、`run`、`exec alembic`、`down`、`stop`、`rm`、`restart`、`--remove-orphans`；
- 不更新 `/root/partsignal/current`，不修改 Nginx，不执行 Alembic。`current` 不是流量开关，混合态由实际 container image ID 审计，不伪装成整栈旧 release。

### 6. 切换前后必须核对的运行不变量

在真正 `up` 前冻结，之后逐项比较：

1. `postgres redis fake-oss api worker scheduler` 六个 service 的 container ID、Docker image ID、state/health 完全一致；
2. `migrate` service 对应的 container ID 集合完全一致，且没有新建 migration one-off container；
3. `alembic_version` 在切换前后均为预期 `0043_geo_platform_identity`；
4. `/root/partsignal/current` 的 link 值完全一致；
5. frontend 容器名称仍为固定项目的 `partsignal-staging-frontend-1`，其 `.Image` 精确等于目标冻结 image ID；
6. `127.0.0.1:19000/api/health/ready` 继续通过，`127.0.0.1:19080/` 返回目标 V1/V2 marker；
7. 公网 cache/security headers、hashed asset、missing asset、`.map`、SPA fallback 和相应浏览器合同继续按目标 UI 验收。

只允许格式化 `docker inspect` 所需字段，避免输出容器环境变量。比较 backend container ID 比单看 `running` 更强：任何被意外 recreate 的 service 即使恢复健康也会被发现。

### 7. 失败停止条件

以下任一条件使方案判定 `BLOCKED` 或本次切换立即停止，不得改用整栈 V1、downgrade 或兼容 hack：

- V1/V2 release 目录、Compose 文件、固定 tag 或冻结 image ID 缺失/不匹配；
- V1 release 不再精确以 `../frontend` 持有 V1 build owner，或候选 release 不再精确以 `../frontend-v2` 持有 V2 owner；
- `config --images frontend` 不只返回目标固定 image ref；
- Hostdzire Compose 不支持 `--no-deps`、`--no-build`、`--pull never`、`--force-recreate`、`--wait`，或 dry-run 显示计划操作 frontend 之外的 service；
- 切换前任一 candidate backend service 不健康、image/container identity 不符合已批准候选，或 DB revision 不是预期 `0043_geo_platform_identity`；
- `up` 非零退出、frontend 未使用目标 image ID、loopback/public UI 验收失败；
- backend/base/migrate container identity、DB revision、`current`、Nginx 任一发生变化；
- V1 frontend 与 candidate backend 的 API/Auth/permission/runtime compatibility 证据不足或失败。该兼容性由另一研究主题负责，本文件不替代其结论。

### 8. 最小定向测试

优先扩展现有 `deploy/scripts/test-deploy-staging.sh`，不要新增 operational switch 脚本。最小充分断言是：

1. 静态冻结 `frontend` 的 image expression、V2 build context、`127.0.0.1:19080:80`、edge-only network，且 service block 没有 `depends_on`/`links`；
2. 使用本地 Compose `config --no-env-resolution --format json frontend`，断言 `.services` 的 key 集合精确为 `frontend`，解析 image 精确等于注入的 test repo/tag；
3. 从 Runbook 的 V1 fallback 和 V2 restore 两个 fenced command block 提取唯一 `up` 命令，断言都有 `--no-deps --no-build --pull never --force-recreate --wait`，最后 service 仅为 `frontend`；
4. 断言两个切换块均不含 `deploy-staging.sh`、backend/base/migrate service 名、`build`、`run`、`down`、`stop`、`rm`、`restart`、`--remove-orphans`、`alembic` 或 `current` 写入；
5. 断言 Runbook 同时要求 V1/V2 image ID 前置校验、frontend 容器 image ID 后置校验、六个非 frontend service identity 前后比较、migration container 集合比较和 DB revision 前后比较；
6. 保留现有 full/fast mock 顺序断言，证明新增 frontend-only 合同没有悄悄改写常规部署流程（`deploy/scripts/test-deploy-staging.sh:43-128`）。

这组测试证明仓库内的命令合同只选择 frontend；真实 Hostdzire 不变量仍必须由执行时的前后快照与探针证明，不能用静态测试冒充外部验证。

### 9. External references

- [Docker Compose `up`](https://docs.docker.com/reference/cli/docker/compose/up/)：service selector、recreate 行为、`--no-deps`、`--no-build`、`--pull`、`--force-recreate`、`--wait` 的官方合同。
- [Docker Compose production redeploy](https://docs.docker.com/compose/how-tos/production/)：官方单 service redeploy 示例使用 `docker compose up --no-deps -d web`。
- [Compose Build Specification](https://docs.docker.com/reference/compose-file/build/)：service 同时声明 `build` 与 `image` 时由 pull policy 决定行为；缺省时不能把 `--no-build` 等同于“固定本地 artifact”。
- [Compose services / `pull_policy`](https://docs.docker.com/reference/compose-file/services/#pull_policy)：`never` 只使用平台缓存，缺失 image 时失败。
- [Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)：shell 插值变量优先于 `--env-file`，并可用 `docker compose config` 核对最终模型。
- [Docker Compose `config`](https://docs.docker.com/reference/cli/docker/compose/config/)：渲染实际应用到 Engine 的模型，支持指定 service、JSON 和 `--no-env-resolution`。

### 10. Related specs

- `.trellis/spec/infra/index.md`：基础设施写操作必须有精确目标、验证阈值与回滚，不能把“启动成功”当业务通过。
- `.trellis/spec/infra/domain-security-operations.md`：外部配置变更与 Nginx reload 是独立边界；本方案不修改 Nginx。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨层 owner 与数据流必须完整闭环；本方案把 UI artifact、Compose service、backend runtime、DB revision 分开核对。
- `docs/operations.md:46-54`：数据库默认 forward-only，应用回滚只允许当前数据库契约兼容版本；状态机/数据契约不兼容时不得接回旧 backend。

## Caveats / Not Found

- 用户点名的 `docs/frontend-v2/10-implementation-roadmap.md` 当前不存在；`docs/frontend-v2/` 只到 `09-architecture-decisions.md`，Phase 9 roadmap 实际在 `docs/frontend-v2/07-migration-plan.md:514-552`。
- 本任务明确禁止 SSH，因此没有重新确认 Hostdzire 的 Docker Compose 版本、当前 container/image 状态或远程 dry-run。已有 Runbook 使用 `--wait`，但实际切换前仍应只读确认所有所需 flags。
- `<V2_RELEASE>` 与 `<V2_IMAGE_ID>` 只有候选完整发布构建后才能冻结；缺少任一值都不能执行 fallback/restore 合同。
- 本文件只审计 deployment scope isolation，不判定 V1 frontend 对 candidate backend 的 API/Auth/permission 兼容性；该证据若不成立，整体 Task 必须 `BLOCKED`。
- 未执行任何 Staging activation、rollback、Compose `up`、build、pull、migration、Nginx、SSH 或 production 操作。
