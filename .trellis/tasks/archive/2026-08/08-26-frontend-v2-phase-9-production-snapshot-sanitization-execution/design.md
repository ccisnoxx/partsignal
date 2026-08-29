# Frontend V2 Phase 9 Production Snapshot Sanitization Execution 设计

## 0. Development Closeout

本设计因 2026-08-29 的开发阶段范围决策停止实施，outcome=`CANCELLED_BY_SCOPE_DECISION`、Gate=`NOT_APPLICABLE`。下文仅保留历史合同，不构成继续 production snapshot、quarantine/fresh restore、ACL/GUC、导出或 cleanup 的授权。

## 1. 设计结论

本 Task 不重新设计 sanitizer。归档 `sanitize_snapshot.py` 与 `sanitization-matrix.md` 是不可变执行 owner；新 Task 只拥有分阶段授权、外部执行身份、只读聚合 profile、sanitized manifest、cleanup 证据和父任务 handoff。

最小数据流：

    production PostgreSQL
      -- approved read-only snapshot + pg_dump -->
    encrypted 0600 raw SQL.gz
      -- restore -->
    quarantine_<run-id>
      -- archived sanitizer transaction + verifier -->
    sanitized quarantine state
      -- pg_dump -->
    0600 sanitized SQL.gz
      -- restore -->
    verify_<run-id>
      -- restore-verify + archived verifier + aggregate profile -->
    sanitized manifest + parent handoff

production object storage 不在数据流中。

## 2. 不可变 owner 与仓库边界

| Owner | 精确合同 |
| --- | --- |
| archived sanitizer | commit `217d011c`，SHA-256 `124c2182...f889fd1d` |
| archived matrix | SHA-256 `71c86e68...dc4d638a6` |
| schema | revision `0043_geo_platform_identity`，signature `90070a89...193a4a` |
| source | `hostdzire/partsignal-staging/postgres:partsignal`；Compose 名称按现状保留；仅批准的只读 snapshot/session，不接收 sanitize 参数 |
| quarantine | `QUARANTINE_DATABASE_URL`，名称必须匹配归档脚本 allowlist |
| fresh verify | `VERIFY_DATABASE_URL`，名称必须匹配归档脚本 allowlist |
| execution evidence | 当前 follow-up Task 的 `research/`，只存脱敏身份、聚合、布尔与 checksum |
| sanitized artifact | 仓库外受控路径，由 manifest owner 持有并交付父任务 |

不修改归档 Task、backend、migration、contracts、deploy 脚本或产品配置。父任务只在 Gate=`MET` 后获得 sanitized artifact 合同。

## 3. 授权状态机

每个阶段单独停止和请求授权：

1. `LOCAL_READY`：只读核验仓库、artifact、版本与历史证据；当前已完成。
2. `SOURCE_IDENTIFIED`：用户已确认 exact source 为 `hostdzire/partsignal-staging/postgres:partsignal`；此状态已完成。
3. `SOURCE_EXPORT_REVIEW_READY`：profile、host、ACL query 合同已完成本地验证；完整 setup/profile/encrypted dump/rollback/cleanup executor artifact 尚未冻结，因此不得进入 production execution。
4. `SOURCE_EXPORT_AUTHORIZED`：run=`pss_20260828_03` 曾取得 `2026-08-28 12:00:00–12:30:00 CST` exact 授权，但在 host preflight 的 raw ancestor identity 断言失败后已失效；未进入 mutation/export。
5. `QUARANTINE_AUTHORIZED`：冻结 exact host/run ID/database/role/path/owner/isolation 后，才可创建与恢复 quarantine。
6. `SANITIZE_VERIFY_AUTHORIZED`：核对 raw identity/profile 后，才可执行 sanitize、sanitized dump、fresh verify 与 manifest 候选。
7. `CLEANUP_AUTHORIZED`：逐项核对 exact targets 后，才可删除 raw/quarantine/verify/secret。
8. `MET`：cleanup 复核、manifest、P0/P1/P2 和父任务 handoff 均满足后才进入。

任何阶段失败都停止且不自动进入下一阶段。Phase 2 只执行同窗口已预授权的 exact source rollback/containment；quarantine、raw、sanitize、fresh verify 与 retention cleanup 仍需各阶段单独授权，不得借 source rollback 扩大删除范围。

## 4. Production snapshot 一致性

- source inventory、aggregate profile 和 `pg_dump` 必须绑定同一 PostgreSQL read-only snapshot identity；不能把不同时点的在线查询与 dump 比较后声称数据漂移或保持。
- 执行时优先使用 PostgreSQL 原生 exported snapshot/imported snapshot 能力，由一个只读 coordinator transaction 持有 snapshot，profile 与 `pg_dump` 使用同一 snapshot；实际命令必须先在批准 host 上按已安装 server/client 版本核验。
- 所有 source session 同时以 role/grant 和 `default_transaction_read_only=on` 双重约束。若 role 存在有效写权限、可继承/切换到写角色、TEMP/CREATE 或审计不可覆盖，立即停止。
- production 是在线系统；零写入结论只针对本 Task export role、window 和审计语句集合，不宣称全库在窗口内无业务变化。

## 5. 隔离与 artifact

- raw/quarantine/verify 可以位于同一批准的专用私有执行 host，但 database、role、path 与 secret 必须独立并带相同 run ID。
- 用户已接受 raw artifact 采用“artifact 强加密、一次性 secret 仅驻留 tmpfs”的边界；source host 普通 ext4 不得被描述为磁盘加密。client/path/secret/artifact 创建、quarantine/verify 私有访问、无公网监听、无 application egress 与无共享 owner 仍必须在各自创建前单独批准并验证。
- raw 与 sanitized file 均由 `umask 077` 创建并检查最终 mode=`0600`；raw path 只在批准的加密 quarantine boundary 内。
- secret 不写 shell history、argv、仓库或 evidence；命令输出不得展开连接字符串。日志仅保存安全状态与脱敏错误类型。
- source export 成功后，encrypted raw、source profile 与 tmpfs passphrase/GPG homedir只保留到获授权 raw quarantine restore。restore、restore-verify 与 raw/source profile 全部 PASS 后，按该阶段 exact cleanup 授权删除 passphrase/GPG homedir；不把 secret 延长到 sanitize/fresh verify。
- sanitizer 的 `sanitize` 事务负责变换原子性，随后 `verify` 以独立连接复核；fresh restore 再次从字节 artifact 建立独立验证边界。

## 6. 聚合 profile 合同

归档 verifier 已覆盖 schema、全部 matrix 字段、AI credential/header/password/session/triggers 以及精确 table counts，但没有输出全部验收所需的关系、状态、revision、时间与长度桶 profile。因此本 Task 在执行 evidence 中维护一组一次性、显式、只读 aggregate 查询；不修改 sanitizer，也不建立通用 profiler。

profile 只允许以下输出：

- 每张业务表精确 row count；
- matrix 登记关系的 orphan boolean 与 fan-out count/min/max/percentile；
- status、enum、classification、account type、revision 的 value/count，其中 value 仅限合同登记的机器值；
- `created_at`、`updated_at`、`tested_at`、`published_at` 等登记时间列的 null count 与 min/max UTC；
- matrix 中被替换 string/JSON/array 字段的 null count 和 `empty/xs/sm/md/lg` 长度桶计数；
- file metadata 的 category/content_type/status/size bucket 与 `object_payload_copied=0`。

禁止输出字符串 min/max、样本、正文、URL、用户名、request/provider identity、PII hash、credential、ciphertext 或对象 key。profile 查询清单在 production 访问前完成静态审阅；任何未登记列或输出 shape 使阶段停止。

比较规则：raw quarantine 必须等于 source snapshot profile；sanitized quarantine 与 fresh verify 必须完全相等；source/raw 与 sanitized 之间只允许 matrix 登记的 session 删除、AI enable/test 字段强制值、credential 清空/替换及敏感字段内容变化，长度桶与其余聚合保持。

## 7. Manifest 与 handoff

最终 manifest 使用 JSON，仓库内只保存脱敏且可审核的副本。至少包含：

- `gate`、`run_id`、执行日期与批准记录 label；
- source/quarantine/verify 的脱敏 identity fingerprint；
- revision、schema signature、server/client version；
- sanitizer commit/script/matrix checksum；
- raw identity/checksum/cleanup boolean，不包含 raw path；
- sanitized artifact 的批准消费 path、size、SHA-256、owner 与 retention；
- source read-only/audit、restore、sanitizer、quarantine verifier、fresh verifier 与 profile comparison 的布尔结果；
- `object_payload_copied: 0`、`open_findings: {P0: 0, P1: 0, P2: 0}`；
- cleanup exact-target result。

父任务读取 manifest 后必须自行重新计算 sanitized checksum；manifest 不传递任何 source/quarantine credential 或 raw artifact。

## 8. 失败、cleanup 与 rollback

- production business data 无写入，因此没有 business-data rollback；source ACL/GUC/resource rollback 由 sibling exact packet 唯一拥有。任何 source 异常立即断开并冻结非敏感审计证据。
- sanitize/verify/profile 失败时停止，不修 production 数据、不修改 matrix、不生成 Gate=`MET` manifest。
- cleanup 只在单独授权后按 exact run ID/owner/database/role/path/secret 执行；sanitized artifact 保留给父任务。
- 未获 cleanup 授权或 cleanup 复核失败时，撤销访问并按已批准边界隔离现场，Gate 保持 `NOT_MET`。

## 9. 已知阻塞

- exact source、change operator=`root`、audit/freeze owner=`777`、server version 与 revision 已确认；catalog-only preflight 证明 bootstrap role 仅能作为已批准的只读审计例外，不能作为 export role。
- 历史 run=`pss_20260828_01` 在 mutation 前因 ACL fingerprint query contract 未落盘而 fail-closed。历史公式已恢复并冻结为 SQL checksum=`829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae`，纯本地 self-check PASS；corrected profile/wrapper 合同保持不变。
- latest completed run=`pss_20260828_08` 已通过host preflight，随后在远端shell解析阶段、`docker exec`/database session前fail-closed停止。未创建resource，未执行mutation/profile/`pg_dump`，production write/object payload=`0/0`、retained artifact=`0`。run08/window不重试、不复用。run09 仅完成本地 pre-authorization packet 与 database preflight boundary 修正；新的 production window 尚未授权。
- run07 的单一 artifact handoff 根因已确认并修正：daemon 侧 `docker cp` 不能证明 container `/tmp` tmpfs 内容可被 host 读取；后续必须由同一 container 内 wrapper 的 `handoff --expected-run-id <run-id> --input /tmp/source-profile.json` 经 `docker exec` 流式输出到 host partial，再原子改名。唯一 host invocation 必须用 exact-target trap 清理失败残留的 partial，并在成功改名后立即停止/`--rm` exact container；wrapper 新 checksum=`d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`；离线复现与证据见本 Task `research/phase-3-local-profile-artifact-root-cause.md`。
- execution host 已确认为 `hostdzire`；container client `16.14` 仅为候选，host client `15.18` 禁止用于 PostgreSQL 16 导出。
- source role 创建、授权或全局 `PUBLIC` 权限调整属于 prerequisite Task 的独立 production 权限变更，不由本 Task 执行或越权替代。
- 当前本机没有 `pg_dump`/`psql`，不能被默认当作执行 host。
- 以上均不通过猜测或默认值解决。
