# Frontend V2 Phase 9 Production Snapshot Sanitization Execution 实施计划

## 当前状态

本 Task 因 2026-08-29 的开发阶段范围决策终止，outcome=`CANCELLED_BY_SCOPE_DECISION`、Gate=`NOT_APPLICABLE`。该状态不表示原 Gate=`NOT_MET` 已通过；production snapshot、quarantine/fresh restore、临时 role、ACL/GUC、profile、加密导出和 cleanup 均不再继续。

latest completed attempt 仍为 `pss_20260828_08`：在 `docker exec`/database session 前 fail-closed，production write=`0`、object payload copied=`0`、retained artifact=`0`、cleanup=`NOT_REQUIRED_NO_TARGETS`。run09 只有本地 packet，未创建、未执行且不再创建；没有新的 production 访问或现有 evidence 所记录的残留远端 artifact/resource。

以下 Phase 0–6 仅作为历史执行计划保留，不得继续执行。未来 Production Release Readiness 必须重新创建 Task 与计划，不从本文恢复。

本地基线、planning、task start、host/catalog/prerequisite preflight 均已完成。历史 run `pss_20260827_01` 已完成 preflight/resources、no-xattrs artifact stream、prerequisite change、bootstrap-owner `PASSWORD NULL`、candidate grants/readonly validation、coordinator 与 source profiler database phase；task-local wrapper 在安全 JSON 二次处理时 fail-closed，`pg_dump` 未启动。exact rollback/cleanup PASS，original ACL/GUC 已恢复，role/session/container/secret/run path=`0`，production write/object payload=`0/0`，无 artifact 保留。

corrected profile wrapper、ACL query checksum与xattr-free stream invocation保持冻结。latest completed attempt run=`pss_20260828_08` 在host preflight PASS后，因唯一database preflight invocation的远端shell单引号未闭合而在`docker exec`/database session前fail-closed停止。未创建resource，未执行mutation/profile/`pg_dump`；run08/window不重试、不复用。用户现仅批准本地预留 run09、补证与修正 packet；新的 production window 尚未授权，quarantine/verify、sanitize/fresh verify仍未启动。

本地根因已确认：run07 把 daemon 侧 `docker cp` 用作读取 container `/tmp` tmpfs artifact 的 handoff，wrapper 的 `output_written=true` 只证明 container-side 原子写入，不能证明 daemon 可见路径存在。profile wrapper 新增 `handoff` 子命令，在 container 内校验并将 exact artifact 字节流交给 host；禁止再次使用 `docker cp` 读取该 tmpfs。根因证据与本地复现见 `research/phase-3-local-profile-artifact-root-cause.md`；wrapper 新 checksum=`d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`。

## Phase 0：本地只读基线（已完成）

1. 确认 primary working directory 位于 clean `main`，从当前 `af161997` 创建唯一授权临时分支；未 pull/push。
2. 创建 follow-up Task 并关联父任务，父任务保持 `planning`。
3. 完整读取指定归档 Task、父 Task、Trellis workflow/spec、数据库合同与 restore 脚本。
4. 核验 sanitizer commit ancestry、script/matrix checksum、0043 head/signature 常量与归档 self-check evidence。
5. 确认当前本机缺少 `pg_dump`/`psql`；不猜执行 host 或安装新依赖。

## Phase 1：规划复核与任务启动

1. 用户审阅 `prd.md`、`design.md`、`implement.md` 与本地 evidence。
2. 配置 `implement.jsonl` / `check.jsonl`，运行 Trellis planning validation。
3. 仅在用户对最新规划明确批准后运行：

       python3 ./.trellis/scripts/task.py start frontend-v2-phase-9-production-snapshot-sanitization-execution

4. 启动后先完成任务内 profile 查询清单与安全输出静态复核；不连接任何数据库。

停止点：task start 和本地文档/查询清单批准不等于 production 访问授权。

## Phase 2：Production inventory/export 授权

Host-only preflight 已在 `2026-08-26 14:11:46–14:41:46 CST` 的批准窗口内完成，audit owner=`777`；
脱敏结果见 `research/phase-2-host-preflight.md`。用户已将 exact source 冻结为
`hostdzire/partsignal-staging/postgres:partsignal`，audit owner=`777`；Compose 的 staging 名称保持真实值。
获授权的 catalog-only 预检已在 `2026-08-26 14:43:51–14:58:51 CST` 窗口内于 `14:45:23 CST`
完成，脱敏结果见 `research/phase-2-catalog-preflight.md`。它只使用 bootstrap role 执行单次强制只读
catalog/revision 审计，没有读取业务行或创建资源。实际 revision=`0043_geo_platform_identity`、server=`16.14`
和 session read-only 断言通过；但 bootstrap role 是高权限 owner，不能作为 export role，`PUBLIC TEMP` 有效，
candidate export role 不存在，statement logging 也不能按 role/database/application 覆盖全部语句。

因此当时 Phase 2 状态为 `SOURCE_EXPORT_COORDINATION_DRAFT`，
`production_access_authorized=false`，未生成 source profile 或 raw snapshot。后续一次获授权的同窗口尝试仍在 mutation/export 前停止。禁止通过 bootstrap role、全局
`REVOKE`、自行创建 role 或修改 logging 绕过停止条件。

同窗口唯一执行 owner 见 `research/phase-2-same-window-execution-packet.md`；旧协调草案仅保留决策历史，不再作为执行 source of truth。

执行前向用户报告并冻结：

- exact source label（已确认）；
- database revision=`0043_geo_platform_identity` 的外部证明；
- read-only role identity fingerprint 与 effective grants；
- export window；
- audit owner（`777` 已确认）与可覆盖语句范围；
- execution host（`hostdzire` 已确认）、PostgreSQL server/client version；
- raw encrypted path identity、owner、容量、mode policy；
- unique run ID。

已按精确授权执行以下前置审计并停止：

1. 使用现有 bootstrap role，在 `default_transaction_read_only=on` 和显式只读事务内核验 revision、server version、role attributes/membership/object ownership、`PUBLIC` 权限与 PostgreSQL statement logging 覆盖；不读取业务行。
2. 只保存批准的 identity、boolean 与 count；没有创建 role、secret、path 或 artifact。
3. 已观察到固定 candidate export role 不存在，且未取得其他合规 read-only role 证据；同时 `PUBLIC TEMP` 有效，按设计立即停止。source role 创建、授权、全局权限与 logging 调整属于 production 权限修改，必须由授权运维方在本 Task 外独立完成。

绝对窗口开始且本地时间/Task/checksum/preflight 复核通过后，才执行：

1. 核验 export role 无 membership/ownership，且仅有 database `CONNECT`、schema `USAGE`、业务 table/sequence `SELECT`；确认无 `CREATE`、`TEMP`、sequence `USAGE/UPDATE`、DML/DDL，并强制 `default_transaction_read_only=on`。
2. 以 `REPEATABLE READ READ ONLY` coordinator 固定 snapshot identity，让 source aggregate profile 与 `pg_dump` 绑定同一 snapshot；实际 snapshot 选项以批准 host 的本地 `pg_dump --help`/server 版本为准。
3. 通过另行批准、共享 source container network namespace 的 `--rm` one-shot Python client 运行显式聚合查询，只输出批准的 counts/booleans/机器值/timestamps/length buckets；不启动任何应用服务。
4. 以 `umask 077` 将 `pg_dump | gzip` 直接流入批准的 GPG 对称加密 artifact；一次性加密 secret 仅驻留 exact tmpfs path，不产生明文 raw file。所有 source session 强制 `default_transaction_read_only=on`。
5. 检查 raw mode=`0600`、size、SHA-256、snapshot identity 与 audit window；同窗口执行预授权 source-side success cleanup，精确撤销 export role/ACL/GUC/container/partial。
6. 记录 production object storage 未访问，payload copied=`0`；只按 retention plan 保留 encrypted raw final、source-profile final 与 tmpfs passphrase/GPG homedir。

Required validation：source grants/session/snapshot/audit 全部 PASS；raw mode/size/checksum PASS；输出泄密检查 PASS。任一失败不进入 Phase 3。

## Phase 3：Quarantine 创建与 raw restore 授权

先报告 exact host/run ID/database/role/path/owner、磁盘加密、私有访问、无公网监听、egress deny、无共享 owner，并取得创建授权。

1. 创建精确 `quarantine_<run-id>` database/role；不创建应用、Redis、object namespace 或其他服务。
2. 重新校验 raw SHA-256 后，通过显式 target 恢复；`deploy/scripts/restore-verify.sh` 只对该 quarantine DSN 运行一次。
3. 核对 revision、schema signature、constraints/triggers 与 source snapshot profile。
4. 保存 pre-sanitize profile；raw quarantine profile 必须与 source snapshot profile 一致。
5. 仅在 raw restore、restore-verify 与 raw/source profile 全部 PASS 后，按本阶段另行批准的 exact target 删除 tmpfs passphrase/GPG homedir并复核不存在；在此之前不得删除或复制 secret。

Required validation：restore-verify PASS；revision/signature PASS；raw/source profile PASS；isolation PASS。任一失败保留现场并停止，不自动 cleanup。

## Phase 4：Sanitize 与 fresh verify 授权

在用户确认 exact quarantine/verify/sanitized targets 后：

1. 执行归档 artifact：

       QUARANTINE_DATABASE_URL=<仓库外注入> \
         backend/.venv/bin/python \
         .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py sanitize

2. 使用新的独立 connection 运行同一脚本 `verify`，保存安全 JSON 结果。
3. 生成 `0600` sanitized SQL.gz，记录批准 path、size、SHA-256。
4. 创建精确 `verify_<run-id>` database/role；恢复 sanitized dump并运行：

       VERIFY_DATABASE_URL=<仓库外注入> \
         deploy/scripts/restore-verify.sh <sanitized-snapshot-path>
       VERIFY_DATABASE_URL=<仓库外注入> \
         backend/.venv/bin/python \
         .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py verify

5. 在 sanitized quarantine 与 fresh verify 独立运行 aggregate profile；两者必须完全相等，并按 design.md 第 6 节与 source/raw profile 比较。
6. 生成 manifest 候选，Gate 仍为 `NOT_MET`，直到 cleanup 完成。

Required validation：sanitize PASS；quarantine verify PASS；sanitized checksum PASS；fresh restore-verify PASS；fresh verifier PASS；profile comparison PASS；payload copied=`0`；输出泄密检查 PASS。

## Phase 5：精确 cleanup 授权

先向用户列出每个 exact target：run ID、host、database、role、raw path、checksum、secret identity 与 owner；sanitized artifact 明确排除。

取得授权后按反向依赖执行：

1. 撤销并删除临时 secret；复核不存在。
2. 删除 fresh verify database，再删除 verify role；复核不存在。
3. 删除 quarantine database，再删除 quarantine role；复核不存在。
4. 删除 exact raw dump；复核 path 不存在。
5. 再次证明无 production object namespace/payload 被创建或复制。

禁止 broad path、glob、共享资源删除、自动 fallback 或未验证 owner 的删除。任一失败保持 Gate=`NOT_MET`。

## Phase 6：Gate、自审与父任务 handoff

1. 汇总 source read-only、raw/quarantine、sanitizer/matrix、fresh restore、profile、manifest、object copied=`0` 与 cleanup 证据。
2. 检查 open P0/P1/P2=`0/0/0`，并确认 required validation 均有实际结果。
3. 运行完整 task consistency/self-review；归档历史不变，产品/contract/deploy/spec 不需要更新时记录原因。
4. 全部条件满足才把 Task metadata、evidence 和 manifest 更新为 Gate=`MET`。
5. 更新父任务的 sanitizer dependency 指向本 follow-up Task 最终 manifest/checksum，并仅报告父任务“具备启动条件”；不启动父任务。
6. 展示 exact commit plan 并等待确认；不自动 commit/push/merge/archive/delete branch。

## Required validation

当前已授权离线阶段：

    sha256sum \
      .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py \
      .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitization-matrix.md
    backend/.venv/bin/alembic -c backend/alembic.ini heads
    python3 -c 'import ast, pathlib; ast.parse(pathlib.Path(".trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py").read_text())'
    backend/.venv/bin/python -m py_compile .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py
    backend/.venv/bin/ruff check .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py
    backend/.venv/bin/ruff format --check .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py
    PYTHONPATH=backend backend/.venv/bin/mypy --config-file backend/pyproject.toml .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py
    backend/.venv/bin/python .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py self-check
    backend/.venv/bin/python -m py_compile .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py
    backend/.venv/bin/ruff check .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py
    backend/.venv/bin/ruff format --check .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py
    PYTHONPATH=backend backend/.venv/bin/mypy --config-file backend/pyproject.toml .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py
    backend/.venv/bin/python .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py self-check
    bash -n .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh
    .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh self-check
    test "$(shasum -a 256 .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/acl_fingerprint_v1.sql | awk '{print $1}')" = 829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae
    test "$(shasum -a 256 .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh | awk '{print $1}')" = 4b40289f0677ef568bd47005100980be0a75dd980d8335823b777909046773f5
    python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-production-snapshot-sanitization-execution
    git diff --check

外部 required validation 由 Phase 2–5 的实际命令和非敏感结果组成；不能用历史 self-check 或计划文本代替。

## Optional validation

不运行 backend/frontend full suites、build、E2E、Compose 或浏览器。Task 不修改产品代码、共享合同或运行时，也明确禁止 Production-like Rehearsal；这些检查不能直接证明本 Task 的数据安全结果。

## 预计修改

- 当前 follow-up Task 的 `task.json`、`prd.md`、`design.md`、`implement.md`、manifests 与 `research/` evidence/manifest/profile query contract；
- 父任务 `task.json` 的 child link，以及 Gate=`MET` 后最小 handoff 引用。

不修改 archived sanitizer Task、backend、frontend、frontend-v2、deploy、contracts、migration 或 `.trellis/spec/`。若实际 schema 或工具不能满足已验收 sanitizer 合同，停止并回到规划，不新增兼容 sanitizer。
