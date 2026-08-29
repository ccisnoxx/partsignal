# 0043 Production Snapshot 聚合 Profile 执行合同

## 边界与 artifact

- 可执行 owner：`research/profile_snapshot.py`，SHA-256
  `295a4fe72b549fc29fb8a4c310baca50e3002aeb32423c8ab129060a7a33d17b`；只服务本 Task，不是通用 profiler。
- source 输出 wrapper：`research/profile_wrapper.py`，SHA-256
  `d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`。它只使用 Python 标准库，
  在 process memory 捕获 profiler stdout/exit code，拒绝重复 JSON key，并冻结 exact 顶层
  identity/readonly/artifact/profile shape；全部逐字段 boolean PASS 后才以 `0600` partial 原子改名。失败只输出异常类型，
  不展开 producer stdout/stderr、路径或 profile 内容。
- 执行前固定核对归档 sanitizer SHA-256
  `124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d`、matrix SHA-256
  `71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6`、revision
  `0043_geo_platform_identity` 与 schema signature
  `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a`。
- 脚本复用归档 sanitizer 的精确 schema validator 和字段 matrix；不复制或修改归档 artifact。
- 所有成功输出均为单行 JSON；失败只输出 `command/status/error_type`，不输出 DSN、database、snapshot
  identity、SQL 值、正文、URL、credential、PII hash 或对象 key。
- profiler 不访问 object storage，固定输出 `object_payload_copied=0`；该字段只证明本 executable
  的访问边界，最终 Gate 仍需审计与外部执行证据。

当前 Gate=`NOT_MET`。本文与静态 self-check 不构成 production 访问、resource 创建、sanitize、fresh
verify 或 cleanup 授权。

source one-shot container 内唯一允许的 wrapper 调用形状为：

wrapper stdin 只允许一个不超过 4096 bytes、无重复 key/额外字段的 JSON document：

```json
{"database":"partsignal","role":"pss_export_20260828_08","run_id":"pss_20260828_08","snapshot_id":"<coordinator exported snapshot identity>"}
```

wrapper 校验 run/database/role/snapshot shape 后，在 process memory 构造 no-password loopback DSN，并给 producer
显式设置且只设置批准的 `PROFILE_RUN_ID`、`SOURCE_EXPECTED_DATABASE`、`SOURCE_SNAPSHOT_ID`、
`SOURCE_DATABASE_URL`、`PGAPPNAME=pss_20260828_08_profile`、固定 readonly/timeout `PGOPTIONS`、
`PGPASSFILE=/dev/null` 与 `PATH`。这些数据库参数不得进入 Docker config、argv、临时文件、日志或 evidence。

```text
python /app/.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py run \
  --expected-run-id pss_20260828_08 \
  --output /tmp/source-profile.json \
  -- python /app/.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py profile source
```

wrapper PASS 后，禁止使用 daemon 侧 `docker cp` 读取 `/tmp` tmpfs：该接口不能证明 mount namespace 内 artifact 可被 host handoff。
必须让同一 one-shot container存活到唯一一次 `wrapper.py handoff --expected-run-id <run-id> --input /tmp/source-profile.json`
完成，将已校验的 artifact字节流写入 host `source-profile.json.partial`。host必须使用noclobber、复核regular/non-symlink、
owner/mode=`root:root/0600`、非空与container/host SHA-256一致，再原子改名为 `source-profile.json`；唯一 host invocation
必须以 exact-target `trap` 清理 handoff、权限、非空、checksum、原子改名或容器生命周期断言失败留下的 partial，成功改名后
不得触碰 final；随后立即停止并 `--rm` exact container。任何 wrapper/checksum/stream/identity/container lifecycle失败均不得启动
`pg_dump`，并立即进入同窗口已预授权的exact failure rollback。

## 固定阶段

四个 profile 必须使用同一个仓库外 `PROFILE_RUN_ID`，并按以下顺序独立保存到批准的 evidence 路径：

| stage | URL 环境变量 | identity 门禁 |
| --- | --- | --- |
| `source` | `SOURCE_DATABASE_URL` | 实际 database 必须精确等于仓库外 `SOURCE_EXPECTED_DATABASE`；必须导入 `SOURCE_SNAPSHOT_ID` |
| `raw-quarantine` | `QUARANTINE_DATABASE_URL` | database 必须精确为 `quarantine_<PROFILE_RUN_ID>` |
| `sanitized-quarantine` | `QUARANTINE_DATABASE_URL` | 与 raw 使用同一 exact quarantine database，但在 sanitize 后使用新 connection |
| `fresh-verify` | `VERIFY_DATABASE_URL` | database 必须精确为 `verify_<PROFILE_RUN_ID>` |

`source` 连接必须由批准执行环境通过 `PGOPTIONS`/role policy 预先强制
`default_transaction_read_only=on`。脚本先验证该默认值，再启动 `REPEATABLE READ READ ONLY`
事务，并在任何 profile 查询前导入 `SOURCE_SNAPSHOT_ID`。该 snapshot 必须由仍保持打开的只读
coordinator transaction 导出，并同时交给批准版本的 `pg_dump --snapshot`；否则 source profile 与 raw
dump 不是同一 snapshot identity，Phase 2 立即停止。

quarantine/verify profile 也固定使用 `REPEATABLE READ READ ONLY`，但不能代替各阶段的 database/role、
restore、sanitizer、独立 verifier 和隔离证据。

## 查询与输出 shape

`production-snapshot-profile-v1` 固定输出：

- 0043 全部 31 张业务表的精确 `table_counts`；
- 0043 全部 74 个外键的 child/link/orphan、parent 和 fan-out min/max/p50/p95 聚合；
- 已登记 machine value 与 boolean 分布；发现 allowlist 外值立即失败，且不回显该值；
- 16 个 `revision/facts_revision` 分布；
- 54 个 date/timestamp 字段的 null count 与 UTC min/max；
- 归档 matrix 全部非 `preserve` 字段的 row null、string leaf/array element count 与
  `empty/xs/sm/md/lg` 长度桶；
- file category/content type/access/status 分布和 size bucket；只允许项目已登记 content type。

脚本在查询前调用归档 schema validator；未知表列、constraint/USER trigger 漂移、revision/signature、
artifact checksum、机器值或 JSON output shape 漂移均 fail closed。所有 SQL identifier 只来自当前文件的
固定 0043 清单或 checksum 已验证的归档 matrix。

## 比较规则

执行：

```text
backend/.venv/bin/python <task>/research/profile_snapshot.py compare \
  --expected-run-id pss_20260828_08 \
  <source-profile.json> <raw-quarantine-profile.json> \
  <sanitized-quarantine-profile.json> <fresh-verify-profile.json>
```

比较器要求：

1. source 与 raw quarantine 的完整 `profile` 完全相等；
2. sanitized quarantine 与 fresh verify 的完整 `profile` 完全相等；
3. source/raw 与 sanitized/fresh 之间，除以下 matrix 明示变化外全部相等：
   - `sessions` row/profile/关系清零；
   - `ai_channels.is_enabled=false`；
   - `ai_models.is_enabled=false`、`test_status=UNTESTED`、`last_tested_at=NULL`；
   - `clear/clear_json/credential/password/delete` 字段的长度桶允许变化；
4. 其他 row count、外键/fan-out、机器值、boolean、revision、timestamp、长度桶及 file size
   必须精确保持；
5. 四份文档必须具有同一 run ID、profile contract checksum、schema/artifact identity，且每份
   `object_payload_copied=0`。

比较 PASS 仍不自动将 Gate 更新为 `MET`；fresh restore verifier、source audit、artifact checksum、
manifest 和精确 cleanup 必须分别有真实证据。

## 离线静态检查

以下命令不连接数据库：

```text
backend/.venv/bin/python -m py_compile <task>/research/profile_snapshot.py
backend/.venv/bin/ruff check <task>/research/profile_snapshot.py
PYTHONPATH=backend backend/.venv/bin/mypy --config-file backend/pyproject.toml \
  <task>/research/profile_snapshot.py
backend/.venv/bin/python <task>/research/profile_snapshot.py self-check
backend/.venv/bin/python -m py_compile <task>/research/profile_wrapper.py
backend/.venv/bin/ruff check <task>/research/profile_wrapper.py
backend/.venv/bin/ruff format --check <task>/research/profile_wrapper.py
PYTHONPATH=backend backend/.venv/bin/mypy --config-file backend/pyproject.toml \
  <task>/research/profile_wrapper.py
backend/.venv/bin/python <task>/research/profile_wrapper.py self-check
```

`self-check` 核对 artifact checksum、当前 ORM metadata 的 table/FK/revision/time/boolean/matrix 字段清单、
固定 output shape，并以非零 sessions/AI/password 样例证明允许变化、以 row count 与伪名字段长度桶样例证明
禁止变化 fail closed；它固定报告 `database_connected=false`。

wrapper `self-check` 通过 local-only producer 证明固定 source context、显式 child env 与成功 shape 可原子写入
`0600` final，并以不含 tmpfs 内容的 daemon-visible view 复现旧 handoff 缺失，再证明 container-side `handoff` reader
使用单一打开的regular/non-symlink owner文件描述符、受大小上限约束并保持artifact字节；host partial的noclobber、mode、
SHA-256与atomic rename仍由same-window packet中的唯一host invocation拥有。同时证明 input/output 重复 key、额外字段及
producer非零都会fail closed且不留下partial。
它固定报告 `producer_started=true`、`producer_scope=local-only`、`legacy_mount_copy_missing=true`、
`artifact_handoff_stream=true`、`database_connected=false`。
