# Current-head Audit：GEO Observation Successor Integrity

- Date: 2026-09-16
- Mode: 只读源码/合同/测试审计；未运行数据库写入、迁移、测试或实现
- Objective: 为 T5-I5 冻结 successor precheck、partial unique index、并发/事务/HTTP 与前端边界

## Confirmed repository evidence

1. `GeoObservation` 没有 revision；`supersedes_id` 是自引用 FK。当前 create precheck 在已有 successor 时返回
   `REVISION_CONFLICT`，根 INSERT 在 relation add 前首次 flush，且没有 successor index 的本地 mapper。
2. `0007_geo_observation` 创建 `uq_geo_observations_supersedes_once`：表 `geo_observations`、列
   `supersedes_id`、unique、predicate `supersedes_id IS NOT NULL`。它是独立 partial unique index，不是 ORM 或
   `pg_constraint` UNIQUE owner。
3. production 正常路径先锁 Product、eligible PublishedArticle 集合和 previous GeoObservation。因此合规双请求
   应在行锁上串行，winner commit 后由 precheck裁决；不能把它描述成 unique race。
4. target operation 已在 OpenAPI/router 声明 409，ErrorEnvelope 固定四字段，code 为开放 string；request-ID
   middleware回显合法入站 ID。code-only 变化不需要 OpenAPI/runtime/generated修改。
5. correction page 当前只把 `GEO_PUBLICATIONS_CHANGED` 与 `REVISION_CONFLICT` 视为 stale。T5-I5 不改前端；
   T6 才增加 successor code并实现保留草稿/evidence、显式 reload/no replay。server变更必须受 release-atomic gate约束。

## Runtime evidence not executed in planning

本轮明确禁止数据库修改，因此没有建立临时库、升级 migration、写入 duplicate row或运行并发测试。以下仍是实施
preflight的硬门禁，不能由 migration源码替代：

- PostgreSQL 16 / Alembic head 的 `pg_index` 实际属性、key/predicate和无 `pg_constraint` row；
- psycopg 当前驱动的真实 `23505 + diag.constraint_name`；
- 合规 lock wait 与 test-only真实 target INSERT wait的 backend PID/blocker证据；
- known/unknown rollback后同 Session reuse与HTTP no-leak。

任一证据不符都触发停止，不修改 production/schema 以适配规划。

## Migration evolution caveat

- `0008` 增加 verified-file guard 与 attachment append-only trigger。
- `0022` 的 kind CHECK 继续约束新人工 observation 必须有真实 Topic；successor race fixture不得复用现有历史空
  Topic测试中临时删除该 constraint的方法。
- `0029` 曾为 GEO四张表增加 transaction-variable DELETE guard。
- `0034` 替换 article-result guard并迁移到 PublishedArticle identity。
- `0037` 调整 Article FK，并把 GEO四张表 append-only trigger改为 `BEFORE UPDATE`；因此 `0029` 的 DELETE
  trigger行为不是 current-head事实。
- `0038` 在显式 Article delete语境补充 GEO下游引用 guard。

本 Task只改 correction INSERT错误语义；删除生命周期或稳定 spec中的历史漂移不在范围内。

## Planned verification split

| Evidence | Expected observation | Must not be claimed as |
|---|---|---|
| compliant two-session path | loser waits production row lock; after winner commit hits precheck | target 23505/unique wait |
| test-only bypass race | loser waits real `INSERT INTO geo_observations`; exact 23505 diagnostics | production normal control flow |
| known direct-service | mapper root rollback; same Session immediately reusable | caller/test cleanup |
| unknown direct-service | original error; caller rollback then same Session reusable | stable domain error |
| known HTTP | exact four-field envelope + empty details + request-ID parity | new OpenAPI schema |
| unknown HTTP | 500 with no DB detail leakage | stable default 500 body |

## Scope conclusion

最小 production change只需要：command-local exact classifier、precheck code替换、root observation首次 flush 的
narrow catch/root rollback。relation flush/commit、其他 11 个 producer、deletion、OpenAPI/runtime/generated 与
frontend production必须保持不变。
