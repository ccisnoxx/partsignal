# Step 2 Source Freeze 与执行拓扑核验

## 结论

2026-08-30 本轮 Step 2 已完成 source-side freeze，但尚未创建 Production candidate image、source archive 或 manifest。最终候选镜像与 manifest 必须在 Hostdzire `linux/amd64` Docker 上创建；开发机 Colima 是 `linux/arm64`，不能作为当前 local-delivery 合同的 candidate owner。

这项发现要求把原 Package A 拆成 A1（Host checkout/archive/build）与 A2（manifest/configuration），消除“授权前要求未知 image/manifest identity、获批后却没有执行步骤”的循环依赖。该 material planning correction 已由用户明确批准；A1/A2 仍须分别取得执行授权。

## Source identity

- evidence time：`2026-08-30T10:17:37+08:00`
- branch：`main`
- working tree：clean
- local `HEAD`：`a663bcce9fd49da9c5aea7f257372fc318447234`
- local `origin/main`：`a663bcce9fd49da9c5aea7f257372fc318447234`
- authoritative `git ls-remote origin refs/heads/main`：`a663bcce9fd49da9c5aea7f257372fc318447234`
- Git tree：`7d4a167bf0a60b293ef8920177df9d1340343fbd`
- commit time：`2026-08-30T10:01:49+08:00`
- schema head：`0043_geo_platform_identity`
- proposed unique release ID：`production-20260830-101614-a663bcce`

## Hostdzire read-only eligibility

Identity captured at `2026-08-30T10:16:42+08:00` and capacity refreshed at `2026-08-30T10:17:37+08:00` through SSH alias `hostdzire`; remote mutation=`NONE`。

- hostname：`scrapy`
- architecture：`x86_64`; rollback image reports `linux/amd64`
- available memory：`2,341,384,192` bytes
- root available：`46,532,714,496` bytes
- Docker root filesystem available：`46,532,714,496` bytes
- proposed release directory/archive/manifest：all absent
- proposed backend/frontend image tags：both absent
- running frontend full container ID：`7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75`
- running frontend image ID：`sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`
- Compose identity：project=`partsignal-staging`, service=`frontend`
- runtime state：running, restart=`0`, OOM=`false`
- rollback reference：`partsignal-frontend:mvp-20260825-172239-2a6fd940b848`
- rollback image ID：`sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`
- rollback RepoDigest：`partsignal-frontend@sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`

容量满足每次 build 前 available memory ≥2 GiB、root available ≥10 GiB 的当前门槛，但 A1 执行前必须重新读取；这次证据不能代替获批 package 的即时 precondition。

## Fixed tracked-file identity

- `deploy/compose.prod.yaml`：`07b25396f75f0ae0d7f3f49b64f86a23f430cc2e227eca9c1b0585e090876d4a`
- `deploy/nginx/partsignal-maintenance.conf.template`：`9259ce49b8877c123e2ce0d7c70dc3a6414a0c764a012ff5d3acc7894d83f217`
- `deploy/nginx/partsignal-security-headers.conf`：`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`
- `deploy/nginx/partsignal.conf.template`：`7d4d39eaa98ed42f65acb8f300af4b092cad7e887061a9ecd203735d59d20dac`
- `deploy/scripts/activate-production.sh`：`c0a05c5f056465a8015d5513260389e8a4bd5b8e2766ffabf92464d2eaf1fa13`
- `deploy/scripts/deploy.sh`：`42221763ffc3ae677500a6fb9dae5f9f1d7e5ede7648b5199d0ffbd5671bae94`
- `deploy/scripts/prepare-production-data.py`：`de90b71590a6423f91bf185761d7afb6355b7d117cab0722550538aaeb4bb0e5`
- `deploy/scripts/rollback-production-frontend.sh`：`a1a1fa9a0d10db6add66d89f508a193b84f1fc31ba849878f82673acfc61c797`

## Execution boundary

- 本机曾为只读 Docker identity 检查启动既有 Colima；未执行 build/tag/archive/manifest，随后已恢复停止。
- 未创建或覆盖任何本地/远端 release、archive、manifest 或 image tag。
- 未读取或输出任何 env/secret 值。
- A1 未获授权前，不得在 Hostdzire 创建 checkout/archive 或构建镜像。
- A2 未获授权前，不得创建 manifest、运行 Compose configuration preflight 或触碰 `.env.production`。

## Read-only helper deviation

在规划修订获批后的 A1 事实补充中，一条用于汇总 base-image `docker image inspect` 的命令在 Hostdzire `/tmp` 创建并立即删除了 PID-suffixed 临时结果文件。该命令没有修改 PartSignal checkout/release/archive/manifest/image/container/data/Nginx/env，也没有遗留临时文件，但严格说不满足“remote mutation=`NONE`”。后续只读核验不得使用远端临时文件；该偏差不标记任何 Gate 为 `MET`。
