# Content Task 幂等 IntegrityError 映射实施计划

## 1. 边界

### 1.1 允许修改

- `backend/app/services/content_planning.py`
- `backend/tests/integration/test_content_task_creation.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`

### 1.2 只读 / 零 diff

- `backend/app/services/geo_observation.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/observation.py`
- `contracts/openapi.yaml`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- `frontend/src/domains/content/new-content-task-page.tsx`
- `frontend/src/domains/content/new-content-task-page.test.tsx`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`

不得修改 Generation Job、Content Version、Fact Version、publication repair、worker、数据库 schema、公共 status/error code 或部署文件。

## 2. 实施步骤

### I1：先固定失败证据和测试边界

1. 扩展顺序幂等测试：普通 same identity replay、三个目标字段任一不同的准确冲突、预存在 GEO winner 的 source-kind 冲突。
2. 强化正常同 key 并发测试：两个独立 Session 保持现有 advisory-lock 串行，并以 SQL statement 计数或等价稳定证据证明只发出一次 ContentTask insert。
3. 增加真实 PostgreSQL catalog/diagnostics 测试，断言 `orig.sqlstate == "23505"` 且 `orig.diag.constraint_name == "uq_content_tasks_idempotency_key"`。
4. 设计受控 sentinel/race：在普通 lookup 后暂停 caller，由绕过 advisory protocol 的独立 Session 提交普通 same identity、普通 different identity、GEO winner；释放 caller 后真实触发唯一约束。
   - 所有 barrier/event 等待必须设置有界 timeout，并在异常路径释放等待方，防止测试挂死。
5. 增加 exact recovery 与 unknown matrix：rollback 顺序、winner same/different/GEO、winner missing、identity 不完整、diagnostics 缺失、非 `23505`、其他 constraint；unknown 必须是原异常对象。
6. 增加 HTTP 证据：准确 409 envelope/request ID header，以及 unknown 500 不泄漏 SQL、表名、constraint、driver message。
7. 为 known/unknown 失败记录调用前后数据库快照：ContentTask、ContentVersion、FactVersion、ReviewRecord、AuditLog、winner pointer/revision/source，以及任何 dispatch spy/counter。

### I2：最小生产实现

1. 在 `content_planning.py` 增加表内私有精确 classifier，只读取固定位置 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name`。
2. 收敛普通 identity 判定，确保三个目标字段相同且不存在 `ContentTaskGeoSource` 才可 replay；复用既有准确 `IDEMPOTENCY_CONFLICT`，不增加 DTO/error code。
3. 仅在 `create_content_task` 调用 `add_locked_content_task` 的局部边界捕获 `IntegrityError`：
   - 非 exact idempotency constraint 原样抛出；
   - exact constraint 保存原异常并 root rollback；
   - rollback 后按 key 查询 winner，先验证 identity 可判定，再按唯一普通 identity 口径 replay/conflict；
   - winner missing 或 identity 不可验证时重新抛出原异常。
4. 不修改 `add_locked_content_task` 的事务责任，不影响 GEO caller；不改变现有 resource lock 顺序、`commit` 参数或成功路径。
5. 对新增/实质变更的 Python helper、复杂异常分支和开发者可见文本执行 touched-scope 中文文档检查；只为非显然边界补中文 docstring/comment。

### I3：文档同步

1. 在 `contracts/database.md` 的 0032/required constraint 适当单一位置记录准确约束名、ordinary source kind 和数据库最终仲裁，不重复 service 测试细节。
2. 在 `.trellis/spec/backend/database-guidelines.md` 的普通 Content Task 创建规范中补充 exact diagnostics、caller rollback/requery、GEO winner 冲突、unknown 原抛和无副作用要求。
3. 保持 OpenAPI、Frontend V2 文档、generated client 和 runtime metadata 零 diff。

### I4：候选 diff 审计与独立 review

1. 检查实际 diff 只涉及 1.1 的允许文件，并保留全部范围外脏改动。
2. 检查是否出现错误文本解析、模糊 constraint、rollback 前查询、unknown 转已知、第二 identity owner、全局 mapper、重复 insert/commit 或 GEO owner 变更。
3. 执行 1.2 的零 diff gate。
4. 完成一次独立只读高风险实现 review；如有 material finding，只允许一次修复和一次定点复审。

## 3. Required validation

以下均为实施阶段 required；失败后只有相关代码、测试、配置或诊断证据发生变化才重跑，且每个 gate 最多两轮 `repair -> targeted re-check`：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_content_task_creation.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/content_planning.py backend/tests/integration/test_content_task_creation.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run test -- src/domains/content/new-content-task-page.test.tsx
git diff --check -- backend/app/services/content_planning.py backend/tests/integration/test_content_task_creation.py contracts/database.md .trellis/spec/backend/database-guidelines.md
```

若实施实际触及前端（当前计划不触及），还必须运行：

```bash
npm --prefix frontend run lint
```

额外执行零 diff gate：

```bash
git diff --exit-code -- backend/app/services/geo_observation.py backend/app/routers/planning.py backend/app/routers/observation.py contracts/openapi.yaml backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src/shared/api/generated/schema.d.ts frontend/src/domains/content/new-content-task-page.tsx frontend/src/domains/content/new-content-task-page.test.tsx docs/frontend-v2/05-business-actions-state-and-api-contract.md
```

`test_content_task_creation.py` 的 required 文件级运行必须实际包含并证明：

- 普通 same/different identity；
- GEO winner 负例；
- 正常 advisory-lock 并发只 insert 一次；
- current-head PostgreSQL catalog/真实 diagnostics；
- exact constraint same/different/GEO sentinel/race；
- rollback 后 winner missing、identity 不完整与 unknown matrix；
- HTTP ErrorEnvelope/request ID 和 unknown 不泄漏；
- known/unknown 原子性与 Session reuse。

若 PostgreSQL fixture 因环境缺失而 skip，上述文件级命令即使退出码为 0 也不算数据库门禁通过；交付记录必须确认相关 PostgreSQL 用例实际执行且没有 skip。

## 4. Optional full-suite validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q
npm --prefix frontend run test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

完整 backend/frontend suite 与 build 为 optional：本任务生产改动限定在普通 Content Task service，required 已覆盖目标 PostgreSQL integration 文件、合同/runtime metadata、前端既有恢复测试、Ruff 和全 backend app mypy。若不运行，交付说明必须列出实际替代证据，并说明目标文件以外仍可能存在未被 targeted tests 捕获的间接回归。

不得把 optional gate 的无关或环境失败擅自纳入本任务修复范围。`make verify` 如需用于 release readiness，只能在 targeted checks 全部通过后运行一次。

## 5. 停止与回退

- current-head PostgreSQL constraint name 与规划不一致时停止，不增加 message fallback。
- 如果正确实现必须修改 GEO command/shared policy、OpenAPI/router/generated client、数据库 schema、公共 status/error code、权限或状态机，停止并返回合同决策/T5-C，不扩大本任务。
- 若同一根因经过两轮 targeted repair 仍失败，或独立 re-review 仍有 material finding，停止并报告证据、尝试、当前状态和下一步选项。
- 回退只撤销本任务允许文件中的候选 diff，不使用 `git reset --hard`、`git checkout --`、stash 或覆盖无关脏文件。

## 6. 完成定义

- AC1–AC12 均有明确测试或 diff gate 证据；
- required validation 全部通过，optional suite 有实际结果或未运行说明；
- 独立 review 无未解决 material finding；
- 代码、测试、数据库合同、稳定规范和零 diff 公共合同一致；
- 新增或修改的 Python 注释/docstring/开发者可见文本已完成中文 touched-scope 检查；
- 在任何提交、归档或 push 前另行给出 commit plan 并取得用户确认。
