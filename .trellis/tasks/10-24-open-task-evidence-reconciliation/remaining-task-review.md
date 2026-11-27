# 剩余任务再核对 · 2026-10-24

Scheduler后续修订（2026-10-25）：独立AMD64测试机不再是前置；当前[现有线上Docker最小变更方案](../10-24-scheduler-memory-budget/online-memory-change-plan.md)只完成规划，等待线上执行范围明确。下方旧环境等待及当日机器快照保留为当时记录，不恢复旧隔离试验。未关闭任务仍6条，其他任务和OSS缺口/NOT_FOUND边界不变。

2026-10-25用户已明确暂停，等待外部条件到位后再继续；恢复从[暂停点](pause-point.md)进入，不新增自动跟进或重复检查。6条未关闭任务及浏览器上传验收缺口保留。

最新核对：2026-10-25，见本文末节与[当前机器快照](remaining-task-review-20261025.json)。原remaining-task-review.json继续保留为10-24历史快照；OSS自然清理已通过，自动跟进结果NOT_FOUND保留且不再追查，浏览器上传验收缺口仍在。

本记录已追加Scheduler环境等待后的核对；下方原五项分类与历史证据继续保留。覆盖 implement.md 早期“剩余8项”的当前时态，不改写历史执行。依据当前仓库 task.json、后续任务、原始验收JSON与人工接受记录核对；本轮没有访问远端或重新执行应用测试。

## 结论

- Trellis 未归档目录中实际未关闭 **6条**：Scheduler环境等待、3项现场验收工作（OSS、DEPLOY、UAT）、1项聚合父任务、1项明确延期任务。其中UAT尚等待前置任务与人员/样本输入。
- GEO-1009、GEO-1010-UI 的 `done` 是有效终态；当前 `.trellis/scripts/common/tasks.py` 同时识别 completed/done，且两项都有明确人工接受记录。不改状态词、不重复接受，不计入未完成。
- 没有新的整项任务可以仅凭现有证据关闭。已完成阶段不要求重做；未完成验收不通过改标题、移交或放宽原标准消除。
- Manifest另有GEO-805/806/807三项post-core延期计划，尚无独立Trellis任务；与804组成延期工作链，不计为当前核心版必须补做的功能。

## 分类与下一步

| 任务 / 状态 | 分类 | 已有证据与可复用部分 | 仍需实际执行 / 等待条件 |
| --- | --- | --- | --- |
| [真实OSS文件流程](../09-30-development-preview-real-aliyun-oss-integration/task.json) / in_progress | 实际待执行的现场集成验收 | 后端中转上传子任务完成；10-08实际API容器PUT/HEAD/签名GET、匿名/失效签名403和测试对象清理通过。旧preview切换、浏览器直传CORS与共享Bucket ACL不再是当前工作 | 确认现场候选/账号及受控测试对象范围后，经正常UI上传→FileRecord VERIFIED及size/hash/type→下载字节/哈希→未引用文件清理→OSS对象删除、DB DELETED与下载失效；记录真实结果并完成最终复核。现有探针database_writes=false，不能代替该闭环；缺口是验收，不是已确认的新源码缺陷 |
| [GEO-1010-DEPLOY](../10-07-geo-1010-internal-pilot-deploy/task.json) / in_progress | 实际待执行的部署后验收；部分依赖管理员配置和受控现场输入 | 10-08固定6a96bfcb：候选门禁、工件、清空重建、0066迁移、六服务、登录与私有OSS已完成，不应表述为完全未部署 | 先确认现场实际候选/配置（10-08不代表今天实时状态）；完成管理界面AI配置与获批真实AI业务smoke、MANUAL主链路及评估/Action/Retest入口；验证新试运行数据的备份/恢复和安全停止；工作验收后人工接受。不是简单补一个done状态，也不能因重审自动清空或重新部署 |
| [GEO-1010-UAT](../10-07-geo-1010-manual-uat-performance/task.json) / planned | 等待DEPLOY完成及外部业务输入，随后执行真实试用 | UI页面闭环已有实现/本地真实栈证据，但UAT implement仍为未开始模板，不能替代真实员工试用 | 业务/运维具名人员、获批环境/平台/数据范围和时间窗口；2～3产品、每产品3～5竞品、3平台、2～4试用人员；20～30总问题×3平台×2次=120～180Run（或明确获准缩减）；至少一个Opportunity→Action→Retest闭环；页面/上传/分析/队列等实测、5人并发、反馈与具名内部Go/No-Go |
| [GEO-1010父任务](../10-07-geo-1010-manual-pilot/task.json) / in_progress | 聚合等待，不重复计作一份实现工作 | 3个子任务中UI=done，有2026-10-07人工接受；DEPLOY/UAT尚未完成 | 等两个子任务各自验收完成，完成集成验收，再由用户单独明确接受父任务。production_go=false保留；内部Go/No-Go不自动授予生产Go |
| [GEO-804](../10-05-geo-804-approved-browser-adapter/task.json) / deferred | 已明确延期；等待重新排期及外部条件 | ADR-006仍Accepted，manifest804～807均post-core/deferred；preflight与参考adapter测试不是正式平台Adapter交付 | 产品恢复排期并指定责任人；唯一平台/账号/用途/环境/频率/保留规则批准；受控staging smoke入口与授权。条件满足后才设计、实现真实Adapter；不因其他任务完成自动恢复 |

UAT原性能阈值和分母仍按其PRD：Run Detail P95≤2s、Overview≤3s、分析完成P95≤60s、主流程成功率≥95%，另记队列等待与5人并发。当前没有实测值，不以本地自动化数据或计划表冒充完成。

## 已处理的滞后记录

1. 原核对记录的“8项剩余”已明确标为早期快照；T5-I6及两个父任务现已completed，T5-G/T6-P亦完成，不再列入当前待办。
2. `task-manifest.yaml` GEO-1010 execution_note仍停在10-07“未部署/工件缺失”；更新为10-08已部署的历史证据及尚缺AI smoke/恢复/UAT。保持status=in_progress，不改验收范围，更新仅该文件的SHA256SUMS条目。
3. OSS task.meta.blocker保留原始private/CORS检查值作为历史，显式标注已被后续方案替代，并新增当前验收缺口分类，避免旧403再次被当作阻断。
4. 五项任务新增当前复核分类、已完成阶段、实际剩余和外部依赖，状态均保持真实未完成；不把missing evidence转换为pass。

## 证据与适用范围

- [10-08现场原始JSON](../10-07-geo-1010-internal-pilot-deploy/evidence/hostdzire-final-deployment.json)：actual_running_api_oss_gate成功；public_ui.credentials_entered_in_browser=false；ai_business_smoke=NOT_RUN_OWNER_ADMIN_UI_CONFIGURATION_PENDING；new_data_backup_restore_on_host=NOT_RUN。只证明当时固定候选，不证明当前线上状态。
- [10-14交付](../10-14-review-commit-main/implement.md)：SDK/日常部署等仓库实现已验证并提交，明确没有部署或真实AI/OSS请求，不能补齐以上现场结果。
- [GEO-1009人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)、[UI人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1010-ui-acceptance.md)：只关闭各自范围，未接受DEPLOY/UAT/父任务。
- [T5/T6收尾](../09-04-integrity-error-domain-mapping/closeout.md)：本地错误恢复工作线完成；AC11 NOT_CAPTURED按用户接受保留。它不改变GEO-1010现场义务。
- [Manifest](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml)与[ADR-006](../../../docs/geo-monitoring/05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)：804～807为post-core，不恢复排期。

本轮只做仓库证据与治理记录核对，检查JSON可解析、状态计数/关联、Markdown链接、GEO文档摘要和diff/保护范围；未跑应用测试/完整门禁，未创建现场数据、外呼AI、访问主机、部署、提交、推送或归档。没有新增应用行为需要测试，也没有将任何“等待外部条件”假定为已获得批准。

## Scheduler等待后的当前推进（2026-10-24）

Scheduler保持in_progress，执行状态为WAITING_INDEPENDENT_AMD64_ENVIRONMENT，24h=NOT_STARTED；119份已有证据文件SHA-256逐一核对未变。见[Scheduler任务](../10-24-scheduler-memory-budget/prd.md)。其余任务没有被一概挂到AMD64依赖下。

| 工作 | 当前授权内已推进 | 当前无法执行的实际步骤 |
| --- | --- | --- |
| OSS | 完成现行UI/API/存储/文件回收路径核对，形成[可恢复验收步骤](../09-30-development-preview-real-aliyun-oss-integration/acceptance-readiness.md)；明确VERIFIED后保留24小时、小时扫描、abort仅PENDING，以及batch_size不能精确限定测试文件 | 正常上传会新增线上FileRecord及OSS对象，当前禁止；完整验收需真实下载与自然回收证据，不能以离线准备关闭 |
| DEPLOY | 核对剩余验收与当前授权的对应关系；复用此前部署阶段证据，不把它重列为从未部署 | 真实AI业务smoke、MANUAL链路和新数据备份/恢复、安全停止涉及被禁止的AI调用、写入或服务操作；本轮未执行 |
| UAT | 复核原PRD样本、120～180Run分母、5人并发及具名Go/No-Go；确认没有可复用的真实员工验收结果 | 依赖DEPLOY done及获批业务样本/人员/平台/时间；维持planned，不代签业务接受 |
| GEO-1010父项 | 确认UI done、DEPLOY/UAT未完成；production_go=false保持 | 不能先于子项完成或人工接受关闭 |
| GEO-804 | 复核deferred/post-core仍有效 | 需重新排期、平台范围批准和staging输入，当前不自动恢复实现 |

本轮没有新发现可仅凭状态修正关闭的整项任务，也没有在剩余任务范围内确认需要立即修复的源码缺陷。可执行工作是上述证据治理和OSS验收准备；不为制造进展重复测试已通过代码、重做现场快照或新增功能。

本轮未连接远端或运行应用测试；没有创建运行进程/临时资源。检查任务JSON、未关闭集合、父子关系、文档相对链接、119份Scheduler证据不变、git diff --check及暂存区。所有未执行的现场结果保留未知/NOT_RUN，不把准备完成标作业务验收通过。

## OSS后续现场进展

2026-10-24用户放行唯一PNG/FileRecord写入后，真实认证文件API上传、VERIFIED、签名下载/hash/type及匿名拒绝通过；等待10月25日09:06:36北京时间到期后的既有清理。当前平台为空，未创建平台/绑定Logo，UI上传控件证据仍缺。详见[本轮证据](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/README.md)。此前“禁止任何测试文件写入”仅是旧阶段范围；当前已执行唯一获批对象，不授权其他数据。六项未关闭数不变。

## OSS等待期间再次核对（本轮最新）

用户明确继续等待唯一OSS对象自然清理，暂不创建平台补测；Scheduler继续等待独立AMD64环境。本轮没有访问远端，也未改变既有自动化安排。

- 实际未关闭仍为6项；原remaining-task-review.json与task.meta.latest_review的5项汇总漏掉后来新增的Scheduler，本轮同步为6项，旧JSON结果保留在historical_review，不将旧验证字段当作本轮执行。
- DEPLOY完成[分项证据收口](../10-07-geo-1010-internal-pilot-deploy/acceptance-status.md)：候选工件、初始化、迁移、账号、readiness和已获批文件API验收无需重做；完整MANUAL smoke、AI、新数据恢复及接受仍缺。修正等待列表中“尚未核对现场候选”，但不声称10-24 OSS快照验证了全部运行配置或AI可用性。
- 父任务PRD中的“UI尚未部署”已修正为10-08候选已包含UI上线；完整业务验收仍未完成，父任务继续等待DEPLOY/UAT及集成接受。
- UAT仍planned，实际人员、样本、平台、时间窗口和DEPLOY接受未齐备；没有以本地测试取代员工试用，也不创建平台或试用数据。GEO-804及manifest-only的805～807继续deferred/post-core，不恢复排期。
- 本轮新增整项关闭数为0。现有证据没有揭示额外可执行的源码修复；余下现场操作分别受当前外呼/写入/服务操作限制或外部业务输入约束，并非都依赖OSS或AMD64。

实际工作限于上述证据治理及文档/JSON一致性修正；未运行应用测试或完整门禁，没有为等待状态重复检查线上、创建临时服务、配置、重启、部署、写业务数据、调用外部AI、暂存、提交或推送。

## AI等待Key后的独立可执行性核对（当前）

AI配置已明确标记WAITING_SUPPLIER_API_KEY；CUSTOM、无额外Header的最小方案保留，DEPLOY不关闭。OSS按既定安排等待自然清理且暂不补建平台，Scheduler等待独立AMD64环境，两个等待任务与证据均未改动。

| 不依赖上述三项的工作 | 当前实际约束 | 本轮决定 |
| --- | --- | --- |
| MANUAL回答入库、确定性规则分析、复核和Overview | 规则分析无需供应商Key，但完整现场操作需获批样本/Profile及线上业务写入；当前平台为空、禁止创建平台/业务写入 | 保留未执行；不以空数据页或本地fixture冒充现场验收 |
| 评估、Action、Retest页面闭环 | 需可用业务基线及新记录/状态转换；UI既有实现已接受 | 复用实现证据，现场闭环待执行；不重复功能实现 |
| 新数据备份/恢复、安全停止 | 恢复目标、数据范围、负责人/窗口未齐；服务停止或重启不在当前范围 | 不提取生产数据或自行创建恢复环境，不以空库演练代替新数据恢复 |
| UAT样本、人员、性能和具名结论 | 需要DEPLOY接受及业务人员/平台/样本/时间窗口；不是由代理代填的内容 | 保持planned；保留原120～180Run或具名缩量、5人并发及阈值 |
| GEO-1010聚合接受 | DEPLOY/UAT及集成验收未完成 | 保持in_progress |
| GEO-804～807 | 产品排期、唯一平台批准、责任人及staging输入未齐，post-core延期继续有效 | 不恢复实现 |

核对结论：仍6条未关闭，无新增可按现有证据整项关闭的任务；当前限制内已可完成的只读调查、最小录入方案和证据整理已经完成。未发现尚未处理的、可在这些剩余任务内立即修复的具体代码缺陷。无需为等待新增重复测试、无效轮询或模板。

本轮复用并核对7份既有引用文件摘要未变；检查任务状态/父子关系与本地记录一致性。未访问主机、调用AI或OSS、创建平台、写业务数据、修改线上配置、重启、部署、暂存、提交或推送；无新增进程或临时环境。

## 2026-10-25 OSS自然清理后续

用户要求只读复查唯一OSS测试文件。北京时间12:02，hostdzire实际API候选及相关运行源码身份核对通过；真实OSS HEAD确认对象缺失，FileRecord及正常文件GET均为DELETED，deleted_at为北京时间09:52:58；download-url返回409 FILE_INTEGRITY_FAILED。见[现场证据](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/README.md)。

自然清理分项已通过，不再等待回收；OSS任务改为等待浏览器Logo上传控件验收，仍in_progress，整项未关闭。暂不创建平台、不改线上配置，不手动清理、不提交推送。未关闭总数仍为6，Scheduler等待独立AMD64、DEPLOY/UAT及Browser延期边界均不变。上方10-24记录及remaining-task-review.json是当日快照，不代表本次仍在等待自然清理。

## 2026-10-25 其余未完成任务的可推进性

本轮按用户要求仅核对本地任务、PRD、验收计划和既有证据。OSS自然清理PASS及自动跟进NOT_FOUND原始记录均保留，没有再访问自动化服务或主机。未关闭仍为6项（4项实际工作、1项聚合父任务、1项延期任务），新增整项关闭为0；GEO-805～807仍为manifest-only的post-core延期计划。

| 任务 | 现有限制下可推进 / 本轮已核对 | 必须等待的输入、依赖或操作边界 |
| --- | --- | --- |
| OSS / in_progress | 复用API上传、下载和自然清理PASS；保留正常浏览器Logo控件NOT_RUN_NO_EXISTING_PLATFORM，停止将清理列为待办 | 已有可用平台和受控浏览器上传范围；当前暂不创建平台，不能完成该控件验收或关闭整项。NOT_FOUND不再追查 |
| Scheduler / in_progress | 复用ARM64短测和故障注入证据；已规划现有线上Scheduler的256 MiB动态调整、自然观察及有条件回退 | PLAN_READY_WAITING_ONLINE_CHANGE_AUTHORIZATION；当前仅方案，线上执行/观察NOT_STARTED，不再等待独立AMD64测试机。旧隔离工具不在生产Engine运行 |
| GEO-1010-DEPLOY / in_progress | 已完成候选/基础部署分项与剩余验收映射；最小AI录入方案、MANUAL规则链路和恢复步骤资料可复用 | AI分项缺供应商Key及管理写入/外呼范围；MANUAL缺获批真实样本、平台和业务写入；恢复缺隔离PG目标、新数据范围、保管/恢复负责人和允许停写/停止/恢复的窗口；当前禁止改线上配置或创建平台 |
| GEO-1010-UAT / planned | 核对120～180初始Run、Retest另计、5人并发、性能阈值、反馈和具名接受口径；不填虚构结果 | DEPLOY done，加获批产品/问题/平台、真实回答/引用/截图、2～4试用人员、5人并发参与安排、具名业务/运维接受人及窗口；缩量需明确批准 |
| GEO-1010父任务 / in_progress | 确认UI done和独立人工接受有效，检查子项依赖和父项接受条件 | DEPLOY与UAT分别完成/接受，随后集成工作验收和父任务单独人工接受；当前不能代签或提前关闭 |
| GEO-804 / deferred | 核对ADR-006与manifest的延期状态及恢复条件 | 产品重新排期、指定责任人、唯一平台范围批准、staging入口与人工授权；维持post-core，GEO-805～807同样不自动恢复 |

当前可推进的是上述离线证据核对、输入清单和恢复顺序；资料已具备后续恢复所需的步骤，没有另一项可以在当前输入和操作边界内直接转为完成。本轮没有从这些记录中确认需要立即修复的新源码缺陷，不扩大为代码审计、功能实现或重复测试。

### 条件之间的关系与恢复顺序

1. 供应商Key、AMD64环境、真实样本/平台、隔离恢复目标、人员/窗口可以分别准备；浏览器上传缺口不阻断其他分项的资料准备。
2. Scheduler基于现有线上Docker方案另行明确执行范围后推进，不依赖供应商Key、MANUAL样本或独立测试机；当前只完成方案，旧隔离试验授权不能用于线上写入。
3. MANUAL确定性规则分析不需要供应商Key；完整现场链路仍需样本、有效Profile及获准业务写入。真实AI草稿另需Key、获批PUBLIC事实/Prompt/任务和数据外发范围，Key单独到位不能绕过当前线上配置限制。
4. 新数据恢复目标按PostgreSQL和依赖兼容/隔离条件选择，不自动要求AMD64；真实新数据备份、停写/停止/恢复须有独立目标和操作窗口，空库演练不替代该证据。
5. DEPLOY剩余分项完成并接受后进入正式UAT；UAT和集成验收后再接受父任务。内部接受不自动授予正式生产Go。

本轮仅更新本地核对与输入资料，执行任务JSON/状态/依赖、引用文件和diff检查；没有重查自动跟进、访问主机、读取新凭据、创建平台或业务数据、调用AI、运行应用测试、启动24小时作业、修改线上配置、停止/重启、部署、暂存、提交、推送或归档。原有工作区、暂存区和OSS已完成证据保持。
