# run pss_20260828_08 database preflight command stop evidence

## 1. 证据来源与边界

本文件依据本机已归档的 run08 原始工具调用与原始 stdout/stderr 补录，归档 session ID=`01a045e9-4fef-7341-a942-d91fffa90814`。这里只保留批准 allowlist 内的时间、identity、boolean、容量与 shell 错误；不落盘 raw container ID、credential、业务数据或未批准 host path。

用户批准的 run=`pss_20260828_08`、candidate role=`pss_export_20260828_08`、absolute window=`2026-08-28 17:30:00–18:00:00 CST`。本轮于 `2026-08-28 17:30:26 CST` 开始，并于 `2026-08-28 17:32:34 CST` fail-closed 停止。

## 2. 已观察的本地与 host preflight 结果

本地 readiness 命令实际输出 `LOCAL_WINDOW_AND_CONTRACT=PASS`，并核验两个 Task 的 `in_progress`/run/window/approval identity，以及以下冻结 checksum：

| artifact | SHA-256 |
| --- | --- |
| `profile_wrapper.py` | `d71f86a7305ccc8f956a1ef1b421806582078c912852b1c8ac4700d5be7d54b6` |
| `profile_snapshot.py` | `295a4fe72b549fc29fb8a4c310baca50e3002aeb32423c8ab129060a7a33d17b` |
| historical `host_preflight.sh` | `75f0312c17259c5f1cb43eb3e5d493570f60017d559e73404a7cd8c4489dcfd8` |
| historical `host_preflight_selfcheck.py` | `d0002e4d93efd86365b12e375e1261c32dd8fc35424d64a9c716e13365c72a99` |
| `acl_fingerprint_v1.sql` | `829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae` |

host preflight 于 `2026-08-28T17:30:34+0800` 输出 `contract_version=host-preflight-v1`、`run_id=pss_20260828_08` 与 `host_preflight_complete=true`。已观察的安全结果包括：

- source container identity/Compose project/Compose service/image/running/restart count 全部为 `true`；
- PostgreSQL server、`psql`、`pg_dump` version 检查全部为 `true`；
- raw ancestor owner/filesystem type/filesystem label 检查全部为 `true`，available bytes=`46965284864`；
- shm filesystem 检查为 `true`，available bytes=`3112849408`；
- exact host artifact/container absence、GPG、gzip 检查全部为 `true`；
- `database_connected=false`、`resource_mutation=false`。

## 3. 准确失败边界与根因

唯一 database preflight invocation 把远端命令拼为一个本地双引号字符串，其中包含以下脱敏后的结构：

```text
ssh hostdzire "docker exec -i <verified-source-container> sh -lc 'export PGOPTIONS=...; exec psql ... -d \"\$POSTGRES_DB\""
                                                                    ^
                                                                    此处打开的单引号没有闭合
```

准确命令边界是传给 `ssh hostdzire` 的单个远端 command argument；准确缺陷是 `sh -lc '` 在 `-lc` payload 起点打开单引号，而命令末尾只关闭了本地双引号，没有在 `-d \"\$POSTGRES_DB\"` 之后关闭该单引号。原始 stderr 为：

```text
bash: -c: line 1: unexpected EOF while looking for matching `''
```

命令 wall time=`0.3s`。该错误由远端登录 shell 在解析 command argument 时返回，因此发生在 `docker exec` 启动和 database session 建立之前。停止结果=`STOP_PRE_DATABASE_REMOTE_SHELL_QUOTING`。

## 4. 最终状态

本轮没有重试或改变命令，没有创建 role、session、container、secret、raw parent/run path、profile/raw partial 或 final，也没有执行 mutation、profile 或 `pg_dump`：

- database session started=`false`
- production mutation/resource creation=`false/false`
- source profile/`pg_dump` started=`false/false`
- production business write/object payload copied=`0/0`
- retained artifact=`0`
- cleanup=`NOT_REQUIRED_NO_TARGETS`
- Gate=`NOT_MET`

run08 及原 absolute window 已消费，不得重试或复用。
