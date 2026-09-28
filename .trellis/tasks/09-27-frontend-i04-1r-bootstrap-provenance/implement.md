# I04-1R 执行记录

## Baseline

- parent I04-1：`in_progress / blocked_high_risk_review`。
- blockers：`AI_CREDENTIAL_BOOTSTRAP_PATH_UNREACHABLE`、`PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE`。
- local main/origin/candidate baseline：`d20ecffa10da797de36d7be15cdc2b0c8eb20122`；candidate worktree clean，main 含上一轮 `.env.example` 与 I04/I04-1 Trellis 未提交变更。
- External Services Gate=`NOT_RUN`；本任务不进入 I04-2。

## Plan

1. 从原 Codex JSONL 恢复 creator/validator/final secret-scan tool-call input/output，固定 provenance 与 SHA-256。
2. read-only architecture analysis：确认 deploy phase owner、backend service/schema/audit reuse、一次性失败语义和最小文件所有权。
3. 创建并验证 host-side + backend Production bootstrap CLI、目标测试和 runbook/self-test。
4. 主代理检查实际 diff、secret boundary 与集成验证。
5. fresh critical review；只有 `NO BLOCKER` 才关闭 parent blockers。

## Architecture freeze

- 只读 architecture stage 已完成，结论为 deploy state owner 内新增 `bootstrap-ai` 子命令，并由 backend maintenance command 编排 T1 创建事务 / T2 外部测试 / T3 启用事务。
- host 在全程 maintenance lock 下验证 run/candidate/manifest/phase 和实际 API 容器 image identity；backend 不接收 phase 自报。
- host state 记录单次、无 secret 的 `ai_bootstrap_attempt`，`STARTED/FAILED` 阻断 activation 和重复 bootstrap；无 force-clear。
- actor 固定为已初始化且状态安全的 `admin`，只用于业务审计归属；不读取密码，不表示浏览器认证。
- 第一版不支持自定义 Header；secret 经 TTY、内核 pipe、Docker exec 与 provider buffer，除批准密文外不持久化、不进入可观察接口。
- 不新增 migration、HTTP endpoint、临时公网入口、独立 host script、Compose/OpenAPI 合同。
- architecture execution audit：`20260927T141144Z-i04-1r-bootstrap-provenance-9918acde/01-architecture-analysis.*`，validated/accepted，worker 无写入。

## Implementation candidate

- host owner：`deploy/scripts/prepare-production-data.py bootstrap-ai`，在同一 maintenance lock 内校验 run/manifest/candidate/`PRODUCTION_PREPARED` 与实际 API 容器 identity，并拥有 no-echo TTY、stdin pipe 和 durable attempt。
- backend owner：`python -m app.cli bootstrap-production-ai`，只接受最大 64 KiB、严格键集、拒绝重复键和 trailing bytes 的 stdin JSON；输入/配置拒绝投影为 `REJECTED`，无法证明事务结局的 generic exception 投影为 `UNKNOWN`，只有完整 provider test failure 结果为 `FAILED`。
- service owner：既有 channel/model create 与 enable 拆出无 commit transaction participants，原 HTTP wrappers 仍各自 commit；bootstrap 按 T1 create+2 audit / T2 at-most-once provider test / T3 enable+2 audit 执行。
- attempt：backend 启动前原子记录 `STARTED`；完整成功为 `SUCCEEDED`，明确失败为 `FAILED`，输出缺失/损坏或 JSON status 与 exit code 矛盾时保持 `STARTED`。任意已有 attempt 拒绝重入，`verify-prepared`/activation 拒绝 `STARTED|FAILED`。
- credential：仅真实 stdin/stderr TTY 经 `getpass` 读取，通过 `docker exec -i`、`shell=False` stdin pipe 传递；不读取 `.Config.Env`，backend stderr 丢弃，第一版不支持自定义 Header。
- 未增加 migration、ORM schema、OpenAPI、Compose、HTTP endpoint、直接 SQL、临时公网入口或独立 host script。

## Validation

- backend unit：修复后由主代理重跑 `uv run --project backend pytest backend/tests/unit/test_cli.py backend/tests/unit/test_ai_boundaries.py -q` → `28 passed`；包含 duplicate JSON key、合法 envelope 在非 Production 拒绝、generic exception=`UNKNOWN` 且不泄漏异常/credential。
- backend static：owned Python files `ruff check` 与 `ruff format --check` 通过。
- host syntax：`sh -n deploy/scripts/test-deploy-production.sh`、`python3 -m py_compile deploy/scripts/prepare-production-data.py` 通过。
- deploy regression：修复后由主代理重跑 `./deploy/scripts/test-deploy-production.sh` exit `0`；除既有 container metadata、stdin/no-shell/no-stderr、attempt/reentry/activation gate 外，新增真实 subprocess parser/main、三个候选身份变量、maintenance lock、wrong run、非绝对 manifest、candidate/phase mismatch、lock contention、backend 期间锁持有、真实 PTY no-echo 与 SIGINT 后 ECHO 恢复，以及 commit 后输出丢失保持 `STARTED`。
- real PostgreSQL：主代理通过仓库 `backend-test` Compose owner 运行 `pytest tests/integration/test_ai_channel_management.py -q` → `13 passed`；覆盖 T1/T3 原子性、四条同 request ID SUCCESS audit、provider failure at-most-once、并发 bootstrap、部分配置拒绝与原 HTTP 回归。
- `git diff --check` 通过。
- post-implementation exact-value secret scan：对 Git tracked/untracked（按 ignore 排除）`2,429` 个普通文件扫描本地真实 OSS endpoint、AccessKey ID/secret，match=`0`；bucket 因与既有测试常量碰撞而按上一轮相同规则排除，值未输出。
- 未运行完整 `make verify`：本次变更的权威目标为 backend AI/CLI 与 Production deploy harness；完整候选 Repository Release Gate 留给 I04-1 完成后的最终 clean main，不复用当前 dirty worktree 冒充 release candidate。
- External Services Gate、真实 provider、Hostdzire bootstrap、release/manifest/maintenance/cutover 均未执行，继续为 `NOT_RUN`。

## First high-risk review and remediation

- 首轮 fresh critical review audit：`20260927T141144Z-i04-1r-bootstrap-provenance-9918acde/03-critical-review.*`，结论为 `BLOCKER`。
- provenance 证据已被独立确认充分，`PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE` 可以关闭。
- P0：权威 runbook 的 bootstrap invocation 未显式提供 `PARTSIGNAL_VERSION`、`PARTSIGNAL_BACKEND_IMAGE`、`PARTSIGNAL_FRONTEND_IMAGE`，而 candidate owner 必须读取并与 manifest 精确核对；严格照原命令执行会在读取 credential 前失败。
- P1：原 deploy regression 直接调用 Python 函数并 monkeypatch 核心 owner，未证明 parser/main、同一 maintenance lock、错误 run/manifest/candidate/phase 的 early rejection、锁竞争和真实 PTY SIGINT/echo 恢复。
- 主代理补充发现：backend generic exception 可能发生在 T1/T3 已提交或结果输出丢失之后；若投影为明确 `FAILED`，host 会错误终结 durable attempt。不能证明数据库结局时必须视为 unknown 并保留 `STARTED`。
- runbook/design 已补充三个非 secret 候选身份变量；代码与回归修复由独立 remediation worker 负责。完成目标复验后必须再安排一个全新的 `critical_reviewer`；在 `NO BLOCKER` 前本 child 保持 `in_progress`。

修复后主代理验证：owned Python `ruff check` 与 `ruff format --check` 通过；Python compile、shell syntax、`git diff --check` 通过；真实 PostgreSQL `backend-test` Compose owner 执行完整 `tests/integration/test_ai_channel_management.py` → `13 passed`。remediation audit 为 `20260927T141144Z-i04-1r-bootstrap-provenance-9918acde/04-remediation.*`。未执行真实 provider、远端 bootstrap 或 External Services Gate。

## Second high-risk review and remediation

- 第二次 fresh critical review：同一 audit bundle 的 `05-final-critical-review.*`，结论为 `BLOCKER`。
- P0：clean-init 的 activation safety helper 仍把“没有 `ai_bootstrap_attempt`”视为安全，导致从未执行 bootstrap 的 `PRODUCTION_PREPARED` state 可以通过 `verify-prepared`/`mark-initialized`。修复方向固定为 clean-init 必须存在且精确为 `SUCCEEDED`；upgrade 有独立 phase/命令路径，不受该约束。
- P1：design 误称 `PARTSIGNAL_BACKEND_IMAGE`/`PARTSIGNAL_FRONTEND_IMAGE` 直接等于 manifest 完整 reference；实现实际要求不带 tag 的 repository，再与 `PARTSIGNAL_VERSION` 拼成 reference。design 与 runbook 已统一为 repository 语义。
- 第二轮代码 remediation 只拥有 `prepare-production-data.py` 与 deploy regression；完成后必须再次实际跑门禁和全新独立复核，在 `NO BLOCKER` 前保持 `in_progress`。

第二轮 remediation 已完成：activation helper 只接受结构合法且 `status=SUCCEEDED` 的 attempt；缺少/畸形/`UNKNOWN|STARTED|FAILED` 均拒绝。真实 deploy regression 证明无 attempt 的 clean-init activation 在 Compose/up 前停止且 phase 保持 `PRODUCTION_PREPARED`，`SUCCEEDED` 后正常推进；显式移除 attempt 后，独立 upgrade deploy/activation 路径仍成功。主代理重跑 Python compile、ruff/format、shell syntax、`git diff --check` 与完整 deploy regression 均通过。remediation audit 为 `20260927T141144Z-i04-1r-bootstrap-provenance-9918acde/06-remediation-2.*`；现进入第三次、全新的独立 critical rereview。

第三次 fresh critical review（`07-final-critical-rereview.*`）发现一个 P1 blocker：`_attempt_status` 把 attempt 键缺失与显式 `null` 同时解释为首次未尝试，导致 activation 虽拒绝 `null`，bootstrap reentry 却可能覆盖它并进入 credential/backend。第三轮 remediation 固定为“只有键完全不存在才允许首次 bootstrap；键存在即严格验证，任何畸形值在容器/credential/backend 前 fail closed，状态保持不变”。

第三轮 remediation（`08-remediation-3.*`）已完成并由主代理重跑完整 deploy regression：`_attempt_status` 仅在键完全不存在时返回 `None`；显式 `null`、非对象、字段缺失/多余、非法 request ID 与非法/非字符串 status 均明确失败。真实 CLI 回归逐项确认零 Docker/credential/backend I/O 且状态文件 byte-identical；合法 `STARTED|FAILED|SUCCEEDED` 均拒绝 reentry，无键首次路径仍可执行。现进入全新的 closure critical review（`09-closure-critical-review.*`）。

closure review 发现新的并发 P1 blocker：T2 对冻结 revision 成功后，在 bootstrap reload/T3 前，另一合法事务可更新并重新测试 model；现有实现会把后来产生的 `PASSED` revision 重新冻结并启用。第四轮 remediation 必须把 T2 结果严格绑定到 `channel_revision == frozen_channel_revision` 与 `model_revision == frozen_model_revision + 1`，T3 只能使用这一预期 revision；任何漂移作为冲突进入 CLI `UNKNOWN`/host `STARTED`，不得生成 enable audits。新增真实 PostgreSQL update+retest 交错回归后再复核。

第四轮 remediation（`10-remediation-4.*`）已完成：T2 后先验证 channel revision 未变且 model revision 恰为 `frozen + 1`，再解释 `FAILED|PASSED`；T3 CAS 固定使用 `frozen + 1`。真实 PostgreSQL 交错测试通过：独立 session 在 T2 后 update+retest 到更高 `PASSED` revision 时 bootstrap 返回 `REVISION_CONFLICT`，两者保持 disabled，仅保留 create audits。主代理重跑 backend unit `28 passed`、完整 PostgreSQL integration `14 passed`、ruff/format 与 `git diff --check` 通过；现进入 `11-ultimate-critical-review.*`。

ultimate review 继续发现 identity-map/锁窗口 blocker：普通 provenance reload 校验完成后到 T3 `FOR UPDATE` 前仍有并发窗口，且 `expire_on_commit=False`、lock query 未强制 refresh 时可复用 stale ORM 属性。第五轮 remediation 必须在 T2 后直接 expire 并以固定 channel→model 顺序取得 fresh row locks，在持锁事务内完成 revision/status 解释、T3 enable/audits/commit；新增 post-provenance/pre-lock 的真实 PostgreSQL 交错测试。

第五轮 remediation（`12-remediation-5.*`）已完成：唯一 fresh-lock owner 以 channel→model 顺序 `FOR UPDATE` 并使用 `populate_existing=True` 覆盖 identity map；provenance 校验、FAILED/PASSED 解释与 T3 commit 处于同一持锁事务窗口。新增真实 PostgreSQL stale-snapshot 交错与 lock-held blocking 测试，保留 r+3/PASSED drift；主代理重跑 unit `28 passed`、完整 PostgreSQL integration `16 passed`、ruff/format/diff-check 通过。现进入 `13-conclusive-critical-review.*`。

## Completion

- conclusive fresh critical review `13-conclusive-critical-review.*`：`NO BLOCKER`。
- 两项原 blocker 均关闭：`PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE` 由原 session/evidence 身份证明解除；`AI_CREDENTIAL_BOOTSTRAP_PATH_UNREACHABLE` 由 `PRODUCTION_PREPARED` root/operator bootstrap CLI、安全 attempt/activation gate 与完整事务/并发边界解除。
- 最终本地证据：backend unit `28 passed`；真实 PostgreSQL integration `16 passed`；完整 Production deploy regression exit `0`；owned ruff/format、Python compile、shell syntax、`git diff --check` 通过；secret equality scan `2434` files、真实 OSS endpoint/AccessKey ID/secret match=`0`，值未输出。
- 未执行真实 provider、Hostdzire bootstrap、External Services Gate、release/manifest、maintenance/cutover；这些继续为 `NOT_RUN`，不是 I04-1R 已完成的声明范围。

## Evidence recovery

- source session ID：`01a0e19e-6636-75c2-a8a8-2703a2afe050`。
- source JSONL：Codex 2026-09-27 01:28:01 segment；`2245181` bytes；SHA-256 `7365a78ee15d1b9f10b3df28ec0837b6d291e6f7041e202292a9146bf33a5362`。
- creator call ID：`call_zbndroBvKc7Nu030G3L71zAd`。
- validator call ID：`call_BCV2dZYFx9rrvmh2WleUA4AL`。
- final secret-scan call ID：`call_bHa5AZbOEwy2SmwILop69RNH`。
- equality scan 对本地真实 `OSS_ENDPOINT`、bucket、AccessKey ID/secret 的证据内容匹配数=`0`；值未输出。
- 规范化文件 SHA-256：
  - creator input `ed72fb965202a8b691d5e869eed0d3f3663a2fc142af1aaa823f48df1a1112c0`
  - creator output `fbb22c1c6fa0067c888c6d0da8632205392dd381270a5694b9d7e4b81d22a577`
  - validator input `4ea46576db1a4e78106459f3be096a303ddaf9c54c65bd5a49c480b11bc0359f`
  - validator output `6ece4e1d97e393eb58cd427b2f682671aef73cde238ccaee51159dffe51cdcf2`
  - secret-scan input `626412ae39863f0907188c52412c3f54d99ccb11b5307c5f1ee580bf4e6fc486`
  - secret-scan output `f99d9b354f39b4290eab4a0625cd51a0bcd24b9e69c9d46317eb9394a450c153`
- recovered creator 可直接核对 `secrets.token_urlsafe`/`secrets.token_bytes(32)`、同目录 `O_EXCL|O_NOFOLLOW` 临时文件、`0600`/root ownership、file fsync、`renameat2(RENAME_NOREPLACE)`、directory fsync、竞态与 cleanup；validator/scan 的范围同样保留实际代码，不以状态日志替代实现证据。
- 本轮未重新创建、覆盖、轮换或读取远端 Production env 值；provenance 恢复为纯本地只读 session extraction。
