# I04-1 执行与证据记录

## Baseline

- local candidate HEAD、local main、`origin/main`：`d20ecffa10da797de36d7be15cdc2b0c8eb20122`；tree `b7a37e877354a35ec6a8d2c77f1ae764de650c7b`。
- 两个本地工作树在 child 创建前 clean。
- parent I04：`in_progress / blocked_remote_precheck`；Repository Release Gate=`MET`，本轮不重跑。
- 固定远端目标：SSH alias `hostdzire`，`/root/partsignal/shared/.env.production`。

## Execution plan

1. 只读 remote precheck：host/path/staging metadata、目标仍不存在、允许键存在性与真实 OSS 安全布尔状态。
2. 单个受控远端 Python 进程生成并 no-replace 原子安装 Production env；仅输出键名、字节数、SHA-256 和固定状态。
3. 独立 remote validator 完成 metadata、静态合同、Settings/CLI preflight、Compose config 和脱敏日志摘要。
4. 只读 Docker inspect + 历史证据交叉核对并冻结 rollback frontend identity。
5. fresh critical review；若 `NO BLOCKER`，完成 child，更新 parent/overall 状态与下一任务。

## Evidence ledger

## 2026-09-27 remote precheck

- SSH alias `hostdzire` 通过既有 host-key 校验；hostname=`scrapy`。
- `/root/partsignal/shared/.env.production` 在两次检查中均不存在；shared parent 全部为普通目录、无 symlink/path alias。没有创建临时文件或目标文件。
- `.env.staging` 是 `root:root 0600` 普通非 symlink 文件，大小 `1332` bytes，解析无重复键、CRLF 或 NUL；远端进程只输出键名和布尔状态，没有输出任何值。
- 脱敏 OSS 结果：`OBJECT_STORAGE_BACKEND=development`（仅记录固定枚举相等结果）；没有 `OSS_ENDPOINT` 键；`OSS_ACCESS_KEY_ID` 与 `OSS_ACCESS_KEY_SECRET` 均未配置；`OSS_BUCKET` 已配置且键法安全。不存在可依法复用并验证为真实 Aliyun OSS 的完整输入。
- env 型 provider credential key 不存在。仓库合同确认真实 provider credential 属于数据库 AI Channel；预定安全路径仍是 clean-init 后由 credential owner 通过 HTTPS Production 管理 UI/API replacement-only 录入并用新 Production encryption key 加密，禁止旧库导出或聊天传递。本轮因 OSS blocker 未执行该路径或真实 AI Gate。
- 脱敏日志：`/tmp/partsignal-i04-1-hostdzire-config-precheck.log`，`1447` bytes，SHA-256 `d5c3bf92b888d19f08ffbd9fa8e61fcbb4705f09da71c2df348b72f26ece8929`；两次 SSH precheck exit code 均为 `0`。

## Stop result

`BLOCKER_REAL_OSS_CONFIGURATION_MISSING`。根据用户显式 stop condition，没有创建 `.env.production`，没有生成任何 secret，没有运行 Settings/CLI preflight 或 Compose config，没有冻结 rollback frontend identity，也没有安排仅适用于 env 创建完成后的 critical review。

I04-1 保持 `in_progress`；parent I04 保持 `in_progress / blocked_remote_precheck`；总体任务保持 `in_progress`。恢复前需要 credential owner 通过 Hostdzire 本机安全渠道 provision 可验证的真实 Aliyun OSS endpoint、bucket 与 AccessKey 输入（不得经聊天），然后从目标不存在性和 source metadata precheck 重新开始。

## 2026-09-27 provided `.env` recheck

- 用户说明已在 `.env` 提供真实 Aliyun OSS 输入。本轮分别检查 main 工作区、候选工作区、Hostdzire shared/current 的可能 env owner，只输出文件身份、键存在性和 endpoint 安全布尔状态。
- main 工作区 `.env` 被 Git ignore，是当前用户拥有的普通非 symlink 文件；发现 mode=`0644` 后已收紧为 `0600`，未修改内容。文件包含非空 bucket、AccessKey ID 与 AccessKey secret，但没有 `OSS_ENDPOINT` 键。
- main `.env` 现有 `OBJECT_STORAGE_ENDPOINT` 与 `OBJECT_STORAGE_PUBLIC_ENDPOINT` 均为非 HTTPS、非 Aliyun 且 host safety=false，不能被映射为 Production OSS endpoint。候选工作区 `.env` 和 Hostdzire `.env.staging` 也没有可用真实 OSS endpoint；候选 AccessKey 仍为空，Hostdzire shared `.env` 不存在。
- `/root/partsignal/shared/.env.production` fresh read-only check 仍为 absent。没有把任何 local secret 发送到远端，也没有创建 Production env。
- 脱敏日志：`/tmp/partsignal-i04-1-local-env-recheck.log`，`1279` bytes，SHA-256 `9b66d168257df73b52a462bf108eb45a3ccf3b377ebdecb85a3c7fe57dd8d1f2`。
- 当前 blocker 收窄为 `PRODUCTION_OSS_ENDPOINT_MISSING_OR_UNSAFE`：需要在 main 工作区 `.env` 增加非空 `OSS_ENDPOINT=https://<Aliyun OSS endpoint>`，host 必须属于 `aliyuncs.com`、无 userinfo、无非 443 port、无 path；不要通过聊天提供值。

## 2026-09-27 second resume recheck

- 用户再次说明已提供真实 Aliyun OSS 输入；`2026-09-27T08:30:03Z` 重新检查 main/candidate 两个根 `.env` 以及 Hostdzire shared/current 已知 env owner。
- main `.env` 仍为用户所有、`0600`、普通非 symlink 文件并安全解析，但 endpoint 相关键名只有 `OBJECT_STORAGE_ENDPOINT` 与 `OBJECT_STORAGE_PUBLIC_ENDPOINT`；精确 `OSS_ENDPOINT` 键仍不存在，四项 Production OSS 输入不能同时成立。
- candidate `.env` 同样没有 `OSS_ENDPOINT`；Hostdzire `.env.staging` 仍没有 `OSS_ENDPOINT` 和完整 AccessKey，shared `.env` 不存在。
- 远端目标 `.env.production` 仍不存在，parent path 安全。没有传输任何 local secret，没有生成 Production secret，没有远端写入。
- 脱敏日志：`/tmp/partsignal-i04-1-local-env-second-recheck.log`，`1105` bytes，SHA-256 `841d25eb3f6acaecd1c4a471941fd0b569509be6b36786b0882ebca5170e5682`。
- blocker 继续为 `PRODUCTION_OSS_ENDPOINT_MISSING_OR_UNSAFE`。恢复要求保持不变：在 main 工作区根 `.env` 中增加精确非空 `OSS_ENDPOINT`，不得把 development endpoint 自动映射为 Production OSS endpoint，也不要通过聊天传值。

## 2026-09-27 complete `.env.example`

- 用户明确要求提供完整 `.env.example`，并重申 `.env.production` 由代理在输入完整后受控创建。
- 根 `.env.example` 已补充当前 Settings 可配置项：Session/CSRF/TTL、generation eager、development storage path、upload/download TTL，以及 Production Aliyun OSS 精确键 `OSS_ENDPOINT`。示例不包含真实 credential，且说明 provider credential 由 AI Channel 管理接口加密入库。
- `.env.example`：`2011` bytes，SHA-256 `925eac0abcc8ec89f140883137cfc4ad50baf3cb82c5cd7814345f7f7146760d`。
- targeted validation：dotenv 解析 `38` keys / `0` duplicate / required keys complete；当前 Settings development load passed；Production Compose `config --quiet` passed；`deploy/scripts/test-deploy-production.sh` exit `0`，输出 `Production V2 编排、两阶段激活、可续跑数据状态机与候选清单合同自检通过`。
- 现有 Git-ignored `.env` 未被覆盖或修改；等待 credential owner 只在本机补齐精确 `OSS_ENDPOINT` 后恢复。Production 目标仍未创建，I04-1 保持 `in_progress`。

## 2026-09-27 Production env creation and validation

### Controlled creation

- local Git-ignored `.env` 最终通过四项 OSS 输入检查：required configured、HTTPS、`aliyuncs.com`、无 userinfo、默认 443、无 path/query/fragment、bucket 语法安全；任何值均未输出。
- remote target 在写入前仍不存在，hostname=`scrapy`，parent components 全部为普通非 symlink 目录、root owner、无 group/world write。
- Hostdzire 受保护 Python 进程仅经 SSH stdin 接收 OSS 四项，使用安全随机源生成 PostgreSQL、session、AI encryption、upload signing、ADMIN seed 与 ENGINEER seed 六个 secret。六项 pairwise distinct，且与 staging/development 值均不相等。
- 目标通过同目录 `0600` 排他临时文件写入，file fsync 后用 Linux `renameat2(RENAME_NOREPLACE)` 原子安装，再 fsync parent directory；竞态目标存在会 fail closed，不覆盖。
- final `/root/partsignal/shared/.env.production`：regular non-symlink、`root:root 0600`、`1480` bytes、SHA-256 `413092ab3459ca8c1198a1b352eca8009ff1bc965916073d002d2be4cdab6eba`、35 keys。
- creation log：`/tmp/partsignal-i04-1-env-create.log`，`606` bytes，SHA-256 `24be8c6b7b938e6655253961a875d0972d5178b7936e7def60613af3d3b5ac7f`，exit `0`。

### Configuration validation

- independent read validator：exact key set、required nonempty（`VITE_API_BASE_URL` 按同源合同为空）、无 duplicate/CRLF/control/source/include/shell substitution，DATABASE_URL 与 `POSTGRES_*` 一致，password URL-safe，AI key 为合法 Base64 32 bytes，六个 secret 独立。
- fixed Production boundary 全部通过：production URLs、INFO、Compose PostgreSQL/Redis、secure Cookie、`openai-compatible`、local HTTP false、Aliyun OSS、精确 CORS、same-origin Vite。
- Host current source 的 `backend/app/config.py`、`backend/app/cli.py`、`deploy/compose.prod.yaml` SHA-256 与 local main 相同。
- 在当前 API image 内通过 stdin 瞬时注入 Production env，实际执行 `python -m app.cli preflight-production-config`：exit `0`，输出严格匹配固定枚举与 `*_configured=true` allowlist；未连接或写 PostgreSQL/Redis。
- Production Compose `config --quiet`：exit `0`，stdout/stderr empty；未运行 `run/up/stop`，没有 service start/stop/recreate。
- validation log：`/tmp/partsignal-i04-1-config-validation.log`，`2282` bytes，SHA-256 `19a5c39d2d9ae65165a10931e7066b8f46661a6b1a5be80e51cff9cc30c23f43`，exit `0`。
- 这些结果只证明 Configuration Gate 结构合同；真实 AI/OSS External Services Gate 仍为 `NOT_RUN`。

### Rollback frontend identity freeze

- current frontend container full ID：`2081c2b1e49afa9fc84a0be20c7f49df42e840bc95a741c7c4f6930a04bd5818`；project/service=`partsignal-staging/frontend`；running；healthcheck not configured；restart=`0`；OOM=false。
- frozen reference：`partsignal-frontend:mvp-20260830-133651-a663bcce`。
- frozen image ID：`sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e`。
- frozen RepoDigest：`partsignal-frontend@sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e`；platform=`linux/amd64`。
- current release `/root/partsignal/releases/mvp-20260830-133651-a663bcce` clean at source commit `a663bcce9fd49da9c5aea7f257372fc318447234`；local commit tree 存在 canonical `frontend/`，historical staging Compose build context 为 `../frontend`。
- `development-rebuild-execution.md` 记录同一 release/source/image ID 及数据库、七服务、fake-oss、公网和 current 验收；`step2-source-freeze.md`、`authorization-packages.md`、`package-a1-execution.md` 提供 earlier V2/A1 identity 和平台/RepoDigest 边界。current identity 满足 `create-release-manifest.py` rollback inspect 合同。
- 该 tag/image 在 I04 完成前不得删除或 retag。identity log：`/tmp/partsignal-i04-1-rollback-identity.log`，`1110` bytes，SHA-256 `2a6fcd2da9c5d30030dd7550afed53ab45b189a617a392ecb88f6e864d39a05e`，exit `0`。

### Secret boundary correction and scan

- credential owner 补数据时曾把真实 OSS endpoint、AccessKey ID/secret 同时写入 tracked `.env.example`；在任何 commit/push 前由本任务检测并立即恢复为 blank/no-credential template。真实值继续只存在于 Git-ignored `.env` 与 remote protected env。
- final equality scan：真实 OSS endpoint/AccessKey 对 tracked repo、Trellis、ordinary logs、shell history 均为 0；remote DATABASE_URL、全部生成 secret、OSS endpoint/AccessKey 对 release tracked files、ordinary logs、shell history、process cmdline、container configs 均为 0。值未输出。
- bucket 未作为 equality secret scan 输入，因为短或通用 bucket 名可能与测试文本碰撞；其值未输出，结构验证通过。
- final `.env.example`：`2056` bytes，SHA-256 `6a79f18a468985f7195b8708644499762adf8b49ebf20776810dfd876cbd3195`；38 keys / 0 duplicate；Production Compose parse 与 `test-deploy-production.sh` 均通过。
- secret scan log：`/tmp/partsignal-i04-1-secret-scan.log`，`914` bytes，SHA-256 `6563e95e1360b1c0a46b748c2dd90224e592ae03cc7bd4beb72f1772caf8cf1d`，exit `0`。

### AI credential injection path

真实 provider credential 不在 env。原计划是 clean-init 后由 credential owner 通过 HTTPS Production 管理 UI/API 创建或 replacement-only 更新 AI Channel，服务端以本次新 `AI_CREDENTIAL_ENCRYPTION_KEY` 加密入 PostgreSQL；不得解密/导出旧数据库 credential，也不经聊天传递。fresh review 证明该路径在现行 maintenance/cutover 顺序中不可达，因此本段只保留为被否决的设计假设，不能作为安全注入路径或 I04-1 完成证据。

当前状态：Configuration validation 与 rollback identity freeze 已完成；未创建 release/manifest，未进入维护窗口，未停止容器，未修改 Nginx 或活动数据。

## 2026-09-27 fresh high-risk critical review

- audit ID：`20260927T133013Z-i04-1-production-config-rollback-review-922379db`；fresh `critical_reviewer` 使用隔离上下文，只读复核本地记录、脱敏日志和 Hostdzire metadata/Docker identity，未读取 env 值、未修改本地或远端状态。
- 结论：`BLOCKER`，不是 `NO BLOCKER`。已通过的部分包括最终文件当前为 `root:root 0600` 普通非 symlink、四份日志字节数与 SHA-256 一致且不含 secret、Configuration Gate 明确不等于 External Services Gate、rollback identity 与 fresh inspect/历史证据一致。
- P0 `AI_CREDENTIAL_BOOTSTRAP_PATH_UNREACHABLE`：maintenance Nginx 在 External Services Gate 前固定 503 且没有 upstream；final Nginx 必须在 Gate 与 activation 后安装；回环 frontend 不代理 `/api`，回环 API 仅 HTTP；AI Channel 写入要求 Admin+CSRF，而随机 seed 密码没有安全 owner handoff。由此形成“需要 credential 才能过 Gate，但 Gate 前没有既定 HTTPS 写入路径”的闭环。
- P1 `PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE`：最终 metadata 与 status-only 日志成立，但审计包没有保存实际 creator/validator 源码、精确脱敏调用方式或源码 SHA-256，独立 reviewer 无法区分真实 CSPRNG/`O_EXCL`/`RENAME_NOREPLACE`/正确 fsync 顺序与仅输出相同状态的反例。
- 解除 P0 至少需要在维护窗口前定义、实现并验证 maintenance-compatible 的 credential-owner 路径，以及管理员初始凭据的安全 owner 生成或一次性交付方式；任何方案都必须保持 HTTPS、Admin、CSRF、replacement-only、服务端加密与不回显合同，并更新 runbook 后再做独立安全复核。
- 解除 P1 需要提供原执行使用的脱敏 creator/validator 源码与精确调用证据并记录 SHA-256；若原实现无法恢复，则需要另行授权通过受审查工具安全轮换/recreate，当前文件不得覆盖。
- 状态：I04-1 保持 `in_progress / blocked_high_risk_review`；parent I04 与总体任务保持 `in_progress`；External Services Gate、maintenance preflight、clean-init/cutover、activation、final Nginx、Observation 均为 `NOT_RUN`。本会话按 stop condition 停止，不进入 I04-2。

## 2026-09-27 I04-1R remediation

- child：`.trellis/tasks/09-27-frontend-i04-1r-bootstrap-provenance/`，负责恢复原 creator/validator/secret-scan execution provenance，并实现 `PRODUCTION_PREPARED` 下的 Production bootstrap CLI。
- provenance 已从原 Codex session JSONL 按三个 call ID 恢复，保留实际 tool-call input/output、源 session identity/SHA-256 和逐文件 SHA-256；本地真实 OSS 四项对六份 evidence 的 exact-value match=`0`，值未输出。该证据直接覆盖 CSPRNG、secret 长度、`O_EXCL|O_NOFOLLOW`、`RENAME_NOREPLACE`、file/directory fsync 与 cleanup/fail-closed 实现。
- AI bootstrap 采用 Hostdzire root/operator maintenance boundary，不再依赖被否决的公网 HTTPS UI/API 或 seed-admin password handoff。浏览器公共 HTTP API 的 Admin+CSRF 合同保持不变，但不适用于本地 root maintenance CLI；旧 review 给出的“HTTPS + admin handoff”只是一个可选解除方向，已由经架构复核的 CLI 方案取代。
- CLI 仍由 deploy state owner 在同一 maintenance lock 内证明 run/manifest/candidate/`PRODUCTION_PREPARED` 与实际 API 容器 identity；credential 由真实 TTY no-echo 输入，经 stdin pipe 到 backend，使用既有 schema、CredentialCipher、provider test 与 SUCCESS audit。backend 固定使用 T1 创建事务、T2 外部测试、T3 启用事务，不新增 HTTP endpoint、migration 或直接 SQL。
- I04-1R 代码、目标测试与 fresh critical review 尚未完成；两项原 blocker 仍保留到 review 明确关闭。External Services Gate 继续为 `NOT_RUN`，没有生成 release/manifest 或执行任何远端操作。

## I04-1R closure

- I04-1R 已恢复原 creator/validator/secret-scan 执行 provenance，并完成 Production bootstrap CLI、durable attempt、clean-init activation gate、严格 revision provenance 与 fresh row-lock/identity-map 并发修复。
- 最终验证：backend unit `28 passed`；真实 PostgreSQL integration `16 passed`；完整 deploy regression exit `0`；owned static/format/compile/syntax/diff checks 通过；最新 secret equality scan 2434 files、真实 OSS endpoint/AccessKey ID/secret match=`0`，值未输出。
- conclusive fresh critical review audit `20260927T141144Z-i04-1r-bootstrap-provenance-9918acde` 结论 `NO BLOCKER`。`AI_CREDENTIAL_BOOTSTRAP_PATH_UNREACHABLE` 与 `PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE` 均关闭。
- I04-1 完成；I04 推进为 `in_progress / configuration_ready`。真实 provider/OSS Gate、release、manifest、maintenance 与 cutover 均未执行，继续为 I04-2 范围。
