# Staging V1 UI frontend-only 回退设计

## 1. 架构决定

采用一个权威部署边界：现有 `deploy/compose.staging.yaml` 的 `frontend` service。
不新增服务、Compose 副本或切换脚本。同一 candidate release 中预先冻结两个静态站点镜像：

| 角色 | 镜像 | 源码 owner | backend/DB |
| --- | --- | --- | --- |
| V1 UI fallback | `partsignal-frontend-v1:<candidate-release>` | candidate release 的 `frontend/` | 长驻 candidate / `0043` |
| V2 UI active/restore | `partsignal-frontend:<candidate-release>` | candidate release 的 `frontend-v2/` | 长驻 candidate / `0043` |

历史 `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40` 与其 backend 继续保留，
但两者都不再是迁移后回退 target。这是已验证合同的更换，不是新兼容层。

## 2. 不变量与所有权

### 2.1 数据库和写入 owner

- PostgreSQL 是唯一业务状态 owner，migration 只前进。
- `0043` 后 Publication Work 的 `platform_profile_id_snapshot` 只由 candidate
  `create_publication_work()` 写入，再由 PostgreSQL trigger 最终守卫。
- V1/V2 frontend 都只发送公开两字段创建合同，不看到 snapshot，不需要 frontend 兼容字段。

### 2.2 backend 运行 owner

- `api`、`worker`、`scheduler`、`fake-oss` 以同一 candidate release 长驻。
- frontend-only 命令不启动 dependency，不重建、pull、build、restart 或 replace 上述服务。
- `postgres`、`redis` 同样不变；`migrate` 不产生新 one-off container。

### 2.3 frontend artifact owner

- V1 fallback 镜像从最终 candidate release 的 `frontend/Dockerfile` 和 `frontend/` 构建；不从历史 release 构建。
- V2 镜像继续由现有 Compose `frontend.build.context=../frontend-v2` 和完整发布脚本持有。
- 两个镜像使用同一 candidate release tag，通过不同 repository 区分 UI 代际，并冻结 image ID。
- V1 现有 production source map 行为不在本 Task 中改写；V2 restore 仍必须恢复
  `.map=404` 且无 `sourceMappingURL` 的 V2 Required 合同。这是已知的临时 V1 回退取舍，
  不得将 V1 marker 误判为 V2 验收通过。

### 2.4 release 记录 owner

`/root/partsignal/current` 只记录最后完成相应验收的 release，不是容器流量开关。首次
activation 失败时它仍可能指向上一 release；UI fallback/restore 只要求切换前后值精确
不变，不用其推断实际 container image。

## 3. artifact 预置与冻结

以下步骤属于未来 staging activation 的迁移前门禁，本 Task 不执行：

1. 固定唯一 `<candidate-release>` 和 candidate release 目录。
2. 从该目录构建
   `docker build -f frontend/Dockerfile -t partsignal-frontend-v1:<candidate-release> frontend`。
3. 立即用 `docker image inspect` 记录 V1 image ID；镜像缺失、tag 漂移或 ID 不一致时停止。
4. 完整 staging 发布仍由 `deploy-staging.sh` 构建 V2 与 candidate backend 并执行 migration。
   任何 fallback 之前再冻结当前
   `partsignal-frontend:<candidate-release>` 的 V2 image ID。
5. 两个镜像任一未冻结，都不得进入可执行 rollback 状态。

不修改 `deploy-staging.sh` 来增加预构建模式，不新增 `PARTSIGNAL_FRONTEND_VERSION`：
V1 镜像仅需一条 Docker 原生构建命令，切换时 `PARTSIGNAL_VERSION` 始终保持 candidate。

## 4. 精确 frontend-only 命令

两条命令都从 candidate release 的 `deploy/` 目录执行，先用
`docker compose ... config --images frontend` 核对唯一目标 image ref，再执行：

```sh
# V1 UI fallback
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 \
PARTSIGNAL_VERSION="$ps_candidate_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

```sh
# V2 UI restore
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend \
PARTSIGNAL_VERSION="$ps_candidate_release" \
docker compose --env-file ../.env.staging -f compose.staging.yaml \
  up -d --wait --wait-timeout 60 --no-deps --no-build --pull never \
  --force-recreate frontend
```

命令语义：

- 最后唯一 service selector 为 `frontend`。
- `--no-deps` 禁止关联服务启动；`--no-build` 禁止构建；`--pull never` 禁止拉取或隐式替换镜像。
- `--force-recreate` 仅作用于已选中 frontend，确保镜像切换真正落地；`--wait` 只验证容器健康。
- 命令不包含 `--remove-orphans`、`--always-recreate-deps`、`deploy-staging.sh`、migration、seed、
  `current` 或 Nginx 操作。

## 5. 切换前后快照

Runbook 使用原生 Compose/Docker/PostgreSQL 命令产生两组非敏感快照，切换前后用
`cmp` 精确比较：

1. 对 `postgres redis fake-oss api worker scheduler` 逐一记录 container ID、image ID、
   state 与 health；不输出 environment。
2. 通过 Compose project/service labels 记录 `migrate` container ID/image/status 集合。
3. 读取 `alembic_version`，必须始终精确等于 `0043_geo_platform_identity`。
4. 读取 `/root/partsignal/current` symlink，必须始终精确不变。
5. 单独核对 frontend container `.Image` 等于目标冻结 image ID。

任一 protected 快照变化，即使服务最终显示 healthy，也视为合同违反。

## 6. 验证矩阵

| 边界 | 本 Task 仓库证据 | 未来 staging 执行证据 |
| --- | --- | --- |
| V1 UI / candidate API | Phase 8 当前 V1 真实栈 `52 passed`，产品树无差异 | 固定 image ID、目标 marker、真实公网/浏览器验收 |
| candidate API / 0043 | service 写 snapshot、migration trigger 与 integration tests | DB revision 前后为 0043，API ready 不变 |
| Compose 操作范围 | `config frontend`、精确 flags、mock/静态定向测试 | dry-run 只计划 frontend，protected snapshots 完全一致 |
| 可恢复性 | 对称 V1 fallback / V2 restore 命令 | V2 image ID、V2 marker、`.map=404`、浏览器合同 |

本 Task 不跑新的 production-like rehearsal，也不用开发服务器冒充历史镜像。仓库验证固定命令与
已测当前 V1 source 的身份连续性；外部 artifact/container 身份只能在后续获得 staging 授权后验证。

## 7. 文档与测试 owner

- `deploy/compose.staging.yaml`：不修改，现有 service/image/context/network 已足够。
- `deploy/scripts/deploy-staging.sh` 与 `redeploy-staging-fast.sh`：不修改，它们是整栈发布入口，不是 UI switch owner。
- `deploy/scripts/test-deploy-staging.sh`：复用现有 shell test，补 frontend-only 渲染、flags、禁止操作与 Runbook 同步断言。
- `docs/Hostdzire部署上线流程.md`：用 frontend-only 不变量替换过期整栈 V1 回滚摘要。
- `docs/Hostdzire部署附录.md`：持有 artifact 冻结、快照、精确 fallback/restore 命令和失败处置。
- `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md`：记录 Phase 9 方案、证据边界与后续外部 Gate。
- `.trellis/spec/infra/domain-security-operations.md`：移除“健康失败即可完整 release 回滚”的过期通则，保持数据库兼容边界。
- 不创建缺失的 `docs/frontend-v2/10-implementation-roadmap.md`；Phase 9 roadmap 的权威 owner 是 07。

## 8. 失败处理

- fallback 开始前任一门禁失败：不执行 `up`，保留 V2/candidate/0043 现状。
- fallback 后 V1 UI 验证失败：只使用已冻结 V2 restore 命令；不触碰 backend 或 DB。
- V2 restore 失败或 protected snapshot 改变：停止所有新操作，保留非敏感证据，不用旧 backend、downgrade 或 restore 自救。
- 若发现原生 Compose 命令不能保持范围隔离，本 Task 直接判定 `BLOCKED`，不新增兼容 hack。
