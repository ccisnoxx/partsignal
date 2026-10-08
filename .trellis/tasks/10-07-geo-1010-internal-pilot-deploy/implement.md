# GEO-1010-DEPLOY 实施记录

2026-10-07 已按新会话启动授权开展发布准备；候选冻结与目标写入因必需输入/授权缺失停止。任务已实际开始准备，尚未部署，未达到 review。

## 启动检查

- 执行：本 DEPLOY Codex 会话；准备前工作树快照时间 `2026-10-07T17:01:57.918219Z`（America/Los_Angeles 10:01:57 PDT）。人工部署操作者/责任人尚未指定。
- 使用 `task.py start` 关联本会话；CLI 仅转换 planning，不自动转换 ready，状态按实际准备开始另行维护。
- main HEAD=`bc68f087153009aae032e52415ee5c9274199581`，缓存 origin/main 相同；工作树 dirty，79 项修改/未跟踪文件。未 fetch、commit、push；该 HEAD 不包含 UI，不是发布候选。
- GEO-1009/UI 均 done；UI 人工接受及 22 项源码/9 项证据身份匹配。旧 GEO-1009 门禁日志哈希匹配，只证明旧 SHA。
- 精确目标、阶段批准、镜像 repository、previous V2、runtime、smoke 数据和操作者/恢复负责人未闭合；来源与具体要求见 [发布准备](./preparation.md)。

## 实际实施与变更

完成 producer/consumer、13 项 tracked-file allowlist、Production Compose/shared Settings、8 项 Beat 注册、schema 源码 head、部署持久阶段与停止/恢复路径核对。建立可审阅 [操作与输入清单](./preparation.md)、[低敏现场记录](./evidence/release-record.yaml) 和可重复准备检查。现场未知保持 null/NOT_VERIFIED；没有伪造 release、manifest、image digest、批准或目标事实。

更新父任务/当前导航和当前 runbook 的候选归属说明；不改历史 ADR/接受记录，不修改应用代码、OpenAPI、数据库或发布执行器。已接受 UI 及其他工作树变更保留。

## 实际验证与证据

| 检查 | 实际结果 | 证据/边界 |
|---|---|---|
| 工作树准备基线 | main/dirty/缓存 origin；79 个文件身份 | [entry-state.json](./evidence/entry-state.json)，不是 candidate |
| 接受身份、依赖、allowlist、Beat | 22 源码＋9 证据均匹配；旧 gate log hash 匹配；13 文件与 8 任务一致 | `backend/.venv/bin/python .../evidence/check-preparation.py` exit 0；[preparation-checks.json](./evidence/preparation-checks.json) |
| 迁移 head | `0066_geo_manual_evaluation (head)`，exit 0 | `backend/.venv/bin/alembic -c backend/alembic.ini heads`；未连接/迁移目标 DB |
| 本机工具 | Docker client/server 29.6.1/29.5.2，Compose 5.3.1，exit 0 | 只查版本，不证明目标能力/健康 |
| Nginx/source 安全检查 | `node deploy/scripts/check-nginx-security.mjs` exit 0 | 当前工作树离线检查，不是 candidate 全门禁或目标 Nginx 验收 |

第一次临时准备检查使用系统python3，在YAML导入处因 `ModuleNotFoundError: yaml` 退出1；entry-state已保存，其余结果未生成。已确认项目venv安装YAML/Alembic/SQLAlchemy，改用该运行时完成正式检查，没有安装依赖或覆盖entry-state。准备脚本首次Ruff检查发现两项B905和一项UP017，已显式严格zip并使用UTC别名，修正后Ruff与准备检查通过。文档/hash、状态/链接、diff与无关文件保全的最终检查见 [validation.json](./evidence/validation.json)。

完整 `run-verify.py/make verify` **NOT_RUN**：缺包含 UI 的 clean pushed main SHA。未提前重复 UI 验证或旧 SHA 门禁。archive/images/manifest、实际配置、readiness/MANUAL smoke、备份/停止/恢复和观察期 **NOT_VERIFIED**；未执行 SSH、配置/镜像上传、容器启动、Nginx/数据库写入或 UAT。

## 缺口与剩余义务

准备时 GIT/TARGET/IMAGES/RUNTIME/STAGES/RECOVERY 六组输入待闭合，详细出处与可执行顺序见 preparation.md。未获 Git 发布授权、精确目标与恢复输入时不能推进冻结/部署；按 ADR-008 保持 blocked，父任务仍 in_progress，UAT planned/未开始。若选择空环境，不能自行把 previous V2 或持久状态要求改为 N/A，也不能套测试绕过。业务代码缺陷另立任务。

## 工作验收与人工接受

DEPLOY 六项验收尚未完成；没有 DEPLOY review、人工接受、内部 Go/No-Go 或生产 Go。准备检查通过只关闭本地准备核对，不代替候选或现场验收。后续实施完成先 review，明确人工接受后才 done；父任务须另行集成与接受。

## Git 授权后的候选工作

2026-10-07T17:19:07.470277+00:00 用户明确授权提交已接受 UI、接受治理及本次 DEPLOY 准备到 main，并 push/fetch、固定新候选。开始按 UI 与 DEPLOY 归属提交；尚未填写未执行的 SHA 或门禁通过。GIT 已闭合，其余五组输入没有实际值或记录引用，目标写入继续等待。

## 已执行 Git 与第一次候选门禁

UI 实现/接受证据提交 `ce65c6fa`，接受治理/DEPLOY准备提交 `1ed8c4af`；push origin main、fetch origin均exit0。候选固定为 `1ed8c4af1d62fb6d86b4401d0703a90bf629a839`，固定时main clean、HEAD=origin/main。原始日志/diff保留原 whitespace，以免改写接受证据；staged check除原始`.log`/`.diff`后exit0，其余准备staged check全量exit0。

完整原始wrapper于2026-10-07T17:21:38.090873Z–17:50:13.773705Z执行，exit2，工作树仍clean/同SHA。静态/类型、3870 backend unit、1347 frontend unit（142files）、1253 PG integration（45warnings）、6隔离恢复、1性能（100000回答fixture）、32canonical真实页面E2E/secret_scan=0通过；GEO模式工厂因评估开关true拒绝后readiness失败。fixture/部署脚本/最终Compose尚未运行，不能以部分通过冻结release。

已保存仓库外确定性source archive及13项tracked hashes；仍没有正式镜像/manifest。失败与工件身份见[candidate-attempt-1.json](./evidence/candidate-attempt-1.json)。测试入口缺陷单独记录在[geo-e2e-evaluation-phase-isolation](../10-07-geo-e2e-evaluation-phase-isolation/prd.md)，仅修正模式配置，原UI接受身份与失败证据保留。修正后须提交/push/fetch固定新候选并运行完整门禁。目标五组实际输入仍未取得，未部署或UAT。

## 修正后源码候选通过（当前结果）

修复提交/push/fetch后，固定main `76d1d523b87816ba2ce52a2fc6a679144b5dab06`；固定时与门禁结束时均clean、HEAD=origin/main。原始wrapper于2026-10-07T17:56:34.595156Z–18:34:07.274518Z运行完整make verify，exit0（2252.679362秒）。[源码候选验证记录](./evidence/candidate-source-verification.json)包含命令、SHA、日志哈希、archive/hash、clean checkout与资源状态；原失败记录保留。

3870 backend unit、1347 frontend unit（142files）、1253 PG integration（45原warnings）、6隔离恢复、1性能、32canonical真实页面E2E、3GEO模式通过（3原skip）、498fixture通过（74原skip）；部署脚本与最终Dev/Prod Compose检查通过，全部E2E secret_scan=0。成功证据只绑定该SHA，不冒充后续治理提交。

archive SHA256=`041b715e59e4201dfed4e067ede16877ae8b91e27369404d85ac3fc59f11969e`；唯一源码schema head=0066，13项tracked hashes已绑定。仓库外独立clean main checkout为 `/Users/sc/.codex/reviews/partsignal/geo1010-candidate-gate-20261007T175603Z-cp9lgugz/source-checkout`，保留固定时的origin/main快照，供后续producer使用；发生fetch/源码漂移须重新核对身份。正式repository、previous V2等未取得，未创建正式镜像/manifest，candidate_frozen仍false。

原3个Dev容器均按相同ID恢复exited，没有残留临时容器；Redis DB13最终0，DB14仍6，DB15在两次既有integration后75→79→83，保留且未删除未知键，不声称其未变化。E2E随机DB/storage/端口由原runner精确清理。原UI接受9项证据仍保留；22源码身份中仅测试runner由独立缺陷修复改变，不改写旧接受记录或哈希。

TARGET/IMAGES/RUNTIME/STAGES/RECOVERY仍无实际值或引用，DEPLOY保持blocked，现场六项独立验收未完成；UAT planned/未开始，没有Go/No-Go或生产Go。GIT与本地源码候选验证已完成。后续验证记录治理提交不是新的应用候选。

最终证据/归属与文档复核见[git-candidate-validation.json](./evidence/git-candidate-validation.json)：当前治理211项文档摘要、30本地链接、diff与UAT保全通过。首次最终摘要核对发现根清单里嵌套SHA256SUMS的一项旧摘要，原因是先刷新根再刷新嵌套；已按嵌套→根顺序修正，只在后续治理提交。原76d1d523 archive保持不可变，保留该文档摘要旧值限制；不声称其文档哈希检查通过。应用完整门禁、13项部署文件hash与archive身份均匹配，后续治理不是另一个已执行完整门禁的SHA。

## Hostdzire 现有站点目标选择与只读 inventory

用户明确选择本次内部试运行升级Hostdzire现有站点。使用原生hostdzire别名完成三次有界只读SSH inventory，全部exit0；观察时间2026-10-08T01:34:39Z–01:36:33Z（当地10月7日）。仅查询容器/镜像/网络与文件元数据、受限配置枚举；数据库以READ ONLY事务读取alembic_version，不读取业务表或对象正文。低敏派生记录见[hostdzire-existing-site-inventory.json](./evidence/hostdzire-existing-site-inventory.json)。

现场为健康运行的09-30 preview/staging；数据库0043、fake-oss运行且objects目录存在，Production持久状态文件不存在。共享Production env root:root/0600和三组网络身份已确认，不能继续把这些已知事实写成全部未知。活动旧镜像有可读RepoDigests，但旧preview正式manifest未找到，旧V2与成套恢复尚未验收。当前upgrade的read_state/upgrade_entry_state明确要求现有Production state，不能直接接管；没有通过执行失败的部署命令来证明已由源码与文件缺失确认的阻断。

当时按保留数据解释形成了升级准备；随后用户明确纠正为不隔离、不保留数据、推倒重来，现以[清空重建准备](./hostdzire-fresh-rebuild.md)覆盖该方案。只读inventory和实际命令事实未改写；旧preview保留数据接管不再实施。没有上传、构建、拉取、停服、迁移、配置/Nginx修改或UAT；没有运行新CI或完整门禁。

## 清空重建工具实施与当前边界

按用户最新决定提交fresh工具`3811738db696724fa948ebb133b000889c933ca8`及四份稳定部署文档。新模块拥有固定root/三叶目录清空、FD/inode/mount边界和RESETTING→RESET_READY；原owner保有锁/supervisor/原子状态，fresh-init共享空库迁移、初始化及bootstrap/activation。共同14项allowlist，fresh回滚角色NOT_APPLICABLE。

[初次验证](./evidence/fresh-init-script-validation.json)和[修正验证](./evidence/fresh-init-root-mount-validation.json)保存命令/退出码/带SHA日志：13项fresh及3项root挂载检查最终通过；旧Production scripts harness、recovery19/failure7/registry4/signal组成功证据复用。初次root bind P1修正后[最终独立复核](./evidence/fresh-init-review-final.md)关闭阻断；Audit `20261008T014655Z-hostdzire-fresh-rebuild-145a7537`已校验。文档JSON/YAML/链接检查通过；系统Python缺YAML后使用已有backend venv，未安装依赖。

Host只读runtime结构检查及Linux mountinfo解析通过；仅concurrency=1，GEO项省略。AI Header需求及凭据ready/owner/TTY/编码上界未闭合，不修改私有清单、不读取Key。新完整Gate未运行：本机Docker socket不可连接，不调用必然失败的make verify；旧76完整通过不冒充新工具。后续补齐输入与Docker门禁环境，固定新main并完成Gate/Host构建/manifest后推进同候选现场阶段。服务器尚未停服/清空/部署，UAT未开始。


## 可选 Header 首次初始化

按用户明确要求，配置中心既有 Header 能力扩展到首次 Production bootstrap，默认省略/空数组；使用现有校验、敏感加密和 T1/T2/T3，无 HTTP API/DB schema/UI 变化。实现提交 `4a4859b0e9737cf6e8da9bddb88d0580c8734ea9`，合同见[可选Header](./optional-bootstrap-headers.md)。Host 名称参数可选，值 no-echo TTY/stdin 交接，预检与完整大小检查早于 STARTED。

独立初次复核发现名称161字符可超过varchar160，已补真实输入边界回归并修正，修正复核关闭P2。最终unit60、Host7、输入预检5正/44负、定向mypy/Ruff通过；原全scripts成功证据复用，PG实际11skip/7deselect不作通过。具体命令/hash/限制见[验证](./evidence/optional-bootstrap-headers-validation.json)和[修正复核](./evidence/optional-bootstrap-headers-review-final.md)。Audit81760223已闭合校验。私有旧清单未猜测改写，owner/TTY/预算及现场基线仍待闭合；新完整候选Gate未运行，没有Actions派发或Host写入。


## Hostdzire 直接构建与当前现场状态（2026-10-08 UTC）

源码852c6d5e完整本地Gate及Hostdzire镜像/manifest通过；现有env已核对，正确OSS地域与Production runtime已受控交付。真实OSS上传/HEAD/签名读取成功，但Bucket公开读取及CORS范围待确认，AI上线后管理UI配置已获选择、部署owner移交实现与定向验证/独立复核完成，新候选准备中；尚未维护、清空、迁移或切换。当前以[直接执行记录](./hostdzire-direct-build.md)和[配置执行证据](./evidence/hostdzire-runtime-config-execution.json)为准；此前404/NoSuchBucket是旧服务器配置的历史失败，不是缺少现有本地配置。配置交付本身未改应用源码/镜像；新增部署owner须新候选验证，旧完整Gate仅作历史。Actions不要求且未触发。DEPLOY blocked，UAT未开始。


### admin-ui初始化方式实施与独立复核

按用户“新站上线后在管理界面配置AI”的明确选择，owner新增同锁、同候选的显式defer-ai-configuration，首次激活以OSS_MET_AI_PENDING区分实际OSS通过与AI待配置；upgrade保持完整Gate，任何已有/畸形bootstrap attempt不可绕过。9项CLI/state及production scripts harness通过；fresh独立复核无代码阻断，operations文档P2由主代理修正。真实PG临时库迁移0066后同一空集探针返回EMPTY，库已精确删除；初次基础库无表失败保留为环境事实。详见[定向验证](./evidence/admin-ui-ai-handoff-validation.json)与[独立复核](./evidence/admin-ui-ai-handoff-review.md)。新候选冻结与完整Gate/Host构建尚未执行，原852工件不可冒充新部署owner已交付。Bucket权限范围仍待回复，旧站未停服/清空/迁移/切流。
