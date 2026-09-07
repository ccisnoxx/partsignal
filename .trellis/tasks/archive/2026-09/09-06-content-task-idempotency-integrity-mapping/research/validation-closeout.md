# 实施验证与收尾证据

## 证据来源与候选

2026-09-07 收尾核对既有实际 diff 与上一阶段原始 Codex 执行记录；本轮没有改动业务代码或测试，也没有重复已成功且后续变更未影响的正式门禁。

- 实施主会话：`01a074df-b5a3-7693-88c8-f89f72c15865`。
- 最终独立只读检查与 AC5 定点复查：`01a079bb-d8db-7c42-841b-cfb52f0d991e`。
- 原始记录位于本机 `~/.codex/archived_sessions/` 对应 rollout JSONL。以下结果核对了工具退出码和输出，而非只依据规划文件。
- 最终测试 diff 为 `272 additions / 28 deletions = 300`。最后的行为相关变动是 current-head catalog 断言；其后已通过受影响用例和独立定点复查。

## 实际通过的 required validation

| 检查 | 实际命令 | 核实结果 |
| --- | --- | --- |
| PostgreSQL 目标文件，含 HTTP known/unknown | `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_content_task_creation.py -q` | 退出码 0，13 个通过标记，0 skipped；独立记录行 68–77 |
| 最后 catalog 变更的定点复查 | `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest 'tests/integration/test_content_task_creation.py::test_exact_idempotency_constraint_race_recovers_only_verified_winner[unknown]' -q` | 退出码 0，1 passed，0 skipped；行 234–243 |
| Contract/runtime | `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q` | 到达 100%，退出码 0；行 81–96 |
| Ruff | `UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/content_planning.py backend/tests/integration/test_content_task_creation.py` | All checks passed；行 100–103；catalog 后测试文件 Ruff 再通过，行 247–250 |
| Mypy | `UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app` | 80 source files，无问题；行 107–110 |
| Frontend regression | `npm --prefix frontend run test -- src/domains/content/new-content-task-page.test.tsx` | 1 file / 9 tests passed；行 114–123 |
| Diff check | `implement.md` 第 3 节指定四文件的 `git diff --check` | 退出码 0；行 127–130；catalog 后受影响路径再次通过，行 254–257 |
| 零 diff owner | `implement.md` 第 3 节指定 owner 的 `git diff --exit-code` | 退出码 0；行 134–137；本轮提交范围检查也确认整个 `frontend/src/domains/content` 零 diff |

早期本机 PostgreSQL fixture 曾 skip，不能作为成功证据；本记录采用随后容器内真实 PostgreSQL 的实际执行结果。定点复查首次未引用参数中的方括号被 zsh 拒绝，正确引用后通过；该 shell 解析错误不是测试失败。

## 行为与证据边界

- 普通 canonical identity 包含 `product_id`、`fact_version_id`、`platform_profile_id` 和 ordinary source kind（无 `ContentTaskGeoSource`）；普通 lookup 和 exact-race recovery 共享判定，普通请求不会 replay GEO winner。
- 同 identity 返回既有任务，沿用 router 的 `201`；异 identity/GEO winner 返回 `409 IDEMPOTENCY_CONFLICT`。HTTP 测试直接验证准确 409 envelope、中文 message、空 details 与 request ID/header 一致；201 由现有 service replay、未变 router 与 contract/runtime 证据共同支撑。
- 只按 `23505 + uq_content_tasks_idempotency_key` 精确映射；先 root rollback，再查 winner 和验证 identity。真实异常与同测 catalog 联合证明准确约束。
- winner missing、identity 不完整、diagnostics 缺失、其他约束及非 23505 保留原异常；HTTP unknown sentinel 验证默认 500 不泄漏 SQL、表名、constraint、driver message、traceback。
- PostgreSQL same/different/GEO/unknown 竞态覆盖候选任务清理、版本/事实/review/audit 计数和 Session reuse。快照包含 winner revision、pointer、status、source；dispatch 不存在的依据是普通创建 owner 无此调用，不将它写成实际执行过 dispatch spy。
- 原子性结论结合事务 owner 静态检查与数据库计数证据；快照测试未逐字段断言 winner 前后相等，不能声称每个 pointer/revision 字段都已有独立动态断言。
- 正常 advisory-lock 并发只执行一次任务 insert；旁路 writer sentinel 与正常并发保持区分。
- OpenAPI、runtime metadata、generated client、frontend、router 与 GEO owner 零 diff；数据库合同与稳定规范已同步 ordinary identity 和精确恢复边界，无需变更公开合同。
- 新增业务 helper 的非显然分类/identity 边界已有中文 docstring；保留中文冲突 message。本轮不另行修改 Python 注释或开发者可见文本。

## 独立 review 与剩余风险

最终独立只读 full pass 只剩 AC5 catalog 证据 finding；补充当前 schema、表、constraint 类型及精确定义查询后，同一 reviewer 的唯一一次 targeted re-review 关闭 AC5，未发现新的 material finding，明确允许进入 Phase 3.3。未在本轮重开独立 review。

Optional 完整 backend/frontend suite、frontend typecheck/build 未运行。替代证据为上述真实 PostgreSQL/HTTP、contract/runtime、前端定点回归、Ruff、全 backend app mypy 和 diff/独立 review。目标文件以外仍可能存在未被定点检查捕获的间接回归，且原子性逐字段动态断言覆盖具有上文所述限制。

仅归档本 implementation task。`content-integrity-error-contract-decision` 继续作为 I1–I5 planning-only 合同 owner；父任务 `integrity-error-domain-mapping` 继续 planning。
