# I04 执行与证据记录

## Phase 0 — 当前恢复点

- 候选工作树：`codex/frontend-redevelopment-candidate@a4c15a535f21621188a61f076cf7856c14509d42`，tree `9738ba36cb0f4fbe1f4352cfb89e043df7fa580c`，创建 I04 前 clean。
- `a4c15a53` 相对已验证产品候选 `387b802d` 仅包含 Trellis/会话收尾记录，没有产品代码、部署配置或依赖变化。
- 原检出区：`main@9100774b0e124d1d834f8c726cf85f2c0e171e5e`，创建 I04 前 clean。
- I04 已建立并链接为总体任务 child；总体任务保持 `in_progress`。

## Planned phases

1. Git 收口：fetch、严格 ancestry/远端分叉检查、候选 I04 规划记录 commit、原检出区 fast-forward only、非 force push、再次固定 local/origin/candidate identity。
2. Repository Release Gate：在最终 clean main 运行 Nginx security、三组 deploy 测试、CLI unit、Compose config、shell/Python syntax、diff check 与 secret scan，逐项保存日志和 SHA-256。
3. Hostdzire 只读预检：主机/资源、Docker、固定路径、repo/release/current/manifest、Compose service/container/image/health/profile、listener、migration、Nginx/TLS、数据 device/permissions/size、env 安全状态、rollback image、delivery 条件与 fake-oss inventory。
4. 冻结 release：生成唯一 release ID/run ID、可复现 source archive、候选镜像与 RepoDigest、排他 0600 manifest；完成 pre-cutover fresh critical review。
5. 维护与 quarantine：原子 maintenance Nginx、稳定 503/T0、精确停止旧服务、确认无写入与 mount、同一 run ID quarantine。
6. clean-init prepare：只通过 `deploy.sh` 完成 config/identity/health/preflight/migration/integrity/initialize-accounts/API/Frontend，达到 `PRODUCTION_PREPARED`。
7. 真实 AI/OSS Gate：实际权限、连通、timeout、失败语义、namespace、受控预签名上传/HEAD/read/CORS/cleanup；只在全部通过后标记 `MET`。
8. 激活与 final Nginx：只通过 `activate-production.sh` 启动 worker/scheduler，进入 `PRODUCTION_INITIALIZED`；原子切换最终 Nginx。
9. 验收与观察：回环/公网/浏览器/权限/受控写/AI/OSS/artifact/security/runtime/migration/state，记录多采样观察与 T0+60 分钟结论。
10. 精确清理与收尾：保留规定证据和 rollback/quarantine，fresh post-observation critical review，完成 I04 与总体任务，提交并非 force push 仅含 Trellis 收尾记录的 main commit。

## Evidence ledger

后续在本文件与 `task.json.meta` 中追加实际 commit/tree、release ID、run ID、manifest 路径与 SHA-256、archive SHA-256、image ID/RepoDigest、Nginx old/new checksum 与备份、T0/时间线、Gate/验收日志、观察采样、review audit ID、警告和覆盖缺口。不得记录 secret 值。

## Current status

`BLOCKED_REMOTE_PRECHECK`。Git 收口与 Repository Release Gate 已完成；Hostdzire 只读预检发现明确停止条件，未生成 release/manifest，未执行任何远端写入，未进入维护窗口。

## 2026-09-27 actual execution

### Git 收口

- fetch 后 `origin/main` 仍为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`；候选无分叉并领先 27 个提交。
- I04 规划记录提交为 `f91b98b52c1fd7e90b4767979c13915af423914b`；原检出区以 `git merge --ff-only` 更新到该提交并非 force push。
- push 后 local `main == origin/main == f91b98b52c1fd7e90b4767979c13915af423914b`，tree `4891af4b287fdedb983aeb87dcda7d82db5f4607`，两个工作树均 clean。

### Repository Release Gate

以下项目均在最终 clean `main` 实际退出 `0`：

| 检查 | 结果 | 日志 | SHA-256 |
| --- | --- | --- | --- |
| Nginx security | passed | `/tmp/partsignal-i04-check-nginx-security.log` | `17f63aff5334365b1891fde48a58f034158e44fbcd8f03382cd5ce49b589f99c` |
| deploy staging test | passed | `/tmp/partsignal-i04-test-deploy-staging.log` | `fd574621f03c8142222f748dfdb6f828574f70f8b1956da2a2726498e3cf9c51` |
| deploy production cleanup test | passed | `/tmp/partsignal-i04-test-deploy-production-cleanup.log` | `22d94cd0bddc580d9aa2112e89f28b8b3c40b2af6ef89b69e5dde64422fdd48b` |
| deploy production test | passed | `/tmp/partsignal-i04-test-deploy-production.log` | `e5ca00cf2fdd647e3b998fc42d10a212c043012e02f54b884b6b2c9d166246c7` |
| CLI unit | `4 passed` | `/tmp/partsignal-i04-pytest-cli.log` | `f6e6b8418565fbd6476bef4cd4eea6509c221f48d795a78ffe3933df059705b7` |
| Production Compose config | passed | `/tmp/partsignal-i04-compose-config.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| shell/Python syntax | `17 shell / 2 Python` | `/tmp/partsignal-i04-syntax.log` | `b09fa319357c0301cc3ddda0fec1ef52ddbe4274b3f0d8c61b974a8f2ca7564e` |
| diff/clean tree | passed | `/tmp/partsignal-i04-git-diff-check.log` | `0eab04424246f43275470005c9150cae8074b8de5e657b6fd983f195329388d1` |
| pattern secret scan | `2,415 tracked files / 0 high-signal findings` | `/tmp/partsignal-i04-secret-scan.log` | `90b456489ecd3dfb49a713e782131b94e143bd6fce2e35355f43be5523139a4f` |

I03 `make verify` 复用仍成立：`387b802d` 到 `f91b98b5` 的产品代码、部署配置和依赖没有变化；新增差异仅为 I03/I04 Trellis 与会话记录。本轮没有把 I03 日志当作 Hostdzire 部署证据。

### Hostdzire 只读 inventory

- OpenSSH alias `hostdzire` 正常通过既有 host-key 校验；主机 `scrapy`，x86_64，Docker `29.4.1`，Compose `5.1.3`，Nginx `1.29.8`；根盘约 105 GB、可用约 38.7 GB，内存约 6.2 GB、可用约 2.3 GB，无 swap。
- 当前 `/root/partsignal/current` 指向 `releases/mvp-20260830-133651-a663bcce`；该 checkout 为 clean `main@a663bcce9fd49da9c5aea7f257372fc318447234`。远端没有 release manifest 文件。
- `partsignal-staging` 当前运行 postgres、redis、api、worker、scheduler、frontend、fake-oss；健康检查存在的五个 service 为 healthy、restart count 均为 0。当前 migration 为 `0043_geo_platform_identity (head)`。
- 当前 Frontend image 为 `partsignal-frontend:mvp-20260830-133651-a663bcce`，image ID 与 RepoDigest 均为 `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e`；历史 production frontend image 也有非空 RepoDigest，但没有 manifest 证明其为当次已验证 rollback identity。
- 19000、19001、19080 均仅监听 `127.0.0.1`；fake-oss 正在运行并挂载 `/root/partsignal-data/objects`，符合“当前仍是旧 staging 运行态”，不符合进入 Production 的最终态。
- Nginx enabled target 为 `/etc/nginx/sites-enabled/partsignal-staging.conf -> /etc/nginx/sites-available/partsignal-staging.conf`，SHA-256 `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`，`nginx -t` 通过；当前配置仍包含 19001 和 `/object-storage/`。证书有效期为 2026-08-31 至 2026-11-29，续期 owner 是 root-owned `/etc/cron.d/certbot`。
- postgres、redis、objects 和预期 quarantine parent 均在 device `2049`；quarantine root 尚未创建，但其 parent 与活动数据同 device。活动三目录均为普通目录、非 mountpoint、非 symlink。
- `/root/partsignal/shared/.env.production` **不存在**；只有 `.env.staging`。因此无法验证权限 `0600`、Production 安全键状态、真实 AI/OSS 配置或执行 Production preflight。

只读证据日志：

- core inventory：`/tmp/partsignal-i04-hostdzire-inventory-core.log`，SHA-256 `90cce087650b9f857e32ef27683493fc00e36c5d1f036113913a4bbced444085`
- corrected container inventory：`/tmp/partsignal-i04-hostdzire-containers.log`，SHA-256 `17c738a8649ac065e32bc7b12668aab5bad75351f8e28b68b01202fda3927efc`
- Nginx/data/env：`/tmp/partsignal-i04-hostdzire-nginx-data-env.log`，SHA-256 `e0fcb893b7ad367a5671641e02eb8725f10a79884e1add4c5329935d690b5986`
- certificate/image inventory：`/tmp/partsignal-i04-hostdzire-certs-images.log`，SHA-256 `7d0fe0107037e7c84fce526c6d5b250b8e77cacc59666bfd538de63afcb68df5`
- final identity inventory：`/tmp/partsignal-i04-hostdzire-final-inventory.log`，SHA-256 `dc00e08e46ff630439480dc7b2be36f4e0220c2f273e70774e975f8d06779e91`
- current checkout identity：`/tmp/partsignal-i04-hostdzire-current-git.log`，SHA-256 `2d1f6d29d49f43a559f3c310013c2d72d51ead3efbc16358d47d53ccd07a462a`

### Blocker and recovery point

停止条件为 `PRODUCTION_ENV_MISSING`：固定路径 `/root/partsignal/shared/.env.production` 不存在。根据用户明确停止条件与 runbook，不能从 `.env.staging` 复制、猜测、打印或合成 Production 值，也不能继续构建/上传 release、生成 manifest、安装维护配置、停止容器或 quarantine 数据。

恢复 I04 前需要由凭据 owner 在 Hostdzire 受控创建普通、非 symlink、权限 `0600` 的 `.env.production`，并确保 Production-only 安全配置和真实 AI/OSS 凭据完整；同时需要明确并验证上一份 V2 rollback frontend identity（最好以不可变 manifest 或等价审计记录固定）。下一会话从 Hostdzire 只读预检重跑开始，不复用本次缺失 env 的 Configuration Gate 结论。
