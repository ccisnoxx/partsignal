# run pss_20260828_09 pre-authorization execution packet

## 1. 状态与不可越过边界

run=`pss_20260828_09` 是为下一次 production 尝试预留的新唯一 run identity。当前仅完成本地 packet 修正与验证，尚无新的 absolute window 授权：

| 状态 | 值 |
| --- | --- |
| packet status | `LOCAL_PREFLIGHT_READY_AWAITING_EXACT_WINDOW_AUTHORIZATION` |
| production access authorized | `false` |
| production inventory/profile/export authorized | `false` |
| production mutation/resource creation authorized | `false/false` |
| failure rollback/source cleanup authorized | `false/false` |
| absolute window | `PENDING_USER_APPROVAL` |
| SSH/production/Docker/database connected by this correction | `false/false/false/false` |
| Gate | `NOT_MET` |

run08 及其 `2026-08-28 17:30:00–18:00:00 CST` 窗口不得重试或复用。本 packet 也不允许在用户批准新的精确 source、absolute window、mutation/export、failure rollback 与 cleanup 范围之前连接 `hostdzire`。

## 2. Exact identities

| 项目 | exact identity |
| --- | --- |
| source | `hostdzire/partsignal-staging/postgres:partsignal` |
| source container name | `postgres`；fresh host preflight 必须重新核验 Compose project/service、runtime ID 与 image fingerprint，runtime ID 不落盘 |
| revision/signature | `0043_geo_platform_identity` / `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a` |
| run ID | `pss_20260828_09` |
| candidate role | `pss_export_20260828_09` |
| database preflight application | `pss_20260828_09_execution_preflight` |
| setup/validation applications | `pss_20260828_09_bootstrap` / `pss_20260828_09_bootstrap_verify` |
| rollback application | `pss_20260828_09_rollback` |
| coordinator application | `pss_20260828_09_coordinator` |
| profiler application/container | `pss_20260828_09_profile` |
| dump application | `pss_20260828_09_pg_dump` |
| secret directory | `/dev/shm/pss_20260828_09` |
| raw parent | `/root/partsignal-data/snapshot-quarantine` |
| raw run directory | `/root/partsignal-data/snapshot-quarantine/pss_20260828_09` |
| change operator / audit owner / freeze owner | `root` / `777` / `777` |
| absolute start/end | `PENDING_USER_APPROVAL`；最长 `1800s`，不得提前、延长或复用 |

仓库内既有 tracked/untracked 内容中未发现更早的 run09 identity；本文件与修正后的 invocation 是本轮首次预留。latest completed attempt 仍是 run08。

## 3. 修正后的 database preflight owner

唯一执行入口：

```text
research/database_preflight_invocation.sh
```

合同：

- shell script SHA-256=`4b40289f0677ef568bd47005100980be0a75dd980d8335823b777909046773f5`；
- ACL source=`research/acl_fingerprint_v1.sql`，合同=`acl-fingerprint-v1-md5`，SHA-256=`829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae`；
- 完整 SQL stdin stream SHA-256=`8de9b3d24827645c34af6f9280e51b56c6570d48f9911c653929918186977bfe`；
- SQL stream 复用 run08 已观察的 preflight query 边界，只将 candidate/run application identity 绑定到 run09；ACL 序列化表达式逐字来自独立冻结文件；
- `docker exec -i`、`PGOPTIONS`、`PGAPPNAME` 与 `psql` 参数先作为 Bash array 建立，再用 `printf %q` 机械编码为唯一远端 command argument；禁止手写 `sh -lc '…'` 或嵌套 command quote；
- self-check 比较远端 argv 精确 count/prefix/identity、拒绝 `sh -lc`、执行本地 `bash -n -c`，并通过 `set -- <encoded command>` 验证编码前后 argv 逐项一致；
- `run` 必须同时收到两个十位 epoch 参数、窗口时长不超过 1800 秒、当前时间位于 `[start,end)`，并要求环境变量精确等于 `PSS_PRODUCTION_WINDOW_AUTHORIZATION=pss_20260828_09:<start_epoch>:<end_epoch>`；缺失、错误、过期或超长窗口均在 SSH 前停止；
- SSH executable 固定 `/usr/bin/ssh`，source host 固定 `hostdzire`，不接受动态 host 或命令覆盖。

本地唯一 self-check：

```sh
bash -n .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh
.trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh self-check
```

获得新精确窗口授权后，唯一 database preflight 调用 shape 才能实例化为：

```sh
PSS_PRODUCTION_WINDOW_AUTHORIZATION='pss_20260828_09:<start_epoch>:<end_epoch>' \
  .trellis/tasks/08-26-frontend-v2-phase-9-production-snapshot-sanitization-execution/research/database_preflight_invocation.sh \
  run <start_epoch> <end_epoch>
```

`<start_epoch>` 与 `<end_epoch>` 当前不是已授权值，不得自行填写。调用前仍须在同一新窗口完成 fresh host preflight；host preflight PASS 不等于 database/mutation/export 授权。

## 4. 需要一次性精确批准的 production 范围

新的授权必须同时、明确覆盖下列 exact scope；缺少任一项都不得连接 production：

1. **source 与窗口**：source=`hostdzire/partsignal-staging/postgres:partsignal`，run=`pss_20260828_09`，明确 CST absolute start/end 与对应 epoch；只在该窗口内生效。
2. **只读 inventory/database preflight**：fresh host preflight 后只执行本文件第 3 节唯一 invocation；输出限于批准 identity/boolean/count/version/GUC/fingerprint，事务为 `REPEATABLE READ READ ONLY` 并显式 `ROLLBACK`。
3. **resource creation 与 prerequisite mutation**：preflight 全部 PASS 后，才允许创建 run09 exact raw/secret/container targets，并执行临时 `log_line_prefix`、`PUBLIC TEMP` revoke、`PASSWORD NULL` candidate role、exact read-only ACL/GUC；不得修改其他 role、path、container 或共享资源。
4. **profile/export**：只允许 run09 coordinator、one-shot profiler 与 source-container `pg_dump 16.14` 作为同一 snapshot 的顺序 consumer；`pg_dump` 仅在 corrected profile wrapper/handoff PASS 后启动；raw 只允许直接 gzip+GPG encrypted final，不创建 plaintext raw file。
5. **failure rollback**：任一断言失败立即停止且不重试，只处理 run09 exact application/PID/role/container/path/secret/artifact，并按已捕获 catalog state 的 A/B/C 唯一分支恢复 original ACL/GUC；identity 或 owner 不匹配时保持 freeze，不执行 broad cleanup。
6. **source-side success cleanup**：成功 export 后立即回滚 coordinator、撤销/drop run09 candidate、恢复 original `PUBLIC TEMP`/`log_line_prefix`、移除 exact session/container/partial；只保留另行批准的 encrypted raw final、source profile final、tmpfs passphrase/GPG homedir和 exact raw parent/run directory。
7. **retention/后续边界**：quarantine restore、sanitize、fresh verify、manifest 与最终 cleanup 不属于这次预授权 packet 的自动后续步骤，仍需到达对应停止点后另行批准。Production-like Rehearsal 不得启动。

历史 `phase-2-same-window-execution-packet.md` 的 run08 literal 仅作为已消费窗口的过程记录，不能成为 run09 的执行参数。本文件拥有 run09 identity 与 database preflight entry；未在本文件精确实例化的 production mutation/export 命令不得临场拼接或猜测。

## 5. Gate 与停止条件

run09 当前只完成本地准备，Gate 必须保持 `NOT_MET`。只有 production 导出、quarantine restore、sanitize、fresh verify、manifest 与全部 cleanup 均有实际 PASS 证据后，才可评估 Gate 变更；任何本地 self-check、历史 run 证据或计划文本都不能代替这些结果。
