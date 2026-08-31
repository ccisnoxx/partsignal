# Package A1 执行证据

## 结论

- package：`A1_BUILD_production-20260830-101614-a663bcce`
- 用户授权：`APPROVED_EXACT_COMMAND`
- 执行目标：SSH alias `hostdzire` / hostname `scrapy`
- exact command SHA-256：`67dedb028dd5eeeb923b751a28858b88e65b5210ba7dd8e7baa231c375ec926b`
- 完成时间：`2026-08-30T11:52:33+08:00`
- 退出状态：`0`
- completion marker：`A1_ARTIFACT_BUILD_COMPLETE`
- A1 execution Gate：`MET`
- A2、Production env、Compose、Maintenance/Data、Nginx write/reload、cleanup：`NOT_AUTHORIZED / NOT_STARTED`

本轮只把 A1 标记为 `MET`。AC3/AC4 仍依赖 A2 manifest/configuration，不得提前标记完成；历史任务的 Remote Gate 状态不变。

## Source 与 archive identity

- origin：`https://github.com/ccisnoxx/partsignal.git`
- commit：`a663bcce9fd49da9c5aea7f257372fc318447234`
- Git tree：`7d4a167bf0a60b293ef8920177df9d1340343fbd`
- release checkout：`/root/partsignal/releases/production-20260830-101614-a663bcce`
  - directory，`root:root 0755`，device=`2049`
  - branch=`main`，`HEAD == origin/main == commit`，working tree clean
- source archive：`/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz`
  - regular file，`root:root 0600`，device=`2049`
  - size=`10,118,699` bytes
  - SHA-256=`38666f7a799aee8cd6966ec69e021a6d427c11a89a5fecff1345c84665021fa8`
  - `tar -tzf` successful

## Candidate 与 dependency image identity

- backend：
  - reference=`partsignal-backend:production-20260830-101614-a663bcce`
  - full image ID=`sha256:3a2b4618099644c81dc660d9dbe37fd7f8be5eaa37129dbfbeca447fa6f44380`
  - RepoDigest=`partsignal-backend@sha256:3a2b4618099644c81dc660d9dbe37fd7f8be5eaa37129dbfbeca447fa6f44380`
  - platform=`linux/amd64`
- frontend：
  - reference=`partsignal-frontend:production-20260830-101614-a663bcce`
  - full image ID=`sha256:2a4fabe9eb4071e499b039484c900a434d75922c71f66af807d629a2d67761bb`
  - RepoDigest=`partsignal-frontend@sha256:2a4fabe9eb4071e499b039484c900a434d75922c71f66af807d629a2d67761bb`
  - platform=`linux/amd64`
- pulled base `python:3.12-slim`：ID/RepoDigest=`sha256:09f7da3bc104798d0afb40bc08d23ab2da20a76130cec1f2ef170848f5d85217`，platform=`linux/amd64`
- pulled base `node:22-alpine`：ID/RepoDigest=`sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`，platform=`linux/amd64`
- rollback V2 保持：`partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` / `linux/amd64`

两个候选镜像均只有本 package 的 fixed tag；没有覆盖或移动旧 tag。

## Protected runtime 与边界核验

- A1 结束后独立只读核验确认原 7 个 PartSignal 容器完整 ID、service、旧 image、state、health、restart=`0`、OOM=`false` 和 mounts 与 A1 baseline 一致；没有 stop、recreate、remove 或切换。
- listeners 仍为 `0.0.0.0:80`、`10.0.0.2:443`、`23.80.89.175:443`、`127.0.0.1:19000`、`127.0.0.1:19001`、`127.0.0.1:19080`。
- Nginx enabled target 仍为 `/etc/nginx/sites-available/partsignal-staging.conf`，target SHA-256=`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`，security snippet SHA-256=`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`，unit=`active`，`nginx -t` successful；没有 write/reload。
- `/root/partsignal/current` 仍指向 `/root/partsignal/releases/mvp-20250825-172239-2a6fd940b848`。
- DB revision=`0043_geo_platform_identity`，DB size=`10,714,135` bytes。
- public root=`200`，public `/api/v1/live`=`404`，与获批 A1 baseline 一致。
- `/root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json` missing。
- `/root/partsignal/shared/.env.production` missing；未读取或输出任何 secret 值。
- advisory lock file `/run/lock/partsignal-production-artifact.lock` 保留为 regular empty file、`root:root 0600`；A1 最终核验完成且进程退出后，最小只读 `flock -n` 复核为 `FREE`。

## Data observation

A1 completion 时只记录：

```text
/root/partsignal-data          83744277
/root/partsignal-data/postgres 68128385
/root/partsignal-data/redis    15053506
/root/partsignal-data/objects    558290
```

独立只读核验时 Redis 继续自然增长，data root=`83,753,979`、postgres=`68,128,385`、redis=`15,063,208`、objects=`558,290` bytes。A1 对 byte size 只记录、不做 equality Gate；path type/device/owner/mode 与 mounts 仍 exact。Package M 必须在停止容器后、quarantine 前重新冻结 exact size，不得继承这一例外。

## Capacity 与残余风险

- 最终 capacity Gate：available memory=`2,273,959,936` bytes；root/Docker/containerd available=`45,002,108,928` bytes，均通过 A1 硬门。
- 主机无 swap，后续每个 package 仍须重新检查容量，不能继承 A1 的通过结果。
- `npm ci` 报告 `2 high severity vulnerabilities`；A1 不授权修改依赖，构建未因此失败。Vite 同时报出单个 chunk 超过 500 kB 的非阻断警告。两项均作为后续仓库任务风险记录，不改变本 package artifact identity。
- Docker tag 排他性仍依赖 cooperative single-writer；A1 执行期未观察到并发 tag writer。
- A1 创建的 release、archive、base images、candidate images、build cache 和 lock file均保留；未执行 prune 或任何清理。
