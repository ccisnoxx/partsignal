# Publication 事件时间顺序 Authority 修复

## Goal

修复 `PublicationWorkEvent.created_at` 的时间来源，使同一 `PublicationWork` 的事件继续按 Work 行锁内的实际命令顺序严格单调，并让双 Session PostgreSQL 回归在应用进程与数据库容器存在墙钟偏差时仍然可靠。该 Task 只修事件 writer 的时钟 authority 及其回归证据，不改变发布业务状态机或公共 HTTP 合同。

## Background

- Wave 3 的真实 PostgreSQL sentinels 为 `3 passed / 1 failed`；唯一失败是 `test_publication_verification_final_authority_rejects_awaiting_switch_over_http` 在 HTTP 请求前的时间断言。
- 失败样本中，`switch_db` 的 PostgreSQL `now()` 为 `2026-09-02 07:54:18.175778+00`，`register_db` 写入事件的应用进程 `datetime.now(UTC)` 为 `2026-09-02 07:54:18.164377+00`，跨时钟偏差约 11.401ms。
- 本地只读诊断进一步观察到数据库 `clock_timestamp()` 比应用进程墙钟约快 33ms；同一事务内 `now()` 固定，而 `clock_timestamp()` 持续前进。
- 归档任务 `08-30-publication-verification-final-authority` 和稳定规范已经把 `created_at` 定义为同一 Work 的事件顺序 authority；删除或放宽该测试会掩盖既有并发合同。
- 当前 `_work_event` 是唯一生产 writer，所有 latest-event、timeline、verification command 和 workbench projection 都依赖 `created_at` 排序。

## Requirements

### R1. 唯一 writer 继续拥有顺序不变量

只在 `backend/app/services/publication.py::_work_event` 修正候选事件时间来源。所有创建、换版、准备更新、平台审核、结果登记、核验与关闭路径继续复用该 helper；不得新增第二个 writer、排序字段、sequence、状态位或兼容分支。

### R2. 单一数据库时钟域

候选 `created_at` 必须在取得 Work 锁并读取当前最大事件时间之后，从 PostgreSQL `clock_timestamp()` 取得。不得恢复模型默认的事务级 `now()`，不得继续使用应用进程 `datetime.now(UTC)`，也不得把 NTP/部署同步当作业务正确性的前提。

### R3. 严格单调下限保持

必须保留现有 `latest_created_at + 1 microsecond` 下限。当数据库时钟回拨、同一微秒碰撞或已有时间晚于当前数据库时钟时，新事件仍严格晚于同一 Work 的全部已有事件。`created_at ASC/DESC, id ASC/DESC` 的既有读模型排序规则保持不变。

### R4. 发布行为与公共合同不变

不得改变权限、Work/ContentTask status、revision、事务提交边界、行锁顺序、Verification/PublishedArticle 写入、结果字段、状态转换、审计、error-domain mapping、HTTP status/body/Header 或 request/response schema。

### R5. 保留并增强真实 PostgreSQL 回归

保留现有双 Session 场景：换版事务先开始，结果登记在另一 Session 先取得锁并提交，随后换版取得锁。测试必须继续证明：

- 数据库事务起点早于后写入的 `RESULT_REGISTERED` 事件；
- `CONTENT_VERSION_CHANGED.created_at` 严格晚于 `RESULT_REGISTERED.created_at`；
- latest event、`available_actions` 和 `primary_task` 正确；
- 后续真实 HTTP + CSRF 核验仍返回既有 `409 INVALID_STATE_TRANSITION`，且拒绝路径零副作用。

不得用删除时间断言、只测 HTTP status、sleep 放大或应用时钟 monkeypatch 代替真实时钟域和锁顺序证明。

### R6. 稳定规范记录 authority

在现有 publication 稳定规范中最小补充：持久化事件候选时间使用锁后的 PostgreSQL 实时时钟，事务级 `now()` 与应用主机墙钟都不是顺序 authority。不得修改 OpenAPI、数据库合同、migration 或 generated client。

## In Scope

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `.trellis/spec/backend/publication-workbench-guidelines.md`
- 本 Task 的 `prd.md`、`design.md`、`implement.md`、manifests 与 research

## Out of Scope

- Wave 3 的三个 router、runtime metadata 测试及 Task artifacts；它们保持原样且 Wave 3 继续为 `in_progress`。
- `PublicationWorkEvent` schema、migration、trigger、数据库回填、sequence 或新排序字段。
- Publication 权限、状态机、核验 eligibility、transaction/error mapping、read model 查询形状。
- OpenAPI、generated client、frontend、GEO、Workbench 实现、Phase X、Phase F。
- `.gitignore`、`artifacts/`、`backend/app/schemas/configuration.py` 和并行 Task。

## Acceptance Criteria

- [x] `_work_event` 在 Work 锁后从 PostgreSQL `clock_timestamp()` 获取候选时间，且没有应用进程墙钟或事务级 `now()` fallback。
- [x] 同一 Work 的新事件满足 `created_at > max(existing created_at)`；`+1 day` 隔离的真实 PostgreSQL sentinel 精确覆盖并证明回拨下限为 `+1µs`。
- [x] 现有失败 sentinel 在真实 PostgreSQL 环境通过，并显式证明 `CONTENT_VERSION_CHANGED.created_at > RESULT_REGISTERED.created_at`；确定性 guard 同时禁止恢复应用时钟。
- [x] Publication workflow 全文件原 19 项正式 gate 通过；后续变更涉及的原 sentinel 与新增 lower-bound sentinel 又定向 `2 passed`，最终文件全部路径由组合证据覆盖。
- [x] Work latest event、Workspace timeline、verification command 与 Workbench latest action 继续选择正确事件。
- [x] 实际权限、状态、revision、事务、HTTP 409、零副作用和 error-domain mapping 不变。
- [x] OpenAPI、database contract、migration、generated client 和 Wave 3 四个候选文件均无本 Task diff。
- [x] required validation 全部通过；额外批准的最终 affected-path 独立只读 Review 无 `MEDIUM` 或更高问题。
- [x] Wave 3 仍为 `in_progress`；本 Task 完成/归档后才回到 Wave 3 重跑其 PostgreSQL sentinels 与最终门禁。
- [ ] 最终提交严格路径限定，不包含 543 个已 staged artifact deletions、`.gitignore`、`configuration.py`、Wave 3 或并行 Task。

## Review Gate

用户已经批准本规划并允许运行 `task.py start` 进入实施。当前实施仍需关闭独立 Review 的 `MEDIUM` 后才能进入提交计划；实施批准不等于提交批准。
