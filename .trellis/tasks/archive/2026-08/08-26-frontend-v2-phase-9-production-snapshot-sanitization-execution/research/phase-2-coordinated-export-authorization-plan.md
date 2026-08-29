# Phase 2 同窗口 source profile/export 协调包（SUPERSEDED HISTORICAL DRAFT）

## 1. 当前状态

本文件只保留 `pss_20260826_01` 的历史协调决策，已由 `phase-2-same-window-execution-packet.md` 取代，不得用于当前 run 执行。它不构成 production access、prerequisite mutation、client/path/secret/artifact 创建或 export 授权。

| 项目 | 当前值 |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| revision | `0043_geo_platform_identity`；执行前重新只读核验 |
| run ID | `pss_20260826_01` |
| export role | `pss_export_20260826_01`；尚不存在 |
| parent applications | `pss_20260826_01_coordinator` / `pss_20260826_01_profile` / `pss_20260826_01_pg_dump` |
| change operator | `root` |
| audit owner | `777` |
| deploy/migration/config freeze owner | `777` |
| database credential | `CONTAINER_LOCAL_TRUST_NO_SECRET`；credential secret/path=`0/0` |
| source client | PostgreSQL `16.14` container client |
| parent Gate | `NOT_MET` |
| production access/mutation authorized | `false/false` |
| object payload copied | `0` |

prerequisite Task 的 Phase 2 preflight 已 `PASS`，但 Phase 3 role/ACL/logging setup 仍为 draft。父 Task 只有在同一批准窗口内取得自己的 inventory/profile/export 授权并可在 `READY_FOR_EXPORT` 后 5 分钟内开始时，才能确认 consumer acknowledgement。

## 2. 同一 snapshot 的最小消费顺序

prerequisite role 固定 `CONNECTION LIMIT 2`。父 Task 只使用一个 coordinator 与一个顺序 consumer：

1. coordinator 通过 source container loopback 建立 `REPEATABLE READ READ ONLY` transaction，调用获批准的 `pg_catalog.pg_export_snapshot()`，保持 transaction 打开；
2. source profiler consumer 导入该 snapshot，运行 `research/profile_snapshot.py source`，只输出批准的聚合 JSON；
3. profiler 完成并断开后，source container 的 `pg_dump 16.14 --snapshot=<同一 identity>` 作为第二个顺序 consumer 执行；
4. dump 成功或失败后，coordinator 显式 `ROLLBACK` 并断开；任何阶段失败都不重试、不延长窗口，进入 prerequisite failure rollback/cleanup 边界。

profile 与 `pg_dump` 禁止并发。snapshot identity 可以作为脱敏执行 identity 记录，但不得把 DSN、SQL 正文或业务值写入 Task evidence。

## 3. Source profiler 的实际 client 边界

`profile_snapshot.py` 依赖 Python、`psycopg`、`argon2`，并在固定仓库相对路径读取归档 sanitizer/matrix；`postgres:16-alpine` 只提供 PostgreSQL client，不能直接承担该 executable。为保持 loopback trust/no-password，当前最小候选是：

本地静态复核已确认 `backend/Dockerfile` 的 production stage 基于 Python 3.12 runtime，`backend/pyproject.toml`/lock 中包含 `psycopg[binary]`、`argon2-cffi` 与 SQLAlchemy，因此现有 backend image 是满足 profiler 依赖的候选；这不代替对 source host 当前 deployed image ID 与实际 import 的只读验证。

- 仅在父 Task Phase 2 另行授权后，使用 source 当前已部署 backend image 启动一个 `--rm` one-shot Python client；执行前对当前 API container image ID 重新计算 fingerprint，必须等于 `af6bb6591c51c2655f4ffdfdfbfc9bd9901d511758ca614353f923ade33f910c`；
- 该 client 共享 exact PostgreSQL container network namespace，使数据库目标仍为 container-local `127.0.0.1`；
- host completion preflight 已证明 host checkout 的 exact `profile_snapshot.py`、归档 sanitizer 与 matrix path 均不存在。禁止猜另一个 mount path；改为从本地通过 SSH stdin 将这三个 allowlisted artifact 流式送入 container 私有 writable layer，container 内按固定相对路径解包并复核 `128fd0cc20b3aba9f842ee089f8864d9339411c8cba48d63f1ebb32f639d12c8`、`124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d`、`71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6`；不挂载仓库、env 文件或 deployment secret，不在 remote host filesystem 创建代码文件；
- 只执行 profiler 单进程，不启动 API、Worker、scheduler、frontend、浏览器或对象服务；结束后验证临时 container 不存在；
- database URL 仅在进程内由无 password 的固定组件组装，关闭 shell tracing，不进入 argv、Docker label、Task 文件或命令输出。

one-shot client 是尚未授权的临时外部资源。backend image fingerprint 已由一次只读 host completion preflight 冻结；artifact delivery 已收敛为 checksum-verified stream。exact container name/entrypoint/allowlisted tar paths 已在 `phase-2-same-window-execution-packet.md` 冻结；任一依赖或 identity 不符即停止。

## 4. Raw artifact 加密候选

无需要求用户预先提供 GPG recipient。最小候选是一次性对称加密，但必须由父 Task 单独授权以下精确资源：

| 资源 | 候选边界 |
| --- | --- |
| secret directory | `/dev/shm/pss_20260826_01`，tmpfs，owner `root`，mode `0700` |
| encryption secret | 上述目录内单个固定文件，CSPRNG 生成，mode `0600`，值永不输出 |
| encrypted raw directory | `/root/partsignal-data/snapshot-quarantine/pss_20260826_01`，owner `root`，mode `0700` |
| encrypted raw artifact | `raw-partsignal.sql.gz.gpg`，mode `0600` |
| plaintext raw file | 不创建；`pg_dump | gzip | gpg` 直接写密文 |

GPG 固定使用获批准的 symmetric cipher/S2K 参数并从 exact secret file 读取 passphrase，不把值放入 argv、history、日志或 evidence。写入完成后必须检查 mode、size、SHA-256，并以同一 secret 流式解密到 `/dev/null` 验证密文完整性；raw restore 也只流式解密到 exact quarantine target，不生成明文 dump 文件。

host 数据盘是普通 ext4，当前没有 dm-crypt/LUKS 证据。用户已明确接受“artifact 本身强加密 + secret 仅驻留 tmpfs”而非磁盘级加密的边界。encryption secret 不属于 prerequisite 的 database credential，因此不改变 `CONTAINER_LOCAL_TRUST_NO_SECRET`，但它仍是父 Task cleanup 的 exact target；资源创建仍未授权。

## 5. 执行前仍需实例化

下列字段不能由本地规划冒充实际授权：

1. 从下一次 production 执行确认时冻结的 absolute `window_start_cst/window_end_cst`，最长 30 分钟；
2. 父 Task Phase 2 export authorization label 与 consumer acknowledgement；
3. one-shot profiler client 与 stream manifest 的创建/运行/自动删除授权；
4. 已冻结的 GPG/secret/raw exact targets 的创建、加密、验证与 failure containment 授权；
5. prerequisite Phase 3 exact mutation/failure rollback 授权。

exact identities 已在 `phase-2-same-window-execution-packet.md` 实例化；当前只剩 absolute window、parent consumer acknowledgement 与 combined execution/failure authorization。未获得明确批准前，保持 `production_access_authorized=false`、`production_mutation_authorized=false`、Gate=`NOT_MET`。

## 6. 停止条件与安全输出

- source/container/image/revision/ACL/GUC/HBA/function fingerprint、profile/sanitizer checksum 或 schema signature 漂移；
- one-shot client 需要 password、非-loopback database path、额外挂载、后台服务或无法证明自动删除；
- raw stream 可能产生明文文件、secret 可能进入 argv/log/history、ciphertext 无法独立解密校验、路径容量不足或 mode 不精确；
- audit/freeze/window 不完整、父 consumer 未在 5 分钟内开始、transaction ID 被分配、出现 TEMP/DML/DDL 或 user-schema function invocation；
- 任何输出疑似包含 DSN、credential、正文、原始 URL/用户信息、对象 key 或 payload。

任一条件触发都停止，不扩大授权、不猜 fallback、不自动清理未获精确授权的资源。
