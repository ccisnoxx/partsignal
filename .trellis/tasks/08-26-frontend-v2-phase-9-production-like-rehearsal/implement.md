# Frontend V2 Phase 9 Production-like Rehearsal 实施计划

## 当前状态

规划完成，等待用户审阅。父 Task 与子 Task 均未执行 task.py start；没有 production、SSH、部署、浏览器或清理操作。

## Phase 0：依赖闸门

1. 先实施并完成子 Task frontend-v2-phase-9-production-snapshot-sanitization。
2. 子 Task 必须独立提交、Gate=MET，并交付 design.md 第 2 节全部 manifest 字段。
3. 重新把子 Task 的最终归档路径和 evidence 加入本 Task manifests。
4. 再从 clean main 固定包含 bcb10d3b... 的 candidate；展示本 Task 外部执行计划并取得逐阶段授权。

父 Task 在子 Task 完成前保持 planning，不得先启动或并行搭 clone。

## Phase 1：仓库与 artifact 准备

1. 只读确认 main、origin/main、candidate ancestry 与工作树状态。
2. 构建并冻结 V2 production image；记录 Git SHA、image ID/checksum、package-lock checksum、API base 和 source-map policy。
3. 运行 V2 container smoke、legacy-routing/auth-session production-artifact specs。
4. 生成仓库外 rehearsal env 模板清单；真实 secret/DSN 不写入仓库或命令输出。
5. 在 research/evidence.md 记录准备结果和待授权外部步骤。

若 candidate 不是 clean main 后继、artifact 不能追溯或 Required Validation 失败，停止。

## Phase 2：外部只读 preflight

需单独授权只读检查专用临时环境：

1. 主机 identity、磁盘容量/加密、访问 owner、防火墙和无公网监听；
2. 当前无 Staging/production/shared Compose owner、端口、network 或 data root；
3. run ID、clone database/role、Redis DB、object namespace 和 private access 计划；
4. sanitized dump path/size/SHA-256 与子 Task manifest；
5. 外部 egress deny 与 scheduler-disabled 方案。

任何冲突、容量不足、checksum 不一致或授权缺失即停止；不创建资源。

## Phase 3：创建 clone 与恢复

需单独授权创建/写入专用临时环境：

1. 创建精确命名的 clone DB/role、Redis DB、object namespace 和 environment file；
2. 只向 clone 传输 sanitized dump 和固定 V2 artifact；
3. 校验 checksum 后设置 VERIFY_DATABASE_URL，运行 deploy/scripts/restore-verify.sh；
4. 运行子 Task verifier并核对数据 profile；
5. 只在 clone 执行 Alembic upgrade head 与 app.cli preflight-integrity；
6. 运行 seed-demo 创建本轮测试账号；
7. 保存 pre-runtime snapshot。

不传输 raw dump、production DSN、production credential 或 object payload。

## Phase 4：启动私有 runtime

1. Compose config 必须解析为本轮 image、data root、localhost ports 与私有 networks。
2. 只启动 postgres、redis、fake-oss、api、必要 worker、frontend；确认 scheduler/migrate 常驻集合为空。
3. 验证配置无 OSS/真实 AI/邮件/第三方发布 credential，CONTENT_GENERATOR=deterministic。
4. 以网络探针证明 API/Worker 无外部 egress。
5. 验证 live/ready、frontend title、SPA fallback、hashed assets、cache、map 404 与 CSP/source-map 合同。

任一未知 process、external connection、shared owner 或 health 失败即停止并关闭应用服务。

## Phase 5：Required Validation

### 仓库与 artifact

    git merge-base --is-ancestor bcb10d3b33b14c965cc9af1e20705db3cadfe03d HEAD
    npm --prefix frontend-v2 run build
    deploy/scripts/test-frontend-v2-container.sh
    npm --prefix frontend-v2 run e2e -- tests/e2e/legacy-routing.spec.ts tests/e2e/auth-session.spec.ts

### Clone 数据与完整性

在仓库外注入实际 DSN：

    VERIFY_DATABASE_URL=$REHEARSAL_DATABASE_URL deploy/scripts/restore-verify.sh $SANITIZED_SNAPSHOT_PATH
    DATABASE_URL=$REHEARSAL_DATABASE_URL backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
    DATABASE_URL=$REHEARSAL_DATABASE_URL backend/.venv/bin/python -m app.cli preflight-integrity

恢复命令只执行一次；若已在 Phase 3 完成，不为留日志机械重跑。

### V2 real-stack

    PARTSIGNAL_E2E_REAL_STACK=1 \
    PARTSIGNAL_E2E_API_BASE_URL=$REHEARSAL_API_URL \
    PARTSIGNAL_E2E_V2_BASE_URL=$REHEARSAL_V2_URL \
    PARTSIGNAL_SEED_ADMIN_PASSWORD=$REHEARSAL_ADMIN_PASSWORD \
    PARTSIGNAL_SEED_ENGINEER_PASSWORD=$REHEARSAL_ENGINEER_PASSWORD \
    npm --prefix frontend-v2 run e2e -- \
      tests/e2e/ai-channel-configuration-real-stack.spec.ts \
      tests/e2e/product-facts-real-stack.spec.ts \
      tests/e2e/content-ai-real-stack.spec.ts \
      tests/e2e/content-review-real-stack.spec.ts \
      tests/e2e/content-version-detail-real-stack.spec.ts \
      tests/e2e/publication-workspace-real-stack.spec.ts \
      tests/e2e/geo-real-stack.spec.ts \
      tests/e2e/auth-session-real-stack.spec.ts \
      tests/e2e/system-admin-real-stack.spec.ts \
      --project=foundation-desktop

### Production-like browser

使用 playwright-cli session production-like-rehearsal-<run-id>，执行 design.md 第 8 节 walkthrough；结束前关闭该 session，并确认本 Task 未留下打开的 session。

### 任务一致性

    git diff --check
    python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-like-rehearsal

不默认运行 backend/full frontend suites、make e2e 或 make verify；本 Task 不修改共享产品合同，最小 real-stack 与 artifact gate 直接覆盖请求结果。

## Phase 6：判定与文档

1. 保存 post-browser snapshot，并与 pre-runtime 比较只允许本轮测试业务/对象/Redis变化。
2. 汇总实际 suite 结果、关键数据 profile、运行耗时、对象 key、runtime 错误与 open P0/P1/P2。
3. 全部条件满足才判定 Gate=MET，并更新 docs/frontend-v2/07 与 08。
4. 任一条件失败判定 NOT_MET；保留历史 Staging Gate，不创建修复或后续 Phase 9 Task。

## Phase 7：Cleanup 授权

在用户确认 exact targets 后，按依赖反序分别清理：

1. 停止并验证 frontend/API/Worker；
2. 删除本轮 fixture object keys，确认 namespace 空；
3. 清理仅属于本轮的 Redis keys/DB；
4. 删除 clone database/role；
5. 删除 sanitized artifact 副本和临时 environment secret；
6. 销毁临时主机或按批准期限隔离保留。

每一步先验证 run ID/owner；不得使用 broad path、共享 Compose project、通配符或自动 fallback。清理失败时保留现场并 Gate=NOT_MET。

## 预计仓库修改

- 父 Task prd.md、design.md、implement.md、research/evidence.md、manifests/task metadata；
- 子 Task 最终 evidence/manifest 引用；
- Gate=MET 时仅更新 docs/frontend-v2/07-migration-plan.md 与 08-testing-quality-and-acceptance.md。

默认不修改 backend、frontend-v2、deploy、contracts 或 specs。若现有脚本无法安全承载 clone，停止并提出最小 blocker，不在本 Task 新建 orchestration framework。

## Commit 与停止点

- 子 Task 先独立完成、验证和提交；父 Task 后续单独提交 rehearsal evidence/docs。
- 每次提交前展示 exact commit plan 并等待确认；不自动 push/merge/archive。
- 当前停止在最终规划审阅；下一步若获批准，先启动子 Task，不启动父 Task。
