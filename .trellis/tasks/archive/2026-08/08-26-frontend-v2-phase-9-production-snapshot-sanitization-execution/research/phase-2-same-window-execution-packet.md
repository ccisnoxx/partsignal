# Phase 2 same-window change/profile/export/cleanup historical packet（RUN08 AUTHORIZATION CONSUMED）

## 1. 当前授权状态

run=`pss_20260828_08` 已在批准窗口通过 host preflight，随后唯一 database preflight invocation 因远端 shell 单引号未闭合而在 `docker exec`/database session 前 fail-closed 停止。未创建 resource，未执行 mutation/profile/`pg_dump`，production write/object payload=`0/0`、retained artifact=`0`。该 run/window 不重试、不复用；补录证据见本 Task `research/phase-3-same-window-execution-attempt-pss-20260828-08-database-preflight-command-stop.md`。

run=`pss_20260828_07` 已获批准并于 `2026-08-28 15:38:27 CST` 进入窗口。host/database preflight、resource stream、prerequisite mutation、bootstrap-owner `PASSWORD NULL`、candidate readonly validation、coordinator snapshot与source profile database phase均PASS；wrapper返回 `output_written=true`，但批准的container final path不存在，因此于 `15:44:42 CST` fail-closed停止，`pg_dump`未启动。coordinator显式rollback，权威catalog C分支与exact resource cleanup均PASS；original ACL/GUC恢复，role/session/container/secret/run path=`0`，production write/object payload=`0/0`，retained artifact=`0`。该run/window已消费且不复用，完整证据见本 Task `research/phase-3-same-window-execution-attempt-pss-20260828-07-profile-artifact-stop.md`。

run=`pss_20260828_06` 已获批准并于 `2026-08-28 14:30:13 CST` 进入窗口。host-only preflight PASS且明确 `database_connected=false`、`resource_mutation=false`；进入database preflight前发现sibling exact change/failure rollback与本packet success cleanup仍残留run05 role literal，与run06 identity不一致，因此于 `14:31:07 CST` fail-closed停止。未创建resource/path/secret/container，未启动candidate/profile/`pg_dump`，无需远端cleanup。该run/window不重连、不重试、不复用。

用户已于 `2026-08-28 13:28:30 CST` 明确批准 run=`pss_20260828_05` 的 `2026-08-28 14:00:00–14:30:00 CST` exact packet。host/database preflight PASS并显式 `ROLLBACK`；resource stream因 `com.apple.provenance` xattr无法由 Docker落盘而在任何 database mutation/profile/`pg_dump` 前停止。exact resource cleanup PASS且无残留。该 run/window不重连、不重试、不复用。

run=`pss_20260828_04` 因 operator 自行增加、未包含在批准 packet 中的 executor-freeze gate 而在 absolute window 与任何 production access/SSH 前停止；该 gate 已更正且不延续，run04/window 不复用。run07已使用唯一 `COPYFILE_DISABLE=1 tar --no-xattrs` artifact stream并通过该阶段；其profile artifact persistence根因已在本地收敛，run07/window仍不得复用。

`2026-08-28 10:00:00–10:30:00 CST` 窗口授权已消费。heartbeat 于 `10:00:26 CST` 进入窗口；唯一合并 preflight 的 host 与 catalog 语义检查均 PASS并显式 `ROLLBACK`，但现场 SQL 未复用冻结 ACL fingerprint 的权威序列化表达式，exact fingerprint assertion 无法成立，因此在任何 resource creation/mutation/profile/`pg_dump` 前 fail-closed。结果=`STOP_PRE_MUTATION_ACL_FINGERPRINT_FORMULA_NOT_REUSED`，本窗口不重试。

ACL 查询合同=`acl-fingerprint-v1-md5` 与 SHA-256=`829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae` 保持冻结。run=`pss_20260828_02` 的 `2026-08-28 11:00:00–11:30:00 CST` 授权已消费；旧 host preflight wrapper 错用 Docker template 字段 `.State.RestartCount`，在 database/resource/mutation/profile/`pg_dump` 前 fail-closed，唯一 SSH 已关闭，无远端 target，不复用该 run/window。

run=`pss_20260828_03` 已在批准窗口逐字执行旧 wrapper，但它把未经原始输出证明的 `partsignal_data` 错误解释为 Docker volume name；daemon 返回 `no such volume`，结果=`STOP_PRE_DATABASE_HOST_RAW_ANCESTOR_IDENTITY_CONTRACT`。该 run/window 不重连、不重试、不复用。历史 corrected host preflight 合同=`host-preflight-v1`、wrapper SHA-256=`75f0312c17259c5f1cb43eb3e5d493570f60017d559e73404a7cd8c4489dcfd8`、self-check SHA-256=`d0002e4d93efd86365b12e375e1261c32dd8fc35424d64a9c716e13365c72a99`；原 bootstrap Task 已删除，因此这些 checksum 仅是历史执行证据，不代表当前文件存在。

用户现已明确允许仅在本地预留唯一 run=`pss_20260828_09` 并修正 packet，但尚未批准新的 production source/window/mutation/export/rollback/cleanup。run09 当前唯一 pre-authorization source of truth 为 `research/phase-3-pss-20260828-09-pre-authorization-execution-packet.md`；本文件以下 run08 literal 全部是历史记录，不得执行。

| 状态 | 值 |
| --- | --- |
| production access authorized | `false`；run08 authorization consumed |
| production mutation authorized | `false`；未执行 |
| resource creation authorized | `false`；未执行 |
| cleanup authorized | `false`；无 run08 cleanup target |
| window authorization approved | `false`；run08 历史授权已消费，run09 等待新的精确授权 |
| authorization effective now | `false`；run08 已 fail-closed 停止 |
| parent consumer acknowledged | `true` |
| absolute window | run08 historical=`2026-08-28 17:30:00–18:00:00 CST`；run09=`PENDING_USER_APPROVAL` |
| parent Gate | `NOT_MET` |

profile checksum 保持冻结。下一授权点是本文件固定的 absolute window 完整 same-window execution；catalog wrapper 必须使用 `docker exec -i` 并输出安全阶段标签，`PASSWORD NULL` 继续由 bootstrap owner验证，candidate session不读取不可见 password catalog 字段，三类 PUBLIC baseline 必须复用 `acldefault + aclexplode + grantee=0`，target `log_line_prefix` source 必须为 `configuration file`。profile wrapper 必须在 process memory 捕获安全 JSON 与 exit code；失败只输出既有 `error_type`，成功逐字段验证后才写 exact partial并原子改名，禁止无诊断二次 `assert`。创建 resources 与后续 change/profile/export/cleanup 均需新授权，不复用任何历史窗口。

### 1.1 Exact authorization decision

| 授权项 | exact contract |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| run ID / candidate role | `pss_20260828_08` / `pss_export_20260828_08` |
| absolute start/end | `2026-08-28 17:30:00 CST` / `2026-08-28 18:00:00 CST`；epoch=`1787909400–1787911200` |
| operator / audit owner / freeze owner | `root` / `777` / `777` |
| prerequisite change | 一次合并只读 preflight PASS 后，创建 exact run resources；临时 `log_line_prefix`、`PUBLIC TEMP` revoke、`PASSWORD NULL` candidate role、exact read-only ACL/GUC；password 仅由 bootstrap owner catalog session 验证 |
| parent profile/pg_dump handoff | `READY_FOR_EXPORT` 后 5 分钟内启动 coordinator；profile 与 `pg_dump` 作为单一顺序 consumer 导入同一 snapshot；`pg_dump` 仅在 corrected wrapper PASS 后启动 |
| success cleanup | coordinator rollback；exact role `NOLOGIN`/session/revoke/drop；恢复 original `PUBLIC TEMP` 与 `log_line_prefix`；移除 one-shot container 和 partial；保留第 9 节 final artifact targets |
| failure rollback | 任一断言失败立即停止且不重试；先以预捕获 PID 收敛 exact bootstrap mutation session，再按 sibling 第 7 节权威 catalog state 的 A/B/C 唯一分支回滚；marker 只交叉核验，然后处理 exact session/container/path/secret/artifact；任何 session/stage/owner assertion 不匹配则保持 freeze |
| artifact retention | 仅保留 encrypted raw final、source-profile final、tmpfs passphrase/GPG homedir、exact raw parent/run directory；到 quarantine restore 或窗口结束后 24 小时两者较早者停止消费并另取 cleanup 授权 |

用户已明确批准本 fresh packet，同时覆盖上述 prerequisite mutation、parent source profile/encrypted `pg_dump`、failure rollback、source-side success cleanup 与 retention，但只在表列 absolute window 内生效。absolute start 前及 window 外均不授权 SSH、production access、mutation、resource creation、profile、`pg_dump` 或 cleanup。

## 2. Exact identity

| 项目 | exact identity |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| revision/signature | `0043_geo_platform_identity` / `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a` |
| run ID | `pss_20260828_08` |
| change operator | `root` |
| audit/freeze owner | `777` / `777` |
| export role | `pss_export_20260828_08` |
| setup/validation applications | `pss_20260828_08_bootstrap` / `pss_20260828_08_bootstrap_verify` |
| rollback application | `pss_20260828_08_rollback` |
| coordinator application | `pss_20260828_08_coordinator` |
| profiler application | `pss_20260828_08_profile` |
| dump application | `pss_20260828_08_pg_dump` |
| database credential | container-loopback trust；password/credential secret/path=`0/0/0` |
| backend image fingerprint | `af6bb6591c51c2655f4ffdfdfbfc9bd9901d511758ca614353f923ade33f910c` |
| one-shot container | `pss_20260828_08_profile` |
| PostgreSQL server/client | source container `16.14/16.14` |

run08 的 prerequisite mutation SQL、GUC、ACL owner assertions 与 source-side cleanup 曾由已删除 bootstrap Task 的 `phase-3-exact-change-rollback-plan.md` 拥有；该历史 packet 当前未落盘，因此本文件不得被当作可执行 mutation source。run09 若获新窗口授权，production mutation/export 命令必须先在当前 Task 内精确实例化并与同一授权一起复核，禁止从历史摘要猜测或临场拼接。

### 2.1 Raw ancestor 核验与前次停止证据

authoritative historical host command/output 与旧摘要更正已收录在本 Task `research/phase-3-raw-ancestor-identity-recovery.md`。原始输出只证明 `/root/partsignal-data` 存在、owner=`0:0`、directory/non-symlink=`true/true`、filesystem type=`ext4`、filesystem label=`empty`，并记录当时 available bytes=`46994563072`；它没有输出或证明 `partsignal_data`。available bytes 是动态容量，只要求十进制 shape 并在 fresh preflight 重新计算阈值。当时 exact raw parent `/root/partsignal-data/snapshot-quarantine` 与历史 run directory `/root/partsignal-data/snapshot-quarantine/pss_20260827_01` 均不存在；该诊断 `database_connected=false`、`resource_mutation=false`。fresh run 的 exact parent/run/container/secret absence 只作为新窗口合并 preflight 的必过断言，不以历史诊断替代。

较早的 combined preflight 把“raw parent 已存在”误作只读前置条件，因此在 database session 与任何 mutation/resource creation 之前停止。`2026-08-27 15:42:56 CST` 的最新尝试已改为核验现存 ancestor，并取得完整 host/catalog 结果后显式 `ROLLBACK`；execution wrapper 只因 HBA validator 沿用旧 run candidate count=`2`、并错误要求 global complex classification=`false` 而停止。当前 run 的实际 candidate count=`1`，first match 仍为 rule `2` / `trust` / `loopback_v4`。对 captured safe output 的本地复核确认本节批准的 preflight data contract 全部通过；不再安排 standalone retry。

下一次若获授权，preflight 仍只核验现存 ancestor 的 exact identity、owner、directory/non-symlink、filesystem 与 capacity，并要求 exact parent/run directory 不存在；不在 preflight 内创建目录。GPG capability helper 已收敛为纯 boolean，后续只允许 `gpg_present=true|false`。

## 3. One-shot client 与 artifact stream

host preflight wrapper/self-check 与 ACL SQL 是本地执行合同，不进入 one-shot client tar。执行前必须分别核验 SHA-256=`75f0312c17259c5f1cb43eb3e5d493570f60017d559e73404a7cd8c4489dcfd8` / `d0002e4d93efd86365b12e375e1261c32dd8fc35424d64a9c716e13365c72a99` / `829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae`。

只允许以下四个本地 artifact 进入 tar stream：

| container relative path | SHA-256 |
| --- | --- |
| `.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py` | `295a4fe72b549fc29fb8a4c310baca50e3002aeb32423c8ab129060a7a33d17b` |
| `.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py` | `d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6` |
| `.trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py` | `124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d` |
| `.trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitization-matrix.md` | `71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6` |

唯一允许的 xattr-free tar stream invocation 为：

    COPYFILE_DISABLE=1 tar --no-xattrs -cf - \
      .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py \
      .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py \
      .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitize_snapshot.py \
      .trellis/tasks/archive/2026-08/08-26-frontend-v2-phase-9-production-snapshot-sanitization/research/sanitization-matrix.md \
    | ssh hostdzire 'docker cp - pss_20260828_08_profile:/app'

`COPYFILE_DISABLE=1` 与 `--no-xattrs` 必须同时存在；禁止替换 tar 参数、增加其他输入、携带 macOS xattr metadata，或在窗口内现场调整并重试。

固定 workspace=`/app`。执行边界：

1. 执行前重新核对 current API image fingerprint；不符即停止。
2. 断言 exact one-shot container 不存在，以 immutable image ID 创建 stopped interactive `--rm` container，共享 exact PostgreSQL container network namespace并覆盖默认 CMD，禁止启动 API。
3. container 固定 `--pull never --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges --log-driver none`，只增加 `/tmp` 16 MiB `nosuid,nodev,noexec` tmpfs；**不再使用 `--read-only`**。可写范围仅为 Docker 管理的本 run 私有 container layer；创建前断言 image `Config.Volumes` 为空，创建后断言 container `Mounts` 为空，禁止 host bind mount、named/anonymous volume、host checkout path、env/deployment secret mount。
4. 通过 `docker cp -` 只流送上述 tar allowlist；container 内连接数据库前重新计算四份 checksum。任一不符，删除 exact stopped container并停止。
5. container config 不含 database runtime env。coordinator 只向 wrapper stdin 写入一个不超过 4096 bytes、无重复 key/额外字段的 JSON document并立即关闭 stdin：`database=partsignal`、`role=pss_export_20260828_08`、`run_id=pss_20260828_08` 与动态 exported snapshot identity。wrapper 校验后在 process memory 组装 no-password loopback DSN，并以显式 child env 设置 run/database/snapshot/URL、`PGAPPNAME=pss_20260828_08_profile`、固定 `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15min -c lock_timeout=1s -c idle_in_transaction_session_timeout=35min'`、`PGPASSFILE=/dev/null` 与 `PATH`；不继承 Docker/deployment secret。上述 runtime 参数不进入 Docker config、argv、临时文件、日志或 evidence。
6. one-shot container 的覆盖 CMD 只维持 idle lifecycle，不启动 API 或第二个 producer。container 内只允许一次 `wrapper run` 启动一次 exact absolute path 的 `profile_snapshot.py profile source`，成功后只允许一次 `wrapper handoff` 读取同一 tmpfs final；host final原子交接完成后立即停止 container，依靠 `--rm` 删除并复核 exact name不存在。任一阶段失败都不得再次运行 producer/handoff，直接进入 failure rollback/cleanup。

## 4. Encryption/resource identity

| 资源 | exact target |
| --- | --- |
| secret directory | `/dev/shm/pss_20260828_08`，owner `root`，mode `0700` |
| passphrase file | `/dev/shm/pss_20260828_08/raw-encryption.pass`，mode `0600` |
| isolated GPG homedir | `/dev/shm/pss_20260828_08/gnupg`，mode `0700` |
| existing raw ancestor | `/root/partsignal-data`；只核验，不创建、不修改、不删除 |
| raw parent | `/root/partsignal-data/snapshot-quarantine`，owner `root:root`，mode `0700` |
| raw directory | `/root/partsignal-data/snapshot-quarantine/pss_20260828_08`，owner `root:root`，mode `0700` |
| source profile partial/final | `source-profile.json.partial` / `source-profile.json`，mode `0600` |
| encrypted raw partial/final | `raw-partsignal.sql.gz.gpg.partial` / `raw-partsignal.sql.gz.gpg`，mode `0600` |

preflight 必须证明 existing raw ancestor identity/owner/directory/non-symlink/ext4/capacity 全部匹配，并证明 raw parent 与 exact run directory 均不存在。只有全部 host/database preflight PASS 且本 packet 的 resource-creation scope 已获用户明确批准后，root 才按顺序创建 exact raw parent 与 exact run directory，二者固定 `root:root/0700`；创建前后分别断言 exact path、owner、mode、non-symlink、emptiness，并捕获本 run 的 device/inode identity。禁止覆盖、复用或递归创建/修改 ancestor。

passphrase 使用 kernel CSPRNG 生成，值不输出。GPG 固定 `--batch --pinentry-mode loopback --passphrase-file <exact> --no-symkey-cache --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 --homedir <exact>`。唯一 pipeline supervisor 以三个显式 child process 和 OS pipe 连接 `pg_dump 16.14 -> gzip -> GPG -> exact encrypted partial`，关闭 parent/child 不再使用的 pipe endpoint，并分别 `wait`/记录安全 exit boolean；禁止只看最后一个 process 或 shell pipeline 的总体状态。只有 `pg_dump_exit_zero=true`、`gzip_exit_zero=true`、`gpg_exit_zero=true` 三者同时成立，且 partial flush/fsync/close PASS 后，才允许流式解密到 `/dev/null` 验证；解密 exit=`0`、size/mode/SHA-256 PASS 后才原子改名，不创建 plaintext raw file。任一 child 非零、wait/pipe/fsync/decrypt 失败都关闭 pipeline、保留安全 error type、不改名、不生成 completion token，并立即进入 pre-token failure rollback/cleanup。只记录 boolean、size、mode、SHA-256 与安全 packet identity，不输出 raw stderr。

## 5. 唯一合并 preflight

新窗口内只执行一次合并 preflight，不再重复三轮 catalog/HBA/function inventory：

1. 原 host preflight invocation 所属 bootstrap Task 已按用户决定删除，本 historical packet 不再提供可执行入口，也不得据此重新连接 production；
2. database/revision/OID、database/schema ACL fingerprints、`PUBLIC TEMP`、GUC value/source/pending restart；ACL fingerprint 只允许在同一 database session 中逐字流式执行 sibling `research/acl_fingerprint_v1.sql`，执行前本地 SHA-256 必须为 `829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae`，禁止 inline 重写、候选公式或现场试算；预期 database=`5/true/712516b95217453c364a79a0b387880e/8aeb94122b3324e0b6569a2a653b7c48`、public schema=`3/true/8ab2deb0f524284db7487aae83f297a0`；
3. candidate role absent、HBA first-match fingerprint、function count、`SECURITY DEFINER` count、unexpected/duplicate boolean、PUBLIC EXECUTE fingerprint；HBA success gate 只固定 first match=`2/trust/loopback_v4`，candidate count 与 global complex classification 仅作为安全输出记录，不复用旧 run count=`2` 作为 gate；不重新输出 29 项 function identity；
4. 核验 existing raw ancestor exact path、owner=`0:0`、directory/non-symlink、filesystem type=`ext4`、filesystem label=`empty` 与 available bytes 十进制 shape；容量要求 `available >= 3 × database_size + 1 GiB`，并核验 Docker audit log headroom PASS；禁止查询或假定 Docker volume name；
5. 七项 local contract/artifact checksum（host wrapper+self-check、ACL SQL、四项 tar allowlist）、exact raw parent/run/container/secret targets absent、deploy/migration/manual schema freeze confirmed；GPG capability 只输出纯 boolean；
6. 所有数据库 preflight session 强制 `default_transaction_read_only=on`，只输出批准的 identity/boolean/count/version/GUC/fingerprint，并显式 `ROLLBACK`、证明 transaction ID 未分配。

任一 fingerprint/count/identity 漂移或输出越过 allowlist：在任何 mutation/resource creation 前停止。

## 6. Same-window exact change 与 export

全部在同一个最长 30 分钟窗口内顺序执行：

1. 合并 preflight 全部 PASS。
2. 在本 packet 同时批准的 resource change 下，root 先创建 exact raw parent `/root/partsignal-data/snapshot-quarantine`，再创建 exact run directory `/root/partsignal-data/snapshot-quarantine/pss_20260828_08`，均为 `root:root/0700`；创建前后核验 path/device/inode/owner/mode/non-symlink/empty 并记录本 run ownership。随后创建第 3–4 节 exact container、tmpfs secret/GPG homedir 与 profile/artifact targets；client 尚不连接数据库。
3. 按 sibling packet 执行并验证 audit prefix、transient `PUBLIC TEMP` revoke、candidate role/ACL/GUC setup，捕获本 run post-change fingerprints。
4. coordinator 以 exact coordinator `PGAPPNAME` 和 `REPEATABLE READ READ ONLY` 导出 snapshot identity并保持 transaction 打开。
5. one-shot profiler 以第 3 节 exact bounded stdin/explicit child env 导入同一 snapshot；唯一 wrapper=`profile_wrapper.py`、SHA-256=`d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6`，container 内固定调用 `python /app/.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py run --expected-run-id pss_20260828_08 --output /tmp/source-profile.json -- python /app/.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_snapshot.py profile source`。profile SHA-256=`295a4fe72b549fc29fb8a4c310baca50e3002aeb32423c8ab129060a7a33d17b`；producer 在输出前以 compare 共用 validator 验证 canonical `command/status/profile` envelope，动态 snapshot identity 只通过该 process stdin JSON 传入。absolute script paths 与 tar 中保留的仓库相对目录一致，使 profiler 的 `REPO_ROOT`/归档 artifact 定位保持冻结；`/tmp` 是该 UID 唯一批准的 writable tmpfs。wrapper 在 process memory 捕获安全 JSON 与 exit code，拒绝 input/output 重复 key/额外字段，冻结字段逐项 PASS 后才以 `0600` 原子写入 container final；禁止 daemon 侧 `docker cp` 读取该 tmpfs 路径，必须在同一 container 内执行 `wrapper.py handoff --expected-run-id pss_20260828_08 --input /tmp/source-profile.json`，将 artifact 字节流写入 host `source-profile.json.partial`，再复核 mode/safe identity 后原子改名。不得再运行临时 heredoc、环境 fallback 或无诊断二次 `assert`。

唯一 artifact handoff invocation：

```sh
set -euo pipefail
umask 077
PARTIAL=/root/partsignal-data/snapshot-quarantine/pss_20260828_08/source-profile.json.partial
FINAL=/root/partsignal-data/snapshot-quarantine/pss_20260828_08/source-profile.json
partial_created=false
cleanup_partial() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$partial_created" = true && ( -f "$PARTIAL" || -L "$PARTIAL" ) ]]; then
    rm -f -- "$PARTIAL"
  fi
  exit "$status"
}
trap cleanup_partial EXIT
[[ ! -e "$PARTIAL" && ! -L "$PARTIAL" && ! -e "$FINAL" && ! -L "$FINAL" ]]
SOURCE_SHA256=$(docker exec pss_20260828_08_profile \
  sha256sum /tmp/source-profile.json | cut -d ' ' -f 1)
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
set -o noclobber
exec {partial_fd}>"$PARTIAL"
partial_created=true
docker_status=0
docker exec -i pss_20260828_08_profile \
  python /app/.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/profile_wrapper.py \
  handoff --expected-run-id pss_20260828_08 --input /tmp/source-profile.json \
  >&"$partial_fd" || docker_status=$?
exec {partial_fd}>&-
set +o noclobber
if (( docker_status != 0 )); then
  exit "$docker_status"
fi
chown root:root "$PARTIAL"
chmod 0600 "$PARTIAL"
[[ -f "$PARTIAL" && ! -L "$PARTIAL" && -s "$PARTIAL" ]]
[[ "$(stat -c '%u:%g:%a' "$PARTIAL")" = '0:0:600' ]]
[[ "$(sha256sum "$PARTIAL" | cut -d ' ' -f 1)" = "$SOURCE_SHA256" ]]
mv -T -- "$PARTIAL" "$FINAL"
[[ -f "$FINAL" && ! -L "$FINAL" && -s "$FINAL" ]]
[[ "$(stat -c '%u:%g:%a' "$FINAL")" = '0:0:600' ]]
[[ "$(sha256sum "$FINAL" | cut -d ' ' -f 1)" = "$SOURCE_SHA256" ]]
docker stop -t 10 pss_20260828_08_profile >/dev/null
CONTAINER_ABSENT=false
for _ in {1..20}; do
  if ! docker inspect pss_20260828_08_profile >/dev/null 2>&1; then
    CONTAINER_ABSENT=true
    break
  fi
  sleep 0.25
done
[[ "$CONTAINER_ABSENT" = true ]]
```

`trap` 只处理本次 invocation 通过 `noclobber` 文件描述符成功创建的本 run exact partial；若启动前置断言发现已有 partial/final，trap 不会删除既有目标。任何 handoff、权限、非空、checksum、原子改名或容器停止/消失断言失败都会先移除本次创建的 partial，再进入预授权 failure rollback。成功原子改名后 partial 已不存在，trap 不会触碰 final。

该命令只允许在新鲜、重新批准的 run/window 中使用；本文件历史状态段落中的 run07 literal 只用于历史证据引用，run07/window 不复用。
6. profiler 断开后，source container `pg_dump 16.14` 以 exact dump `PGAPPNAME` 与 `--snapshot=<same identity>` 作为唯一顺序 consumer，按第 4 节三进程 supervisor 流入 gzip+GPG encrypted partial；仅三段 exit=`0`、fsync、解密与 artifact identity 全部 PASS 后原子改名。
7. coordinator 显式 `ROLLBACK`，证明 transaction ID 未分配。
8. 验证 `pg_dump/gzip/GPG` exit booleans=`true/true/true`、encrypted artifact mode/size/SHA-256、流式解密、source profile checksum、audit coverage、production write=`0`、object payload copied=`0`。
9. 生成不含敏感值的 source export completion token。
10. 不等待新的 cleanup 回合，立即执行第 8 节预授权 source-side success cleanup。

连接并发固定为 coordinator + 一个顺序 consumer；profile 与 `pg_dump` 禁止并发。bootstrap role 不执行业务 profile/export。

## 7. Exact failure rollback/containment

新的 execution authorization 必须同时预授权本节，只处理 `pss_20260828_08` exact targets：

1. 停止新消费；coordinator 若存在则显式 `ROLLBACK`，只处理 exact run application/PID；
2. 验证 name/image/run identity 后停止或删除 exact one-shot container；
3. 以 exact rollback application 建立独立 bootstrap-owner session，按预捕获 PID 收敛 mutation session 后，再按 sibling packet 的权威 catalog A/B/C 唯一分支执行 run-owned ACL/GUC rollback；marker 只作交叉核验。只有 C 分支允许 role `NOLOGIN`、revoke/drop 与恢复 `PUBLIC TEMP`，B 分支只 RESET/reload 本 run GUC，A 分支不做 ACL/GUC mutation；assertion 不匹配则保持 freeze 并停止覆盖；
4. 只有 owner/mode/path/run identity 全匹配时，删除 exact partial；若 completion token 尚未生成，先终止 exact isolated GPG agent/process，再删除本 run final profile/raw、passphrase、GPG homedir与空 secret directory；
5. 只有 exact run directory 是本 run 创建、device/inode/owner=`root:root`/mode=`0700`/non-symlink identity 全匹配、目录为空且不存在 retained final 时，才以 exact empty-directory 删除移除它；随后只有 exact raw parent 也是本 run 创建、identity/owner/mode/non-symlink 全匹配且目录为空时，才以 exact empty-directory 删除移除它；
6. 禁止删除 existing ancestor `/root/partsignal-data`，禁止递归删除、glob、共享目录或任一非空目录。任一 identity/owner/emptiness assertion 不匹配时保持 root-only containment并报告 exact residual target；
7. 复核 role/session/container/run path、original ACL/GUC、production write=`0`、object payload copied=`0`，Gate 保持 `NOT_MET`。

禁止 `DROP OWNED`、glob、broad session/container/path cleanup、共享资源删除或 fallback candidate。

## 8. Exact source-side success cleanup

export completion token 生成后立即执行：

1. coordinator 已显式 `ROLLBACK`，exact profile/dump session 已退出；必要时只终止仍匹配本 run application/PID 的 session；
2. 按 sibling packet owner assertions 对 `pss_export_20260828_08` 执行 `NOLOGIN`、revoke/drop；恢复 original `PUBLIC TEMP` 与 `log_line_prefix` 并 reload；
3. 删除或确认不存在 exact one-shot container、source-profile/raw partial；终止 exact isolated GPG agent/process，但保留第 9 节列出的 tmpfs passphrase、homedir、exact raw parent 与 run directory；
4. 复核 role/session/container/partial=`0/0/0/0`，database/schema ACL fingerprints、`PUBLIC TEMP`、GUC value/source/pending restart与 preflight exact 一致；
5. 解除 deploy/migration/manual schema freeze，记录 audit coverage、production write=`0`、object payload copied=`0`。

本节不删除第 9 节保留目标。任一 cleanup assertion/复核失败：保持 freeze，Gate=`NOT_MET`，报告 exact residual target；不自动进入 quarantine。

## 9. Artifact retention plan

success cleanup 后仅保留：

| target | 理由与边界 |
| --- | --- |
| exact encrypted raw final | 后续 quarantine restore 的唯一 raw payload；root `0600`、已记录 size/SHA-256、无 plaintext |
| exact `source-profile.json` final | 后续 raw/sanitized/fresh profile comparison；root `0600`、只含批准的聚合输出 |
| exact passphrase + isolated GPG homedir | 解密 raw 所必需；仅 `/dev/shm`、root `0600/0700`，不输出值 |
| exact raw parent + run directory | retained encrypted raw/profile 的容器；`root:root/0700`，device/inode identity 已绑定本 run |

retention decision point 为“获授权 quarantine restore 完成”与“execution window 结束后 24 小时”两者较早者。到达 decision point 不自动删除；必须停止后续消费并请求 exact restore/cleanup authorization。该后续 cleanup 仍须按 device/inode/owner/mode/non-symlink/emptiness 从 run directory 到 raw parent 的顺序精确授权；绝不删除 ancestor。host reboot、passphrase 缺失、mode/owner/checksum 漂移立即停止，不重新导出或猜 fallback。sanitized artifact 尚未生成，不在本 packet retention 范围。

## 10. Safe output allowlist 与下一停止点

允许输出：run/application/role label、fingerprint、revision/signature、boolean/count/version/GUC、database/available bytes、artifact size/mode/SHA-256、snapshot identity fingerprint、aggregate profile JSON、error type。

禁止输出：DSN、password/passphrase、credential、raw image ID、未批准 host path、业务 SQL/content/sample、正文、原始 URL/用户信息、对象 key/payload、原始 statement log。

source export 和 source-side cleanup 全部 PASS 后停止，报告 retained artifact identity/checksum 与 cleanup result；不得进入 quarantine restore、sanitize/fresh verify 或 Production-like Rehearsal。
