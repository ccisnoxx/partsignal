# 14项功能本地集成交付候选

日期：2026-10-26。状态：LOCAL_SCOPED_CANDIDATE_READY_FOR_REVIEW。CORE-01～06、AUTO-01～02、MAN-01～06均保持review；父任务继续in_progress。未提交、推送、部署或记录用户验收，未启用自动调度。

## 精确范围与候选身份

- 基线commit：`a4f9bbd581aa558cb3567d6da1f0c5509998bfd0`。候选以该HEAD加[精确补丁](local-candidate/candidate.patch)构造；不使用当前index、不包含原74项暂存删除。
- [机器清单](local-candidate/manifest.json)：229个payload路径，136修改、93新增；backend107、contracts2、deploy脚本1、docs4、frontend115。逐项列出归属、change、mode、候选/工作区/HEAD的SHA256（新文件无HEAD hash）。另列60份支持记录，不把任务恢复索引当成提交清单。
- payload指纹：`1ec49d1aba20ee232e371e8995a395b23fc3b19b6994354058ddea38e54c59d0`；算法见manifest。patch SHA256：`5a28582d588dd72622412f134c43ddf4dbfa49742e35f64f874fbf70f1ff98e9`。
- 两个片段选择：publication.fixture.ts只纳入CORE-04所需末行export；SHA256SUMS只纳入方法说明、人工SOP、API设计三条hash。两个原工作区文件均不回退、不改写；不能用工作区整文件替换这两个候选内容。
- 其余内容删除恢复、T6-P fixture、表格焦点、部署内存与配置、AI工作流治理、OSS跟进等域外内容不纳入补丁。patch包含的是对HEAD的精确增量，应用时无需暂存或修改index。
- 补丁已在第二份HEAD干净源码副本检查并应用；229文件hash逐项匹配，候选文档138条校验和全部一致。最终backend全树与实际执行竞态的副本逐字相同。

## 依赖与恢复

现有0066→0067(AUTO-01)→0068(AUTO-02)→0069(MAN-01)→0070(MAN-02)迁移及0070 SQL载荷均包含。未来交付需要配套前后端协议，尤其新人工提交的显式引用观察声明；不通过旧新客户端混用绕过声明要求。0067～0070拒绝破坏性downgrade，应采用前向修复或迁移前备份恢复。

CORE-01/02与MAN-02共用指标读取；CORE-01/06、MAN-01/04共用运行详情；AUTO-01与MAN-03共用计划入口；MAN-02/04/05/06共用人工表单，MAN-05/06使用最终共享上传生命周期。本候选按14项集成成果整体纳入这些关系。worker/beat接线源码属于AUTO功能，但本轮没有运行Worker/Beat、保存启用配置或扫描自动窗口。

## 本轮新增验证及失败诊断

详细命令、逐例schema head、PG版本、日志及复用矩阵见[verification.json](local-candidate/verification.json)。使用本轮专用本机PostgreSQL17.11与开发对象存储；fixture随机库迁移到0070，原文和虚构证据走真实字节/HEAD边界，不连接共享/线上数据库或真实平台。

实际选集：`test_geo_manual_cancellation.py::test_cancel_and_submit_serialize_at_real_batch_run_lock`（cancel/submit两赢家），`test_geo_manual_races.py`（取消先提交；提交先于取消/保存；保存先提交，共四例）。两类测试均通过pg_blocking_pids观察真实等待。

首轮5 passed/1 failed：最后一例的锁等待、409 REVISION_CONFLICT/current_revision1、赢家草稿与审计均正确，仅旧raw JSON比较要求新增nullable字段以NULL持久化而失败。按MAN-02旧canonical字节保持合同，只修`test_geo_manual_races.py`末尾断言，显式检查回执None、持久化省略该字段、其余完整内容相等和revision1，业务代码不改。随后只复验该项1 passed，复用另外5项，总计六个有效用例，不能表述为修正后全组六项重跑。该测试Ruff通过，独立窄复核确认未弱化竞争保证。

环境准备曾先遇macOS Unix socket路径超限，以及来源探针/var和/private/var别名差异；分别改为本轮PG仅TCP、两侧resolve后检查，业务测试函数当时未执行，未修改项目配置。生产代码与策略未因这些问题调整。

## 证据复用和交付前提

14任务原implement.md中的真实PG、单元/组件、定向浏览器、合同和静态结果按未变输入范围复用。verification逐项列出记录hash及后续共享路径；共享源码和schema曾演进，不能把历史数量相加或宣称当前精确候选全套一次通过。CORE-04 fixture剔除的T6-P证据不移作CORE-04验收。本轮没有重新运行浏览器、前端构建、全量检查或Runtime/OpenAPI生成检查。

范围独立复核见[scope-review.md](local-candidate/scope-review.md)：初稿两处P2归属问题已通过片段切分闭合，新增导入/迁移闭合，OpenAPI和generated AST语义对应，最终无新增范围阻断。独立复核不等于独立重复执行测试。

仍需后续按授权审阅/提交推送和正式候选冻结；准备部署指定commit时按部署合同执行make verify-release及相应恢复/现场门禁。当前没有不可变发布镜像或正式release manifest。真实浏览器剪贴板、真实图片栅格、文件服务/存储上传与用户业务验收不由stub证明；上传保留NOT_RUN_NO_EXISTING_PLATFORM，不新建平台或自动跟进来闭合。

## 工作区保护与资源

本轮工作区只修一处现有竞态测试，并在本父任务追加候选/证据记录；SOP修正文案继续原样保留。HEAD/index、原74项暂存删除、所有其他任务和业务文件按基线核对，见[保护记录](local-candidate/preservation.json)。补丁和清单属于明确交付物；本轮专用数据库、存储、两个源码副本及一次性运行脚本在证据转存后清理，不保留后台服务。

## 定向复核补记（2026-10-26）

对修正后的 verification.json 和 manifest.json 的定向只读复核已完成，详见[复核补记](local-candidate/scope-review.md#2026-10-26-证据命令-p3-定向复核补记)。两轮解释器绝对路径、探针执行上下文及证据哈希一致，原解释器路径记录问题P3已闭合（P3_CLOSED），本次定向范围未发现新的确认问题。

本次复核仅使用JSON、探针源码静态及SHA-256核对，未重跑测试或启动服务；原六项有效用例、229文件候选和补丁均不变。本轮补记只更新候选说明、复核记录及manifest中复核记录的证据哈希，verification.json及其已核对哈希保持原样。

14项功能继续review，父任务保持in_progress；部署、用户验收与发布门禁前提继续按上文保留。原未提交内容和74项暂存删除保留，不提交推送、不操作线上、不启用自动调度，上传缺口仍为NOT_RUN_NO_EXISTING_PLATFORM。

## 本地候选收尾

2026-10-26，最终只读一致性核对通过，未发现新的确认问题；本地候选准备与记录一致性核对阶段收尾。核对结论见[最终一致性核对记录](local-candidate/scope-review.md#最终一致性核对与本地收尾)。原P3保持已闭合（P3_CLOSED），候选说明与复核记录的结论、链接及manifest证据哈希一致。

本次沿用已完成的JSON、静态及SHA-256核对与原有效证据，仅补记收尾结论并同步scope-review.md在manifest中的哈希；verification.json、探针、原日志及六项有效竞态结果保持原样。229文件payload指纹仍为`1ec49d1aba20ee232e371e8995a395b23fc3b19b6994354058ddea38e54c59d0`，补丁SHA-256仍为`5a28582d588dd72622412f134c43ddf4dbfa49742e35f64f874fbf70f1ff98e9`。

剩余交付前提：

1. 最终交付范围的接受、暂存/提交、推送分别依后续明确授权安排。当前14项功能均保持review、completedAt=null，父任务继续in_progress；本次没有归档任务或记录用户验收。
2. 正式发布候选按[部署合同](../../../docs/Hostdzire部署上线流程.md#3-repository-与-candidate)从clean、已推送main形成，冻结不可覆盖源码归档、backend/migration/frontend镜像身份及正式release manifest。当前本地补丁与清单未形成这些发布工件。
3. 准备部署指定commit时，按部署合同安排make verify-release及实际变化对应的现场检查；有效旧证据按未变输入复用。本次未执行发布门禁、全量测试、构建或镜像/升级恢复演练，不增加通过声明。
4. 部署前核实目标实际schema、配置和备份恢复条件，保留0066→0067→0068→0069→0070迁移链及前后端引用观察协议配套。0067～0070拒绝破坏性降级，采用前向修复或迁移前备份恢复；自动调度启用仍需单独授权。
5. 真实剪贴板、图片栅格、文件服务/存储上传及用户业务验收仍按各自实际环境完成。保留NOT_RUN_NO_EXISTING_PLATFORM及原外部等待，不通过本轮新建平台、浏览器自动化或自动跟进来闭合，也不重复检查OSS自然清理。

本次收尾仅修改候选记录；原未提交内容及74项暂存删除保留，229文件候选和补丁不改，不重跑测试、不启动服务、不提交推送、不操作线上、不启用自动调度。后续工作从上述明确交付前提恢复，不将记录补记本身计作新增功能或测试进展。

2026-10-26收尾后只读一致性复核补记：复核通过，未发现新的确认问题。P3闭合记录、剩余交付前提和证据哈希一致；229文件候选、补丁及原验证结果不变。该轮复核零文件修改、零测试执行、零服务启动，HEAD、全工作区及暂存内容前后一致，原74项暂存删除完整保留。详见[收尾复核记录](local-candidate/scope-review.md#最终一致性核对与本地收尾)。本轮只追加该结论并同步复核记录的manifest哈希，14项保持review、父任务保持in_progress；上列交付前提仍待完成，NOT_RUN_NO_EXISTING_PLATFORM继续保留。
