# Research: PostgreSQL catalog 与 generation_jobs 唯一性 diagnostics

- Query: 核实 current-head 可用 PostgreSQL 实例/测试数据库、`generation_jobs` 两个目标唯一对象的真实名称、类型、定义、schema/table、以及 PostgreSQL/psycopg unique violation diagnostics 的可用字段；确认 partial unique index 与 UNIQUE constraint 的差异。
- Scope: mixed（本地容器 catalog 只读查询 + 仓库 migration/ORM/测试审计 + PostgreSQL/psycopg 官方资料）
- Date: 2026-09-05

## Findings

### 1. 访问入口与 current-head 状态

本次只使用了 `docker ps`、`docker inspect`、`docker compose ... ps`、`find/rg/sed/nl` 和容器内 `psql -X -q` 的 `SELECT`；未执行 `INSERT`、`UPDATE`、`DELETE`、DDL、Alembic upgrade/downgrade、测试 fixture 或生产请求。

仓库和运行环境的只读检查结果：

| 检查对象 | 命令/证据 | 结果 |
|---|---|---|
| 开发 PostgreSQL | `docker ps --format ...`; `docker compose --env-file .env -f deploy/compose.dev.yaml ps` | `partsignal-dev-postgres-1`，`postgres:16-alpine`，健康，宿主机 `127.0.0.1:55432 -> 5432` |
| 开发库版本 | `docker exec partsignal-dev-postgres-1 psql -U partsignal -d partsignal -X -q -AtF '\\t' -c "SELECT current_database(), current_user, version(), (SELECT version_num FROM alembic_version);"` | `partsignal / partsignal / PostgreSQL 16.14 ... / 0038_published_article_delete` |
| 仓库 migration head | `cd backend && .venv/bin/alembic heads` | `0043_geo_platform_identity (head)` |
| staging PostgreSQL | `docker exec partsignal-staging-postgres-1 psql ... -c "SELECT ..."` | PostgreSQL 16.14，但 `alembic_version` 不存在；`information_schema.tables` 没有业务表，不能作为 current-head catalog |
| 其他数据库 | `SELECT datname, datallowconn, datistemplate FROM pg_database ORDER BY datname`（两个容器） | 每个容器只有 `partsignal`、`postgres`、`template0`、`template1`；没有已存在的独立测试库 |
| 测试 URL 环境 | `env | cut -d= -f1 | rg '^(PARTSIGNAL|DATABASE|POSTGRES|APP_ENV)'` | 当前 shell 没有 `PARTSIGNAL_TEST_DATABASE_URL`、`DATABASE_URL` 或 `APP_ENV`；项目 `.env` 的 `DATABASE_URL` 是 Compose 内部 `postgres:5432` |

因此，本次确实连接并查询了一个可用但落后于仓库 head 的开发库；没有可供只读核验的 current-head 已迁移测试库。开发库的目标对象是在 `0017` 引入后、后续 `0038` 仍存在的 schema，静态搜索未发现 `0043` 或中间 migration 重命名/删除这两个名字。实施阶段仍必须在测试 fixture 新建并迁移到仓库 head 的隔离 PostgreSQL 后再次核验；不能把本次 `0038` catalog 当成 `0043` catalog 的实测替代。

### 2. current catalog 的精确对象矩阵

使用的只读查询（在 `partsignal-dev-postgres-1` 内执行）：

```sql
SELECT c.oid::regclass AS index_oid,
       n.nspname AS index_schema,
       c.relname AS index_name,
       c.relkind,
       i.indrelid::regclass AS table_name,
       i.indnatts,
       i.indkey::text AS indkey,
       i.indisunique,
       i.indisvalid,
       pg_get_expr(i.indpred, i.indrelid, true) AS predicate,
       pg_get_indexdef(i.indexrelid) AS index_definition,
       con.oid AS constraint_oid,
       con.contype,
       con.conname,
       pg_get_constraintdef(con.oid, true) AS constraint_definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
WHERE i.indrelid = 'public.generation_jobs'::regclass
  AND c.relname IN (
      'uq_generation_jobs_idempotency_key',
      'uq_generation_jobs_active_humanization_source'
  )
ORDER BY c.relname;
```

实际输出摘要：

| 对象名 | schema/table | `relkind` | unique/valid | partial | 定义 | `pg_constraint` |
|---|---|---|---|---|---|---|
| `uq_generation_jobs_idempotency_key` | `public.generation_jobs` | `i`（index relation） | `indisunique=t`, `indisvalid=t`, `indisready=t` | 否（`indpred` 为 NULL） | `CREATE UNIQUE INDEX ... ON public.generation_jobs USING btree (idempotency_key)` | 有；`contype=u`，`conname` 同名，`UNIQUE (idempotency_key)`，`convalidated=t`，`condeferrable=f`，`condeferred=f` |
| `uq_generation_jobs_active_humanization_source` | `public.generation_jobs` | `i`（index relation） | `indisunique=t`, `indisvalid=t`, `indisready=t` | 是 | `CREATE UNIQUE INDEX ... ON public.generation_jobs USING btree (source_content_version_id) WHERE (((job_type)::text = 'HUMANIZE'::text) AND ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'RUNNING'::character varying])::text[])))` | 无 |

进一步的 catalog 输出：

```text
uq_generation_jobs_idempotency_key | public | generation_jobs | UNIQUE (idempotency_key)
uq_generation_jobs_active_humanization_source | public | generation_jobs | （pg_constraint 无行）
```

对 `information_schema.table_constraints` 的同名查询只返回：

```text
public | generation_jobs | uq_generation_jobs_idempotency_key | UNIQUE
```

对 `pg_class` 全 schema 的同名查询只找到上述两个 `public` index，没有其他 schema 的同名对象。`pg_depend` 显示 idempotency index 以内部依赖关联到 constraint OID `16726`；active index 仅以自动依赖关联到 `generation_jobs`，与其不是 constraint-backed object 的结果一致。

`generation_jobs` 的关键列 catalog 结果为：

```text
id                         uuid                  NOT NULL
idempotency_key            character varying(128) NOT NULL
status                     character varying(24) NOT NULL
job_type                   character varying(24) NOT NULL
source_content_version_id uuid                  NULL
```

开发库当前 `generation_jobs` 为零行（`total_jobs=0`、`keyed_jobs=0`、`active_humanization_jobs=0`），所以没有现存业务行可用于冲突回查或改变 catalog 结论。

### 3. migration、ORM 与调用路径的交叉证据

- `backend/alembic/versions/0017_content_humanization.py:38-70` 新增 `job_type` 与 `source_content_version_id`，创建 `ck_generation_jobs_job_type`、`ck_generation_jobs_job_type_source`，并以 `op.create_index(..., unique=True, postgresql_where=...)` 创建 `uq_generation_jobs_active_humanization_source`。这明确表明 active 名称是 index 名，不是 `op.create_unique_constraint` 的 constraint 名。
- `backend/app/migration_schema_v1.py:426-435` 的初始 `GenerationJob.idempotency_key` 使用 `unique=True, nullable=False`；开发库 catalog 将其物化为同名 `UNIQUE` constraint/index。
- `backend/app/models/ai_generation.py:132-188` 保持同一事实：`idempotency_key` 是列级 `unique=True`；active humanization 是带谓词的 `Index(..., unique=True, postgresql_where=...)`。
- `backend/app/services/content_production.py:279-387` 的 `_create_job()` 先按 `idempotency_key` 查询，再 `db.add(job)` 和 `db.flush()`；失败点是该 `flush`。job type/source 的值由 `retry_of`/`source` 决定，因此 create humanization 与 HUMANIZE retry 都会写入同一 `generation_jobs` 表和同一 active partial index。
- `backend/app/services/content_production.py:440-516` 的 `create_humanization_job()`：先查询幂等键、验证 source、查询活动 HUMANIZE 作业，然后调用 `_create_job()`；现有 `except IntegrityError` 在 `:496-511` 无条件 rollback 后仅按幂等键回查，查不到时猜为 `HUMANIZATION_ALREADY_ACTIVE`，没有读取 diagnostics。
- `backend/app/services/content_production.py:519-604` 的 `retry_generation_job()`：先验证失败作业、OPEN task、最新作业和 HUMANIZE source，再在 `:597-599` 调用 `_create_job()`；HUMANIZE active 预检在 `:588-596`，最终 `_create_job()` 目前没有本地 `IntegrityError` catch。
- HTTP operation owner 是 `backend/app/routers/production.py:244-268` 的 `createHumanizationJob` 和 `:309-328` 的 `retryGenerationJob`；两者 OpenAPI 现有 409/ErrorEnvelope 声明位于 `contracts/openapi.yaml:2264-2278`、`:2310-2324`。本 catalog 研究未发现需要改公共合同的证据。

### 4. unique violation diagnostics：可用字段与 partial index 行为

PostgreSQL 16 官方协议文档说明：错误响应的 `C` 是始终存在的 SQLSTATE；`s`/`t`/`c`/`n` 分别是 schema/table/column/constraint 字段，但对象字段只在有限错误类型提供，不能假定所有字段成对出现；特别地，**index 即使不是用 constraint 语法创建，也按 constraint 处理**。见 [PostgreSQL 16 Error and Notice Message Fields](https://www.postgresql.org/docs/16/protocol-error-fields.html)，其中 `n` 的说明明确包含该规则，且提醒客户端不能假定每个对象字段都存在。

Psycopg 3 将服务端字段暴露在 `Error.diag`，字段包括 `constraint_name`、`schema_name`、`table_name`、`column_name`、`sqlstate` 等；`Error.sqlstate` 也直接暴露 SQLSTATE。项目环境中的版本是 `psycopg 3.3.4`、`SQLAlchemy 2.0.51`。见 [psycopg 3 errors API](https://www.psycopg.org/psycopg3/docs/api/errors.html)。仓库已有 mapper/test 模式也直接访问 `error.orig.sqlstate` 和 `error.orig.diag.constraint_name`，例如 `backend/app/services/platform_configuration.py:425-427,655-657`、`backend/tests/integration/test_platform_types.py:239-269`。

PostgreSQL 16 btree 实现进一步给出 partial index 的关键行为：`REL_16_STABLE/src/backend/access/nbtree/nbtinsert.c` 在重复键路径以 `ERRCODE_UNIQUE_VIOLATION` 报告错误，并调用 `errtableconstraint(heapRel, RelationGetRelationName(rel))`；`rel` 是触发冲突的 index，`heapRel` 是基表。因此，即使 `uq_generation_jobs_active_humanization_source` 没有 `pg_constraint` 行，其冲突也应使用 index 名作为 constraint diagnostics，同时把基表作为 table/schema diagnostics。见 [PostgreSQL 16 btree unique-check source](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/access/nbtree/nbtinsert.c#L3367-L3381)。这是基于官方源码的行为推断，不是本次 live write 实验结果。

对本项目两个对象，实施测试应以如下结果为预期，并在 current-head 隔离库用真实写入实测：

| 触发对象 | 预期 SQLSTATE | 预期 `diag.constraint_name` | 预期 `diag.schema_name` | 预期 `diag.table_name` | `diag.column_name` |
|---|---|---|---|---|---|
| idempotency UNIQUE constraint | `23505` (`unique_violation`) | `uq_generation_jobs_idempotency_key` | `public` | `generation_jobs` | PostgreSQL btree 唯一路径只设置 table constraint 字段，通常为 `None`；不能依赖它分类 |
| active humanization partial UNIQUE INDEX | `23505` (`unique_violation`) | `uq_generation_jobs_active_humanization_source`（index 名） | `public` | `generation_jobs` | 同上，通常为 `None`；不能依赖它分类 |

上表的 SQLSTATE、index/constraint name 和 schema/table 是官方协议+源码结合出的预期；本次禁止写入，因此没有把它们误写成 live exception capture。`message_primary`/`message_detail` 会携带人类可读的约束和 key 信息，但不是稳定分类依据，不能在 mapper 中解析。

### 5. 对 T4 窄切片的直接建议

1. `uq_generation_jobs_idempotency_key` 与 `uq_generation_jobs_active_humanization_source` 必须作为两个独立 allowlist 条目。后者要从 `pg_index`/`pg_indexes` 角度理解为 partial unique **index**，不能因为 `pg_constraint` 查询为空就认为没有 diagnostics 或改用模糊文本。
2. 两条 allowlist 都应要求 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name` 精确等于对应名称；与仓库现有 mapper 约定一致。schema/table 可在真实 PostgreSQL integration test 中断言为 `public`/`generation_jobs`，但不要解析英文 message、detail、key value 或通过失败后查询猜测约束。
3. `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 的预检语义可以保持现有领域结果：同 key 同 payload 返回已有 job；同 key 异 payload 返回 `409 IDEMPOTENCY_CONFLICT`；不同 key 但同 source 的 active 竞态返回 `409 HUMANIZATION_ALREADY_ACTIVE`。最终 `23505` 只能依据上面的 diagnostics 选择这两个结果，未列名约束、缺 diagnostics、非 `23505`、CHECK/NOT NULL/FK/trigger 继续原异常。
4. `db.flush()` 是最早且共同的最终约束边界；mapper 所在 command owner 必须在失败后处理 SQLAlchemy failed state。未知异常不应在 rollback 后用“是否查到幂等行”推断 active 冲突。成功路径的 `commit -> dispatch -> refresh`（`create_humanization_job:512-515`、`retry_generation_job:600-603`）不应因 mapper 改动重排。
5. 本次 catalog 发现没有公共错误码、HTTP status、OpenAPI、generated client、frontend 或 schema 变更的必要性：两个 code 都已存在且目标 operations 已声明 409。若实施证据要求新增 code/status、改变 response shape 或修订前端恢复政策，应停止 T4 窄切片并另立 `content-integrity-error-contract-decision`。

## Caveats / Not Found

- 没有可用的 current-head（`0043_geo_platform_identity`）已迁移测试数据库：开发容器停在 `0038_published_article_delete`，staging 容器为空且无 `alembic_version`。本次没有执行迁移来制造 head 库，因为迁移会写数据库，超出研究子任务的只读边界。
- 没有执行任何实际 duplicate `INSERT`、并发写入或 HTTP/service 测试；因此没有声称本机捕获到真实 `psycopg.errors.UniqueViolation` 的 `diag` 对象。partial index 的 diagnostics 结论来自 PostgreSQL 16 协议文档和 REL_16_STABLE btree 源码，实施阶段必须用 fixture 创建的 current-head 隔离库补真实证据。
- `information_schema.table_constraints` 只能看到 `uq_generation_jobs_idempotency_key`，看不到 active partial unique index；这不是 active 唯一性不存在，而是 constraint/index 类型差异。分类代码不能只查询 `pg_constraint` 或把“无 constraint 行”作为 unknown 的理由。
- PostgreSQL 文档明确指出 schema/table/column/constraint diagnostics 并非所有错误都同时提供；因此测试应记录实测字段，mapper 的必要稳定条件仍是 SQLSTATE `23505` + 精确 `constraint_name`。不要把 `column_name` 非空作为 unique mapper 前提。
- 当前数据库为零 `generation_jobs` 行，无法从现有数据证明同 key replay、异 payload conflict 或 active-humanization race；这些必须留在后续 implementation required validation 中，并同时证明失败请求不产生 job/version/review/task pointer/AuditLog/dispatch 副作用。
- 外部 references（PostgreSQL 16 protocol/source、psycopg API）只用于解释诊断字段；项目 schema/migration 的权威仍是仓库中的 Alembic、ORM 和 `contracts/database.md`，不能用外部资料替代 current-head catalog 实测。
