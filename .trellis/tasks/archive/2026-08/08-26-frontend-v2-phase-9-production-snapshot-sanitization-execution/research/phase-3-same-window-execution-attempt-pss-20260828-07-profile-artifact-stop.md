# run pss_20260828_07 source profile artifact stop evidence

## 1. 授权与执行边界

用户已明确批准 run=`pss_20260828_07`、candidate role=`pss_export_20260828_07`、absolute window=`2026-08-28 15:30:00–16:00:00 CST` 的完整 exact authorization packet。实际执行于 `2026-08-28 15:38:27 CST` 开始，处于批准窗口内；本轮未启动 quarantine、sanitize、fresh verify、Production-like Rehearsal、API、Worker、scheduler、frontend 或浏览器。

## 2. 已通过阶段

- 七项本地 artifact/contract checksum 与 current branch/task identity 均匹配冻结值。
- host preflight PASS：source/API image、PostgreSQL server/client=`16.14/16.14`、container restart=`0`、audit log、raw ancestor identity/capacity、exact target absence与 GPG capability均符合 packet，且该阶段 `database_connected=false`、`resource_mutation=false`。
- 唯一 database preflight 在 `REPEATABLE READ READ ONLY` transaction 中 PASS 并显式 `ROLLBACK`：revision=`0043_geo_platform_identity`、OID fingerprint、原始 database/schema ACL、`PUBLIC TEMP`、GUC、HBA first match、object/function count与 transaction ID unassigned均匹配。
- exact raw parent/run directory、tmpfs passphrase/GPG homedir与 one-shot profiler container按批准 identity创建；xattr-free 四项 allowlist stream与 container 内 checksum PASS。
- audit GUC、transient `PUBLIC TEMP` revoke、candidate role/ACL/role GUC transaction PASS。`PASSWORD NULL` 只由具备 catalog 可见性的 bootstrap owner session读取并通过；candidate export session未读取 password catalog字段。
- candidate permission/read-only validation PASS：database `CONNECT=true/TEMP=false`、schema `USAGE=true/CREATE=false`、table/sequence只读权限、零 membership/ownership、session/transaction readonly与 transaction ID unassigned均通过；安全 audit count role/application/statement/combined=`11/11/11/11`。
- coordinator 成功导出并保持同一只读 snapshot；只记录 snapshot identity SHA-256=`d3ac66f9f602b0d5cf8e1c49940e27e78be8d151c79014666556e37aea679a8c`，不记录 raw identity。
- source profile wrapper 返回 canonical `status=passed`、`output_written=true`，profile database phase为只读，object payload copied=`0`。

## 3. Fail-closed stop

`2026-08-28 15:44:42 CST`，从 one-shot container 复制批准路径 `/tmp/source-profile.json` 到 host partial 时，Docker 报告该 exact container path不存在。该结果与 wrapper 的 `output_written=true` 矛盾，因此判定 `STOP_PROFILE_ARTIFACT_ABSENT_AFTER_WRAPPER_PASS`，未重跑 wrapper、未改变路径或方案，`pg_dump_started=false`，completion token未生成，retained artifact=`0`。

## 4. Exact failure rollback 与 cleanup

coordinator 已显式 `ROLLBACK` 并退出；one-shot container按 exact name与冻结 image fingerprint核验后删除。权威 catalog state匹配 C 分支；rollback owner session以 `pg_authid` 执行 packet 明定的 `PASSWORD NULL` owner assertion后，原子完成 role `NOLOGIN`、exact grants revoke/drop与 `PUBLIC TEMP` 恢复，再执行 `ALTER SYSTEM RESET log_line_prefix` 与 reload。

rollback 操作期间出现三项 operator command问题，均如实保留：首次连接错误假设 owner=`postgres`，在建立 session前被拒绝；首次 C 分支只读 owner assertion误用会遮蔽 password字段的 `pg_roles`，在任何 mutation前回滚；最终验证误把 `PUBLIC` pseudo-role传给 `has_database_privilege`，该错误发生在 ACL/role transaction已提交且 GUC已 RESET/reload之后。随后只读 final catalog verification改用 packet冻结的 `acldefault + aclexplode + grantee=0` 语义，结果全部 PASS，不再执行 rollback mutation。

最终复核：candidate role/session=`0/0`；original database/schema ACL fingerprints=`712516b95217453c364a79a0b387880e` / `8ab2deb0f524284db7487aae83f297a0`；`PUBLIC TEMP=true`；`log_line_prefix='%m [%p] '`、source=`default`、pending restart=`false`、auto-conf entry absent；one-shot container、source profile/raw partial/final、passphrase/GPG homedir、secret directory、exact run directory与本 run创建的 raw parent均 absent；existing ancestor `/root/partsignal-data` preserved；production business write/object payload copied=`0/0`；`pg_dump_started=false`，retained artifact=`0`。

cleanup于 `2026-08-28 15:52:57 CST` 前完成；Task继续保持 `in_progress`，parent Gate=`NOT_MET`。
