# Phase 2 host-only preflight 脱敏证据

## 授权与边界

- 日期：2026-08-26（CST，UTC+8）。
- audit owner：`777`。
- 已确认 SSH alias `hostdzire` 为 production source host；用户在同一 host-only 窗口内进一步确认，当前名为
  `partsignal-staging` 的 PostgreSQL 就是本任务要导出的真实业务数据源。Compose 名称仍保持其实际值，不改写为
  production。
- 批准窗口：`2026-08-26 14:11:46–14:41:46 CST`。
- 实际远程命令：`14:12:15` 开始；本地于 `14:13:02` 完成。
- 批准且实际执行的 scope：只读 host preflight；不连接数据库、不创建远程文件、不读取 secret 值。
- 本轮没有授权 production database access、inventory/profile/export、quarantine/verify 资源创建、sanitize、fresh verify 或 cleanup。

## 实际非敏感观察

| 检查 | 观察值 |
| --- | --- |
| remote user | `root` |
| Docker | `29.4.1` |
| Docker Compose | `v5.1.3` |
| host `pg_dump` / `psql` | `15.18` |
| host current symlink target label | `mvp-20260825-172239-2a6fd940b848`；未据此认定 production identity |
| shared env identity | 仅观察到 `/root/partsignal/shared/.env.staging`；mode=`0600`、owner=`root:root`；未读取内容 |
| Compose runtime | 仅观察到 `partsignal-staging`：`api`、`fake-oss`、`frontend`、`postgres`、`redis`、`scheduler`、`worker` |
| production Compose | 未观察到 |
| 已确认 source identity | source label=`hostdzire/partsignal-staging/postgres:partsignal`；bootstrap role identity=`partsignal` |
| source PostgreSQL | image=`postgres:16-alpine`；container `postgres`/`pg_dump`/`psql`=`16.14`；无 published port |
| staging PostgreSQL data | 约 `68,062,849` bytes；mode=`0700` |
| 目录权限 | `/root/partsignal`、`/root/partsignal/shared`、`/root/partsignal-data` 均为 `0755` |
| filesystem | `/dev/sda1`，`ext4`；约 `105,087,164,416` bytes total、`47,403,667,456` bytes available |
| disk encryption evidence | `lsblk` 未观察到 `dm-crypt` / `LUKS` evidence |
| host audit | `auditctl` absent；`auditd` inactive-or-absent |
| artifact encryption tools | `age` absent；`gpg 2.2.40`；`openssl` command present，但版本未成功记录 |
| volatile secret path candidate | `/dev/shm` 为 tmpfs-like memory path；mode=`1777`、owner=`root:root`；约 `3,112,849,408` bytes available |
| object storage | 未访问 production object storage；`object_payload_copied=0` |

`POSTGRES_DB=partsignal` 与 `POSTGRES_USER=partsignal` 仅作为非 secret identity 观察；未读取或输出
`POSTGRES_PASSWORD`、DSN 或其他 secret 值，也未读取 shared env 文件正文。

## 判定与停止原因

- 用户已明确确认 `hostdzire` 上现名为 `partsignal-staging` 的 PostgreSQL 是本任务真实业务数据源。因此 exact
  source label 冻结为 `hostdzire/partsignal-staging/postgres:partsignal`；该确认不改变 Compose 的
  staging 名称，也不等于批准数据库连接。
- 因未读取 env 内容，不能断言 dedicated read-only role 存在或不存在，也没有取得 role identity 或 effective grants 证据。
- host client `15.18` 不得用于导出 PostgreSQL server `16`；source 容器内 `16.14` 是版本匹配候选，但数据库
  操作尚未授权，server version 仍需 catalog-only preflight 实际证明。
- 本轮未取得 host-level audit、磁盘加密、独立 raw quarantine path/owner、production DB identity、database revision、实际 dump window 或 exported snapshot identity 证据。
- 因此在 database access 前停止。没有执行 inventory/profile/`pg_dump`，没有生成 raw snapshot，没有创建或删除任何远程资源。

## 当前状态

- Phase 2 host-only preflight：完成。
- Source identity：已确认。
- Phase 2 production inventory/export：未开始。
- `production_access_authorized=false`。
- Gate=`NOT_MET`。
