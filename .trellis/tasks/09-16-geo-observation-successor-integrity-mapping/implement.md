# Implement Plan：GEO Observation Successor Integrity Mapping

> 本 Task 当前仅完成规划并保持 `planning`。未经用户评审后明确批准，不运行 `task.py start`、不实施、
> 不提交、不归档、不 push。

## Phase 1: Preflight and authoritative evidence

1. 完整重读本 Task 三份 Markdown、两个 JSONL、`research/current-head-audit.md`、T5-C 的
   PRD/design/implement 与四份 research、已归档 T5-I4 的 PRD/design/implement/implementation log，以及两个
   backend/两个 frontend stable spec；大文件分段读取，不把截断注入当合同。
2. 确认依赖提交 `43c252da`、`771a5826`、`62bb2360`、`a96f6df2`、`a5469871`、`d5487430`
   仍可达；T5-C 与顶层父任务保持 `planning`，I1..I4 保持 completed/archived。
3. 保存完整 `git status --short`，并为 implementation allowlist、当前 Task/父 bookkeeping、OpenAPI/router/
   runtime/generated/frontend 等 protected owners 保存 working-tree/index path status 与 diff fingerprint。
4. 在独立临时 PostgreSQL 16 数据库升级到真实 Alembic head，先完成 PRD R3 的 catalog 查询与真实 duplicate
   INSERT diagnostics。目标必须是独立 partial unique index；任一断言不符立即停止，不进入实现或 spec 修改。

## Phase 2: Tests first in `test_geo_observation_correction.py`

1. 增加 current-head catalog sentinel，逐项断言表、index、单列键、predicate、unique/immediate/valid/ready、
   无 expression、无 `pg_constraint` row及真实 exact diagnostics。
2. 把现有 non-tail precheck 断言更新为目标 code，并逐字段断言 status/message/details；保留其余 11 个 producer
   当前行为给 T5-I6，不在本 Task 批量替换。
3. 增加 production-lock 合规双 Session测试：独立连接/PID、有界 Event、指定 blocker、目标 `FOR UPDATE` SQL、
   loser 未发 INSERT、winner commit 后 precheck、恰一 successor。
4. 增加 test-only real unique race：只对参与连接精确旁路锁/precheck，保留全部 current-head数据库防线；以目标
   INSERT、transactionid wait、指定 blocker PID和真实 exact diagnostics 证明仲裁。不得修改生产函数签名或 schema。
5. 增加 classifier 反例：其他 unique/FK/CHECK/NOT NULL、23514/55000、缺失/畸形 diag、错误 sqlstate、
   alias/前后缀/大小写和 message 伪造 constraint；全部原异常上抛。relation flush/commit 同名或其他错误保持
   catch scope 外。
6. known exact loser在测试额外 rollback 前，用同一 Session 查询 predecessor/winner并完成健康命令；unknown
   direct-service 捕获同一原异常，由 caller rollback 后同 Session reuse。
7. 增加完整失败快照：predecessor/祖先/winner、publication/attachment/file、citation、ContentTask/GEO source、
   ContentVersion/Review/Job、PublicationWork/Article/Issue/history/AuditLog；loser/unknown无部分副作用，winner不可变。
8. 通过真实 route 分别验证 precheck 与 exact 409 的四字段 ErrorEnvelope、空 details、message和入站/body/header
   request ID；真实非目标 PostgreSQL失败验证 HTTP 500 no-leak，不冻结默认 body。

所有 listener、dependency override、Event/barrier、future、monitor 与 timeout 必须在 `finally` 清理。测试使用完整
合法 Topic，不临时删除 `ck_geo_observations_kind_fields` 或其他 current-head防线。

## Phase 3: Narrow production implementation

1. 在 `geo_observation.py` 增加 command-local exact classifier，只读固定结构化 diagnostics。
2. 将现有 successor precheck 的 `REVISION_CONFLICT` 改为
   `GEO_OBSERVATION_HAS_SUCCESSOR`，message/details/status 保持 PRD 目标。
3. 只在 root observation 的首次 `db.flush()` 局部 catch `IntegrityError`：非 exact 原抛；exact 先 root
   rollback，再抛同一目标 AppError。不查询或返回 winner。
4. 保持 Product/Article/previous 锁序、candidate/evidence验证、relation add和commit位置不变；不引入 shared
   mapper、transaction runner、production test flag或新审计。

## Phase 4: Contract/spec synchronization

1. `contracts/database.md`：在 0007/GEO successor 唯一权威位置记录 partial index、exact pair、precheck、root
   rollback、unknown 和两类并发证据。
2. `database-guidelines.md`：记录 GEO command owner、index catalog/diagnostics、production lock 与test-only race、
   原子性和 Session reuse。
3. `error-handling.md`：记录 successor-specific code、catch scope、known rollback、unknown rethrow/no-leak。
4. Frontend V2 05/08 与 frontend component/state specs：冻结 T6 的 canonical-context stale、保留草稿/evidence/
   request ID、显式 reload/no replay，以及 T5-I5 不单独发布的 gate。
5. OpenAPI、router/schema/runtime metadata、generated client 与 frontend production/tests 保持零差异。

## Phase 5: Required validation

PostgreSQL目标用例 skip 即使 exit 0 也不算通过。失败后只有相关代码、测试、配置或新诊断证据变化才重跑；
同根因最多两轮 repair/re-check。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_observation_correction.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

Allowlist whitespace gate：

```bash
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py contracts/database.md docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md .trellis/tasks/09-16-geo-observation-successor-integrity-mapping .trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json
```

Protected-owner zero-new-diff gate：

```bash
git diff --exit-code HEAD -- contracts/openapi.yaml backend/app/routers/observation.py backend/app/main.py backend/app/errors.py backend/app/schemas/common.py backend/app/schemas/geo_files.py backend/app/models/geo_files.py backend/alembic/versions backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src frontend/tests frontend/package.json frontend/package-lock.json frontend/scripts
```

若 protected 路径在 preflight 已 dirty，不把 `--exit-code HEAD` 失败误归因于本 Task；比较保存的 path status、
working-tree/index diff fingerprint，证明 candidate 没有新增差异。最后逐路径审查实际 diff，查找宽泛 23505、
message解析、rollback前查询、catch包围 relation/commit、winner猜测、生产锁/schema弱化、其他producer替换、
frontend production漂移与无关文件吸收。

## Optional frontend compatibility probe

只作为 T6 前只读兼容性探针，不修改失败测试，也不把当前页面尚未识别新 code 误报为 T5-I5实现失败：

```bash
npm --prefix frontend run test -- src/domains/geo/geo.api.test.ts src/domains/geo/geo-observation-correction-page.test.tsx
```

## Optional full backend suite

同一 candidate 最多运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

若因既有同名测试模块、环境或其他范围外问题在 collection/执行阶段失败，记录命令、exit、阶段与未执行范围；
不清缓存、不改变 pytest import mode/config、不重命名文件、不越界修复，也不重跑该一次性 gate。

## Phase 6: Independent high-risk read-only review

required checks通过后执行一次独立只读 full review，覆盖：

- partial index 的 catalog/diagnostics exactness 与 classifier fail-closed；
- root flush catch scope、root rollback、Session reuse、unknown owner；
- production row-lock path 与 test-only real unique race 的 blocker/PID/目标 SQL/有界清理；
- 唯一 successor、append-only history、relations/files/content/publication/audit失败原子性；
- HTTP tuple、ErrorEnvelope/request ID、unknown 500 no-leak；
- 文档同步、release-atomic gate、T5-I6/T6分界和 protected-owner零差异。

full review发现 material finding时，只允许一次 targeted repair、相关 required re-check和一次 targeted re-review；
不得第三轮或借 review 进入 T5-I6/deletion/T6。若 re-review 仍有 material finding，停止并报告。

## Completion boundary

实现、required validation 与独立 review 全部通过后，向用户报告实际 diff、PostgreSQL证据、命令结果、review
finding、optional gate与残余风险。提交、归档、push、T5-G/T5-I6/T6均需届时明确授权；不得归档 T5-C或顶层
`integrity-error-domain-mapping`。
