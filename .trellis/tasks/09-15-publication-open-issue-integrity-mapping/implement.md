# Implement

> 用户已批准本规划；任务已运行 `task.py start` 并进入 `in_progress`。实施与 required/optional
> validation 已按下列阶段执行；提交、归档和 push 仍未获授权。

## Phase 1: Preflight and allowlist baseline

1. 重新完整读取本Task `prd.md/design.md/implement.md`、两个JSONL、T5-C冻结决策、三份backend
   spec与current-head target owner；不能把大文件的截断context injection当成完整合同。
2. 确认T1 `43c252da`、T5-I1 `62bb2360`、T5-I2 `a96f6df2`和T5-C `771a5826`仍可达；
   T5-C与顶层父任务保持`planning`，I1/I2保持completed/archived。
3. 记录完整`git status --short`，并分别保存implementation allowlist、当前Task/父bookkeeping和protected
   zero-diff owners的working-tree/index baseline。所有其他dirty/staged文件保持不动；禁止
   `git add -A`、`git add .`、`commit -a`、stash、reset、checkout、clean。
4. 先在现有临时PostgreSQL head fixture完成partial unique catalog与真实diagnostics sentinel。若名称、
   表、key、predicate、`pg_constraint`关系或exact pair任一不符，触发stop condition，不进入service/spec
   修改。

## Phase 2: Tests first

在`backend/tests/integration/test_publication_workflow.py`复用现有temporary database、seed、并发与HTTP
基础设施，新增/收敛下列有界场景：

1. current-head catalog断言，以及真实`23505 + uq_published_content_issues_one_open`正例。
2. 既有OPEN、历史RETIRED precheck tuple；RESTORED后重新open成功；隐藏RETIRED precheck后的真实
   `23514` trigger保持unknown。
3. 合规双Session Article `FOR UPDATE`竞争：精确query、wait event、winner blocker PID、loser未发送
   Issue INSERT、winner后precheck和single OPEN证据。
4. test-only双Session race：仅对参与连接移除Article `FOR UPDATE`并同步旁路precheck；真实Issue
   INSERT/FK/CHECK/trigger/index不变；证明loser等待在Issue INSERT，winner提交后exact diagnostics与
   single OPEN。
5. classifier fail-closed矩阵：Issue PK/其他unique、FK、CHECK、NOT NULL、trigger、constraint trigger、
   非23505、缺失/非字符串diag、大小写/前后缀/alias全部unknown。
6. catch-scope负例：projection、commit或late/deferred failure即使伪装目标名字也原样上抛，不能进入
   Issue INSERT mapper。
7. Issue专用失败快照、known同Session reuse、unknown direct-service显式rollback后reuse。
8. 真实route的OPEN/RETIRED/exact 409 ErrorEnvelope与request-ID对账；真实unknown FK/trigger 500
   no-leak且不冻结default body。
9. 既有event-time、publication workflow、immutable history、删除事务、权限、状态机、revision和
   AuditLog回归继续由本integration文件完整执行覆盖。

所有event/barrier/monitor/future必须有显式timeout和`finally`释放；不使用`sleep`或fixed-success mock。
temporary PostgreSQL不可用导致目标测试skip时，required integration不算验收通过，即使命令exit 0。

## Phase 3: Narrow implementation

1. 在`backend/app/services/publication.py`为既有precheck/exact path抽取或复用同一
   `PUBLISHED_CONTENT_ISSUE_CONFLICT`错误工厂，不改变tuple。
2. 在新增Issue后的首次`flush()`加入只识别目标exact pair的局部classifier/catch；known先root rollback
   再抛domain error，unknown原样上抛。
3. 保持Article `FOR UPDATE`、Issue读取/precheck顺序、projection和commit位置不变；不查询/replay winner。
4. 不包围Repair Task、Work、GEO、deletion、projection/late failure；不改event clock、immutable history、
   权限、状态机、revision或AuditLog。
5. 更新`contracts/database.md`与三份backend spec；不修改其他production、contract、documentation或
   frontend owner。

## Phase 4: Required validation

按下列顺序执行；targeted失败后只修复本任务归因问题。验证与review共享最多两轮与本任务根因相关的
repair/re-check预算：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run api:check
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md .trellis/tasks/09-15-publication-open-issue-integrity-mapping .trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json
git diff --exit-code HEAD -- contracts/openapi.yaml backend/app/routers/publication.py backend/app/main.py backend/app/errors.py backend/app/schemas/common.py backend/app/schemas/publication.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py docs/frontend-v2/05-business-actions-state-and-api-contract.md frontend/src frontend/tests frontend/package.json frontend/package-lock.json frontend/scripts
```

protected owner在preflight已经存在差异时，不把`--exit-code HEAD`失败误归因于本Task；必须以保存的
working-tree/index baseline证明候选没有新增该路径差异，并准确报告既有阻断。任何本Task新增的
OpenAPI/runtime/generated/frontend/Frontend V2差异都触发stop condition。

最后用精确path status/diff确认实际implementation diff只包含六个owner文件和当前Task工件/父child
bookkeeping；全部其他dirty/staged状态必须与preflight baseline一致。

## Optional full-suite gate

同一candidate最多运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

若不运行，closeout注明required integration/unit、Ruff和完整`backend/app` mypy为替代证据，并报告未覆盖
其他backend domain suite的残余风险。若collection/environment失败，准确归因；不清理用户缓存、不越界
修复、不重跑该一次性gate。I1/I2曾出现`test_geo_insights.py`同名模块collection错配，仅作为已知环境
风险，不预判本次结果。

## Phase 5: Independent high-risk read-only review

required checks通过后执行一次独立高风险只读full review，覆盖：

- 单一exact pair与完整unknown负矩阵，不解析message、不恢复全局handler；
- Article `FOR UPDATE`未削弱、normal loser精确等待且winner后由precheck裁决；
- test-only旁路范围、真实Issue INSERT等待、exact diagnostics与single OPEN；
- OPEN/RETIRED owner区分、RESTORED行为、catch边界；
- root rollback、Session reuse、失败快照、HTTP envelope/request ID与unknown no-leak；
- event-time、append-only/immutable history、删除事务、权限、状态/revision、AuditLog；
- implementation diff allowlist与OpenAPI/runtime/generated/frontend/Frontend V2零差异。

full review发现material问题时，仅在共享两轮repair/re-check预算仍有余额时允许一次targeted repair、
相关required re-check及一次targeted re-review；不得形成第三轮或借review扩展到Repair Task、Work、GEO、
T5-G/T6。预算用尽或re-review仍有material finding时停止并报告。

## Completion boundary

实现、required validation与独立review全部通过后，先向用户报告实际diff、命令结果、review finding与
残余风险。提交、归档、push和进入后续Task均需届时明确授权；无论结果如何，不归档T5-C或顶层
`integrity-error-domain-mapping`，不自动进入T5-I4/T5-G/T6。

## Execution record

- Preflight：依赖提交 `43c252da`、`62bb2360`、`a96f6df2`、`771a5826` 均可达；T5-C 与顶层父任务保持 `planning`。current-head PostgreSQL catalog 与真实 duplicate OPEN INSERT 已证明目标是 `published_content_issues(published_article_id)` 上 predicate 为 `status = 'OPEN'`、无 `pg_constraint` row 的 partial unique index，diagnostics 为 `23505 + uq_published_content_issues_one_open`。
- Implementation：只在 Issue 首次 `flush()` 周围增加 exact classifier/catch；precheck 与 mapper 共享既有冲突工厂，known path 先 root rollback。Article `FOR UPDATE`、projection/commit、状态机、历史、权限、删除事务和 wire owner 未变。
- Tests：新增的 catalog/diagnostics、fail-closed、normal Article-lock、test-only real INSERT race、OPEN/RETIRED/RESTORED、Session reuse、HTTP/no-leak、catch scope、deferred constraint trigger 与失败快照场景已随完整 publication integration gate 通过。
- Required validation：publication integration 77 项通过；contract/runtime metadata unit 401 项通过；Ruff 通过；mypy 对 80 个 backend source files 通过；`npm --prefix frontend run api:check` 通过；allowlist `git diff --check` 与 protected-owner zero-diff 通过。
- Optional full suite：当前 candidate 只运行一次；在 collection 阶段因 integration/unit 两个 `test_geo_insights.py` 的既有顶层模块 import mismatch 退出 2，未执行测试。依计划未清缓存、未越界修复、未重跑。
- 独立高风险只读 review：已完成 full review，无未关闭 material finding；复核者独立确认 exact mapper/catch、两条并发、RETIRED/RESTORED、unknown、Session reuse、HTTP/no-leak、原子性、文档边界和 protected-owner zero-diff。残余限制仅为 optional full suite 的既有 collection mismatch 与并发证据未覆盖数据库连接/网络故障。
- Completion boundary：全部 PRD 验收已有证据，任务继续保持 `in_progress` 等待用户决定是否提交与归档；未运行 `task.py finish/archive`，未 commit、未 push，也未启动后续 child。
