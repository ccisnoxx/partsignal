# 未关闭任务核对结果（2026-10-24）

> 下文为本日首轮历史快照。T5-I6和两个父任务已在后续收尾；最新剩余6条及分类见[剩余任务再核对](remaining-task-review.md)。

## 结论与证据口径

起点 main `a4f9bbd5` 工作区清洁。原 199 条未归档任务中 12 条未关闭；本轮关闭 4 条 review 记录，保留 8 条。新建的本核对任务单独计数，不算原业务待办。

依据用户本轮“核对后整理收尾”的明确授权关闭已有充分完成证据的任务，完成日期为 2026-10-24，不倒填原实施日期或过去的具名人工接受。仅修改任务记录，不移动归档目录，不提交、推送、部署或访问远端。

已读取原始 JSON 验证记录、实施/复核记录、后续提交，并在相关源码中定位原改动是否仍存在。历史 passed 只证明当时范围已交付，不代表本次重跑或当前 main 完整发布门禁通过。核对清单保存逐任务决定、证据路径与 SHA256。

## 已关闭的 4 项

| 任务 | 决定与依据 | 保留边界 |
| --- | --- | --- |
| [GEO 浏览器延期与人工优先范围调整](../10-05-geo-browser-scope-adjustment/task.json) | review → completed。原 validation.json 记录 71 项 DAG、608 项链接、1,295 份源码/配置保护；复核问题已有处置。当前 ADR-006 仍 Accepted，804～807 deferred；后续 PSR-005/007 和 10-14 配置/文档核对继续落实该决策。 | 完成范围治理；Browser 功能仍延期，不产生生产启用授权。 |
| [verify 依赖入口修复](../10-05-verify-entrypoint/task.json) | review → completed。四条 AC 已勾选；validation-results.json 记录完整 make verify/lint/typecheck/deploy-scripts 通过，review.md 无确认阻断。当前普通集成与恢复仍分段必跑，fake OSS healthy 依赖仍在，恢复脚本相对原交付提交未变。 | 历史入口修复完成，不将历史整套通过套到当前 SDK 候选。 |
| [GEO E2E 评估开关隔离](../10-07-geo-e2e-evaluation-phase-isolation/task.json) | review → completed。targeted-check.json 三模式 exit 0，DEPLOY candidate-source-verification.json 证明 `76d1d523` 完整门禁 exit 0；该提交是 HEAD 祖先，模式内显式 false 仍在。 | 后续脚本另有 Browser 专属验证隔离变更，原门禁不证明当前完整 E2E 通过。 |
| [Hostdzire 日常部署流程](../10-08-hostdzire-routine-deployment/task.json) | review → completed。原 PRD 限定仓库实现，允许无现场验证但不得宣称耗时达标。原复核问题已关闭；10-14 validation.json 再次证明 routine 13、handoff 9、runtime-policy 7、registry-order 4 与 scripts harness 通过，两项独立复核无确认阻断；`2ea39903` 收录实现，四份相关 Python 源码相对该提交未变。 | 真实 Engine/Hostdzire、业务 smoke 和 5～15 分钟目标未实测，留待部署验收，不宣称服务器已生效。 |

原 implement.md 的“当时 review/未提交”及原始 JSON 保留为历史证据，本轮追加当前收尾说明。工作完成与远端部署分别记录。

## 保留的 8 条任务记录

| 任务 | 状态 | 实际剩余工作 |
| --- | --- | --- |
| [IntegrityError 领域错误映射](../09-04-integrity-error-domain-mapping/task.json) | planning | 自身规划 AC 已完成；作为现有任务树父项，等待 T5-I6 与前端恢复条件收口，不重新做全库审计或重做已完成子项。 |
| [Publication/GEO 合同决策](../09-14-publication-geo-integrity-error-contract-decision/task.json) | planning | 决策已冻结，5/6 子项完成；保留 T5-I6 及其联动验收，不把规划材料完成当作聚合实施完成。 |
| [T5-I6 GEO context code reconciliation](../09-16-geo-observation-context-code-reconciliation/task.json) | in_progress | 后端实施、定向验证与独立修复复核完成；AC11 前置 protected-owner 指纹缺失不可追补。仍需处置历史证据缺口，完成 T6-C 恢复行为及 T6-G/T6-C 合同对应验收。 |
| [真实 OSS 完整文件验收](../09-30-development-preview-real-aliyun-oss-integration/task.json) | in_progress | 旧 preview 切换方案已被 10-08 fresh rebuild 替代；服务端对象读写有实测，浏览器上传→FileRecord VERIFIED→下载内容/哈希→未引用清理→DELETED/下载失效闭环仍无证据。 |
| [GEO-1010 父任务](../10-07-geo-1010-manual-pilot/task.json) | in_progress | UI 完成；等待 DEPLOY、UAT 和父任务单独接受；production_go=false 保持。 |
| [GEO-1010-DEPLOY](../10-07-geo-1010-internal-pilot-deploy/task.json) | in_progress | 最新仓库内现场证据为 10-08 候选 `6a96bfcb`；AI 配置、真实业务 smoke、现场新数据备份/恢复及任务人工接受无完成证据。下一次现场工作先核对当前实际候选与配置。 |
| [GEO-1010-UAT](../10-07-geo-1010-manual-uat-performance/task.json) | planned | 未开始：真实受控样本/人员/平台，120～180 Run 或获准缩减样本、行动复测闭环、性能/并发、反馈与具名内部 Go/No-Go。 |
| [GEO-804](../10-05-geo-804-approved-browser-adapter/task.json) | deferred | 真实 Adapter 未实施，与 manifest 中 GEO-805～807 继续 post-core；恢复需产品排期、责任人、平台范围批准和受控 staging 授权。 |

### 前端后续交付与 T5-I6 缺口

[G03](../09-21-frontend-g03-geo-observation-detail/prd.md) 与 [G04](../09-21-frontend-g04-geo-observation-correction/prd.md) 已交付 Detail 读取失败冻结、DELETE 409 后显式重载/重新确认和 Correction context 恢复；当前源码与测试仍在。不能笼统声称 T6-G 完全未实现。

T6-C 原合同见 [Frontend V2 验收规范](../../../docs/frontend-v2/08-testing-quality-and-acceptance.md)：共享 content-task preview GET 失败后旧预览失效，普通 DELETE blocked/no replay，永久删除 POST 失败后旧预览和确认文本失效，须显式刷新/重开/重新确认。

当前 [content-task-lifecycle.tsx](../../../frontend/src/domains/content/content-task-lifecycle.tsx) 存在可定位的合同缺口：

- 113～123 行对 404/409 自动 invalidate/refetch；370～378 行确认文本仅在 Dialog 关闭后清空。
- 427～432 行按钮只检查 pending、preview.data 和文本相等，不检查 preview.error/isFetching 或失败后的重新确认状态。
- 静态触发路径：永久删除 POST 返回 GEO 链 409，弹窗保持打开且确认文本保留；自动 refetch 成功且 confirmation_text 不变时，按钮重新可用，不要求重开/重新输入。带缓存的 preview GET 失败仍可能保有 data，按钮也没有 error 条件。
- 已检查的 Content List/Detail 测试只证明普通 409 不自动重放及 canonical refetch，不能证明 GEO 错误后的确认失效。本轮仅核对源码，没有运行 UI 复现，不推断线上数据损失；后续修复应补对应行为测试，不重做整套前端。

AC11 是另一项历史证据缺口。今天补 hash 或重跑测试均不能证明 9 月 21 日修改前文件未变。本轮不勾选 AC11、不解除 release-atomic gate；后续应明确记录历史缺失的处置，并与可验证的当前合同验收区分。

### OSS 后续证据的覆盖边界

[10-08 现场证据](../10-07-geo-1010-internal-pilot-deploy/evidence/hostdzire-final-deployment.json) 的 actual_running_api_oss_gate 证明实际 API 容器内 PUT/HEAD/签名 GET 内容、匿名 403、过期/无效签名 403、精确测试对象清理通过；三消费者环境一致，fake OSS 未运行。旧 OSS 任务“仍为 development/fake-oss”已过时。

但同一探针 database_writes=false；public_ui 的 credentials_entered_in_browser=false，只检查登录页/匿名跳转，不能证明 FileRecord、浏览器上传下载和业务清理墓碑。原 GetBucketCors/ListObjects 403 仅证明当时管理/列举权限，不是当前后端中转上传的阻断。恢复时按当前候选、后端中转与对象私有合同验收，不再执行旧 release 原地切换或恢复浏览器直传/CORS方案。

### 当前 main 与现场版本

[10-14 提交记录](../10-14-review-commit-main/implement.md) 和 validation.json 证明 `2ea39903` 已收录并推送 SDK、Browser 延期与日常部署实现，当前 HEAD 包含它；该记录明确没有部署或真实 AI/OSS 请求，本地代码不等于线上版本。

当前候选仍缺 PG16 容器/恢复、Linux 镜像、真实 Redis/Celery/完整 E2E 与现场检查证据。后续正式发布按 [部署验证选择合同](../../../docs/Hostdzire部署上线流程.md) 复用输入不变的证据并补实际风险，不因本次收尾、新 SHA 或历史提示词机械重跑全套。

## 后续执行顺序

1. 本地优先处理 T6-C 预览与确认失效，核对 T6-G 剩余错误码矩阵并验证受影响行为，同时明确 AC11 历史缺失的处置；本轮只记录，不实施源码修改。
2. 恢复现场工作后先核对候选/配置，再在明确数据和外呼范围内完成 AI 配置与业务 smoke、OSS 浏览器完整闭环及适用恢复验收，不重复旧环境切换。
3. DEPLOY 接受后执行 UAT，落实样本、性能与业务结论，最后关闭 GEO-1010 父任务。内部 Go 不等于生产 Go。
4. Browser 804～807 保持延期，不纳入当前核心版补验收。

## 本轮验证

收尾时追加实际命令和结果。历史业务测试不因本轮文档/状态变更重跑；本轮证据 SHA 只标记读到的文件版本，不替代历史 protected-owner 基线。

实际检查结果：

- `python3 .trellis/scripts/task.py validate <task-dir>`：12 个被核对任务和本核对任务共 13 个退出 0；此命令只核对上下文引用，不代表业务验收。随后清除本任务自动生成的两份 `_example` 占位 JSONL，并再次检查本任务。
- `python3` 内联记录一致性检查：200 个 task.json 可解析；原任务总数仍 199，已完成 191，未关闭 8；4 条状态变化与授权、日期一致。父子关系、既有提交身份、production_go、现场阶段与历史门禁字段未变。
- 同一脚本检查 27 个本地 Markdown 链接有效；48 份核对证据中 43 份字节未变，5 份文档只保留原正文后追加当前说明。
- Git 祖先及差异检查：76d1d523 是 HEAD 祖先；恢复入口脚本相对原交付未变，日常部署四份 Python 源码相对 2ea39903 未变；E2E 后续差异限于另外的 Browser 隔离，不将旧全套结果当作当前全套通过。
- `git diff --check` 通过；差异路径校验确认既有文件变更仅限预期的 17 个任务记录/说明文件，新文件仅为本核对任务交付物；暂存区为空。
- 未重新运行单元/集成/E2E、make verify 或发布门禁；本轮没有业务代码变化，历史证据仅在上述范围内复用。未访问远端、真实 AI/OSS，未部署。

本任务完成，4 项历史任务已收尾，8 条原记录保留；清除本会话任务指针。仅保留本任务 PRD、实施报告、机器可读核对清单与 task.json 为正式交付物；未创建测试进程或临时环境。


## 2026-10-25 OSS分项通过后的剩余工作核对

按用户要求保留OSS自然清理PASS、自动跟进NOT_FOUND且不再追查。复用既有task/PRD/ADR/验收计划核对其余任务，当前未关闭仍6项，新增整项关闭0；本核对任务原completed终态保持。更新[当前分类](remaining-task-review.md)与[当日机器快照](remaining-task-review-20261025.json)，修正DEPLOY最小输入清单中已过期的OSS等待描述，并记录该单文件结果的适用范围。

本轮可推进的本地证据、输入规格与恢复顺序核对已完成；实际执行分别等待独立AMD64环境、受保护Key、获批样本/平台及业务写入、隔离恢复目标、人员与操作窗口。MANUAL规则分析不依赖Key，恢复目标不自动要求AMD64；输入到位不解除当前不创建平台、不改线上配置及其他未授权操作的边界。UAT仍planned，父任务仍等DEPLOY/UAT和独立接受，Browser继续post-core延期。

只执行本地记录读取、任务JSON/父子关系/引用与diff核对；不访问自动化服务或主机、不读取新凭据、不运行应用测试/完整门禁，不创建平台或业务数据、不操作线上服务、不提交推送。既有OSS证据和其他工作区/暂存区保护结果见本次机器快照的validation。

## 2026-10-25 用户明确暂停

按用户要求保存[暂停点](pause-point.md)，等待外部条件到位后再继续。6条未关闭任务的状态、浏览器上传NOT_RUN_NO_EXISTING_PLATFORM、OSS自然清理PASS及自动跟进NOT_FOUND均保留；本核对任务原completed终态不变。暂停期间不新增自动跟进、不重复检查、不创建平台、不改线上配置、不提交推送。本次只保存本地恢复资料，没有再次执行任务核对或现场验收。
