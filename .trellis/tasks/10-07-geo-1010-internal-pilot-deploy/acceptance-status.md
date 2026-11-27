# DEPLOY 验收分项核对 · 2026-10-24

本轮只核对本地已有证据并整理剩余义务；没有访问线上或执行应用测试。任务保持 in_progress，production_go=false。OSS 自然清理与独立 AMD64 容量验收继续各自等待；以下业务验收不因等待这两项而自动完成。

## 可以收口的既有阶段

下表的“已完成”只指对应候选、时间和分项，不改变原 PRD 六项验收的整体判定。

| 分项 | 已核实证据 | 结论与边界 |
| --- | --- | --- |
| 固定候选、完整门禁、工件 | [10-08现场JSON](evidence/hostdzire-final-deployment.json) 的 candidate、full_gate、host_builds：6a96bfcb，exit_code=0，archive、两镜像与manifest有摘要 | 历史候选交付完成；不证明当前未提交工作树的完整门禁或已部署 |
| 初始化、迁移、账号、readiness | 同JSON的 initialized_state.phase=PRODUCTION_INITIALIZED；actual_running_services.actual_application.schema_head=0066_geo_manual_evaluation、users=2、admin_login_status=200；host_cutover.public_readiness_status=200 | 原PRD第3项的基础部署部分已有证据，无需为收尾重建、重新初始化或迁移；完整MANUAL smoke仍未完成 |
| 六服务和注册表 | 同JSON的 actual_running_services：六服务运行，五项已定义healthcheck healthy，三消费者环境相同，Beat注册8项恢复/清理 | 10-08当时通过；不能据此覆盖后来Scheduler OOM、CPU/manifest漂移或24小时验收 |
| 实际API身份及当前文件链路 | [10-24 OSS记录](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/README.md)、[快照](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/after-upload.json)、[请求结果](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/run.json) | 最近一次已记录API镜像仍为d496dd54…，Compose目录为pilot-20261008-054601-6a96bfcb；production/aliyun_oss、0066、登录及唯一文件API上传/下载已验证。旧current软链接不是实际候选依据。该证据不覆盖全部消费者配置或AI可用性 |

## 必须保留的实际待执行工作

| 工作 | 还缺什么 | 当前可否执行 |
| --- | --- | --- |
| AI管理配置与真实业务smoke | 10-08原始记录ai_configuration_state=EMPTY_AWAITING_OWNER_ADMIN_UI，ai_business_smoke=NOT_RUN_OWNER_ADMIN_UI_CONFIGURATION_PENDING；10-24文件验收未读取或验证AI配置。需按届时实际配置确认获批模型/渠道、调用范围和责任人，再取得真实结果 | 不可：当前禁止线上配置修改及外部AI调用。旧待配置状态不能冒称本轮实时观察 |
| MANUAL主链路、评估/Action/Retest | 产品、问题、Plan/Batch/Run、回答/截图、分析/复核及页面闭环的同候选现场记录；现有UI本地验收和文件API通过不能替代 | 不可：需要获批业务数据、平台和实际业务操作；当前禁止写入线上业务数据，且暂不创建平台 |
| 新试运行数据备份/恢复、安全停止 | 原始JSON new_data_backup_restore_on_host=NOT_RUN；旧数据丢弃已获准不等于新数据保护完成。需明确恢复目标、数据范围、负责人和操作窗口，再执行适用的现场验证 | 不可：缺目标/输入，停止或重启线上服务亦不在当前范围。隔离空库测试不能补成真实新数据恢复证据 |
| DEPLOY工作验收与人工接受 | 上述分项结果、残余风险及明确接受 | 不可提前完成；当前不是单纯状态滞后 |

## UAT及父任务

[UAT PRD](../10-07-geo-1010-manual-uat-performance/prd.md) 的真实样本、人员、120～180 Run或具名缩量、页面性能、5人并发、真实闭环及具名内部Go/No-Go仍无完成证据；保持planned。原阈值和分母不变，不使用本地自动化或空数据页面耗时代替。

[父任务](../10-07-geo-1010-manual-pilot/prd.md) 的UI已done；DEPLOY和UAT仍开放，不能进入整体完成或代签人工接受。GEO-804～807维持post-core延期，本次“继续可执行工作”不构成恢复排期。

## 本轮可执行工作结果

已完成证据分项映射，修正“尚未核对实际候选”的过期表述，并从混合验收项中识别已完成的初始化/迁移/账号/readiness步骤；保留原验收标准和原始JSON，不勾选含未完成业务smoke的整项。未发现可凭现有证据关闭的额外任务，也未从这些记录中确认需要新增源码修复的实际缺陷。

本轮没有启动进程/服务或产生远端数据；未运行应用测试、部署门禁、备份恢复、AI调用或Git暂存/提交/推送。最终本地记录一致性检查见[最新核对JSON](../10-24-open-task-evidence-reconciliation/remaining-task-review.json)。

## 后续只读AI观察（2026-10-24 10:09北京时间）

此前AI状态仅引用10-08历史；现已有[只读现场核对](ai-management-readonly.md)：AI三表仍为空、运行模式/主密钥可复用，配置清单只能部分复用，真实AI smoke继续NOT_RUN。MANUAL确定性规则分析不依赖AI渠道，完整MANUAL执行仍受业务数据/平台/样本范围约束；不再把所有MANUAL步骤笼统归因于AI待配置。本次没有线上写入或外部AI调用。

## 2026-10-25 OSS结果后的范围核对

复用今日此前已保存的[唯一文件自然清理证据](../09-30-development-preview-real-aliyun-oss-integration/evidence/live-20261024T010420Z-b292543b/cleanup-observation-20261025T040159541712Z.json)：真实OSS对象缺失、FileRecord DELETED、下载409 FILE_INTEGRITY_FAILED。原文件API上传/下载/自然清理分项已有结果；浏览器Logo控件仍未验收，自动跟进NOT_FOUND按用户要求保留、不再追查。本轮只读本地记录，没有新的线上检查，不能将该单文件结果扩展为全部消费者、AI业务或完整MANUAL链路验收。

DEPLOY剩余义务仍是AI配置和真实草稿smoke、MANUAL及评估/Action/Retest现场闭环、新试运行数据备份恢复、安全停止和人工接受。各自缺少的输入及当前操作限制见[更新后的最小输入清单](minimum-unblocking-inputs.md)；本任务保持in_progress。Scheduler原生AMD64验收、恢复目标、业务样本、供应商Key分别归属各自条件，不互相替代，也不将它们统一记作等待OSS。
