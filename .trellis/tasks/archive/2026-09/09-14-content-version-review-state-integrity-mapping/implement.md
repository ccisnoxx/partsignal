# Content Version review state IntegrityError mapping 实施计划

## 0. Planning 边界

当前阶段只交付可 review 的 PRD、设计、实施计划、必要 research、`implement.jsonl` 和 `check.jsonl`。不得运行 `task.py start`，不得修改 production/test/spec/docs，不提交、不归档、不 push。后续只有在用户明确批准实施后才进入本计划。

依赖顺序：已批准但仍保持 planning 的 `09-05-content-integrity-error-contract-decision` 提供合同；I1/I2/I3 已完成；本 I4 只处理 Content Version review-state 两条 partial unique。父任务 `09-04-integrity-error-domain-mapping` 与合同决策任务均不得由本 Task 启动或归档。

## 1. 实施前门禁

1. 重新确认 primary working directory 位于 `main`，记录并避开所有既有 dirty files；不恢复、删除、格式化或纳入无关变更。
2. 读取本 Task 的 `prd.md`、`design.md`、`implement.md`、research 和 manifests；读取 JSONL 中列出的稳定 spec。若注入输出被 32 KiB 截断，必须分块完整读取原文件。
3. 运行 current-head PostgreSQL catalog 查询，确认两条 index 的名称、unique 属性、列与 predicate；用真实冲突记录 `sqlstate`/`diag.constraint_name`。任何不一致触发 scope stop。
4. 确认允许/只读 owner 没有与当前 Task 冲突的用户修改。无法安全避开重叠 dirty change 时停止并报告。

## 2. Phase A：Backend command owner

Owner：`backend/app/services/review.py`、`backend/tests/integration/test_content_review.py`。不修改 root contracts、router、unit contract tests、模型或 migration。

1. 先在 integration 测试中补 classifier exact/negative matrix：exact pending pair；approved pair；其他 unique；其他 sqlstate（含 CHECK/FK/NOT NULL/trigger-like）；`orig`/`diag`/constraint 缺失；message/SQL 含目标文本但 diagnostics 不匹配。
2. 在 `review.py` 添加最小、无副作用的结构化 classifier，并在 `transition_content_version` 的写入/flush/commit owner 处增加窄 catch。
3. catch 必须先 root rollback；只有 submit-review + exact pending pair 转换为 409 `CONTENT_REVIEW_PENDING`，其他情况 bare re-raise 原始 `IntegrityError`。
4. 增加真实 PostgreSQL pending integration：固定 ErrorEnvelope、request ID/header、完整 rollback、Session 复用和成功 submit 对照。
5. 增加真实 PostgreSQL approved late-failure integration：default 500/no-leak、旧 approved/目标/review record/SUCCESS audit/task pointer/revision 全量 rollback、Session 复用和成功 approve 对照。测试装置不得改变 schema/migration 或削弱锁；无法安全构造则 scope stop。
6. 补 stale revision、非当前版本、非法状态和质量门禁对照，证明 service precheck 在 flush 前保持现有合同和优先级；权限以 HTTP 403 且 `transition_content_version`/flush/commit 未调用证明现有 router/dependency owner，不修改只读 router，也不向 service 复制权限判断。
7. 对新增/实质修改的 Python 模块、函数、复杂分支、异常路径及开发者可见文本执行 touched-scope 中文文档检查；只为非显然职责/边界添加必要中文说明。

## 3. Phase B：Frontend 恢复

Owner：Content Editor model/page 及对应测试、Content Review Page 测试。`content-review-page.tsx` 默认为零 diff。

1. 在 model tests 先定义 exact `CONTENT_REVIEW_PENDING` 的纯投影，以及 malformed details、其他 code、缺 request ID 的 negative/fallback cases。
2. 在 model 中添加最小 code-only blocker/recovery 投影；不根据 message 判断，不新增全局 enum/registry。
3. 在 Editor component tests 定义：Dialog comment/code/request ID 保留并保持打开；第二次 POST 禁止；背景 canonical 不采用；reload 失败保持现场；reload 成功后才采用 canonical；pending 不显示成 revision；不自动 replay。
4. 在 Editor page 中复用现有 query freeze/reload lifecycle，并以 blocker kind 区分 revision 与 pending 文案/行为；保持既有 revision tests 和 generic error 行为。
5. 在 Review Page tests 增加 approved unknown 500：generic server failure、approve POST 一次、不进入 409/revision reload、不选择其他 approved。只有该测试暴露真实缺口时才做最小 production 修改。

## 4. Phase C：稳定文档/spec

Main agent 负责四个允许 owner，避免 backend/frontend worker 交叉修改共享文档：

1. `error-handling.md` 增加 review pending exact pair 与 approved/unknown 原抛规则。
2. `database-guidelines.md` 只增加 command transaction owner 与 rollback 原子性规则。
3. `state-management.md` 增加 Editor pending blocker/reload/background adoption/no replay，以及 Review Page approved generic 5xx。
4. Frontend V2 文档同步同一稳定业务语义。

完成后对照实现和测试，移除重复、历史“建议/待批准”措辞或与当前实现冲突的描述。公共合同与数据库合同保持零 diff。

## 5. Required validation

### 5.1 Backend

真实 PostgreSQL index catalog/diagnostics、classifier matrix、pending/approved HTTP/rollback、Session 复用、成功路径和 precheck 对照均由下列文件级 integration run 覆盖：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_content_review.py -q -ra
```

运行只读公共合同与 runtime metadata 测试：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
```

运行受影响 Python lint 与完整 backend app 类型检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/review.py backend/tests/integration/test_content_review.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

### 5.2 Frontend

```bash
npm --prefix frontend run test -- src/domains/content/content-editor.model.test.ts src/domains/content/content-editor-page.test.tsx src/domains/content/content-review-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/content/content-editor.model.ts frontend/src/domains/content/content-editor.model.test.ts frontend/src/domains/content/content-editor-page.tsx frontend/src/domains/content/content-editor-page.test.tsx frontend/src/domains/content/content-review-page.test.tsx
```

若 `content-review-page.tsx` 被实质修改，将其加入 ESLint 命令；否则该 production owner 保持零 diff。

### 5.3 一致性与零 diff

```bash
git diff --check
python3 .trellis/scripts/task.py validate 09-14-content-version-review-state-integrity-mapping
python3 -c 'import json, pathlib; root = pathlib.Path(".trellis/tasks/09-14-content-version-review-state-integrity-mapping"); [json.loads(line) for name in ("implement.jsonl", "check.jsonl") for line in (root / name).read_text().splitlines() if line.strip()]'
git diff HEAD --exit-code -- contracts/openapi.yaml contracts/database.md backend/app/routers/production.py backend/app/migration_schema_v1.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src/shared/api/generated/schema.d.ts backend/app/models backend/alembic
```

zero-diff gate 还应检查未跟踪文件清单，防止上述 owner 下新生成文件绕过 `git diff`。

### 5.4 独立 review

在 required checks 通过并完成主 agent diff review 后，执行一次独立只读 review，重点检查：结构化 exact mapping、unknown 原抛、root rollback、precheck 优先级、no-leak、Editor 状态生命周期、公共合同零 diff和测试真实性。若修复 material finding，只允许一次 targeted re-review；若仍有 material issue，停止并报告。

## 6. Optional validation

以下检查仅在 required checks 已通过且时间/环境允许时执行，不替代 required evidence：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
npm --prefix frontend run test
npm --prefix frontend run build
```

未运行时在 closeout 记录：required 文件级 integration/unit/Vitest、完整 typecheck/mypy 和受影响 lint 是替代证据；残余风险为未覆盖的不相关 suite/build 集成回归。

## 7. 失败归因、成本上限与停止

- 每个 validation/review gate 最多两轮 `repair -> targeted re-check`，累计约 20 分钟；同一根因再次出现或第二轮仍失败则停止并报告。
- 成功检查不重复；full-scope gate 若失败，不在同一轮无依据重跑。
- 只修复可由当前 diff 归因的失败。无关 dirty state、环境或前置缺陷只记录，不纳入本 Task。
- 需要改变公共 status、ErrorDetail/OpenAPI/generated client、数据库 schema/migration、权限、ContentVersion 状态机、锁，或需要 message parser、宽泛 23505、winner inference/replay 时立即 scope stop。

## 8. Closeout（后续实施阶段）

在用户确认 commit plan 前不提交；不自动 push。完成实施后报告：行为变化、精确 validation 结果、公共 owner 零 diff、文档同步原因、Python touched-scope 中文文本处理和残余风险。父任务与合同决策任务仍保持 planning，只有当前 Task 在用户另行批准后才可归档。
