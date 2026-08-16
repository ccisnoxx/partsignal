# Frontend V2 Phase 6 integration verify blocker 修复

## Goal

关闭当前候选 `make verify` 在 PostgreSQL integration 阶段暴露的两个 P2 blocker，并在保持 production、数据库迁移与业务合同不变的前提下重新运行最终候选门禁，据实重新判定 Phase 6 Exit Gate。

## Confirmed facts

- 规划基线为 clean `main` at `e3803c8c89487802e9c14084bf6629d32413c7b2`，相对 `origin/main` ahead 222；本 Task 不因此 pull 或 push。
- 前置 Task `frontend-v2-phase6-verify-blockers` 已归档并 fast-forward 合入 `main`；原 10 个 Frontend V2 unit blocker 已关闭。
- 前置候选唯一一次 `make verify` 已通过合同、lint/typecheck、backend unit `193 passed`、V1 unit `205 passed`、visual contract `24 passed` 和 V2 unit `427 passed`，随后在 integration 以 `114 passed / 2 failed` 停止；build、real-stack E2E 与 Compose config 未运行。
- 两个失败均位于当前分支零 diff 的 backend integration tests：Content Task Detail 的 GEO coverage snapshot 缺当前合同字段；fresh migration head 期望落后于当前 Alembic head。
- 当前 open P0/P1/P2 为 `0/0/2`，Engineering 与 Phase 6 Exit Gate 为 `NOT_MET`。
- 当前 Task 已在唯一授权分支 `codex/frontend-v2-phase6-integration-verify-blockers` 进入 `in_progress`；production、schema、migration、API 和业务行为均未修改。

## Requirements

### R1. 独立复现并确认两个失败 owner

- 分别运行两个精确 integration test，记录退出码、失败信息、通过/失败/跳过数量与耗时。
- 对照当前 schema、production 创建路径、Alembic head 和迁移测试语义确认 root owner；不因失败位于测试中就默认测试过期，也不通过放宽断言掩盖 production 缺陷。

### R2. 最小修复 GEO coverage snapshot fixture

- 若 production `GeoInsightCoverageItem` 和优化任务创建路径符合当前批准合同，测试 fixture 必须构造完整且内部一致的 `optimization_action`。
- snapshot 的 `rule_code`、`query_topic_id`、`geo_platform` 与 nullable `published_article_id` 必须匹配当前 validation contract。
- 不修改 schema、service、API、数据库、兼容逻辑或 production 行为。

### R3. 最小修复 fresh migration head 期望

- fresh database 执行 `alembic upgrade head` 后应断言仓库当前唯一 head。
- 若 `0043_geo_platform_identity` 是当前唯一合法 head，更新该测试中升级完成及失败降级后的两处过期期望；不得删除 head 断言、动态读取 head 形成同义反复、改成模糊前缀或跳过 migration test。
- 不新增、修改或重排 migration。

### R4. 分层验证并只运行一次最终候选门禁

- 两个目标测试通过后，运行完整 backend integration，再运行与改动直接相关的静态、合同与 diff 检查。
- 前置检查全部通过后，使用本机 PostgreSQL source URL 与独占 Redis DB 14，只对最终候选运行一次 `make verify`。
- 记录各阶段实际通过、失败、跳过数量和耗时，以及 PostgreSQL、Redis、storage、进程、容器和端口 cleanup。
- 若最终门禁暴露新的无关 blocker，先归因并停止扩围，不自动第二次运行完整门禁。

### R5. 据实更新 Phase 6 权威结论

- 更新 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 和本 Task evidence，不修改已归档 Task。
- 只有当前候选 `make verify` 完整通过、cleanup 完整且 open P0/P1/P2 为 `0/0/0`，才能把 Phase 6 Exit Gate 更新为 `MET`；否则保持 `NOT_MET`。

## Acceptance Criteria

- [x] 两个目标 integration tests 分别通过，且 root owner 与实际修复证据写入 Task research。
- [x] GEO fixture 使用当前权威 schema 的完整一致 payload，没有 production/schema/API/database 变化。
- [x] fresh-head test 精确断言当前唯一 Alembic head，没有 migration 变化或弱化断言。
- [x] 完整 backend integration 通过，不再有上述两个 blocker。
- [x] backend lint/typecheck、相关合同检查与 `git diff --check` 通过。
- [x] 最终候选 `make verify` 只运行一次，实际计数、耗时和 cleanup 均被记录。
- [x] `07`、`08` 与当前候选结果一致；完整门禁未通过，因此 Gate 保持 `NOT_MET`。
- [x] 没有产品能力、production、API、数据库、权限、部署、依赖、E2E orchestration、compatibility fallback、通用 helper 或新抽象变化。
- [x] 提交前给出 commit plan 并取得确认；不自动 push 或创建 PR。

## Out of Scope

- Phase 7 功能、Frontend V2 新能力或 UI 变更。
- 修改 GEO Insights、Content Task Detail、migration 或 schema 的 production 合同。
- 修复本次最终门禁中新出现且与两个 integration owner 无因果关系的其它 blocker。
- 清理其它 backend tests、fixtures、migration 期望或历史文档。

## Planning Gate

- 规划已获用户批准；`prd.md`、`design.md`、`implement.md` 和 research evidence 已在 start 前补齐。
- 实施严格使用批准的唯一临时分支，没有额外 worktree 或开发分支。
- 最终候选门禁出现范围外 B-03 后，依停止条件不重跑、不扩围；当前等待 commit plan 确认。
