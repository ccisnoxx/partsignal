# FactVersion IntegrityError mapping 实施计划

## 0. Implementation 边界

用户已明确批准实施，并已运行 `task.py start 09-14-fact-version-integrity-mapping` 将本 Task 置为 `in_progress`。本阶段按已收敛的 PRD、设计和本计划实施 production/test/spec/docs；仍不得提交、归档或 push，除非用户后续另行批准相应动作。

父任务 `09-04-integrity-error-domain-mapping` 与合同决策任务 `09-05-content-integrity-error-contract-decision` 均继续保持 `planning`。本 I5 只处理 `submit_fact_review` 的两个 FactVersion unique enforcement；前置 I1-I4 的实现、归档和 journal 不由本 Task 改动。

## 1. 实施前门禁

1. 确认 primary working directory 位于 `main`；记录 `.gitignore`、大量 artifacts 变更及其他既有 dirty files 的基线，全部保持不动。若允许 owner 内出现无法安全避开的用户修改，停止并报告。
2. 完整读取本 Task 的 `prd.md`、`design.md`、`implement.md`、全部 research 与 JSONL 指定 spec；若上下文注入因 32 KiB 截断，分块读取原文件直至 EOF。
3. 用 `temporary_database()` 创建 fresh PostgreSQL，执行 `alembic upgrade head`，重新断言两个对象的 catalog 定义及真实 `23505` diagnostics；不得沿用 planning probe 代替实施 gate。任何差异触发 scope stop。
4. 记录所有只读/零 diff owner 的 tracked/untracked baseline；不修改父任务和合同 owner 的状态或历史 research。

## 2. Phase A：Backend command owner

Owner：`backend/app/services/product_facts.py`、`backend/tests/integration/test_publication_workflow.py`、`backend/tests/integration/test_product_detail.py`。不修改 router、公共 contracts、unit contract files、模型/schema/migration 或其他 service owner。

1. 先补 classifier exact/negative tests：exact pending；exact version identity；其他/近似 unique；非 23505；缺 `orig`/`diag`/constraint；CHECK/FK/NOT NULL/trigger-like；message 含目标文本但结构化 diagnostics 不匹配。
2. 在 `product_facts.py` 添加最小、无副作用的 pending exact classifier；不抽取全局 registry，不解析异常文本。
3. 在 `submit_fact_review` 写入/flush/commit owner 增加窄 `except IntegrityError`：所有分支先 root rollback；仅 exact pending 转现有 `FACT_REVIEW_PENDING`；其他 bare re-raise 原始异常。
4. 保持 Product `FOR UPDATE`、active/revision/body/pending precheck、version allocation、FactVersion/FactReviewRecord success flow 完全不变；不得修改 `replace_product_facts`。
5. 使用 current-head real-PG one-shot sentinel 分别触发两条 exact constraint，证明 diagnostics、HTTP known/unknown、root rollback、Session reuse 与完整无副作用。listener/marker 必须在 `finally` 清理并断言确实触发。
6. 使用两个独立 Session/connection、event/barrier 与有界 timeout 补 Product-lock 正常并发对照：后到请求走 pending precheck，终局恰有一个 pending FactVersion/一条 ReviewRecord。不得 sleep、mock-only 或削弱生产锁。
7. 比较失败前后 Product workspace/classification/revision、既有 pending与 ReviewRecord、ContentTask pointer、ContentVersion、SUCCESS AuditLog 和 dispatch；不要为测试向 production command 增加其本不存在的副作用。
8. 回归成功 submit、真实 stale `expected_revision`、inactive Product、空 Markdown、权限与其他既有 precheck 优先级。
9. 对实质修改的 Python 函数、复杂异常路径、开发者可见错误/log 执行 touched-scope 中文文档检查；只为非显然职责和边界添加必要中文说明。

## 3. Phase B：Frontend recovery

Owner：`fact-workspace-page.tsx`、`fact-workspace-page.test.tsx`；仅纯投影需要时修改 `fact-workspace.model.ts`、`fact-workspace.model.test.ts`。不修改 shared `product.api.ts` 或 generated schema。

1. 在 model tests 定义 exact pending/revision/generic decision；覆盖 malformed/missing/non-object details、其他 code、缺失/空白 request ID，以及 message 与 code 不一致的反例。
2. 若现有 `mapFactReviewError` 无法安全处理上述 payload，在 model 内增加最小局部 shape guard/recovery projection；不建立全局类型系统，不按 message 分类。
3. 在 page tests 定义 exact pending：准确 message/request ID、workspace 输入和 Dialog summary 保留、POST once、非 revision 分支、canonical refetch 恰一次。
4. 定义 refetch failure：不得把缓存旧 data 误判为成功；原 pending error/request ID/input/blocker 保留；关闭并重开 Dialog、再次触发页面提交入口时 POST 仍恰一次；切换 `productId` 不继承旧 blocker。
5. 定义 refetch success：采用服务器 workspace，清理临时 blocker 后只由 `available_actions` 收敛页面动作，已有 pending 时隐藏/禁用重复提交；不自动 replay。
6. 定义 version identity/default 500：generic summary、无自动 refetch、POST 不 replay、不猜 version。覆盖 malformed/other-code/missing-request-id fallback，并单独回归结构完整的既有 `INVALID_STATE_TRANSITION` 独立 refetch。
7. 在按 `productId` 隔离的 editor owner 中实现最小 pending blocker，页面入口与 Dialog confirm 共用它；Dialog 关闭不得解除。补明确 refetch success signal；不视觉重做，不改变真正 revision conflict 和既有 `INVALID_STATE_TRANSITION` 合同。

## 4. Phase C：稳定文档/spec

Main agent 负责共享稳定文档，避免 backend/frontend worker 交叉修改：

1. `.trellis/spec/backend/error-handling.md` 同步 FactVersion pending exact pair、version/unknown 原抛、root rollback 与 no-leak。
2. `.trellis/spec/backend/database-guidelines.md` 同步 `submit_fact_review` owner、Product-lock 正常并发和两类失败原子性。
3. `.trellis/spec/frontend/state-management.md` 同步 Fact Workspace pending blocker、payload fallback、canonical refetch、`available_actions` 与 no replay。
4. `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 同步同一稳定业务恢复语义。

只写已实现且由测试证明的稳定语义；不复制 test-only sentinel、临时 probe 或默认 500 偶然 payload。`contracts/database.md` 默认零 diff。

## 5. Required validation

### 5.1 Backend

真实 PostgreSQL catalog/diagnostics、classifier matrix、Product-lock 并发、pending precheck/constraint 等价、version 500 no-leak、事务原子性、Session reuse、stale/success/precheck 回归由以下文件级 run 覆盖，且 PG 用例必须实际执行、零 skip：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_product_detail.py -q -ra
```

若本机连接条件无法满足，可使用仓库当前有效的 PostgreSQL 容器测试入口；替代 run 必须记录完整命令、Alembic head、用例数与 `0 skipped`，不能把 skipped run 记为通过。

公共合同/runtime metadata 只读验证：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
```

受影响 Python lint 与完整 backend app typecheck：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/product_facts.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_product_detail.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

### 5.2 Frontend

```bash
npm --prefix frontend run test -- src/domains/product/fact-workspace-page.test.tsx src/domains/product/fact-workspace.model.test.ts
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/product/fact-workspace-page.tsx frontend/src/domains/product/fact-workspace-page.test.tsx frontend/src/domains/product/fact-workspace.model.ts frontend/src/domains/product/fact-workspace.model.test.ts
npm --prefix frontend run typecheck
```

若 model production/test 文件最终零 diff，仍运行现有 model test；ESLint 至少覆盖实际 changed frontend files。若 typecheck 仍只被未修改的 `frontend/src/domains/publication/publication-work-page.test.tsx:351` 既有 TS2345（`[never, never]` 不能赋给 `never`）阻断，精确记录文件、错误与本 Task 零 diff 证据，不修改 publication 文件，不把该无关失败纳入 I5，也不在无相关变更时重复运行相同失败 gate。

### 5.3 一致性、manifests 与零 diff

```bash
git diff --check
python3 .trellis/scripts/task.py validate 09-14-fact-version-integrity-mapping
python3 -c 'import json, pathlib; root = pathlib.Path(".trellis/tasks/09-14-fact-version-integrity-mapping"); [json.loads(line) for name in ("implement.jsonl", "check.jsonl") for line in (root / name).read_text().splitlines() if line.strip()]'
git diff HEAD --exit-code -- contracts/openapi.yaml contracts/database.md backend/app/routers/product_facts.py backend/app/migration_schema_v1.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src/shared/api/generated/schema.d.ts backend/app/models backend/alembic backend/app/services/review.py
```

另用 path-limited `git status --short -- <readonly paths>` 对照实施前 baseline，确认没有新 untracked file 绕过 `git diff`；ContentVersion、ContentTask、Generation Job、publication/GEO service owner 同样按 baseline 保持零 diff。既有无关 dirty files 不得恢复、删除、格式化或纳入本 Task。

### 5.4 独立 implementation review

required targeted checks 通过并完成主 agent diff review 后，执行一次独立只读 review，至少覆盖：

- current-head 真实 catalog/diagnostics 与 exact/negative classifier；
- 两条失败 root rollback、Session reuse、Product-lock 对照和所有无副作用断言；
- pending HTTP 等价、unknown 500 no-leak；
- Fact Workspace pending blocker、refetch failure/success、`available_actions` 与 no replay；
- 允许/只读文件边界和公共 owner 零 diff。

若 review 发现 material issue，只做一次修复与 targeted re-review；仍有 material issue 或新 material issue 时停止并报告。

实施生成 `research/implementation-review.md` 与 `research/execution-results.md` 后，再将两者追加到 `check.jsonl` 并重新运行 task validation；planning 阶段不创建空占位证据。

## 6. Optional validation

required checks 通过后，以下仅在时间/环境允许时运行，不替代 required evidence：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
npm --prefix frontend run test
npm --prefix frontend run build
```

未运行时 closeout 记录替代证据：真实 PG 文件级 integration、公共 unit、相关 Vitest、完整 backend app mypy、frontend typecheck 与受影响 lint；残余风险是未覆盖的不相关 suite/build 集成回归。

## 7. 失败归因、成本上限与停止

- 每个 validation/review gate 最多两轮 `repair -> targeted re-check`，累计约 20 分钟；同一根因再次出现或第二轮仍失败则停止并报告。
- 成功检查不重复；one-time/full-scope gate 失败后不在同一轮无依据重跑。
- 只修复可由当前 diff 归因的失败。无关 dirty state、环境或前置缺陷只记录，不纳入本 Task。
- 需要改变公共 status/ErrorDetail/OpenAPI/generated client、数据库 schema/migration、FactVersion 状态机、权限、Product lock，或需要 message parser、宽泛 23505、winner inference、自动改号/replay 时立即 scope stop。

## 8. Closeout（后续实施阶段）

在用户确认 commit plan 前不提交；不自动 push。完成实施后报告：行为变化、精确 validation 结果、公共/只读 owner 零 diff、文档同步原因、Python touched-scope 中文文本处理和残余风险。父任务与合同决策任务继续保持 planning；只有当前 Task 在用户另行批准实施并完成验收后才可归档。
