# Humanization Job IntegrityError 领域映射

## Goal

在不改变公共 API、数据库 schema、生成客户端或前端行为的前提下，使 `createHumanizationJob` 与 HUMANIZE 类型的 `retryGenerationJob` 在 `_create_job` 写入 `generation_jobs` 时，只把两个已确认的 PostgreSQL 唯一性 enforcement 精确转换为既有领域结果；所有其他完整性故障继续进入默认 unknown 500 边界。

本 Task 是父任务 `.trellis/tasks/09-04-integrity-error-domain-mapping` 的 T4 第一个独立可验收切片。当前阶段只完成 planning，不运行 `task.py start`，不实施代码或测试修改。

## Background

- 前置子任务 `unknown-integrity-error-boundary-correction`、`configuration-integrity-error-domain-mapping`、`identity-integrity-error-domain-mapping` 已完成。
- 两个 HTTP operation 已存在并声明 `202` 与通用 `409 ErrorResponse`：`createHumanizationJob` 和 `retryGenerationJob`。`ErrorDetail.code` 仍为开放 string，目标错误码均已在 runtime 使用。
- 两条目标路径都由 `backend/app/services/content_production.py::_create_job` 创建并 `flush()` 一个 `GenerationJob`。正常 replay 在写入前按 idempotency key 与既有请求身份比较。
- `create_humanization_job` 当前宽捕获任意 `IntegrityError`，rollback 后按 key 回查，查不到便猜成 active conflict；HUMANIZE retry 当前没有对应的本地精确 mapper，且在幂等查询前执行 latest 检查，导致首次 retry 成功后，同 key 同 payload 无法 replay 已成为 latest 的新 job。
- 开发 PostgreSQL catalog（Alembic `0038_published_article_delete`）确认目标对象的当前名称与类型；仓库 migration head 是 `0043_geo_platform_identity`，且 `0039–0043` 未触及 `generation_jobs`。这支持对象未漂移的推断，但不替代实施阶段在隔离 current-head PostgreSQL 中捕获真实 diagnostics。

## Requirements

### R1. 精确覆盖两条命令路径

- 覆盖 `createHumanizationJob -> create_humanization_job -> _create_job -> db.flush()`。
- 只覆盖 `retryGenerationJob -> retry_generation_job` 的 `previous.job_type == "HUMANIZE"` 分支；GENERATE retry 与 `createGenerationJob` 行为必须保持不变。
- HUMANIZE retry 在旧 job 存在、snapshot contract 合法、旧 job 为 `FAILED` 且父 task 为 `OPEN` 后，必须先按 idempotency key 做 canonical replay/conflict；只有 key 不存在的新 retry 才继续 latest、资格、source/AI model、active 与最终 flush。上述 contract/state 拒绝优先级保持在 replay 之前。
- 预检只是快速路径，PostgreSQL 唯一性 enforcement 仍是最终权威。

### R2. 只允许两个结构化映射

- 仅当 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_generation_jobs_idempotency_key"` 时进入 generation-job 幂等冲突恢复：
  - 已提交 winner 与当前 HUMANIZE 请求身份相同，返回既有 canonical job，保持既有 `202` replay；
  - winner 与当前请求身份不同，返回既有 `409 IDEMPOTENCY_CONFLICT`、message `幂等键已用于另一生成请求`、details `{}`；
  - diagnostics 已命中但 rollback 后无法取得可验证 winner 时，原 `IntegrityError` 继续上抛，不猜测结果。
- 仅当 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_generation_jobs_active_humanization_source"` 时返回既有 `409 HUMANIZATION_ALREADY_ACTIVE`、message `该源版本已有活动自然化作业`、details `{}`。
- 领域 message、details 与 `ErrorEnvelope` 保持既有行为，不新增 code 或字段。

### R3. 保留 unknown 500 边界

- 未列名 unique/PK、diagnostics 缺失、非 `23505`、CHECK、NOT NULL、FK、trigger failure 以及任何不满足 R2 精确条件的异常必须原样上抛。
- 禁止解析 `str(error)`、`message_primary`、英文数据库文本、key/value、column，禁止 constraint alias、substring 或模糊匹配。
- 只有 idempotency constraint 已由 diagnostics 确认后，才允许 rollback 后按 key查询 winner；不得以“查到/查不到某行”反推未知 constraint。
- unknown 由 HTTP request 的 `get_db()` rollback/close，并进入既有默认 500；不得冻结默认 500 body、code、Header 或 media type。

### R4. 幂等与 active 行为一致

- create 与 HUMANIZE retry 的同 key 同请求身份均 replay 同一个 job，不重复 dispatch；HUMANIZE retry 首次成功后，即使新 retry job 已成为 latest，使用原 previous job 与同 key 重放仍须命中 canonical replay。
- 同 key 异请求身份均返回 `IDEMPOTENCY_CONFLICT`，不得覆盖或删除原 job。
- active-humanization 预检与最终 partial unique index 路径均返回 `HUMANIZATION_ALREADY_ACTIVE`；create 与 HUMANIZE retry 均须覆盖。
- HUMANIZE 请求身份沿用 `_create_job` 的既有 canonical 比较字段：content task、job type、source content version、AI model 与 retry parent；actor/request ID 不属于 payload identity。
- 已有 key 命中时不创建、不 commit、不 dispatch，因此可跳过只服务于新 job 的 latest、事实完整性、source/AI model 与 active 检查；但父 task 非 `OPEN`、旧 job 非 `FAILED` 或 snapshot contract 无效仍按既有错误拒绝，不因 replay 被绕过。

### R5. 事务与副作用原子性

- 两条 HTTP command 是各自 root transaction/commit owner；已知约束命中后由 caller 显式 root rollback，unknown 交给 `get_db()` cleanup，不引入 SAVEPOINT 或第二套事务 owner。
- 失败不得新增 `GenerationJob`、`ContentVersion`、`ContentReviewRecord` 或 `AuditLog`，不得改变 task current pointer、task/content revision，也不得 dispatch。
- 成功顺序继续是数据库 commit 后 dispatch；不得移动、补偿或重定义 broker failure 行为。
- Worker 继续使用独立 `SessionLocal()` 与自己的 `PENDING -> RUNNING -> SUCCEEDED|FAILED` 事务，不复用 HTTP mapper。

### R6. 文件与文档边界

实施文件边界仅为：

- `backend/app/services/content_production.py`
- `backend/tests/integration/test_generation_reliability.py`
- `backend/tests/unit/test_generation.py`
- `.trellis/spec/backend/error-handling.md`

`contracts/openapi.yaml`、`contracts/database.md`、runtime router metadata、generated client、Frontend V2 文档与代码、ORM、Alembic、其他 service 均为只读/零 diff 对照。

## Out of Scope

- `createGenerationJob`、GENERATE retry、worker content/version unique、content task、fact/content review、publication/GEO 的其他 IntegrityError 映射。
- 新领域错误码、HTTP status、ErrorEnvelope/schema、前端恢复策略或稳定 500 合同。
- 数据库 migration、constraint/index 重命名、schema 或生产数据修改。
- 为测试移除或削弱 production `FOR UPDATE`、状态机、资格校验或不可变边界。
- 当前工作区的其他脏文件、artifacts、Git 提交、归档或 push。

如任一项成为实施必要条件，停止本 Task，先规划独立的 `content-integrity-error-contract-decision`，不得扩大范围。

## Acceptance Criteria

- [ ] 隔离 PostgreSQL 数据库已迁移到执行时仓库 head，并实测两个目标对象的 catalog 类型、精确名称与真实 `23505 + diag.constraint_name`。
- [ ] `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 都经 `_create_job` 的最终 flush 使用同一窄诊断规则。
- [ ] 同 key 同 HUMANIZE 请求身份返回同一 job/`202`，不重复 commit/dispatch；create 与 retry 均有测试，且 retry 首次成功后新 job 已成为 latest 时，针对原 previous job 的同 key replay 仍成功。
- [ ] 同 key 异请求身份返回既有 `409 IDEMPOTENCY_CONFLICT`；预检与真实 idempotency constraint 路径的 code/message/details 一致。
- [ ] active 预检与真实 `uq_generation_jobs_active_humanization_source` 路径均返回既有 `409 HUMANIZATION_ALREADY_ACTIVE`；create 与 HUMANIZE retry 均有真实 PostgreSQL 证据。
- [ ] idempotency diagnostics 命中后仅用既有 canonical request identity 判断 replay/conflict；winner 缺失时原异常上抛。
- [ ] 第三个真实 unique/PK sentinel 原样上抛并在 HTTP 下进入默认 500，不返回两个目标 409，也不泄漏 SQL、表、constraint、数据库 message 或 stack。
- [ ] diagnostics 缺失、非 `23505`、未知 constraint、CHECK/NOT NULL/FK/trigger 类别的分支测试证明不会被两个 mapper 捕获。
- [ ] 每个失败场景均无第二 job、content version、review record、成功 AuditLog、task pointer/revision 或 dispatch 残留；失败 Session cleanup 后独立查询可用。
- [ ] 成功路径保持 commit 后 dispatch；Worker 独立 Session、重复 worker、自然化不可变版本和 broker 恢复回归不变。
- [ ] `createGenerationJob` 与 GENERATE retry 没有行为改变。
- [ ] `.trellis/spec/backend/error-handling.md` 只记录本 service owner 的两个精确映射、rollback/replay 和 unknown 边界，不建立全局 registry。
- [ ] OpenAPI、database contract、router/runtime metadata、generated client、Frontend V2、ORM/migration 与其他 service 保持零 diff，`make contract-check` 通过。
- [ ] 实施 payload 的 diff 仅限 R6 四个文件；本 Task 规划产物与父任务 child bookkeeping 作为 Trellis 元数据单独保留，现有其他脏文件和 artifacts 保持不动。
- [ ] 独立 review 未发现未解决的 material issue；validation/review 遵守既定收敛上限。

## Planning Status

- 用户拥有的产品、scope、UX、兼容性和风险决策：已由本请求与父任务解决。
- 阻塞性开放问题：无。
- 实施前技术门禁：current-head PostgreSQL catalog 与真实 diagnostics；失败时按停止条件退出，不进入代码修改。
- 当前状态：`planning`；等待用户 review 最新规划并另行批准实施。
