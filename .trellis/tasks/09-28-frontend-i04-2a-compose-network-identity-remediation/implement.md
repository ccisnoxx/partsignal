# I04-2A 执行记录

## 恢复与前置核对

- 已读取 I04-2、I04、I04-1、I04-1R、总体任务的 PRD/design/implement/task（存在项），以及用户列出的 Compose、脚本、runbook、Makefile 与 frontend/AGENTS.md；使用 Trellis continue/before-dev、clean-code-design、personal-vps-ssh，后续两次 fresh critical review 使用 multi-agent-orchestration。
- fetch 后 candidate HEAD/local main/origin/main 均为 `8651ca1ef4620285301ae3c5e9b474bbe6014ff2`；tree `f5fbb3630bc5f6e3c83551c361e587abba979ae3`，两树 clean。可见同仓库其他会话 idle，未观察到其他写入。
- 父 I04-2 为 in_progress，最新阶段 `BLOCKED_PRE_CUTOVER_COMPOSE_NETWORK_IDENTITY`；I04 和总体任务为 in_progress。历史 meta 的 Repository Gate=MET 属于旧输入，不代表本修复候选。
- 本地 Engine context=colima，Docker `29.5.2`、Compose `5.3.1`；已有 dev postgres/redis 是前置基础设施，须保留。三个 Production 测试 network/project 预先 absent。
- Hostdzire read-only log：`/Users/sc/.codex/audits/i04-2a-20260928/hostdzire-readonly.log`，exit=0，1607 bytes，SHA-256=`08c7fd7ddeb0ab42ba5645f2ecc045681104d9d747a1becb84f4a35148e9d70d`。三个 physical/logical label 均仍为 staging identity，internal=true。
- 旧 archive SHA-256=`d51eb7ad0b703931a417f8233444a0d2ceafa39055656a5f46c95c6277dce250`；manifest SHA-256=`d9fc3543d2dd73523c0b436d956e22a3f94e61bae19b005aeb2fbecbe55e1ad9`；旧 release checkout clean at `649641ce`，八个 tracked file 和 backend/frontend/rollback image IDs 均未变化。
- 七个旧容器仍 running/restart=0/OOM=false，one-off=0；current、Nginx target/checksum 和 Production env hash 未变；public root=200，quarantine/cutover state absent。所有远端命令只读。

## 当前阶段

回归建立中。尚未修复 Compose、冻结新 release、生成新 manifest、进入 maintenance/quarantine/clean-init/activation/observation；External Services Gate=NOT_RUN。旧 AI metadata/credential owner handoff blocker 留给下一会话。

后续逐项追加失败回归、修复、定向门禁、review、Git identity、唯一 make verify 和资源清理实际证据。完整日志与 result JSON 固定于 `/Users/sc/.codex/audits/i04-2a-20260928/`。

## 失败回归、最小修复与定向验证

旧 Production Compose 尚未修改时，静态断言 exit=1；真实 Engine exit=1，在创建 API 容器前精确报 egress label=`partsignal-staging-egress` / expected=`partsignal-egress`。两次失败日志保存，owned network/container 均清理。

最小修复只更名 Production logical key 和引用，physical name/project/internal/ports/mount/profile 未改变；dev/staging Compose、deploy/activate/rollback、manifest producer/consumer、应用/migration/env 均 byte-identical。新增静态 3 network/7 service 断言、真实 Engine 7 positive/3 negative 与 network ID 不变断言；三条脚本 local 路径 8 个 run/up、manifest-before-first-operation 和共同 Compose owner 回归通过。Runbook 的直接 probe 先验证同一 manifest tracked-file/image identity，再使用 `--pull never --no-deps`；固定 ownership 和旧冻结证据不复用规则已写入。

定向完整 Production harness 包含真实 Engine/全部旧用例，exit=0；cleanup/staging/Nginx/Compose/syntax/diff/高信号 secret scan 通过。资源快照 controlled container/network/port/database/Redis/temp 全零，已有 dev PostgreSQL/Redis 保留。Secret scan 不读取 Production env 内容，只扫描仓库高信号模式；真实栈原生 post-run secret scanner 将随唯一 make verify 验证测试凭据/产物。

| 日志（固定 evidence root） | exit | bytes | SHA-256 |
| --- | ---: | ---: | --- |
| fixed-engine | 0 | 657 | `cb8446206a7ac01a5653c7060feec8a54dc54c3a1dfdb011c4032f37a3575cf6` |
| fixed-static | 0 | 146 | `a41d874eb66d8b14ba0694ca839ebc39b26f320e80354cd96219a4d853108abb` |
| hostdzire-readonly | 0 | 1607 | `08c7fd7ddeb0ab42ba5645f2ecc045681104d9d747a1becb84f4a35148e9d70d` |
| old-engine | 1 | 351 | `94fb502a82fde6d25eb28b4caae61fa04e453943d83cce7ab59a0b85fa977612` |
| old-static | 1 | 168 | `3ca6802833ce544d2db19c01560ba3cc661f04111a4b44fa77527e49ed0169ec` |
| targeted-cleanup | 0 | 79 | `22d94cd0bddc580d9aa2112e89f28b8b3c40b2af6ef89b69e5dde64422fdd48b` |
| targeted-compose | 0 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| targeted-diff | 0 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| targeted-nginx | 0 | 79 | `17f63aff5334365b1891fde48a58f034158e44fbcd8f03382cd5ce49b589f99c` |
| targeted-production | 0 | 911 | `4eca7e688c7840c2a8a2e536a52fb3c25b45b9509ed5669cf29c6d4cf9f36a6a` |
| targeted-resources | 0 | 229 | `d39293836a52589e43625eb546a2298f26597aecad9cfd52aa765c92e60180b2` |
| targeted-secret | 0 | 47 | `8fb2adaf5aa797af24a56b9561e2529f879aa0afb35010d463f81608706cd344` |
| targeted-staging | 0 | 152 | `fd574621f03c8142222f748dfdb6f828574f70f8b1956da2a2726498e3cf9c51` |
| targeted-syntax | 0 | 35 | `db11cb54c373b641eb026f613b62520bb8af95ed783cccf029cf70c99f74da47` |

计数：静态 3 networks/7 services；Engine 7 positive/3 negative；deploy/activate/rollback 3 paths/8 local operations；syntax 17 shell/5 Python；secret 2446 files/0 findings。现有 shell suite 没有全集用例计数接口，不虚构总数。

## 第一次候选冻结

代码/deploy/runbook/spec 已冻结，待 fresh independent critical review；复核期间不修改候选。NO BLOCKER 后才提交、fast-forward/non-force push，并在最终 clean main 运行唯一一次 make verify。

## 第一次 fresh high-risk review

NO BLOCKER，reviewer=`/root/i04_2a_implementation_review`，audit=`20260928T035743Z-i04-2a-compose-network-identity-cec3f231/01-implementation-critical-review`；实际 diff 与29686-byte冻结证据 SHA-256=`70fb66f9202c44e4c1361c9cf4821513d0f65623548df0469aab16365b40b17c`一致，2446份文件摘要匹配。复核核对network identity/topology、真实Engine正负向、cleanup、deploy/activate/rollback、manifest-bound preflight和全部定向日志。未执行测试、文件/Git或远端写入。

覆盖缺口：完整Repository Gate未运行；本地shell probe只证明network ownership，不代表应用启动或远端修复后的Engine版本兼容性；Engine signal/daemon中断未做故障注入，finally/owner限制已审查且无确认blocker。真实AI/OSS/metadata/TTY owner仍留给后续。首次结论只允许本地Git收口和新的完整门禁，不允许发布。

## Git 收口

修复 commit=`b28d72f790bac891f3abf87cff95011923745062`，tree=`73ea23d7681d5ec31d65d151311708ce9b48aa6e`；已 main fast-forward/non-force push。首次自动收口脚本在最后 clean 断言 exit=1：Trellis create 同时 seed 的 implement/check.jsonl 未包含在显式 add 清单；提交与推送本身成功。已把两份索引补为真实 infra spec 引用并作 Trellis-only 收口，未修改已审查的 exported source；make verify 尚未开始。原始 git-closure.log 2700 bytes，SHA-256=`29e7b7235eb33496c12c3d4d4150a68ab3a712c7897387e56580cf3d43d76889`，保留真实 exit=1，不改写为成功。
