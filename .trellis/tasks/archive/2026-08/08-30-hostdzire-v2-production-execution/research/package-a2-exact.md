# Package A2 Exact Authorization：Manifest / Configuration

## Authorization status

- package：`A2_MANIFEST_CONFIGURATION_production-20260830-101614-a663bcce`
- baseline：`A2-DRAFT-BASELINE-20260830T120709+0800`
- target：SSH alias `hostdzire` / hostname `scrapy`
- status：`BLOCKED_ENV_MISSING_AND_ROLLBACK_NAMED_REF_ABSENT`
- remote mutation authorization：`false`
- blocker 1：`/root/partsignal/shared/.env.production` observed=`ABSENT`
- blocker 2：rollback reference `partsignal-frontend:mvp-20250825-172239-2a6fd940b848` named lookup=`ABSENT`，manifest producer 不能按获批 reference inspect
- correction：用户已批准把精确受限的临时 container/file、network precheck、full-image frontend wrapper 与 owned cleanup 纳入 A2
- guard 1：现有 `test-frontend-container.sh` 未强制 no-pull，且同名冲突时 cleanup 可能删除非本 package 容器；最终 command 不得直接调用
- guard 2：Compose one-off preflight 必须在执行前 exact 比较 `partsignal-staging-internal` / `partsignal-staging-egress` network identity
- 本文件不是执行授权；没有可执行的单一 SSH command block，禁止拼接以下 command fragments 执行

Package A1 的批准不授权 A2。当前固定 identity 足以确定 manifest 内容，但不足以形成 configuration 的 observed Gate；在 env 经安全渠道 provision 且 correction 获批后，必须重新做一次只读 inventory，再把本文件重渲染为单一、全字面量、可审计命令。

用户已批准本文件的 temporary validation mutation correction，但这不是 A2 执行授权。`2026-08-30T12:45:48+08:00` 最终只读 re-freeze 与主线程复核仍观察 env=`MISSING`、manifest=`ABSENT`，并发现 rollback named reference 无法解析；最终 exact render 被两个 hard blocker 阻断。

### Final pre-render blocker evidence

```text
hostname=scrapy
/root/partsignal/shared/.env.production|MISSING
/root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json|ABSENT
partsignal-frontend:mvp-20250825-172239-2a6fd940b848|NAMED_REFERENCE_ABSENT
sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111|PRESENT|linux/amd64|RepoDigest=partsignal-frontend@sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111|RepoTags metadata still lists expected tag
```

`docker image inspect <rollback tag>` 和 `docker image ls` 均找不到 named reference；按 full image ID inspect 仍成功。不能把 image metadata 中的 stale `RepoTags` 当作可解析 reference，也不能自动 retag。任何 tag repair 都是新的远端 mutation，必须先形成独立全字面量 authorization package。

## Fixed A1 actual inputs

- origin=`https://github.com/ccisnoxx/partsignal.git`
- commit=`a663bcce9fd49da9c5aea7f257372fc318447234`
- tree=`7d4a167bf0a60b293ef8920177df9d1340343fbd`
- release ID=`production-20260830-101614-a663bcce`
- schema head=`0043_geo_platform_identity`
- checkout=`/root/partsignal/releases/production-20260830-101614-a663bcce`
- source archive=`/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz`
- archive metadata=`regular file|600|0:0|2049|10118699`
- archive SHA-256=`38666f7a799aee8cd6966ec69e021a6d427c11a89a5fecff1345c84665021fa8`
- manifest output=`/root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json`，observed=`ABSENT`
- expected deterministic manifest size=`2274` bytes
- expected deterministic manifest SHA-256=`a19b9e43cf5ba6607b93c4c599b2b5e8e1d27eddb44d1fcfec806f0417068b06`
- artifact lock=`/run/lock/partsignal-production-artifact.lock|regular empty file|600|0:0|25|0`，observed advisory lock=`FREE`

### Approved network guards

```text
partsignal-staging-internal|0a086717c50c6ae90eeacf96788ecd7331b01f24fbc153fd1820afaa41abb7c3|bridge|local|project=partsignal-staging|network=partsignal-staging-internal|compose-version=5.1.3|config-hash=2e5098afa3fd8c38f053d7cb8660a4b397357d110b4c6e42ca3cf4464f5461a4
partsignal-staging-egress|3f6d3e49da4f5d0f83b84bb1af8dd8f2f1f840a419cda56ca1364530ce60b738|bridge|local|project=partsignal-staging|network=partsignal-staging-egress|compose-version=5.1.3|config-hash=587a776673c6c06436d9c2bf0df78daf126383765fec3c69b7b53a0ca1cb03ec
```

这些是 correction 获批后的只读 observation；env provision 后最终 render 仍须重新读取并 exact 比较，不能直接继承。

### Images

| role | reference | full image ID / only RepoDigest | platform |
|---|---|---|---|
| backend | `partsignal-backend:production-20260830-101614-a663bcce` | `sha256:3a2b4618099644c81dc660d9dbe37fd7f8be5eaa37129dbfbeca447fa6f44380` | `linux/amd64` |
| frontend | `partsignal-frontend:production-20260830-101614-a663bcce` | `sha256:2a4fabe9eb4071e499b039484c900a434d75922c71f66af807d629a2d67761bb` | `linux/amd64` |
| rollback frontend | `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` | `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` | `linux/amd64` |

三个镜像的 RepoDigest 均为 `<repository>@<同一 full image ID>`，且每个 reference 当前只有表中的 fixed tag。

### Tracked file allowlist

```text
07b25396f75f0ae0d7f3f49b64f86a23f430cc2e227eca9c1b0585e090876d4a  deploy/compose.prod.yaml
9259ce49b8877c123e2ce0d7c70dc3a6414a0c764a012ff5d3acc7894d83f217  deploy/nginx/partsignal-maintenance.conf.template
c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e  deploy/nginx/partsignal-security-headers.conf
7d4d39eaa98ed42f65acb8f300af4b092cad7e887061a9ecd203735d59d20dac  deploy/nginx/partsignal.conf.template
c0a05c5f056465a8015d5513260389e8a4bd5b8e2766ffabf92464d2eaf1fa13  deploy/scripts/activate-production.sh
42221763ffc3ae677500a6fb9dae5f9f1d7e5ede7648b5199d0ffbd5671bae94  deploy/scripts/deploy.sh
de90b71590a6423f91bf185761d7afb6355b7d117cab0722550538aaeb4bb0e5  deploy/scripts/prepare-production-data.py
a1a1fa9a0d10db6add66d89f508a193b84f1fc31ba849878f82673acfc61c797  deploy/scripts/rollback-production-frontend.sh
```

## Draft protected runtime baseline

以下是 `2026-08-30T12:07:09+08:00` 的只读 draft baseline，最终授权前必须刷新，不能直接继承：

```text
api       0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f  running healthy restart=0 oom=false
redis     4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba  sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99  running healthy restart=0 oom=false
fake-oss  57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f  running none restart=0 oom=false
postgres  680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc  sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777  running healthy restart=0 oom=false
frontend  7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75  sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111  running none restart=0 oom=false
worker    dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f  running healthy restart=0 oom=false
scheduler e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f  running healthy restart=0 oom=false
```

- listeners=`0.0.0.0:80,10.0.0.2:443,23.80.89.175:443,127.0.0.1:19000,127.0.0.1:19001,127.0.0.1:19080`
- DB=`revision=0043_geo_platform_identity|size=10714135`
- current resolved target=`/root/partsignal/releases/mvp-20250825-172239-2a6fd940b848`
- Nginx target=`/etc/nginx/sites-available/partsignal-staging.conf`
- Nginx target SHA-256=`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`
- security snippet SHA-256=`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`
- Nginx unit=`active`，`nginx -t=successful`
- public=`root=200|live=404`
- data path type/device/owner/mode 与 A1 证据一致；byte size 不在本 draft 中扩展 A1 的 package-scoped correction，Package M 仍须停机后 exact freeze
- capacity observation：memory=`2322034688` bytes；root/Docker/containerd=`45000876032` bytes

## Production env required outcome

用户声明已安全 provision，但 Hostdzire canonical path 的两次只读检查仍为 `ABSENT`；因此下列只能是 required outcome，不能伪装为 evidence：

```text
/root/partsignal/shared/.env.production
type=regular file
symlink=false
owner=root:root
mode=0600
device=2049
```

文件必须由用户或运维 owner 经安全渠道 provision。代理不创建、不复制 `.env.staging`、不接收、不显示也不记录任何值。status-only preflight 的固定成功输出必须精确等于：

```json
{"ai_allow_local_http": false, "content_generator": "openai-compatible", "database_configured": true, "environment": "production", "object_storage_backend": "aliyun_oss", "oss_access_key_id_configured": true, "oss_access_key_secret_configured": true, "oss_bucket_configured": true, "oss_endpoint_configured": true, "redis_configured": true, "seed_admin_password_configured": true, "seed_engineer_password_configured": true, "session_cookie_secure": true}
```

不得输出 URL、DSN、bucket、AccessKey、password、token、Cookie、Header、request body 或其他 secret 值。现有 status-only owner 不报告 PostgreSQL init keys 或 CORS status；A2 不能把该 CLI 解释为真实 AI/OSS/CORS Gate，这些仍由后续 clean-init 与 external Gate 证明。

## Proposed material planning correction

原 A2 持久 mutation 仍只有排他创建 manifest，但强制 validation 不是零 mutation。拟议授权必须显式加入以下短暂、精确受限且完成后自清理的 mutation：

1. manifest producer 为 deterministic archive comparison 创建一个 `tempfile.mkstemp(suffix=.tar.gz)` 文件并在 `finally` 中 unlink。
2. `docker compose run --pull never --rm --no-deps api python -m app.cli preflight-production-config` 创建并删除一个 `partsignal-staging` one-off API container；执行前必须 exact 冻结 `partsignal-staging-internal` 与 `partsignal-staging-egress` network 的 ID/driver/scope/labels，缺失或漂移时在 Compose 前停止，禁止 Compose 新建 network、启动 dependency、pull、build 或挂载业务数据。
3. 不直接调用当前 `test-frontend-container.sh`。最终 exact command 必须用 frontend full image ID=`sha256:2a4fabe9eb4071e499b039484c900a434d75922c71f66af807d629a2d67761bb`、固定字面量容器名、`--pull=never` 与本 package 唯一 ownership label 执行等价 artifact checks；创建前要求该名字 absent，cleanup 只能在重新证明 container ID 与 ownership label 都等于本次创建记录后删除。
4. `deploy/scripts/test-deploy-production.sh` 创建并删除一个 fixed-temp-root 下的 `partsignal-production-test.*` fixture tree；除开头真实 Compose config 外，后续 Docker/curl 使用该目录内 mock executable，不触碰真实 runtime。
5. 上述 validation 自身的成功/失败 cleanup 只限其精确 one-off container/temp resource；不授权删除 manifest partial、release、archive、image、cache、旧资源或任何非本 package 资源。

最终命令还必须显式设置 `TMPDIR=/tmp`、`TMP=/tmp`、`TEMP=/tmp`，先冻结 `/tmp` metadata/space，使 Python `tempfile` 与两个 shell validation 的临时路径不受远端 inherited environment 改写。这一 correction 已由用户明确批准，但 correction approval 不等于 A2 execution authorization。最终 package 仍须实现这些 guard、通过独立审计并另行展示授权。

## Exact command fragments fixed by current evidence

以下片段没有 placeholder，但仅用于审计最终 render，不得单独执行。

Manifest producer：

```bash
cd /root/partsignal/releases/production-20260830-101614-a663bcce
umask 077
python3 deploy/scripts/create-release-manifest.py \
  --release-id production-20260830-101614-a663bcce \
  --commit a663bcce9fd49da9c5aea7f257372fc318447234 \
  --source-archive /root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz \
  --backend-image partsignal-backend:production-20260830-101614-a663bcce \
  --frontend-image partsignal-frontend:production-20260830-101614-a663bcce \
  --rollback-frontend-image partsignal-frontend:mvp-20260825-172239-2a6fd940b848 \
  --schema-head 0043_geo_platform_identity \
  --tracked-file deploy/compose.prod.yaml \
  --tracked-file deploy/nginx/partsignal-maintenance.conf.template \
  --tracked-file deploy/nginx/partsignal-security-headers.conf \
  --tracked-file deploy/nginx/partsignal.conf.template \
  --tracked-file deploy/scripts/activate-production.sh \
  --tracked-file deploy/scripts/deploy.sh \
  --tracked-file deploy/scripts/prepare-production-data.py \
  --tracked-file deploy/scripts/rollback-production-frontend.sh \
  --output /root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json
```

Compose config 与 status-only preflight：

```bash
cd /root/partsignal/releases/production-20260830-101614-a663bcce
COMPOSE_PROJECT_NAME=partsignal-staging \
PARTSIGNAL_VERSION=production-20260830-101614-a663bcce \
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend \
PARTSIGNAL_RUNTIME_ENV_FILE=/root/partsignal/shared/.env.production \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
docker compose --env-file /root/partsignal/shared/.env.production \
  -f deploy/compose.prod.yaml config --quiet

COMPOSE_PROJECT_NAME=partsignal-staging \
PARTSIGNAL_VERSION=production-20260830-101614-a663bcce \
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend \
PARTSIGNAL_RUNTIME_ENV_FILE=/root/partsignal/shared/.env.production \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
docker compose --env-file /root/partsignal/shared/.env.production \
  -f deploy/compose.prod.yaml run --pull never --rm --no-deps api \
  python -m app.cli preflight-production-config
```

Deploy contract validation draft fragment：

```bash
cd /root/partsignal/releases/production-20260830-101614-a663bcce
TMPDIR=/tmp TMP=/tmp TEMP=/tmp \
deploy/scripts/test-deploy-production.sh
```

Frontend artifact 的现有 script fragment 已移除：最终 package 必须内联与仓库脚本同等的 fallback/cache/source-map checks，并使用 full image ID、固定容器名、`--pull=never`、ownership label 与 container-ID-bound cleanup。该安全 wrapper 尚未完成 final render，禁止退回直接调用现有脚本。

## Required order after blockers clear

最终单一 command 必须保持：

1. 获取现存 artifact lock 的 advisory lock；重新验证 hostname、capacity、release/archive/tracked/images、manifest absent、env metadata/configured outcome、protected runtime baseline、`/tmp` owner/mode/device/space 与两个 Compose network exact identity。
2. 在 manifest 创建前执行 Compose config、status-only preflight、frontend artifact、deploy self-test；任何失败都停止，不留下不可覆盖 manifest。
3. 验证 one-off container/temp directory/network/image/tag/runtime snapshot 已恢复到 package baseline。
4. 最后排他创建 manifest；创建失败或 partial manifest 必须保留现场，禁止删除或覆盖重试。
5. 复算 actual manifest metadata/size/SHA、archive/tracked/image/platform，并再次验证 protected runtime 未变化。
6. 输出 `A2_MANIFEST_CONFIGURATION_COMPLETE` 后释放 advisory lock并暂停；不进入 Nginx 或 Maintenance/Data。

## Stop and preservation boundary

- env missing、symlink、owner/mode/device 不符或 status-only JSON 不等于固定值时，在 manifest 创建前停止。
- manifest 已存在、release/archive/tracked/image/RepoDigest/platform/tag、container、Nginx、listener、DB、current 或 public baseline 任一漂移时停止。
- Compose network 缺失/漂移时必须在 one-off preflight 前停止；Compose config、preflight、frontend artifact、deploy self-test任一失败，或发生 pull/build/new network/dependency start/residual container/temp resource 时停止。
- 输出疑似包含 secret 值时停止并只报告 `SECRET_SAFE_OUTPUT_GATE_FAILED`，不得转述原输出。
- 不允许 rebuild、retag、env write、current/runtime/Nginx/data mutation、prune、cleanup、V1/test escape 用于真实 producer，或删除 partial manifest 后重试。
- 失败时保留 release/archive/images/manifest partial 与现场；只允许验证脚本清理自己创建的精确临时资源。
