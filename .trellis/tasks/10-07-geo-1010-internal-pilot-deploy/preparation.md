# GEO-1010-DEPLOY 发布准备与待闭合输入

本记录是 2026-10-07 当前工作树的准备结果与后续操作清单，不是 release manifest、目标写入批准或部署成功记录。执行依据为本任务 [brief](./prd.md)、[父任务设计](../10-07-geo-1010-manual-pilot/design.md)、ADR-008 与现有核心/Production/恢复 runbook。

## 准备时的现状（历史基线）

- 分支 main；HEAD 和本地缓存 origin/main 均为 `bc68f087153009aae032e52415ee5c9274199581`。本会话未 fetch，不能据缓存相等证明远端最新。开始准备前有 79 个修改/未跟踪文件（含待删除文件），不是 clean 候选。
- GEO-1009 与 GEO-1010-UI 均 done；UI 已获人工接受。22 项接受源码身份和 9 项原始证据哈希全部匹配，含已删除 seed。接受对象仍是未提交工作树，HEAD 不包含 UI。
- GEO-1009 原门禁日志哈希匹配，但只证明 `e5949ab66989c1277424cfe9ab8b93e10ce10046`。新候选完整门禁尚未执行。
- `alembic heads` 返回唯一 `0066_geo_manual_evaluation`，只是当前源码的迁移 head，目标数据库 revision 未核验。
- producer/consumer 的 tracked-file 集合一致，精确 13 项；当前哈希见 [准备检查](./evidence/preparation-checks.json)，尚未绑定 release。
- 源码 Beat 注册 8 项：GEO 分析恢复/补投递、采集 lease 恢复/Run 补投递、generation 恢复/补投递、GEO retention 和 platform logo 清理。未注册 Plan CRON 或周期 Opportunity evaluator。实际三进程配置与运行注册表未核验。
- 本机 Docker client/server 为 29.6.1/29.5.2，Compose 为 5.3.1；只查询版本，未启动或接管部署资源。

原始基线见 [entry-state](./evidence/entry-state.json)。目标、固定候选、archive、正式镜像、manifest、现场 smoke、备份/恢复仍未取得；UAT 未开始。

## 必需输入与出处

所有当前未知字段在 [release-record](./evidence/release-record.yaml) 保持 null/NOT_VERIFIED。下列批准必须来自人工，记录引用不能代替批准。

| 输入 ID | 需要闭合的决定/材料 | 权威出处 | 当前阻断 |
|---|---|---|---|
| GIT | 允许按已核对归属提交 UI 实现、接受治理与本次部署准备；允许 push main 并 fetch；指定纳入/排除的其他未提交工作 | UI acceptance 的 DEPLOY 移交；ADR-008 §决策4；brief §范围内1 | 2026-10-07 当前会话用户已明确授权；提交/push/fetch与新候选门禁正在执行，完成后另记实证 |
| TARGET | 精确主机/访问与部署入口、内部环境标识、数据归属、OSS namespace、受控人群与访问控制；现有环境升级还是新空环境；运行 owner 和持久发布阶段的只读 inventory 范围 | brief §基本信息/待闭合；核心 Runbook §1/2；Production Runbook §1/2 | 尚无选定目标，不能默认使用公开 `geo.962850.xyz` 或自动选择某 VPS |
| IMAGES | backend/frontend 的真实 repository、registry/local 交付方式、构建平台与发布权限；不可覆盖 release ID/tag；已验证且可取得的 previous V2 reference/image ID/RepoDigest/验证记录 | producer 的必填参数与 inspect_image；Production Runbook §3；部署附录 §2 | 不能用本地 test 镜像或虚构 digest；local 模式仍要求非空 RepoDigest |
| RUNTIME | 已批准的受保护 runtime 文件引用/owner/0600；真实 AI/OSS 准备及 Gate 安排、内部 ADMIN/ENGINEER 交接、批准 smoke 数据 | brief §配置；production-configuration §2–5；核心 Runbook §1/3/4 | 不读取未知私有文件、不输出凭据；MANUAL 不豁免 activation 的全应用真实 AI/OSS Gate |
| STAGES | expand+deploy、enable 内部、受控访问、smoke 写入、静默备份/隔离恢复与停止恢复演练分别覆盖的批准；候选/目标/窗口/操作范围、操作者及业务/运维/停止恢复负责人 | 核心 Runbook §1/2/5/6；brief §执行门禁 | 会话启动授权不足以开始这些精确目标写入；Nginx write/reload 如适用分别批准 |
| RECOVERY | 旧 manifest/archive/镜像/schema/发布状态证据，成套备份位置与独立密钥保管/隔离 PG16 目标；initialized 后的新 release 恢复材料与批准准备；容量观察期、采样间隔与停止阈值 | 核心 Runbook §5/6；GEO-903 Runbook；部署附录 §9；brief §待闭合 | 不把 previous V2 因空环境改为 N/A；未准备新 release 时不能承诺 initialized 后即时重启恢复 |

现有 Production consumer 固定 project=`partsignal-staging`、data root=`/root/partsignal-data`、quarantine root=`/root/partsignal-data-quarantine` 和维护锁；公开 production 输入检查还固定站点 CORS 等边界。UAT namespace 指业务/对象隔离，不能自行改 Compose project/data root 或套用 test-only override。若用户选择另一主机/新空环境，先核对它能否沿现有 owner/runbook 执行；缺前置持久阶段或不同恢复路径时须明确批准并对齐权威 runbook，不能直接 clean-init/手工建状态。

## 分阶段操作清单

1. **提交候选输入。** 获得 GIT 决定后，以 entry-state 与 UI acceptance 核对各文件归属，检查实际 diff、秘密与待删除文件；只显式 stage 已批准内容，再 commit/push/fetch。选定完整 main SHA，在 clean、HEAD=origin/main 的源码 checkout 执行候选操作。任务证据写到源码 checkout 外；之后的治理提交不冒充候选。不得 stash、覆盖、清理 UI 或其他任务变更。
2. **固定候选门禁。** 在该 SHA 上运行 `UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend python .trellis/tasks/10-05-verify-entrypoint/run-verify.py`，它调用原始 `make verify`。先记录本地 Dev 服务和测试隔离资源，完成后恢复本次改变的资源状态；保存命令、SHA、起止时间、退出码、日志哈希、原 warnings/skips。本任务有明确完整门禁要求，不先把同一套定向检查全部跑一遍。源码输入变化后重新选定候选，不能拼接旧 SHA 的通过。
3. **冻结工件。** 按部署附录 §2 在仓库外排他生成确定性 `git archive --format=tar.gz <SHA>`；用批准 repository/不可覆盖 tag 构建、交付并核验正式 image ID/RepoDigest。API/Worker/Scheduler 共用 backend 身份；migration 首次可与 backend 相同，恢复时必须保留原迁移镜像。producer 冻结 backend/migration/frontend/rollback_frontend 四角色、完整迁移运行时、唯一 schema 与 13 项 hashes。使用现有 producer，不手写 manifest、不设测试逃生变量；本次没有生成 archive/manifest 或占用 release ID/tag。
4. **目标只读与准备。** 在获批入口核验 runtime owner、project/network labels、容器/image/挂载/数据目录、持久阶段、DB revision、受控入口和恢复材料。先完成真实输入检查、manifest consumer 和 image identity；one-off preflight 容器也须在操作范围内。备份/静默和 maintenance 适用性按目标实际情况执行；任何漂移停止。
5. **expand+deploy。** 同时具备两个阶段批准后，仅经 `PARTSIGNAL_DEPLOY_MODE=upgrade deploy/scripts/deploy.sh` 前滚和部署。按核心runbook，总开关和评估资格在本阶段保持false，API/Browser false、retention dry-run true、concurrency=1。现有环境路径为upgrade；空环境路径尚未获批。检查唯一head、`preflight-integrity --require-schema`、账号初始化和API/frontend readiness，保持prepared，Worker/Scheduler未激活。健康脚本只证明live/ready，不能作为MANUAL smoke。
6. **enable 内部。** 单独批准覆盖保护配置切换和 prepared 下同候选再次 deploy。API/Worker/Scheduler 共享配置：总开关 true、API/Browser false、管理员显式评估 true、retention dry-run true、concurrency=1；保留默认恢复参数与既有清理，不自行配置删除期限。真实 AI/OSS Gate 和配置证明通过后才经 `activate-production.sh` 激活 Worker/Scheduler。核对三进程实际值、8 项注册任务、恢复扫描、Browser 服务/profile/overlay/全部 PG session 行数和材料库存；没有现场负证据不填 N/A。
7. **目标 MANUAL smoke。** 使用批准内部数据和账号，从页面完成登录、产品/批准事实、监测对象、问题、MANUAL Profile/Plan/Batch/Run、保存草稿、真实截图上传、提交回答、Worker 分析与必要复核、Overview/Insights/Reports；验证 ADMIN 显式评估及 Content Task Action/Retest 入口。每项绑定 environment/release/commit/UTC/操作者及稳定 ID/低敏结果。无 opportunity 时保留可解释回执，不能造状态来验入口。该阶段不是 UAT 的真实样本/性能/Go-No-Go。
8. **备份、停止、恢复。** 按 GEO-903 的同一静默窗口成套备份 PG/对象/配套密钥/runtime/manifest/适用 Nginx，要求 complete=true、异地摘要与隔离 restore complete=true/无对账差异。按核心 §5 先阻写/停 Beat、核对在途与 SENT/UNKNOWN，再有界 warm stop Worker；不重置 PG 或 broker。未 initialized 可在批准后同候选 deploy→activate；initialized 后必须新不可变 release/manifest/镜像身份和阶段批准，再完整 upgrade→activate。frontend-only rollback 只在 initialized 且局部 artifact 问题、previous V2 兼容时可用；升级 artifact 失败走 failure/attempt/runtime 绑定的 recover-upgrade；跨 schema/缺证明保持维护，不 downgrade。
9. **独立验收。** 核对 brief 六项独立验收、现场证据与失败/未知；满足后 DEPLOY 才 review。后续明确人工接受才 done；不启动 UAT、不代签内部 Go/No-Go，父任务保持独立集成与人工接受义务。

## 当前覆盖边界

源码与旧接受身份、迁移 head、发布身份合同、配置键和 Scheduler 注册、恢复状态路径已核对。新 SHA 完整门禁、正式工件、真实配置、精确目标、全部现场行为和恢复能力均未验证；生产没有 Go。代码缺陷应另立任务，不混入本 DEPLOY 范围。本准备未修改应用/合同/部署执行器或历史接受证据。

## Git 授权后续记录

2026-10-07T17:19:07.470277+00:00 当前会话用户明确授权将已接受 UI、接受治理与本 DEPLOY 准备按归属提交到 main，随后 push、fetch 并固定新候选。GIT 输入已闭合；提交结果、候选 SHA 与门禁结果以执行后证据为准。第 2、3 项尚未提供实际目标或材料引用，TARGET/IMAGES/RUNTIME/STAGES/RECOVERY 仍未闭合。此前快照与检查中的未执行状态保留其原始时间，不冒充当前执行结果。
