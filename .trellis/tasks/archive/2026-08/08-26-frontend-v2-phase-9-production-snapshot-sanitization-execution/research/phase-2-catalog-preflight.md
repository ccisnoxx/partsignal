# Phase 2 catalog-only database preflight 证据

## 授权与执行边界

| 项目 | 结果 |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| audit owner | `777` |
| 授权窗口 | `2026-08-26 14:43:51–14:58:51 CST` |
| 完成时间 | `2026-08-26 14:45:23 CST` |
| application name | `pss_20260826_01_catalog_preflight` |
| session | 单次 `docker exec` / `psql` session |
| transaction | `REPEATABLE READ READ ONLY`，结尾 `ROLLBACK` |
| timeout | statement=`10000ms`；lock=`1000ms`；idle in transaction=`30000ms` |
| production inventory/profile/export authorized | `false` |

`PGOPTIONS` 强制 `default_transaction_read_only=on`。本次只读取 PostgreSQL catalog 与
`alembic_version.version_num` machine revision；未读取业务表行、secret、DSN、password、对象或业务正文。
未创建或修改 role、ACL、logging、path、file、artifact 或其他资源，未执行 export。

## 脱敏观察

### Identity 与只读事务

| 检查 | 结果 |
| --- | --- |
| database identity | PASS |
| bootstrap identity | PASS |
| `default_transaction_read_only` | `true` |
| `transaction_read_only` | `true` |
| `REPEATABLE READ` | `true` |
| server version number | `160014` |
| revision row count | `1` |
| revision | `0043_geo_platform_identity`，PASS |
| completion transaction read-only | `true` |
| transaction ID assigned | `false` |

### Bootstrap role 与 ownership

bootstrap role 仅作为本次获批准的强制只读审计例外；以下能力证明它不能被复用为 export role。

| 检查 | 结果 |
| --- | --- |
| superuser | `true` |
| inherit | `true` |
| create role | `true` |
| create database | `true` |
| login | `true` |
| replication | `true` |
| bypass RLS | `true` |
| membership count | `0` |
| candidate export role exists | `false` |
| owned databases | `4` |
| owned schemas | `5` |
| owned relations | `107` |
| owned functions | `29` |

### Effective PUBLIC、schema 与 logging

| 检查 | 结果 |
| --- | --- |
| database `PUBLIC CONNECT` | `true` |
| database `PUBLIC TEMP` | `true` |
| public schema `USAGE` | `true` |
| public schema `CREATE` | `false` |
| user-defined function count | `29` |
| RLS-enabled table count | `0` |
| `log_statement` known | `true` |
| all statements logged | `false` |
| `log_min_duration_statement` logs all | `false` |
| destination includes stderr | `true` |
| destination includes CSV | `false` |
| logging collector | `false` |
| log prefix includes user | `false` |
| log prefix includes database | `false` |
| log prefix includes application | `false` |

## 判定与停止结果

- revision、server、强制只读 session、只读事务与未分配 transaction ID：`PASS`。
- strict export gate：`BLOCKED`。`PUBLIC TEMP` 有效，candidate export role 不存在，且 statement audit 不能同时
  覆盖 role、database、application 与全部语句。
- bootstrap role 是已批准的 catalog-only 例外，不是 export role；其高权限不是本次发生的权限漂移。
- 按既定设计停止；没有全局 `REVOKE`，没有创建 role，没有修改 logging/ACL，没有执行 inventory/profile/export。
- GPG recipient/key custody 与 raw artifact 加密有效性仍未验证。
- source profile：未生成；raw snapshot：未生成；production object payload copied=`0`。
- cleanup target count：`0`；本次未创建 role、secret、path、file、database 或 artifact。
- Phase 2 status：`CATALOG_PREFLIGHT_BLOCKED_PUBLIC_TEMP_AND_AUDIT`。
- Production Snapshot Sanitization Gate：`NOT_MET`。
