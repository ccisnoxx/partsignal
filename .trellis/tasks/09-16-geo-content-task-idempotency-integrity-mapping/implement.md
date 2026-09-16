# Implement Plan：GEO Content Task 幂等 IntegrityError 映射

> 本规划已由用户于 2026-09-16 明确批准，任务已进入 `in_progress`；提交、归档、push 和后续 Task 仍需另行授权。

## Phase 1: Preflight and authoritative evidence

1. 完整重读本Task三份Markdown、两个JSONL、T5-C的PRD/design/implement与四份research、已归档ordinary
   幂等Task的PRD/design/implement，以及两个backend spec；大文件必须分段读取，不能把截断注入当合同。
2. 确认依赖提交`43c252da`、`771a5826`、`62bb2360`、`a96f6df2`、`a5469871`仍可达；T5-C与顶层父任务
   保持planning，I1..I3保持completed/archived。
3. 保存完整`git status --short`以及implementation allowlist、当前Task/父bookkeeping、所有protected owner
   的working-tree/index baseline。禁止`git add -A`、`git add .`、`commit -a`、stash、reset、checkout、clean。
4. 先用现有临时PostgreSQL head fixture证明`uq_content_tasks_idempotency_key`的catalog定义与真实driver
   diagnostics。任一不符立即停止，不进入service/spec修改。

## Phase 2: Tests first in `test_geo_insights.py`

1. 增加current-head catalog与真实duplicate INSERT sentinel：表、列、contype、非deferrable及exact pair。
2. 强化正常GEO同key并发：两个独立Session/connection、有界barrier、advisory-lock目标SQL、指定blocker PID、
   loser未发task INSERT、只执行一次INSERT、winner后precheck replay、单task/source。
3. 增加connection-local test-only bypass race，并按锁兼容性拆证据：
   - same GEO、source-only差异、ordinary/GEO跨kind共享target资源，在首次lookup后、production资源锁前由
     PostgreSQL advisory latch形成可观测等待；winner完整commit后释放worker，保留全部production锁/FK并在
     真实task INSERT收到exact diagnostics；
   - 不同task identity使用不共享的product/fact/platform，证明loser在真实task INSERT等待指定winner的
     unique仲裁。
4. 在本文件调用unchanged ordinary service增加ordinary loser + 完整GEO winner的反向latch race；既有
   `test_content_task_creation.py`只读回归只证明guard/diagnostics，不冒充双worker等待。
5. 对task三字段与source六字段逐维覆盖可证明差异；按rule覆盖nullable字段的有效形状。
6. 覆盖winner missing、task identity缺失、内容型source article因历史`SET NULL`缺失、覆盖型source
   topic/platform缺失、未知rule/畸形source；断言重新抛出同一个原始`IntegrityError`。
7. 覆盖非目标unique、FK、CHECK、NOT NULL、trigger、缺失/非字符串diag、错误sqlstate、大小写/前后缀/alias、
   message伪造constraint；全部fail closed。
8. catch-scope负例：source add/flush/commit即使产生同名或其他`IntegrityError`也不得进入task INSERT mapper。
9. 扩展失败快照：task/source/basis、ContentVersion/Review、GEO relation、AuditLog、task status/revision/current
   pointer；known/unknown loser均无额外副作用，winner不可变。
10. known同Session在测试额外rollback前完成查询和健康命令；unknown捕获原异常后显式rollback再reuse。
11. 通过真实route验证precheck/exact 409 tuple、四字段ErrorEnvelope和request ID；真实unknown PostgreSQL失败
    验证默认500 no-leak且不冻结body。

所有event/listener/override/barrier/future/monitor必须有timeout和`finally`清理。不得使用sleep、无界
`executor.map`、任意Lock或synthetic exception冒充真实数据库race。

`test_content_task_creation.py`只运行既有ordinary→GEO precheck/race回归，不修改；
`test_publication_workflow.py`只提供fixture/并发模式并作为跨域回归，不修改。

## Phase 3: Narrow production implementation

1. 在`geo_observation.py`增加command-local exact classifier；只读固定structured diagnostics。
2. 增加本地私有GEO identity判定，区分same/different/unverifiable，并按rule校验source必要形状；不导入或修改
   ordinary私有helper，不建立shared abstraction。
3. 仅在`add_locked_content_task(...)`局部catch `IntegrityError`：
   - 非exact pair原样上抛；
   - exact pair保存原异常并root rollback；
   - 按key重查winner并执行PRD decision table；
   - same GEO返回winner；完整ordinary/异GEO抛既有冲突；missing/incomplete重抛原异常。
4. 保持existing lookup、资源锁序、insight复算、article校验、source add与commit位置不变；不包围source flush/commit。
5. 对新增Python helper、复杂异常分支与开发者可见文本执行中文touched-scope文档检查。

## Phase 4: Contract/spec synchronization

1. `contracts/database.md`在ContentTask/GEO source单一权威位置记录exact pair、双向kind、tri-state、同事务与unknown。
2. `database-guidelines.md`补GEO owner、真实catalog/diagnostics、normal/bypass concurrency、失败快照和Session reuse。
3. `error-handling.md`补局部catch scope、known rollback/requery、unknown rethrow/no-leak；不建立第二套error registry。
4. OpenAPI、router、runtime、schema、generated client、Frontend V2与frontend保持零diff。

## Phase 5: Required validation

以下命令均为实施阶段required；PostgreSQL目标用例skip即使exit 0也不算通过。失败后只有相关代码、测试、
配置或诊断证据变化才重跑，且本任务根因共享最多两轮repair/re-check预算。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_insights.py backend/tests/integration/test_content_task_creation.py backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_insights.py backend/tests/integration/test_content_task_creation.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
```

allowlist whitespace gate：

```bash
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_insights.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/tasks/09-16-geo-content-task-idempotency-integrity-mapping .trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json
```

clean protected-owner zero-diff gate：

```bash
git diff --exit-code HEAD -- backend/app/services/content_planning.py backend/tests/integration/test_content_task_creation.py backend/tests/integration/test_publication_workflow.py contracts/openapi.yaml backend/app/routers/observation.py backend/app/main.py backend/app/errors.py backend/app/schemas/common.py backend/app/schemas/content.py backend/app/schemas/geo_files.py backend/app/services/projections.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py backend/tests/unit/test_response_schema_instances.py docs/frontend-v2/05-business-actions-state-and-api-contract.md frontend/src frontend/tests frontend/package.json frontend/package-lock.json frontend/scripts
```

若protected路径在preflight已dirty，不把`--exit-code HEAD`失败误归因于本Task；必须比较保存的path status与
working-tree/index diff fingerprint，证明candidate没有新增该路径差异。对整个`frontend/`执行同样baseline
比较，保留既有`frontend/AGENTS.md`等无关修改。

最后逐路径审查实际diff，检查：message解析、模糊constraint、rollback前查询、source-less replay、
incomplete source猜测、catch包围commit、ordinary owner变化、共享mapper、schema/wire漂移与无关文件吸收。

## Optional full backend suite

同一candidate最多运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

当前已知`backend/tests/unit/test_geo_insights.py`与`backend/tests/integration/test_geo_insights.py`在默认pytest
import mode下发生同名顶层模块collection mismatch。若optional gate因此在collection阶段失败，准确记录exit、
路径和未执行测试；不清缓存、不改`--import-mode`/pytest配置、不重命名/新增文件、不越界修复，也不重跑该
一次性gate。若不运行，记录required targeted integration/unit、Ruff和全backend app mypy为替代证据及残余风险。

## Phase 6: Independent high-risk read-only review

required checks通过后执行一次独立只读full review，覆盖：

- 单一exact pair、task INSERT catch scope与完整fail-closed矩阵；
- ordinary/GEO双向kind、rule-specific source完整性、0037 article SET NULL与tri-state；
- normal advisory wait、共享资源场景的test-only PostgreSQL latch、不共享资源场景的真实INSERT wait、
  指定blocker和有界清理；
- root rollback、winner重查、Session reuse、task/source原子性与完整失败快照；
- HTTP envelope/request ID、unknown 500 no-leak；
- ordinary/OpenAPI/runtime/generated/frontend protected-owner零差异与allowlist。

full review发现material finding时，只有共享repair预算仍有余额才允许一次targeted repair、相关required
re-check和一次targeted re-review。不得进行第三轮或借review进入T5-I5/I6/T6。

## Completion boundary

实现、required validation与独立review全部通过后，向用户报告实际diff、命令结果、review finding、optional
suite结果与残余风险。提交、归档、push、启动后续Task均需届时明确授权；不得归档T5-C或顶层
`integrity-error-domain-mapping`。
