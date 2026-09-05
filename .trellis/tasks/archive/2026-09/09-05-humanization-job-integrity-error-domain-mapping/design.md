# Humanization Job IntegrityError 领域映射设计

## 1. 推荐设计

保留 `_create_job` 作为 `GenerationJob` 幂等读取、请求身份比较和最终 `flush()` 的唯一写入 owner；在两个 HUMANIZE command caller 的可见事务边界增加同一个窄 diagnostics classifier。classifier 只识别两个 `23505 + constraint_name`，不 rollback、不查询、不构造公共合同。

为避免 rollback 后复制 `_create_job` 的请求身份判断，提取现有“按 key 读取 + canonical identity 比较”为一个私有 helper，供 `_create_job` 的正常 replay 与已确认 idempotency race 的 winner 解析共同复用。请求 identity 必须在 flush 前冻结为标量 UUID/string/revision 值，rollback 后不得依赖已过期 ORM 对象重新推断 payload。该提取必须保持 `createGenerationJob` 和 GENERATE retry 的现有判断完全不变，不能形成第二套 payload comparator。

两个 caller 的 catch 顺序固定为：

```text
_create_job.flush()
  -> 非 IntegrityError：沿用 created/replay 结果
  -> IntegrityError：先读取 sqlstate + diag.constraint_name
       -> 未精确命中：原样 raise；get_db rollback/close -> default 500
       -> idempotency unique：caller root rollback
            -> 用唯一 canonical comparator 读取 winner
                 -> identity 相同：返回既有 job（202 replay，不 dispatch）
                 -> identity 不同：IDEMPOTENCY_CONFLICT
                 -> winner 不可验证：原 IntegrityError 上抛
       -> active-humanization unique index：caller root rollback
            -> HUMANIZATION_ALREADY_ACTIVE
```

`retry_generation_job` 的 catch 只包围 HUMANIZE `_create_job` 调用；GENERATE retry 继续走原路径。不得把 classifier 放进全局 handler，也不得让 `_create_job` 对所有 job type 自动映射。

HUMANIZE retry 还需修正既有 replay 优先级。完成旧 job existence、snapshot contract、`FAILED` 状态与父 task `OPEN` 检查后，先按 idempotency key 运行 canonical matcher：命中即 replay/conflict，不再要求原 job 仍是 latest，也不重跑事实完整性、source/AI model 或 active 检查，因为该分支不创建、不 commit、不 dispatch。只有 key 不存在的新 retry 才继续 latest、资格、source/AI model、active 与 flush。GENERATE retry 顺序保持不变；父 task 非 `OPEN`、旧 job 非 `FAILED` 和 snapshot contract 无效仍在 replay 前拒绝。

## 2. 已确认调用路径

### 2.1 createHumanizationJob

`backend/app/routers/production.py:create_humanization_job` 把 request Session、actor、path source ID、`HumanizationJobCreate.ai_model_id` 与 `Idempotency-Key` 传给 `content_production.create_humanization_job`。service 依次读取 source identity、锁定父 task 和 source、检查 model；已有 key 时先走 `_create_job` replay；新 key 时校验 source 与 active job，再由 `_create_job` 构造 snapshot、添加 job 并 flush。成功后 caller commit、dispatch、refresh。

### 2.2 HUMANIZE retryGenerationJob

`backend/app/routers/production.py:retry_generation_job` 把 request Session、actor、旧 job ID 与 key 传给 service。当前 service 先要求旧 job 是 retryable `FAILED`、父 task 为 OPEN 且仍是 latest，之后才查询 key；首次 retry 成功后新 job 已成为 latest，因此相同 previous/key 的合法 replay 会被 latest 检查提前拒绝。目标顺序是保留 existence/snapshot contract/`FAILED`/task `OPEN` 拒绝优先级，随后先做 canonical key replay/conflict；仅 key 不存在的新 HUMANIZE retry 才继续 latest、资格、source/AI model、active，并由 `_create_job(retry_of=previous)` 复用不可变 snapshot、flush。成功后仍是 commit、dispatch、refresh。

两条路径在写入前都持有父 `ContentTask FOR UPDATE`。正常同 source HTTP 请求因此通常被串行化；active partial unique 仍是数据库最终防线，但真实测试不能虚构“两请求自然同时越过 task lock”。

## 3. 精确映射矩阵

| 前置/数据库证据 | 允许的后续读取 | 结果 | HTTP | 原子性 |
|---|---|---|---|---|
| 已有 key，canonical identity 相同，未 flush | 无额外写入 | 返回 existing job | `202` replay | 不 commit、不 dispatch、不增行 |
| 已有 key，canonical identity 不同，未 flush | 无 | `IDEMPOTENCY_CONFLICT` / `幂等键已用于另一生成请求` / `{}` | `409 ErrorResponse` | 原 job 不变 |
| `sqlstate=23505` + `constraint_name=uq_generation_jobs_idempotency_key` | caller rollback 后只按该 key 读取已提交 winner，并复用 canonical identity comparator | 同 identity replay；异 identity `IDEMPOTENCY_CONFLICT` / `幂等键已用于另一生成请求` / `{}`；winner 不存在/不可验证则原异常 | `202` / `409` / default `500` | 失败写入整体回滚；replay 不 dispatch |
| 已有同源 active HUMANIZE，预检命中 | 无 | `HUMANIZATION_ALREADY_ACTIVE` / `该源版本已有活动自然化作业` / `{}` | `409 ErrorResponse` | 无 flush/dispatch |
| `sqlstate=23505` + `constraint_name=uq_generation_jobs_active_humanization_source` | 不进行 idempotency 回查 | `HUMANIZATION_ALREADY_ACTIVE` / `该源版本已有活动自然化作业` / `{}` | `409 ErrorResponse` | 失败写入整体回滚 |
| 其他 constraint、缺 diagnostics、非 `23505` 或其他 IntegrityError | 禁止失败后业务回查分类 | 原异常上抛 | default unknown `500` | `get_db()` rollback/close |

HUMANIZE retry 的 canonical key 命中优先于 latest、事实完整性、source/AI model 与 active 检查，但低于旧 job existence、snapshot contract、`FAILED` 和父 task `OPEN` 检查；这既保证 retry replay 可达，也避免幂等键绕过既有 task/job 状态合同。

两个 catalog 对象的区别：

- `uq_generation_jobs_idempotency_key` 是 `public.generation_jobs(idempotency_key)` 的 UNIQUE constraint，并由同名 unique index 支撑。
- `uq_generation_jobs_active_humanization_source` 是独立 partial unique index，键为 `source_content_version_id`，谓词为 `job_type='HUMANIZE' AND status IN ('PENDING','RUNNING')`；它不出现在 `pg_constraint`，但 PostgreSQL unique violation diagnostics 预期使用 index 名作为 `constraint_name`。

当前开发库的上述事实来自 Alembic `0038` catalog；仓库 head 为 `0043`，中间 migration 未触及目标表。实现前仍必须在 fixture 迁移出的 current-head PostgreSQL 中重新证明 catalog 与真实 psycopg diagnostics，不能接受 alias 或静态推断替代。

## 4. 私有代码边界

建议在 `content_production.py` 内形成三个清晰责任：

1. **canonical existing-job matcher**：从 `_create_job` 提取现有逻辑；在 flush 前以标量值冻结 task、retry parent、model、job type、source，以及 GENERATE 独有的 Prompt ID/revision，唯一负责与 existing row 比较；无 existing 时返回 `None`，异 identity 时仍构造既有 `IDEMPOTENCY_CONFLICT`。不得在 rollback 后读取可能已过期/删除的 ORM 对象来构造错误或猜测 identity。
2. **HUMANIZE diagnostics classifier**：读取 `error.orig.sqlstate` 和 `error.orig.diag.constraint_name`，只返回两个允许名称之一或 `None`；不 rollback、不解析消息、不查询数据库。
3. **caller-owned recovery**：create 与 HUMANIZE retry 的 caller 先分类；unknown 直接 raise；known 才 root rollback。idempotency 使用 canonical matcher，active 直接抛既有错误。

不新增通用 constraint registry、策略类、跨 service helper、公共错误码表或 SAVEPOINT abstraction。若 canonical matcher 的无行为提取会迫使修改其他 service/contract，停止并保留最小 caller-local 方案，但不得复制 payload identity 规则。

## 5. 事务与副作用

| 阶段 | 当前写入/副作用 | 失败策略 |
|---|---|---|
| 资格、replay、active 预检 | 只读与行锁 | AppError/unknown 结束请求；无业务写入 |
| `_create_job.flush()` | 仅 pending `GenerationJob` | 已知 constraint 由 caller rollback；unknown 由 `get_db()` rollback |
| caller commit | job 成为 PostgreSQL canonical state | commit 失败时不 dispatch |
| commit 后 dispatch | Celery UUID 或 eager worker | 保留已提交 PENDING job，由既有补投递/worker owner 恢复 |
| worker | 独立 `SessionLocal()` 更新 job，成功时创建 ContentVersion/移动 task pointer/递增 revision | worker 自有 rollback 与 FAILED 状态，不经过 HTTP mapper |
| review | 后续独立 command 创建 ContentReviewRecord | 本 Task 不触及 |

create/retry 入队命令本身不写 `AuditLog`、ContentVersion、review record、task pointer 或 revision。验收仍要查询这些表/字段，证明 mapper 未把未来副作用提前，也未在失败后触发 dispatch。

## 6. 测试设计

### 6.1 真实 PostgreSQL integration

- fixture 创建随机数据库并 `alembic upgrade head`；先对 `alembic_version`、`pg_constraint`、`pg_index`/`pg_indexes` 做 catalog gate。
- idempotency 最终路径分为两个独立竞争组：create-vs-create 在不同 task/source 使用同 key；HUMANIZE-retry-vs-retry 也在不同 task/source 使用同 key。每组用两个独立 Session 与 `before_flush` event/barrier 越过 key 预检；不同 task lock 不互相阻塞，数据库应恰一成功，败者分别从 caller 路径捕获真实 `uq_generation_jobs_idempotency_key` 并返回 `IDEMPOTENCY_CONFLICT`。
- same-key/same-identity：create 做顺序 replay；HUMANIZE retry 在首次成功使新 job 成为 latest 后，仍以原 previous job 与同 key 顺序 replay，断言同一 job ID、行数不变、dispatch 仅首次一次。另断言父 task 非 `OPEN` 等既有 contract/state 拒绝不会被 replay 绕过。该路径受父 task 行锁串行化，不伪造成必然的 unique race。
- active 最终路径：先建立真实 active job，使用窄 test-only precheck seam 让 command 到达最终 flush；create 与 HUMANIZE retry 分别捕获真实 partial index diagnostics。retry fixture 让目标 FAILED job 仍满足“latest”规则。不得移除 production task/source lock。
- unknown sentinel：使用 test-only SQLAlchemy event 令待插入 job 撞 `pk_generation_jobs`，经真实 HTTP `debug=False`/`raise_server_exceptions=False` 观察默认 500 与不泄漏；对 service 直接调用则显式 rollback 后验证 Session 可查询。
- 所有 case 在新 Session 检查 job/version/review/audit 计数、task pointer/revision 与 dispatch spy。

### 6.2 Unit

- 参数化 classifier：缺 `orig`/`diag`、缺 constraint、非 `23505`、第三 constraint、`23514`、`23502`、`23503`、`55000` 均返回 unknown；两个精确组合才命中。
- 参数化 create/HUMANIZE retry：unknown 不调用 local rollback 或 winner query；known idempotency 才 rollback + canonical winner resolution；known active rollback 后直接使用 active error。
- GENERATE retry 不进入 HUMANIZE mapper，既有 legacy/latest/snapshot 行为继续通过。

Fake `IntegrityError` 只证明分支，不替代真实 PostgreSQL catalog/diagnostics、failed Session 或唯一性 enforcement。

## 7. 公共合同与前端零变更

- OpenAPI 两个 operation 已声明 `409 ErrorResponse`；`ErrorDetail.code` 是 string，目标 code 不要求 schema/enum 变化。
- runtime router metadata 已声明相同状态集合；无需改 router。
- generated `schema.d.ts` 对两条 operation 只引用通用 ErrorResponse；无需重新定义类型。
- Frontend V2 已规定稳定 Idempotency-Key、`IDEMPOTENCY_CONFLICT` 后废弃 key、409 不自动重放；active error可走既有通用错误展示。
- database schema 已有两个 enforcement；mapper 不需要 migration。

如果实际实现需要改变任何上述事实，立即转 `content-integrity-error-contract-decision`。

## 8. 风险、停止条件与回滚

### 停止条件

- current-head catalog 名称、对象类型、谓词或真实 diagnostics 与矩阵不一致；
- partial unique index 不稳定提供可精确使用的 `constraint_name`；
- 必须依赖错误文本、alias、模糊匹配或 unknown 后查询才能分类；
- 需要新增/修改 code、status、message/details、ErrorEnvelope、OpenAPI、runtime metadata、generated/frontend 或 database schema；
- 需要改变 `createGenerationJob`、GENERATE retry、worker、router、其他 service/spec；
- 无法在不削弱 production lock/状态机的情况下建立真实 PostgreSQL 证据；
- 发现 command 不是独立 root transaction owner，必须引入 SAVEPOINT/组合事务语义。

### 回滚边界

实现回滚只撤销四文件内的 mapper/canonical matcher 提取、测试与 error-handling spec 条款；不回滚 schema，不恢复全局 unknown-to-revision handler，不触碰其他脏文件。若已知 mapper 无法安全落地，恢复 caller 原结构时也不能恢复“unknown 猜成 409”的旧缺陷，应停止并由用户决定后续边界。
