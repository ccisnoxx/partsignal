# GEO-305 实施与验证证据

当前状态：completed（manifest：done）；本会话用户已人工审查并接受实现与测试证据，验收日期2026-10-02。GEO-303/GEO-304依赖均done，GEO-306仍planned。

## 范围和结果

MANUAL entry context / shared single-run draft / independent draft_revision / formal submit / idempotency / Run和Batch状态推进 / honest analysis placeholder。新增三个HTTP端点、七个闭合公共数据组件、0051两表/守卫和generated OpenAPI类型。后端应用服务拥有事务；Router仅认证/CSRF/输入与调用。

未实现GEO-306列表/详情、GEO-307页面、GEO-308阶段验收、Collector、机器分析、指标/机会、调度循环、草稿保留扫描或真实外部AI请求。没有Git提交、推送、PR或生产迁移。

## 业务、事务和锁

冻结MANUAL PENDING/NOT_STARTED、无答案/后继才可首次写入；当前actor及Profile/Surface资格锁后重读。草稿虚拟revision0，首次1、实际变更+1、同值不变；Run revision不受保存影响。正式提交支持最终未保存编辑，但必须匹配当前draft_revision。

User(NO KEY UPDATE，舍弃认证heartbeat)→提交identity advisory→Surface→Profile→Batch→Run→Draft→Files(UUID升序)，READ COMMITTED。GET录入上下文在认证前REPEATABLE READ；配置停用仍可读取草稿，阻断动作。旧新文件全集先锁定，防止解绑清理逆序获取旧文件锁。

正式提交先删除临时草稿，再冻结AnswerSnapshot/所有Citation/文件；复用GEO-302策略推进COLLECTED/revision+1，完整Runs投影Batch为RUNNING、最小成功审计和提交身份同commit。任意失败全部rollback；0050不可变和deferred完整性约束继续生效。原文空格/换行和实际引用位置保留，hash为完整UTF8；未知来源/模型/搜索事实和费用保持NULL。collected_at带时区，Run创建≤采集≤锁内数据库clock，started_at=collected_at。

identity_hash为geo-manual-submit命名空间+actor+key的SHA256；request_hash覆盖Run、expected_draft_revision和完整规范载荷，时间UTC、引用按位置排序而原文URL保留。认证和CSRF先于回放；同键同请求稳定201回执，内容或Run不同409。不同键或账号争抢同Run只有一次成功；不重复审计。提交身份和答案均不可修改/删除。

分析回执为NOT_IMPLEMENTED。COLLECTED/ANALYSIS_PENDING只表示等待后续稳定ID加载，没有Redis投递、dispatch计数增长、分析结果或分析成功声明。

## 安全与证据

仅当前提交者的VERIFIED INTERNAL/RESTRICTED文件可关联；截图类别/类型/10MiB及raw文本类别/50MiB、真实对象HEAD尺寸/hash/type持续重验。归属错误403、缺失/变更422、对象存储不可用503，无状态推进。文件引用进入实时GC；最后真实引用解绑后沿既有七天保留。用户历史计入draft.updated_by/submission.submitted_by。

URL只按既有GEO-304输入owner规范化，不DNS/HTTP请求。闭合raw summary拒绝正文/Header/凭据扩展；审计只含稳定ID/版本，不存正文、URL、文件内容或原始幂等key。人工上传前负责敏感裁剪/清理，本任务不声明通用脱敏器。没有放宽CSRF、权限、SSRF、TLS或不可变边界。

## 合同和迁移

0050_geo_answer_evidence→0051_geo_manual_collection：新增geo_manual_drafts、geo_manual_submissions及FK/索引/CHECK/触发器，无历史回填/改写。空库head、非空0050正式Answer/Run前滚、两表ORM metadata一致及downgrade55000安全停止均已有真实PostgreSQL证据。失败恢复为前向修复或备份恢复，不删除原始证据。迁移仅专用测试库执行。

OpenAPI是唯一协议权威，三个端点getGeoManualEntryContext / saveGeoManualDraft / submitGeoManualObservation；session、CSRF、Request-ID和错误信封保持现有合同。运行时与根合同、generated类型检查通过。installed FastAPI省略nullable defaults，main恢复已有GeoRawPayloadSummary默认annotation；精确响应清单随三个端点更新。

## 独立复核和修正

fresh critical_reviewer确认一项P2：原草稿SQL安全外壳允许TbadZ、来源首尾空白、缺host/带userinfo URL，可能破坏后续DTO读取。0051补真实日期/canonical UTC微秒、来源空白和URL安全外壳；11项SQL反例保护拒绝且原草稿和200上下文保留。review-fix.log为19 passed；draft-validator-red-green.log实际运行旧候选与新守卫，五种旧接受/新拒绝反例已确认。完整URL/IDNA规范化仍由应用唯一owner负责。

复核最终未发现其他确认的发布阻断问题。主代理核对实际工具事件，仅只读查询及两个内部缺陷消息，无写入/Git/测试/容器命令。具体review-tool-evidence.json、independent-review.md；Audit Bundle已关闭且verify passed，SUBAGENT_EXECUTION_DIGEST可校验，不以completed推算验收。

## 实际验证

- 起点单元：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_batch_policy.py backend/tests/unit/test_geo_answer_contract.py backend/tests/unit/test_geo_batch_creation_contract.py —— 1401 passed。
- 起点集成：docker --context colima compose -f .trellis/tasks/10-02-geo-305-manual-collection/evidence/compose.validation.yaml run --rm backend-test pytest tests/integration/test_geo_batch_creation.py tests/integration/test_geo_answers.py tests/integration/test_geo_answer_files.py —— 56 passed。
- 人工输入/identity/hash单元：18 passed；人工旅程/证据/事务集成：21 passed；边界初轮最终：7 passed；修订边界+非空前滚：19 passed；两项migration metadata/safe-stop检查：2 passed。
- make contract-generate、make contract-check、make lint、make typecheck —— 通过。typecheck后端137文件，前端tsc。
- make test-unit —— 最终后端2704 passed、前端1067 passed；首轮6项失败为新端点/响应数量、nullable annotation和新增文件引用的既有固定断言，按权威合同修正后失败范围先验，完整门禁通过。
- make test-integration COMPOSE='docker --context colima compose -f .trellis/tasks/10-02-geo-305-manual-collection/evidence/compose.validation.yaml' —— 首轮742 passed/1 failed，失败为既有0050 head断言；修改为0051且定向migration通过。修订后最终755 passed、16 warnings，exit0；两类既有SQLAlchemy metadata warnings未视作无警告通过。
- git diff --check —— 已通过，最终状态及文档更新后再次通过。

具体命令、原始日志、初轮失败分类和最终结果见evidence/validation-results.json及各log。没有运行make verify、build、浏览器E2E或browser matrix：本任务没有页面或前端交互变更；新的人工API旅程由真实session/PostgreSQL/本地OSS集成观察。真实外部AI平台未作为普通测试调用。

## 环境和工作树

任务起点429文件SHA256和完整baseline副本用于区分已有脏改动，当前分支本来为geo/GEO-305。仅本任务实现文件列入implementation-files.json；最终对照baseline审查，保留其它任务工作。新维护源码最大464行，无依赖升级。

隔离Compose项目partsignal-geo305-validation，测试专用PostgreSQL/Redis/fake-OSS。初始Colima停止，本任务启动；完整验证后仅清理本项目容器/卷，恢复初始Colima状态，未操作生产或开发业务库。compose down --volumes已确认三服务容器、两个专用卷和网络删除；colima stop exit0，随后colima status明确not running；docker context恢复default。精确证据见environment-restored.json和清理日志。

## 已知限制和后续

分析尚未接线；NOT_IMPLEMENTED不是投递成功。人工敏感裁剪仍由操作者负责。草稿保留扫描归GEO-901；本任务只把现有真实文件引用与解绑保留接入GC。0051不可安全降级，需前向修复/备份恢复。metadata检查中的SQLAlchemy循环FK/dialect_options warnings来自既有模型结构，相关比较结果通过，不称无警告通过。

下一直接任务GEO-306（Batch/Run列表与详情读模型）仍planned；之后GEO-307页面、GEO-308 R2验收，以及对应Collector/分析/保留任务均未实施。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-305 的实现与测试证据。”据此仅将manifest的GEO-305从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节、原始evidence及独立复核审计保留验收前历史状态、实际验证与已知限制，不改写测试结果。本次仅记录GEO-305人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；未重跑实现阶段测试。
