# Frontend V2 Phase 9 Production Snapshot Sanitization 实施计划

## 当前状态

子 Task 已启动，Phase 0 与 Phase 1 本地 sanitizer artifact 已完成并通过 required
validation。当前 Task 保持 `in_progress`、Gate=`NOT_MET`：尚未读取 production，未创建外部
quarantine/verify 环境，未执行真实 snapshot sanitize、dump、restore 或 cleanup。后续 Phase
2–5 继续以精确目标和单独授权为前提。

## Phase 0：启动与基线

1. 用户明确批准最新父/子规划后，只启动本子 Task；父 Task继续 planning。
2. 从 clean main 固定 schema/candidate 基线，确认 head=0043_geo_platform_identity。
3. 读取本 Task prd/design/implement、backend database/AI specs、infra isolation/object specs 与 parent research/audit。
4. 在实现前更新 task metadata/related files，真实 source/target identity 只写脱敏 label。

## Phase 1：本地 sanitizer artifact

1. 生成 0043 schema signature 与完整 sanitization-matrix.md。
2. 新增单一 research/sanitize_snapshot.py，固定 self-check、sanitize、verify 三个命令；不增加 dependency 或产品入口。
3. self-check 在 disposable PostgreSQL database 注入 marker，验证：
   - marker/credential/session 清零；
   - UUID/FK、row count、enum/status/revision/timestamp 保留；
   - user/file/URL/JSON/text 转换符合 matrix；
   - 未知表/列、错误 revision 与约束失败都 rollback/fail closed。
4. 输出不含 DSN、password、credential、原始值或正文。

### 本地 Required Validation

    backend/.venv/bin/python -m py_compile .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py
    backend/.venv/bin/python .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py self-check
    git diff --check
    python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-snapshot-sanitization

如 self-check 需要 PostgreSQL，由现有 integration test database owner 提供一次性 database；不用 SQLite 代替约束/JSONB/事务语义。

## Phase 2：production 只读 inventory/export 授权

单独取得 source label、export window 与 production 只读授权后：

1. 验证 role/session grants、default_transaction_read_only、revision、pg_dump compatibility 和 audit query；
2. 记录 source aggregate profile，不输出业务值；
3. 以 umask 077 向受控加密路径生成 raw SQL.gz；
4. 校验 file mode、size、SHA-256 和 audit window；
5. 立即撤销或过期 export credential。

建议命令形态，实际 URL 只从仓库外环境注入：

    umask 077
    PGOPTIONS='-c default_transaction_read_only=on' \
      pg_dump --clean --if-exists --no-owner --no-acl "$PRODUCTION_READ_ONLY_DATABASE_URL" \
      | gzip -9 > "$RAW_SNAPSHOT_PATH"
    sha256sum "$RAW_SNAPSHOT_PATH"

任何写权限、未知 revision、审计缺口、raw path 非加密或命令输出泄密即停止。

## Phase 3：quarantine 创建与 restore 授权

单独批准精确主机/database/path 后：

1. 只读确认专用主机、无公网入口/egress、磁盘加密、容量和 owner；
2. 创建 quarantine_<run-id> database/role，不创建应用服务；
3. 校验 raw checksum 后设置 VERIFY_DATABASE_URL，运行 deploy/scripts/restore-verify.sh；
4. 重新确认 revision/signature 与 source aggregate profile；
5. 保存 pre-sanitize counts/booleans。

## Phase 4：sanitize 与 fresh verify 授权

1. 使用 QUARANTINE_DATABASE_URL 运行 sanitizer；事务完成后运行 verifier。
2. 生成 sanitized SQL.gz，记录 size/SHA-256。
3. 创建 verify_<run-id> database/role，恢复 sanitized dump。
4. 使用 VERIFY_DATABASE_URL 运行独立 verifier 与 aggregate profile。
5. 比较 quarantine sanitized state、fresh verify 与 source profile：row counts/relations/status/time/length buckets 只允许 matrix 登记的变化。
6. 生成 sanitized manifest；production object payload copied=0。

建议命令形态：

    QUARANTINE_DATABASE_URL=$QUARANTINE_DATABASE_URL \
      backend/.venv/bin/python research/sanitize_snapshot.py sanitize
    QUARANTINE_DATABASE_URL=$QUARANTINE_DATABASE_URL \
      backend/.venv/bin/python research/sanitize_snapshot.py verify
    pg_dump --clean --if-exists --no-owner --no-acl "$QUARANTINE_DATABASE_URL" \
      | gzip -9 > "$SANITIZED_SNAPSHOT_PATH"
    VERIFY_DATABASE_URL=$VERIFY_DATABASE_URL \
      deploy/scripts/restore-verify.sh "$SANITIZED_SNAPSHOT_PATH"
    VERIFY_DATABASE_URL=$VERIFY_DATABASE_URL \
      backend/.venv/bin/python research/sanitize_snapshot.py verify

实际执行时使用 task 目录绝对路径，不依赖当前 shell 目录。

## Phase 5：Gate 与 cleanup 授权

1. 汇总 source read-only、raw/quarantine identity、matrix/script checksum、self-check、sanitized/verify、data profile 和 object copied=0。
2. open P0/P1/P2 必须为 0/0/0。
3. 取得精确删除授权后，删除 raw dump、quarantine DB/role、verify DB/role、临时 secret/raw namespace；逐项复核不存在。
4. sanitized dump 按 manifest 保留给父 Task，权限只授予父 Task owner。
5. 全部满足才判定 Gate=MET；否则 NOT_MET，父 Task不得启动。

## 预计修改

- 本子 Task prd.md、design.md、implement.md、task metadata 和 manifests；
- research/sanitization-matrix.md；
- research/sanitize_snapshot.py；
- research/evidence.md。

默认不修改 backend、deploy、contracts、database docs、migration 或 specs。若 current schema 不能由 task-scoped script安全处理，停止并重新规划，不把 sanitizer 提升为通用产品能力。

## Commit 与停止点

- 子 Task 形成一个独立 sanitizer/evidence 提交，提交前展示 exact commit plan 并等待批准。
- 不自动 push/merge/archive；父 Task只有在该提交合入 clean main 且 Gate=MET 后才进入 start。
