# Frontend V2 Phase 6 integration verify blocker 修复设计

## Status

`in_progress`。用户已批准规划；Task 已在唯一授权分支 `codex/frontend-v2-phase6-integration-verify-blockers` 启动。

## 1. Decision summary

两个失败的权威 owner 都是 integration test：GEO fixture 没有构造当前 schema 要求的完整冻结来源，migration test 没有随唯一 Alembic head 前移。production 现状符合 schema、service、database spec 和已批准行为，因此设计不修改 production。

## 2. B-01 owner and correction

权威链路为：

```text
GeoInsightCoverageItem validator
  -> geo_observation production builder
  -> GeoQuestionCoverageGapBasis.model_dump(mode="json")
  -> ContentTaskGeoSource.basis_snapshot
  -> Content Task Detail strict validation
  -> compact UI projection
```

测试必须在 `basis_snapshot.item` 补齐 production 已冻结的 `optimization_action`，并保持与 item 和外层 `ContentTaskGeoSource` 的日期、问题和平台完全一致。Detail response 仍只暴露现有 compact basis；不把内部 action 扩到 API response，也不削弱 adapter。

## 3. B-02 owner and correction

仓库当前唯一 Alembic head 是 `0043_geo_platform_identity`。fresh migration test 中两处 `alembic_version` 查询分别证明：

1. 空库执行 `upgrade head` 后位于当前 head；
2. 受保护 downgrade 失败后事务没有改变当前 revision。

两处都应精确断言 `0043_geo_platform_identity`。测试不能通过运行时读取 head 来生成期望值，否则会失去回归能力；其它故意定位 `0042`/`0043` 边界的 migration 专项测试不变。

## 4. Exact writable scope

- `backend/tests/integration/test_content_task_detail.py`
- `backend/tests/integration/test_migrations.py`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/tasks/08-16-frontend-v2-phase6-integration-verify-blockers/`

不修改 `backend/app/`、`backend/alembic/versions/`、contracts、frontend、E2E orchestration 或依赖文件。

## 5. Behavior and compatibility

- 产品、API、数据库 schema、migration graph、权限和部署行为全部保持。
- 只让测试工件与当前严格合同一致；不接受旧不完整 snapshot，不新增兼容读取路径。
- 不添加通用 fixture/helper，因为只有两个局部过期值，没有稳定复用边界。

## 6. Documentation and Gate ownership

`07-migration-plan.md` 和 `08-testing-quality-and-acceptance.md` 只追加本 Task 的实际修复、验证和 cleanup 证据。归档 Task 保持不可变。

Gate 判定矩阵保持六类：Product、Engineering、UX/Accessibility、Architecture、Contract/Data Integrity、Documentation。只有唯一最终候选 `make verify` 完整退出 0、cleanup 完整且 open P0/P1/P2 为 `0/0/0`，Engineering 与整体 Phase 6 Exit Gate 才能从 `NOT_MET` 改为 `MET`。

## 7. Risks and controls

- **遗漏同函数第二处 head 断言**：实施时同时修改两处 current-head 期望，并由完整目标测试执行到 downgrade 后断言。
- **fixture 形状仍不等同 production JSON**：使用 production `model_dump(mode="json")` 的字段和值类型，日期写为 ISO 字符串。
- **误把测试修复扩为 production 放宽**：diff review 拒绝 schema/service/migration 变化、fallback 和弱断言。
- **最终门禁出现新 blocker**：先做因果归因；无关 owner 不自动纳入本 Task，也不第二次运行完整门禁。
