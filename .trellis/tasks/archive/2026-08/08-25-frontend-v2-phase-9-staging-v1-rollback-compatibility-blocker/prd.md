# Frontend V2 Phase 9 Staging V1 UI 回退兼容合同

## 目标

建立一个可审计、可停止、可恢复的 Staging V1 UI 回退合同：数据库升级到
`0043_geo_platform_identity` 后只切换 Compose `frontend` service，API、worker、
scheduler 和 `fake-oss` 始终保持 V2 candidate backend，不让旧 backend 连接迁移后数据库。

## 基线与判定

- 任务创建前 clean `main` 基线为
  `e1ab8774aa804433d839a5f6e87c6266363ea7f8`，本 Task 使用已授权临时分支
  `codex/frontend-v2-phase-9-staging-v1-rollback-compatibility-blocker`。
- 上一历史 release 为 `mvp-20260806-195740-afb1b8c82f40`；其 backend 不写
  `publication_works.platform_profile_id_snapshot`，绝不得接回 `0043` 数据库。
- 该历史 release 的 frontend 也缺少多个当前 API 必需的 revision 参数，不能作为
  已验证的完整 V1 UI 回退 artifact。
- 安全目标改为从最终 candidate release 中保留的当前 `frontend/` 构建并冻结
  `partsignal-frontend-v1:<candidate-release>`。该 V1 源码已与 candidate backend/head DB 完成
  Phase 8 V1 E2E `52 passed`、unit `205 passed`、visual `24 passed` 及 production build；
  固定基线后上述产品树无差异。

## 范围

- 冻结数据库只前进、candidate backend 长驻、frontend-only 切换和固定 artifact 身份
  四类不变量。
- 冻结 V1 UI fallback 与 V2 restore 的精确 Compose 命令、前后快照、验证方法和
  失败停止条件。
- 扩展现有 `deploy/scripts/test-deploy-staging.sh`，定向证明命令只选择
  `frontend`，不构建、拉取、启动、重建或删除 backend/database/migration service。
- 更新 Hostdzire Staging Runbook 与 Frontend V2 Phase 9 权威文档。
- 保留历史 V1 release/image/source，但明确它不是 `0043` 后的 rollback target。

## 不在范围

- 不 SSH 登录或修改 staging，不实际 activation、rollback、restore 或演练。
- 不操作 production、Nginx、DNS、证书、外层代理或公网业务数据。
- 不修改 backend、OpenAPI、数据库合同或 `0043` migration；不增加旧 backend 字段、
  default、fallback、alias 或 compatibility proxy。
- 不执行 Alembic downgrade、数据库 restore、seed 或任意 SQL 修改。
- 不新增切换脚本、Compose 副本、deployment framework、feature flag 或第二套发布状态。
- 不删除 `frontend/`、V1 image、旧 release，不开始 legacy redirect、
  production-like rehearsal 或任何后续 Phase 9 Task。
- 不 push。本 Task 提交前必须先展示 commit plan 并等待用户确认。

## 需求

1. 数据库 migration 只允许前进；frontend fallback/restore 命令不得包含任何
   migration、downgrade、restore、seed 或数据库写入。
2. `api`、`worker`、`scheduler`、`fake-oss` 在迁移后始终运行与 `0043` 兼容的
   同一 V2 candidate backend；回退/恢复不得重建、替换、重启或混用任何后端 release。
3. 历史 `mvp-20260806-195740-afb1b8c82f40` frontend/backend 都不得作为 `0043`
   后的 rollback target。V1 UI 目标必须由最终 candidate 的当前 `frontend/` 构建。
4. V1/V2 artifact 都必须使用固定 release tag 并记录 Docker image ID；禁止 floating tag、
   现场改 build context 、回退时 build 或缺镜像时 pull。
5. 从 candidate release 自身的 `compose.staging.yaml` 执行切换。两个命令必须只选
   `frontend`，并同时使用 `--no-deps --no-build --pull never --force-recreate --wait`；
   不调用 `deploy-staging.sh`、不使用 `--remove-orphans`。
6. 回退时仅将 `PARTSIGNAL_FRONTEND_IMAGE` 切到
   `partsignal-frontend-v1:<candidate-release>`；恢复时仅切回
   `partsignal-frontend:<candidate-release>`。`PARTSIGNAL_VERSION` 始终是同一 candidate release。
7. 切换前后必须比较 `postgres redis fake-oss api worker scheduler` 的 container ID、
   image ID、state/health，比较 `migrate` container 集合、`alembic_version` 和
   `/root/partsignal/current`；只允许 `frontend` container/image 变化。
8. V1 fallback 与 V2 restore 后都要核对 frontend image ID、loopback API/HTML、目标 UI marker 和
   相应的公网/浏览器验收。`--wait` 不能代替业务兼容证据。
9. `current` 不作为 UI 流量开关；frontend-only 切换不修改其切换前值、Nginx 或
   release 目录。首次 activation 尚未完成时，`current` 仍可能记录上一已验收 release，
   不得由此推断实际 container image。
10. 当前 V1 产品树、candidate backend/contract 或已引用的 Phase 8 门禁基线有新差异时，
    必须重跑相关 V1 真实栈验证；不得用旧结果或当前 dev server 证据冒充历史镜像。

## 验收标准

- [x] PRD、设计、实施计划完整区分历史 artifact、candidate-aligned V1 artifact 与 candidate backend。
- [x] 历史 V1 frontend 因已知 API revision 漂移被明确排除；历史 V1 backend 因 `0043`
  snapshot 写入合同被硬禁止。
- [x] Runbook 冻结 candidate-aligned V1 artifact 的迁移前构建/tag/image ID 步骤。
- [x] Runbook 给出仅切 `frontend` 的 V1 fallback 和 V2 restore 精确命令，以及完整的前后不变量比较。
- [x] 定向测试证明 Compose 渲染服务集精确为 `frontend`，命令同时包含
  `--no-deps --no-build --pull never --force-recreate --wait`，且不包含 backend/base/migrate
  service、build、migration、seed、down/restart/remove-orphans 或 `current` 写入。
- [x] 既有 full/fast staging 发布命令序列和 Compose runtime owner 未被改写。
- [x] Hostdzire 主 Runbook、附录、Frontend V2 07/08 和相关 infra spec 与合同一致。
- [x] `docs/frontend-v2/10-implementation-roadmap.md` 不存在的事实已记录；不为复制
  `07-migration-plan.md` 的 Phase 9 owner 而创建第二份文档。
- [x] 最小相关验证通过，差异不包含 backend、database、OpenAPI、migration、Compose 拓扑或运行型部署脚本改动。
- [x] 未执行 SSH、staging/production 操作、activation/rollback、downgrade、push、后续 Task 或未经确认的 commit。

## 失败停止条件

以下任一项使方案或未来激活继续保持 `BLOCKED`，不得以兼容 hack 规避：

- candidate-aligned V1/V2 release tag 或 image ID 无法固定、本地镜像不存在或身份不匹配。
- 只有历史 release 镜像可用，但 candidate-aligned V1 artifact 无法在 migration 前构建和冻结。
- 当前 V1 UI 与 candidate API/head DB 的证据过期、失败，或用历史 artifact 冒充当前门禁结果。
- Compose config/dry-run/定向测试显示除 `frontend` 外的服务将被操作，或所需 flags 不受目标 Compose 版本支持。
- 切换前 backend 集合不是同一健康 candidate、DB revision 不是预期 `0043`，或
  `current`/Nginx 状态无法冻结。
- 切换后任一 protected service、migrate container 集合、DB revision、`current` 或 Nginx 发生变化。
- 为继续而准备旧 backend、Alembic downgrade、数据库 restore、新兼容字段/fallback、第二套部署框架或现场改 context。

## 授权与提交

用户已在 2026-08-25 后续消息明确批准最新规划，`task.py start` 已执行。实现完成后
仍必须展示 changed files、验证结果和 commit plan，再等待用户确认；不自动 commit 或 push。
