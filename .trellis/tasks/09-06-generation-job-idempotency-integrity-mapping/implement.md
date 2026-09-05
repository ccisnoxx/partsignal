# Generation Job 幂等完整性映射实施计划

## 0. 实施前置条件

- [x] 父任务 `09-04-integrity-error-domain-mapping` 存在并保持 `planning`。
- [x] 依赖任务 `09-05-content-integrity-error-contract-decision` 的 T4-C 规划已由 `8d47363b` 提交并保持 `planning`。
- [x] 已阅读父任务、T4-C 决策、相关规范、公开合同、当前 service 和测试。
- [x] `prd.md`、`design.md` 与本计划已达到可 review 状态。
- [x] 用户在后续消息中明确批准实施。

在最后一项完成前，不运行 `task.py start`，不修改业务代码、测试或稳定规范。

## 1. 允许修改和零 diff 边界

### 1.1 默认实施文件

- `backend/app/services/content_production.py`
- `backend/tests/unit/test_generation.py`
- `backend/tests/integration/test_generation_reliability.py`
- `.trellis/spec/backend/error-handling.md`（仅必要的 GENERATE coverage 同步）

### 1.2 必须零 diff

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/app/routers/production.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- `frontend/src/domains/content`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`

此外不得修改 worker、Content Task、Content Version review、Fact Version、publication/GEO、数据库 schema、公共 status、OpenAPI、generated client、frontend 或部署文件。

## 2. 实施步骤

### I1：先固定失败证据和测试接口

1. 在 `test_generation.py` 增加 GENERATE retry 调用顺序测试，明确 previous/FAILED/Task OPEN/旧 snapshot 在 lookup 前，latest/current facts/product 在 lookup 后。
2. 增加同 previous + 同 key 顺序 replay 和 different key 仍受 latest-job 限制的单元测试。
3. 建立精确 diagnostics matrix，覆盖：
   - `23505 + uq_generation_jobs_idempotency_key`；
   - 非 `23505`；
   - 缺失 `error.orig.sqlstate`、`error.orig.diag` 或 `constraint_name`，以及只在替代属性放置相似 diagnostics；
   - 其他 constraint/index、相似名称；
   - `uq_generation_jobs_active_humanization_source` 不被 GENERATE 接受。
4. 为 create/retry caller 增加 rollback 后 winner 同身份、异身份、缺失、identity 不可验证测试；原始 GENERATE winner 必须用真实持久化形状覆盖缺失/损坏 `input_snapshot.platform_prompt.id` 与 `revision`，unknown 断言重新抛出原异常对象。
5. 保留并扩充 Humanization create/retry/idempotency/active-source 回归断言。

### I2：最小生产实现

1. 在 `content_production.py` 内整理表内私有 classifier，使约束识别只依赖固定位置 `error.orig.sqlstate == 23505` 与 `error.orig.diag.constraint_name`，并由不同 caller 明确限制可接受约束；不得读取替代属性兜底。
2. 调整 GENERATE retry：完成 previous、FAILED、Task OPEN、旧 snapshot 校验后立即构造 identity 和 lookup；只让 lookup miss 进入 latest/current 创建资格校验。
3. 在 `create_generation_job` 与 GENERATE `retry_generation_job` caller 捕获精确 idempotency race：
   - 保留原 `IntegrityError`；
   - rollback；
   - 按 key 直接加载 winner并先验证 canonical identity 字段完整性；
   - 字段可验证后用唯一 canonical 比较逻辑重验并 replay/conflict；
   - winner 缺失或不可验证时重新抛出原异常。
4. 不改变 `_create_job` 对候选 GenerationJob 与 input snapshot 的构建职责；保持普通 lookup/Humanization 语义，不把事务恢复隐藏进只转发调用的薄 wrapper。
5. 确保 replay/known conflict/unknown 均不 dispatch；新建成功仍 commit-before-dispatch。
6. 对所有新增或实质变更的 Python 函数、复杂分支、异常路径和开发者可见文本执行 touched-scope 中文文档检查，只为非显然边界补充中文注释/docstring。

### I3：真实 PostgreSQL、HTTP 与原子性证据

1. 在 current-head PostgreSQL 测试库查询 catalog，并通过真实失败 diagnostics 证明约束名为 `uq_generation_jobs_idempotency_key`。
2. 构造同 Task、同 identity 并发：使用独立 Session 和受控屏障，证明 Task lock 串行、第二请求走普通 lookup、一行 Job、一次 dispatch。
3. 对 create 与 GENERATE retry 两个入口分别构造跨 Task、同 key、异 identity 并发：每组两个独立事务共同进入最终竞争窗口，证明只有一个 winner，loser 为精确 `409 IDEMPOTENCY_CONFLICT`。
4. 在 `createGenerationJob` 构造受控 same-identity sentinel：使用无 current version Task，已提交 winner + 只隐藏 insert 前唯一一次 lookup + 真实精确约束 + rollback 后 replay；测试名称/说明必须包含 `sentinel` 或等价限定，禁止描述为正常同 Task race。retry 的真实 exact-constraint 恢复由步骤 3 的 retry race 覆盖。
5. 通过 HTTP 层分别验证 create 和 GENERATE retry 的 `ErrorEnvelope`、`details = {}`、中文 message、`request_id == X-Request-ID`。
6. 对 known loser 与 unknown 异常比较调用前后数据库和 dispatch：Job、ContentVersion、Task pointer/revision、ReviewRecord、AuditLog、dispatch 均无泄漏。
7. 运行 Humanization create/retry/idempotency/active-source 和 broker failure/补投递相关回归。

### I4：必要规范同步

仅当实现使 `.trellis/spec/backend/error-handling.md` 对 Generation Job mapper coverage 的稳定描述不完整时，补充 GENERATE create/retry 精确约束、caller rollback/revalidation、unknown 原抛和 Humanization allowlist 边界。不得把具体测试技巧或临时实现细节写入稳定规范。

### I5：候选 diff 审计

1. 检查实际 diff 是否只有 1.1 的允许文件。
2. 检查是否存在第二套 identity、宽泛异常捕获、message 解析、静默 fallback、重复 dispatch、rollback 前查询或 unknown 转 known。
3. 对 1.2 的路径运行零 diff 检查。
4. 完成一次独立只读实现评审；若有 material finding，只允许一次修复和一次定点复审。

## 3. Required validation

以下均为实施阶段 required；失败后只在相关修复完成后重跑，遵守最多两轮 `repair -> targeted re-check`：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_generation_reliability.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/content_production.py backend/tests/unit/test_generation.py backend/tests/integration/test_generation_reliability.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/content_production.py backend/tests/unit/test_generation.py backend/tests/integration/test_generation_reliability.py .trellis/spec/backend/error-handling.md
```

额外执行明确的零 diff gate：

```bash
git diff --exit-code -- contracts/openapi.yaml contracts/database.md backend/app/routers/production.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src/shared/api/generated/schema.d.ts frontend/src/domains/content docs/frontend-v2/05-business-actions-state-and-api-contract.md
```

`test_generation.py` 与 `test_generation_reliability.py` 的 required 文件级运行必须实际包含并证明：

- GENERATE retry 顺序、同 key replay、different key；
- 精确 diagnostics matrix；
- current-head PostgreSQL catalog/constraint diagnostics；
- 同 Task 普通 lookup concurrency；
- 跨 Task异身份真实 race；
- same-identity exact-constraint sentinel；
- create/retry HTTP envelope/request ID；
- known/unknown 原子性；
- Humanization create/retry/active-source；
- commit-before-dispatch、broker failure `PENDING` 和补投递回归。

## 4. Optional full-suite validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q
```

全 backend suite 为 optional。若不运行，交付说明必须写明：

- 原因：本任务边界集中在 Generation service，required 已执行完整目标 unit/integration 文件、合同/metadata、Ruff 和全 backend app mypy；
- 替代证据：列出上述实际通过的命令和关键场景；
- 剩余风险：目标文件之外、未被 required tests 覆盖的间接 backend 回归仍可能存在。

不得把 optional suite 的无关或环境失败擅自纳入本任务修复范围。

## 5. 停止与回退

- 如果正确实现要求新增公开 code/status、修改 schema、改变 worker policy 或越过 owner，停止并报告，不扩大任务。
- 若同一根因经过两轮 targeted repair 仍失败，停止并提交证据、尝试、当前状态和下一步选项。
- 回退仅撤销本任务识别出的候选 diff，不使用 `git reset --hard`、`git checkout --` 或覆盖无关脏文件。

## 6. 完成定义

- 所有 AC1–AC15 有明确测试或 diff gate 证据；
- required validation 全部通过；optional suite 运行结果或未运行说明完整；
- 独立 review 无未解决 material finding；
- 代码、测试、稳定规范和零 diff 合同一致；
- 在任何提交、归档或 push 前另行向用户给出 commit plan 并取得确认。
