# Phase 2 catalog-only bootstrap 计划与结果

## 当前冻结身份

候选方案中的 catalog-only preflight 已按精确授权执行；raw/export 相关条目仍只是候选，不代表已创建或执行。

| 项目 | 候选值 |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| audit owner | `777` |
| run ID | `pss_20260826_01` |
| candidate export role | `pss_export_20260826_01` |
| server/client | source container `16.14`；host `15.18` 禁止用于 PostgreSQL 16 导出 |
| volatile secret directory | `/dev/shm/pss_20260826_01`，candidate mode=`0700` |
| secret files | `.pgpass` / encryption key file，candidate mode=`0600` |
| encrypted raw directory | `/root/partsignal-data/snapshot-quarantine/pss_20260826_01`，candidate mode=`0700` |
| encrypted raw artifact | `raw-partsignal.sql.gz.gpg`，candidate mode=`0600` |

production object directory 不访问。raw 候选数据流为 `pg_dump | gzip | gpg`，不落明文 raw dump。
`gpg 2.2.40` 已存在，但尚未冻结 recipient、key custody 或加密有效性证据；普通 ext4 也没有
dm-crypt/LUKS 证明，因此当前只形成候选，不能声称 encrypted quarantine 已满足。

## 已执行：privileged catalog-only preflight

用户批准在 `2026-08-26 14:43:51–14:58:51 CST` 内进行一次 database connection。实际于
`14:45:23 CST` 完成。它只使用现有 bootstrap role `partsignal`，只读取 PostgreSQL catalog 与
`alembic_version.version_num` 这一项 schema revision，并只输出安全 identity/boolean/count。该 role 的高权限
仅作为本次强制只读审计的已批准例外，不是 production inventory/export 授权。

本次 session 通过 `PGOPTIONS` 强制：

- `default_transaction_read_only=on`；
- 保守的 `statement_timeout`；
- 唯一 `application_name=pss_20260826_01_catalog_preflight`。

连接后还必须显式开启只读事务并断言 `default_transaction_read_only=on`、`transaction_read_only=on`；任一不符
立即断开。不得执行 `SET transaction_read_only=off`，也不得利用 bootstrap role 的 owner/superuser 能力。

只允许返回以下非敏感 identity、boolean 或 count：

- current database、server version 与 `alembic_version.version_num` revision；除该 machine revision 外不读取任何非 catalog 表；
- current role 的 superuser、inherit、create role、create database、replication、bypass RLS 等属性，以及
  membership count（不输出 role 名称）；
- current role 拥有的 database/schema/table/sequence/function object count；
- database `PUBLIC` 的 effective `CONNECT` / `TEMP` 与 schema `PUBLIC` 的 effective `CREATE`；
- user-defined function count、RLS-enabled table count；
- `log_statement`、`log_min_duration_statement`、`log_line_prefix`、`log_destination`、`logging_collector`：输出
  仅限 allowlisted setting 或“全部语句可覆盖”boolean；`log_line_prefix` 只输出是否包含
  role/database/application-name 标记的 boolean，不回显原始模板；
- candidate role `pss_export_20260826_01` 是否已存在。

禁止读取业务表行、样本、正文、URL、用户名、对象 key、credential、DSN 或 password；禁止输出 role membership
名称、函数正文或配置文件正文。任何非预期权限、revision、输出 shape 或敏感输出都立即停止。

## PostgreSQL 16 边界

- database 默认可能向 `PUBLIC` 授予 `CONNECT` 与 `TEMPORARY`；只给新 role `SELECT` 不能证明它没有
  effective `TEMP`。
- `pg_dump` 不能导出比自身 major version 更新的 server，因此 host `15.18` 不能用于 PostgreSQL 16；候选为
  source container 内匹配的 `16.14`。
- 创建 role 需要现有执行身份具有 `CREATEROLE` 或 superuser；catalog preflight 只核验能力，不使用该能力。
- `log_statement`、`log_min_duration_statement` 的设置需要 superuser 或相应 `SET` privilege；
  `application_name` 可由日志配置纳入审计记录，实际覆盖取决于已观察到的 logging 设置。

不假定以上默认或配置就是现网实际值；只以获授权 catalog preflight 的安全结果为证据。

## 实际判定

- revision=`0043_geo_platform_identity`、server=`16.14`、默认只读、事务只读、`REPEATABLE READ` 与未分配
  transaction ID 均通过。
- bootstrap role 是高权限 owner，不能作为 export role；candidate export role 不存在。
- database 的 `PUBLIC TEMP` 有效，且既定设计禁止在本 Task 内全局 `REVOKE`。
- statement logging 不能同时按 role、database、application 覆盖全部语句，无法形成要求的 export 审计证据。
- 结果为 `CATALOG_PREFLIGHT_BLOCKED_PUBLIC_TEMP_AND_AUDIT`；已停止，未创建 role、修改 logging/ACL 或导出。

完整脱敏观察值见 `phase-2-catalog-preflight.md`。

## 通过条件与停止条件

catalog preflight 只有同时证明以下条件，才允许请求下一轮 export 授权：

- 不需要修改全局 `PUBLIC` 权限；
- 授权运维方已在本 Task 外提供 `NOSUPERUSER`、`NOCREATEDB`、`NOCREATEROLE`、`NOINHERIT`、
  `NOREPLICATION`、`NOBYPASSRLS`，且无 membership、object ownership、`CREATE`、`TEMP`、DML/DDL 的独立 role；
- 该 role 只拥有 source database `CONNECT`、业务 schema `USAGE`、业务 table/sequence `SELECT`；sequence
  `USAGE/UPDATE` 均为 false；
- 已有审计能够覆盖唯一 `application_name`、role 与执行窗口；
- GPG recipient/key custody 与加密 artifact 验证方案足以证明 raw 文件只以密文落盘。

若 `PUBLIC TEMP` 有效且只能通过全局 `REVOKE` 解决，立即停止，不修改全局权限。若 audit coverage 或加密
方案不足，同样停止。source role 创建、授权、logging 修改、`VALID UNTIL`、disable 与 cleanup SQL 均属于
production 权限变更，必须由授权运维方在本 Task 外独立管理；本计划不提供或执行这些 SQL，也不猜 password。

## 授权状态

- source identity：已确认。
- catalog-only database preflight：已授权并完成，结果为阻塞。
- production inventory/profile/export：未授权、未执行。
- role/secret/path 创建：未授权、未执行。
- Gate：`NOT_MET`。
