# 配置 IntegrityError 原子性证据收口执行计划

## Phase 0：实施批准门槛

- [x] 本子任务已作为 `09-04-configuration-integrity-error-domain-mapping` 的 child 创建。
- [x] 只读确认父任务 targeted re-review 剩余的唯一 MEDIUM 为 duplicate 失败原子性证据不足。
- [x] 文件边界收缩为两个现有 backend integration test 文件。
- [x] `implement.jsonl` 与 `check.jsonl` 已配置真实 spec/research context 并通过 task validation。
- [x] 用户在本轮最终规划摘要之后明确批准本子任务实施。
- [x] 实施前确认子任务仍为 `planning`、当前 checkout 仍为 `main` same-directory，并记录两个目标文件当时 diff baseline。

未满足全部门槛时，不运行 `task.py start`，不修改测试。

## Phase 1：实施边界

- 只允许修改 `backend/tests/integration/test_ai_channel_management.py` 和 `backend/tests/integration/test_platform_workspace.py`。
- 不允许修改 production/runtime、unit、schemas、contracts、generated、frontend、stable specs、数据库、父任务文档或其他 dirty 文件。
- 子任务测试净增目标 `<=120` 行，硬上限 `150` 行；超过则停止报告，不继续扩张。
- Backend `trellis-implement` 只拥有上述两个文件，不运行 Git；后续独立 `trellis-check` 原则上只读，仅可对两个文件做一轮机械修复和一次 targeted re-check。

## Phase 2：AI Header/Model 原子性断言

- [x] 在现有 AI CRUD 长链路中为 Header create duplicate 添加稳定 request ID 和失败前 snapshot。
- [x] 使用最小 model sentinel 证明 Header create/update duplicate 不触发 model invalidation，并不干扰长链路后续步骤。
- [x] Header create 失败后用新 Session 断言 header identity/count、channel revision、model state 不变，无 `ai_channel_header.created` SUCCESS audit，Session 可查询。
- [x] Header update duplicate 请求增加唯一 request ID；失败后断言目标 Header 完整持久字段、channel revision、count、model state 不变，无 `ai_channel_header.updated` SUCCESS audit。
- [x] Model update duplicate 请求增加唯一 request ID；失败后断言 display name/identity/parameters/revision/enabled/test fields/count 不变，无 `ai_model.updated` SUCCESS audit，新 Session 可查询。
- [x] 不重复既有 HTTP envelope、diagnostics、unknown 500、并发或删除副作用测试。

## Phase 3：Platform Prompt 原子性断言

- [x] 在现有 Prompt precheck/constraint 测试中保存原 Prompt 纯标量 snapshot，避免 rollback 后访问过期 ORM 对象。
- [x] 为 precheck 与 constraint 失败保留不同 request ID。
- [x] 用新 Session 断言仅有原 Prompt，id/name/Markdown/revision 不变，两个 request ID 都无 `platform_prompt.created` SUCCESS audit，Session 可查询。
- [x] 不改写现有 mapper diagnostics 或 humanization 四状态测试。

## Phase 4：Required targeted validation

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest \
  tests/integration/test_ai_channel_management.py::test_ai_channel_api_enforces_permissions_contract_and_secret_redaction \
  tests/integration/test_platform_workspace.py::test_platform_prompt_duplicate_paths_share_field_error_and_diagnostics
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest \
  tests/integration/test_ai_channel_management.py \
  tests/integration/test_platform_workspace.py
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/tests/integration/test_ai_channel_management.py \
  backend/tests/integration/test_platform_workspace.py
git diff --check
```

任一门槛失败后只修复本子任务引入的原因，最多两轮 `repair -> targeted re-check`；同根因重现或第二轮仍失败时停止。

## Phase 5：独立 Check

- [x] 新的 `trellis-check` 只读父任务批准合同、本任务文档、两个实际 diff 和验证结果。
- [x] 全量 review 重点为四条 duplicate 失败原子性、请求审计归属、新 Session 可用性、无弱化断言与文件边界。
- [x] 最多一轮机械 repair 和一次 targeted re-review；同一问题仍在或出现新 MEDIUM 以上时停止。

## Phase 6：返回父任务

- [x] 核对子任务净增不超过 150 行，且相对已记录的父任务 diff 基线，子任务增量只有两个批准测试文件与 task artifacts。
- [x] 若独立 check 无 MEDIUM 以上，子任务证据合并进父任务候选，由父任务执行尚未运行的一次性 `make contract-check` 和最终跨层 review。
- [x] 本子任务不单独修改 specs/docs：它只增加对父任务已记录合同的测试证据。
- [x] 不提交、不 archive、不 push；与父任务的原子 slice 一起进入最终 commit plan。

## Stop Conditions

1. 正确证据需要修改 production code、公共合同、数据库或超出两个允许测试文件；
2. 需要新并发 harness、全局 monkeypatch、warning filter、`noqa` 或新通用测试框架；
3. 子任务测试净增超过 150 行；
4. 证据显示生产实现真实遗留部分写入或 SUCCESS audit；
5. 同一 validation 根因重现，或两轮 repair 后仍失败；
6. targeted re-review 后仍有 MEDIUM 或更高问题。

## Rollback Boundary

- 只精确移除本子任务新增的 snapshot、sentinel、request ID 和 audit/session assertions。
- 不回滚父任务的任何 production/frontend/contract/spec/doc/test 改动。
- 不使用 `git reset --hard`、`git checkout --`、stash 或宽路径删除。
