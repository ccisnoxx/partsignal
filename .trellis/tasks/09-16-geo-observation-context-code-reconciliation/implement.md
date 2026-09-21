# Implement Plan：GEO Observation Context Code Reconciliation

> 用户已于 2026-09-21 批准进入实施，并已运行 `task.py start`。仍不提交、归档、push、部署或单独发布 backend code。

## Phase 0：已完成的范围决策

1. 用户已批准把`getContentTaskPermanentDeletionPreview`、`deleteContentTask`、`permanentlyDeleteContentTask`纳入同一T5-I6。
2. `backend/tests/integration/test_publication_workflow.py`已加入allowlist；production owner仍只有`geo_observation.py`。
3. 父T5-C `prd.md`/`design.md`/`implement.md`/`research/decision-synthesis.md`已最小修订operation/transaction owner与required validation；父任务保持planning。
4. 当前PRD convergence已完成；执行一次独立planning review，material finding最多一次修订与targeted re-review。

## Phase 1：实施前证据与工作区基线

1. 完整重读本Task三份Markdown、两个JSONL与research；复核T5-C、T5-I5 implementation log和稳定spec未发生改变。
2. 确认依赖提交仍可达，T5-C/顶层父任务仍planning，I1–I5仍completed/archived。
3. 保存完整`git status --short`；为allowlist、OpenAPI/router/runtime/generated/frontend production/tests、ORM/migration与用户已有dirty路径分别保存working-tree/index status和diff fingerprint。
4. 在Alembic head临时PostgreSQL库核对：successor partial unique仍在；GEO append-only trigger为current-head UPDATE-only；不存在误用0029 DELETE guard的计划假设。
5. 再次`rg`确认剩余目标恰为11个，且T5-I5 successor code/classifier没有进入diff。

## Phase 2：测试先行

### 2.1 Detail / correction context

在`test_geo_observation_detail.py`与必要的correction测试中逐producer覆盖第1–6项：

- root/ancestor/descendant缺失；kind/product/platform/search_query越界；branch/cycle/disconnected walk；output type mismatch。
- 每项断言HTTP 409、准确code/message/`details={}`和request ID；detail与correction-context均不得返回部分history。
- 证明REPEATABLE READ下root/tail/selected/history一致，`tested_at`、`created_at`与frozen publication identity不回归。

### 2.2 Create evidence ancestor

在`test_geo_observation_correction.py`覆盖第7项：只有带新增evidence的ancestor traversal缺失才命中；断言无新observation、publication/attachment relation、文件状态/cleanup、publication状态或SUCCESS AuditLog副作用。T5-I5 successor precheck与exact mapper保持原测试不变。

### 2.3 GEO whole-chain delete

新建`test_geo_observation_deletion.py`覆盖第8–11项与正常删除：

- root/middle/tail入口都删除同一完整链；失败前后按稳定ID逐行比较observation/publication/attachment/file/AuditLog/cleanup。
- branch/cycle/product/kind越界返回context incomplete；锁后集合/target membership变化返回chain changed。
- unknown FK/CHECK/23514/55000 UPDATE guard保持原异常/default 500 no-leak。
- fixture只使用`design.md`批准的事务内DDL/SQL与真实并发；finally后fresh connection复核index/trigger/data。

### 2.4 Shared content-task operations

在`test_publication_workflow.py`补窄回归：

- preview、普通delete scope、permanent-delete对第8–11项的exact code/message/details/request ID。
- preview零写入；普通/永久delete失败均不留下Article/Issue/GEO/task、relation、file cleanup或SUCCESS AuditLog部分副作用。
- chain changed对preview使用显式reload语义；普通DELETE与permanent-delete POST都使用refresh/reopen/reconfirm/no replay；不把GET写成mutation重试。

## Phase 3：最小production修改

1. 在`geo_observation.py`只替换research矩阵的11个producer code；保持message、status、details与控制流。
2. 第1–10项使用同一稳定context error code；第11项使用chain-changed code。可抽取无状态错误构造helper，但只有实际减少重复且不改变stack/catch/transaction时才做。
3. 不修改T5-I5 successor helper/classifier、锁序、查询、identity维度、rollback、relation add、commit或audit。
4. 不修改`publication.py`；共享caller自然接收同一新code。

## Phase 4：文档与stable spec

1. Frontend V2 05：冻结detail/correction不返回部分链；context blocked/GET-only；chain changed刷新、重开、重新确认；I5→T6-G及I6→T6-G+T6-C release gate。
2. Frontend V2 08：冻结11 producer exact wire、request ID、unknown 500、删除原子性、cached detail动作冻结及T6-G/T6-C测试矩阵。
3. Backend error handling spec：记录11 producer、真实operation owner、transaction/snapshot、unknown boundary与current-head trigger事实。
4. Frontend component/state spec：移除GEO revision语义；区分candidate/successor stale、context blocked与chain changed mutation recovery；明确T6-G拥有GEO页面，T6-C拥有content lifecycle的preview、普通DELETE与permanent-delete POST。
5. OpenAPI、router/runtime、generated、frontend production/tests与database/schema owner零差异。

## Phase 5：Required validation

PostgreSQL目标测试若skip，即使exit 0也不算通过。失败后只有相关代码、测试、配置或新诊断证据变化才重跑；不做无变化重跑。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

共享owner的required targeted gate：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/tests/integration/test_publication_workflow.py
```

Allowlist whitespace gate：

```bash
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py backend/tests/integration/test_publication_workflow.py docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/backend/error-handling.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md .trellis/tasks/09-16-geo-observation-context-code-reconciliation .trellis/tasks/09-14-publication-geo-integrity-error-contract-decision
```

Protected-owner gate：若路径preflight已dirty，比较保存的path status与working-tree/index fingerprints，不把`HEAD`基线差异误归因于本Task；否则运行：

```bash
git diff --exit-code HEAD -- contracts/openapi.yaml contracts/database.md backend/app/routers backend/app/schemas backend/app/models backend/app/main.py backend/app/errors.py backend/alembic/versions backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src frontend/tests frontend/package.json frontend/package-lock.json frontend/scripts
```

最后逐路径审查实际diff，搜索：非目标`REVISION_CONFLICT`替换、T5-I5 mapper变化、message解析、schema/trigger弱化、identity行为扩张、partial response、自动replay、frontend production漂移与无关dirty文件吸收。

## Optional frontend compatibility probe

只作为T6-G前只读兼容性探针；失败不修改frontend test，也不把当前页面尚未识别新code误报为T5-I6 backend失败：

```bash
npm --prefix frontend run test -- src/domains/geo/geo.api.test.ts src/domains/geo/geo-observation-correction-page.test.tsx src/domains/geo/geo-observation-detail-page.test.tsx
```

## Optional full backend suite

同一candidate最多运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

若collection因既有同名module、环境或范围外问题失败，记录命令、exit、阶段和未覆盖范围；不清缓存、不改pytest配置/import mode、不越界修复，也不重跑该一次性gate。

## Phase 6：Independent high-risk read-only review

required checks通过后执行一次full review，覆盖：

- 11 producer及所有真实operation owner的exact wire与恢复矩阵；
- REPEATABLE READ完整响应、create/delete/content-task transaction原子性；
- branch/cycle/lock-set fixture的schema恢复与真实PostgreSQL证据；
- unknown 500、current-head trigger、T5-I5不回归；
- 文档/spec、T6-G+T6-C release gate、protected-owner与dirty-worktree归属。

full review有material finding时只允许一次targeted repair、相关required re-check和一次targeted re-review；仍有material finding则停止。不得借review进入T5-G/T6。

## Completion boundary

只有Phase 0决策、PRD convergence、实施、required validation与独立review全部完成后，才可报告T5-I6完成。提交、归档、push、T5-G、T6-G和T6-C均需届时明确授权；不得归档T5-C或顶层`integrity-error-domain-mapping`。
