# Frontend V2 Phase 9 Staging V1 UI 回退实施计划

## 状态

- [x] clean `main` 基线与 HEAD 已冻结。
- [x] 已创建用户授权的唯一临时分支和 Trellis Task。
- [x] deployment、V1 API compatibility、database/backend 三条证据链已完成。
- [x] PRD、design、implement 已形成可 review 版本。
- [x] 用户在后续消息明确批准最新规划。
- [x] 批准后执行 `task.py start` 并加载实施阶段上下文。
- [x] 完成最小实现、验证、diff 自审和文档一致性检查。
- [x] 已展示 commit plan，用户已确认按计划提交并归档收尾。

## 阶段 0：批准门禁

用户已批准当前 PRD/design/implement，总结后的实施启动命令已执行：

```sh
python3 .trellis/scripts/task.py start \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-v1-rollback-compatibility-blocker
```

随后已重读 Task artifacts 和相关 spec，确认分支、HEAD、dirty allowlist 与规划一致。

## 阶段 1：更新权威 Runbook

### 1.1 主流程摘要

修改 `docs/Hostdzire部署上线流程.md` 第 7 节：

- 删除 `0043` 后进入旧 release 并重启整栈的过期说明。
- 明确数据库只前进、candidate backend 长驻、只切 Compose `frontend`。
- 明确历史 release/frontend/backend 都不是迁移后 rollback target；目标是 candidate-aligned V1 artifact。
- 链接附录的精确命令、快照和停止条件。

### 1.2 可执行附录

重写 `docs/Hostdzire部署附录.md` 第 5.1 节：

1. 固定 candidate release 和 V1/V2 repo/tag/image ID。
2. 将 candidate-aligned V1 artifact 的 Docker 构建放在 full deployment/migration 前，未构建成功就停止。
3. 定义 protected service、migrate container、DB revision 和 `current` 的非敏感前后快照。
4. 写入对称的 V1 fallback / V2 restore 原生 Compose 命令。
5. 写入 image ID、loopback/public UI marker、V1/V2 不同 source-map 期望和浏览器验收。
6. 写入任一 protected state 变化、artifact 不匹配、命令不支持或 UI/API 不兼容时立即停止。

附录中只更新后续操作者的审核合同，本 Task 不执行其中的 SSH 或远程命令，不改 Nginx 回滚或数据库恢复边界。

## 阶段 2：添加最小定向测试

只扩展 `deploy/scripts/test-deploy-staging.sh`，不新增 operational 脚本或 test framework。

### 2.1 Compose 模型

- 保留现有 frontend image expression、V2 build context、loopback port 断言。
- 渲染只指定 `frontend` 的 Compose JSON，用 Python 标准库断言 services key 精确为
  `frontend`，image 精确等于注入的 repo/tag，且没有 `depends_on`/`links`。

### 2.2 命令合同

- 对 V1/V2 两个命令形状断言唯一 service=`frontend`。
- 同时断言 `--no-deps --no-build --pull never --force-recreate --wait --wait-timeout 60`。
- 断言不包含 `api worker scheduler fake-oss postgres redis migrate`、`build`、`run`、
  `alembic`、`seed`、`down`、`stop`、`restart`、`rm`、`--remove-orphans` 或 `current` 写入。
- 断言 Runbook 同时要求镜像 ID 前置/后置核对、六个 protected service、migrate container、DB revision 和 `current` 前后比较。
- 保留现有 full/fast mock 序列断言，证明本 Task 未改变日常发布入口。

测试只验证仓库内命令和 Compose 合同，不执行真实 `up`、migration 或远程操作。

## 阶段 3：同步 Frontend V2 权威文档

- `docs/frontend-v2/07-migration-plan.md`：记录历史 artifact 被排除、candidate-aligned V1 artifact、
  frontend-only 不变量与外部 Gate 仍需后续 staging activation 验证。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：记录现有 V1 E2E 实际证明的范围、
  新定向命令门禁和 protected-state 运行验证。
- `.trellis/spec/infra/domain-security-operations.md`：修正与 `0043` 后回退边界冲突的完整 release 回滚旧通则。
- 不创建不存在的 `docs/frontend-v2/10-implementation-roadmap.md`；在 Task 中记录
  07 是实际 Phase 9 roadmap owner。

## 阶段 4：最小但充分验证

### 必需验证

```sh
sh -n deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-staging.sh
make test-deploy-scripts
git diff --exit-code \
  3c93e8b2d164f57b2ef253bad010bb9e0e1d7403..HEAD -- \
  frontend backend contracts deploy/scripts/e2e-local.sh
git diff --exit-code -- \
  frontend backend contracts deploy/scripts/e2e-local.sh
git diff --check
python3 .trellis/scripts/task.py validate \
  .trellis/tasks/08-25-frontend-v2-phase-9-staging-v1-rollback-compatibility-blocker
```

执行时先查看 `task.py validate --help` 或现有用法；如命令形状不同，使用仓库实际支持的等价调用，不猜参数。

`make test-deploy-scripts` 已包含 V2 production container 验证；不重复跑同一脚本无意义的等价次数。

### 不默认重跑的重型门禁

不默认重跑 `make verify` 或 `make e2e`，原因是本 Task 不修改 `frontend/`、backend、
contracts、DB 或 E2E runner，Phase 8 已在完全相同产品树上观测 V1 `52 passed`。
上述 `git diff --exit-code` 是继承该证据的必要连续性检查。如它失败，立即停止，将相关 V1 真实栈验证升为必需，不用过期结果继续。

### 外部验证边界

不 SSH、不执行 staging Compose `up`、不构建 Hostdzire artifact、不查询真实 staging DB，
不做 activation/rollback/rehearsal。这些动作只能在本合同获批准、实现和提交后，由后续独立 staging activation Task 按新 Runbook 另行授权。

## 阶段 5：diff 自审与提交门禁

实现后检查：

- changed files 只有当前 Task artifacts/research、`deploy/scripts/test-deploy-staging.sh`、
  两份 Hostdzire Runbook 和 Frontend V2 07/08。
- `deploy/compose.staging.yaml`、`deploy-staging.sh`、`redeploy-staging-fast.sh`、backend、contracts、
  migration、frontend V1/V2 产品码和 production 配置无差异。
- 没有第二套 deployment framework、脚本、兼容字段、隐式 fallback、floating tag、并行状态 owner 或无关整理。
- 文档不宣称未执行的 staging/image/container 行为已被观测。

验证和自审完成后，向用户展示：

1. changed files 与每个文件的唯一责任；
2. 架构决定：历史 artifact 被排除，candidate-aligned V1 + candidate backend + 0043；
3. 实际运行的验证与跳过的重型门禁及理由；
4. 未解决的外部 artifact/staging 证据；
5. 单一原子 commit plan 和建议 message。

用户已确认单一工作提交；提交后按 Trellis 流程归档并记录 session journal。不 push、不合并
main、不删分支、不开始后续 Task。

## 实际验证结果（2026-08-25）

- `sh -n deploy/scripts/test-deploy-staging.sh`：通过。
- `deploy/scripts/test-deploy-staging.sh`：通过；Compose 只渲染 `frontend`，frontend-only
  命令合同和既有 full/fast mock 序列均通过。
- `make test-deploy-scripts`：通过；同时通过 V2 production container fallback、缓存和
  source map 自检。
- Phase 8 commit range 与当前 worktree 的 `frontend backend contracts deploy/scripts/e2e-local.sh`
  连续性检查：均通过，无差异。
- `git diff --check`：通过。
- `task.py validate`：`implement.jsonl`、`check.jsonl` 各 8 条，全部通过。
- 未运行 `make verify`/`make e2e`：产品树和 E2E runner 无差异，按计划继承 Phase 8 V1
  `52 passed`、unit `205 passed`、visual `24 passed`；未执行任何外部 staging 操作。
