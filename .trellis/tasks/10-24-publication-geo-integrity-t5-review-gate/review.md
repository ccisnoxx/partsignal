# T5-G 独立只读复核 · 2026-10-24

复核者：本会话独立 critical_reviewer `/root/t6_recovery_review`。结论：无确认的剩余 material finding，可关闭 T5-G；不替代 T6-P，不授予部署许可。以下为主代理整理的复核结论与原始证据索引；本轮未重跑历史后端测试。

## 六任务证据与当前漂移

归档任务根目录为 `.trellis/tasks/archive/2026-09/`；当前 service 根为 `backend/app/services/`。

| 任务/提交 | 历史证据 | 当前核对 |
| --- | --- | --- |
| I1 Repair / `62bb2360` | `09-14-publication-repair-task-integrity-mapping/implement.md:38`：真实 PG catalog/flush diagnostics、Issue 锁等待、HTTP/Session/删除原子性；两项 P2 经定向修补、8-case re-check 与 re-review 关闭 | publication.py:980 仅接受 23505 + uq_content_tasks_source_published_content_issue_id；首次 task flush rollback 后 REPAIR_TASK_EXISTS，details 为空。4/4 相关历史测试函数 AST 未变；test_migrations.py:132 与 test_publication_workflow.py:5503 保留 catalog/diagnostics 断言 |
| I2 Work / `a96f6df2` | `09-14-publication-work-integrity-mapping/implement.md:76`：57 integration、contract/runtime、Ruff/mypy/api:check、protected-owner 通过，独立 full review 无 material finding | publication.py:406/455 三项 exact allowlist、rollback/winner 优先级、首次 flush catch 未变。相同 key + 完整身份 replay；异载荷 IDEMPOTENCY_CONFLICT；无同 key winner 时另两项约束为 PUBLICATION_IDENTITY_CONFLICT；幂等 winner 缺失 unknown。12/12 测试 AST 未变 |
| I3 OPEN Issue / `a5469871` | `09-15-publication-open-issue-integrity-mapping/implement.md:114`：partial index、23505、Article 锁/INSERT race、late/deferred unknown；77 integration、401 contract/runtime；独立 full review 无未关闭问题 | publication.py:918 仅 uq_published_content_issues_one_open，catch 限首次 flush；FOR UPDATE、OPEN/RETIRED 预检查、known rollback、无 winner replay 保持。5/5 测试 AST 未变 |
| I4 GEO shared key / `d5487430` | `09-16-geo-content-task-idempotency-integrity-mapping/research/implementation-log.md:14`：三个相关 integration 文件通过无 skip；QUESTION_COVERAGE_GAP exact-recovery 缺口修补后32 GEO通过、re-review关闭 | geo_observation.py:2204/2370 exact pair、rollback 后完整 task/source identity 裁决未变，source 写入和 commit 在 catch 外。12/12 测试 AST 未变 |
| I5 successor / `7fd3ddd2` | `09-16-geo-observation-successor-integrity-mapping/research/implementation-log.md:14,51`：partial unique、真实 duplicate、两类并发、20 passed/0 skip；全行原子性快照 P2 修补后20-case re-check与re-review关闭 | geo_observation.py:2455/2558 classifier 未变，catch 限 root 首次 flush、rollback、不查询 winner；relation/attachment/commit 在外。5/5 测试 AST 未变；后续 create 仅 I6 批准的 context code 替换 |
| I6 context/chain / `d73fab3f` 现行基线 | `.trellis/tasks/09-16-geo-observation-context-code-reconciliation/research/implementation-validation.md:8`：40 GEO、12 deletion、81 publication、401 contract/runtime；catalog恢复 P2 经定向 re-review 关闭 | GEO service 与六份相关 integration 相对 d73fab3f 字节相同。11 producer 对齐批准矩阵；三个 content operation 无 remap。AC11 依用户决定接受历史缺口，保持 NOT_CAPTURED，见该任务 closeout.md:7 |

I1–I3 的历史执行/review 主要以同期 implement.md 保存，不能冒称获得完整原始终端日志或 review 全文。本轮以现存代码、测试断言、提交比较作独立交叉核对。历史 optional full suite 的 collection mismatch 仍为历史失败。d73fab3f 是后来聚合提交，不是 I6 历史精确 allowlist 零差异凭据。

## 合同、unknown 与 11 producer

- 七项获准 unique diagnostics 由窄 command mapper 拥有；`backend/app/main.py:271` 未注册全局 IntegrityError handler，`backend/tests/unit/test_runtime_response_metadata.py:1071` 保留禁止该 handler 的断言。未知异常由 `backend/app/db.py:31` rollback/close Session。
- 不同约束、非23505、缺失/替代 diagnostics、FK/CHECK/trigger、mapper 外 relation/event/projection/commit/deferred failure 均保持 unknown，不解析数据库 message，不转为 revision conflict。
- I6 目标 producer 在 geo_observation.py 的 905/929/939/947/951/1030/2532/2613/2636/2643/2657 行：10项 context incomplete、1项 chain changed，与批准矩阵相同。`backend/app/routers/observation.py:85` 保留 Detail/Correction 一致快照。
- 锁后 chain changed 只证明本次调用中发现集合与锁定结果不一致，不能当作客户端确认 token 或覆盖弹窗打开后的全部变化。producer 2/5/6 是 synthetic 防御分支，不冒称真实 PG 可达损坏。
- 第二连接删除 tail interleaving、三个共享 content operation 零副作用、坏链 rollback 后 fresh Session catalog/data 核对均有现存测试。
- 当前 `0037_simplify_deletion_lifecycle.py:338` append-only trigger 是 UPDATE-only；0029历史DELETE guard不是当前保证。后续迁移未重定义目标 unique/FK。
- 11个相关 OpenAPI operation 均声明409，无新增500/default；`contracts/openapi.yaml:11951` 与 generated ErrorDetail.code 为开放string。database.md:630/632/644/648 与 backend error/publication specs 一致；Frontend V2 的 I5/I6 与 G/C 发布原子性继续保留。

## 后续变化的证据有效性

Publication 后来添加 Issue/Repair commit=False、Repair Product 锁、GEO Action 删除 blocker。`geo_opportunity_actions.py:162/186` 使用 commit=False，`geo_plan_locks.py:30` 外层失败 rollback，目标/行动/AuditLog 统一提交。

`.trellis/tasks/10-04-geo-704-action-integration/evidence/validation.md:13` 及所链接原始日志证明最终 actions/guards/migration 16 PG 通过，完整隔离 integration 1062 passed。当前 `test_geo_opportunity_actions.py:366` 覆盖 REPAIR_TASK_EXISTS、无多余行动审计及 Article blocker。该任务两项 P2 是主代理修复、真实 PG 验证后用户人工接受；其 evidence/review.md:10 明确没有第二次独立复核，不能追认。

## 本轮实际核对与边界

- 独立执行只读 AST 比较、历史提交/当前字节比较；九份关键 service/test/root contract SHA-256 与本轮 baseline 相同。
- 所比较历史与当前锁文件 psycopg 3.3.4、SQLAlchemy 2.0.51、FastAPI 0.139.0、Starlette 1.3.1 相同。目标约束、mapper 和关键测试无使证据失效的变化，不机械重跑全量 PG。
- 实际 `git diff --check -- backend contracts` 通过，`git status --short backend contracts` 无修改；reviewer 未改文件、未启动服务、未运行测试或 Git 写操作。
- T6-P 后续验收仍需完成；T6-G/C 见本日当前验收任务。发布原子性、未来部署授权与届时验证未被豁免。
