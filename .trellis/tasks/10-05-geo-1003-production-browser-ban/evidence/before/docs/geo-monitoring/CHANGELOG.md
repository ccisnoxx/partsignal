# 文档包变更记录

## GEO-1002 / R9A V1.0 范围冻结 — 2026-10-05（review）

- 用户明确接受 ADR-007 的人工优先首发范围和配置；能力矩阵区分政策/实现与五类状态，管理员显式评估入口仍待 GEO-1006。
- Manifest/WBS 追加 1002～1010，路线图增加 R9A Release Blocker Closure，runbook 增加 V1.0 Go/No-Go。
- PRD 与业务/状态机/技术架构标明首发执行范围，README 区分当前能力和历史阶段记录，修复四处已确认断链。
- R0—R8 原任务全文/状态与接受记录、ADR-005/006、GEO-1001 和原 production-readiness 保留；运行源码/Schema/OpenAPI/部署脚本不变。
- 当前仍 NO-GO；1002 只交付 review，1003～1010 仅 planned；未生产操作、提交或推送。实际文档验证与独立复核见 GEO-1002 Trellis implement。

## GEO-906 / R8 核心渐进发布准备 — 2026-10-05（blocked）

- 核对903/904/905 done与人工接受；更新当前索引状态，保留904/905现场/容量未验证历史。
- 新核心rollout runbook、低敏证据模板与最终验收矩阵，明确expand/deploy组合批准、enable、MANUAL闭环/内部试用、监控/停止/恢复。
- 修正配置gate的R0旧断言，精确允许已验收geo_cleanup_artifacts注册；18场景、共享Settings和启动零外部调用保持。
- 无OpenAPI/数据库/Alembic/前端/指标/历史/安全/实际运行配置变化，未执行生产动作；R7 deferred不改，Browser现场NOT_VERIFIED、适用性NOT_DETERMINED。
- 生产入口、固定候选、批准和观察期输入缺失；cron/自动evaluator未接线保留NOT_MET，不借906新增功能或宣称全部核心验收。实际检查与阻断见[验收记录](./04-delivery/13-r8-core-release-acceptance.md)及[Trellis记录](../../.trellis/tasks/10-05-geo-906-rollout/implement.md)。

## GEO-905 / R8 大数据量性能和容量硬化 — 2026-10-05（blocked）

- Run列表先窄键分页再加载一页完整投影，保留过滤、total、current/latest、RR与确定性排序；本地100k深页P95由1.008s降至0.169s，临时写274MiB降至3.3MiB。复用现有索引，不引入物化业务权威。
- CELERY_CONCURRENCY成为真实启动配置，默认1、范围1..10，三套Compose不再固定覆盖；不改变PG准入、锁、lease/SENT、预算、prefetch、重投或实际部署容量。
- 新容量入口4项通过：100021存量、1000根批次、100000行实际ASGI流及取消释放、10路threads/prefork重复消息与真实查询计划。prefork约801MiB采样PSS超过staging512MiB，不能直接提高实际并发。
- lint/typecheck/diff-check通过；完整integration原命令1170 passed/6 setup errors，缺显式PG恢复工具；修正本地环境后6项补验证通过，保留原失败及争用负载性能失败记录。
- 无OpenAPI/数据库/ORM/Alembic/前端/业务公式/历史变化。目标环境入口与冻结阈值缺失，依用户限定停止条件in_progress→blocked，不自行done，不实施906、提交或部署。
- 文件增量、精确命令、独立复核和负载局限见[容量记录](./04-delivery/12-r8-capacity-hardening.md)及[实施证据](../../.trellis/tasks/10-05-geo-905-capacity/implement.md)。

## GEO-904 / R8 安全与合规专项复核 — 2026-10-05（blocked）

- 核对903 done及人工接受，按ADR006核心R6→R8执行八项SEC复核；两项只读调查定位实际门禁、展示与材料边界。
- 新增真实PG攻击反例：不可信回答不能触发解密/网络/进程或人工批准；ENGINEER/错误CSRF不能写四条Key/Header路径，拒绝后配置/密文/revision/成功审计不变。
- 本轮不改变OpenAPI/数据库/Alembic、MANUAL/API公式、历史、安全合同、前端或运行开关，不访问真实外部AI。
- 目标环境名称/只读入口/现场材料与适用平台批准inventory尚缺，不能以默认false、新建恢复来源或本地Docker作生产证据；无人工例外，blocked不done、不实施905/906或deferred804～807。
- 本地结果、覆盖限制、失败分类与恢复条件见[专项报告](./04-delivery/11-r8-security-review.md)和[实施记录](../../.trellis/tasks/10-05-geo-904-security/implement.md)。

## GEO-903 / R8 成套备份与隔离恢复 — 2026-10-05（review）

- 同只读RR快照库存/custom dump，逐个实际对象GET/hash；独立backup key认证加密所有资产与清单，备份密钥不进入集合。
- AI/Session/Upload来源密钥配对及包内密钥真实验证；只新建owner随机PG目标，禁止现成/远端目标与继承PG*覆盖，对象仅单次临时树。
- 全表数据与Run Detail/Overview摘要、结构清单、对象完整性、调度窗口并发去重及SIGTERM清理的隔离验收。
- 恢复SQL仅为既有函数的受控search_path执行修复，保留认证DDL、触发器、约束；无OpenAPI/数据库合同/Alembic/指标/历史/前端变化。
- Browser条件性N/A附新建来源部署/PG/配置/材料检查，存在材料则明确拒绝核心N/A；无生产或异地部署声明，不实现904/906。
- 入口与停止/恢复步骤见[Runbook](./03-technical/09-backup-recovery-runbook.md)，实际结果和门禁限制见[实施记录](../../.trellis/tasks/10-05-geo-903-recovery/implement.md)。


## GEO-902 / R8 运行、成本、失败与积压观测 — 2026-10-05（review）

- PG只读RR快照/Prometheus低敏聚合，所有attempt按模式统计、UTCsent日账、未知费用与币种独立、有限稳定ID定位积压/lease/预算异常。
- 0065新增有限operation健康表，短独立事务原子计数不提交业务；Worker本机Heart与targeted ping、Beat tick/publish分开，三环境Compose联合检查PG/Redis/registry。
- GEO固定JSON字段和错误目录，去掉任意异常正文/类型及Celery原始异常链；业务拒绝与系统异常分开。
- 原子textfile、Grafana dashboard、Prometheus告警与持续时间模拟；不将业务低表现、人工待录入或关闭能力当系统故障。
- 无OpenAPI/产品前端/公式/状态机变化、零历史回填；实际命令及未验证生产边界见[实施记录](../../.trellis/tasks/10-05-geo-902-observability/implement.md)。只review，不done、不生产部署、不实施903/905。


## GEO-901 / R8 保留与清理 — 2026-10-05（review）

- 复用权威FileRecord两阶段删除与全部7项实际FK保护；新raw/孤立期限限批预过滤引用，dry-run无DML/存储，存储故障保留DELETING可重试。
- 0064加法新增终态人工草稿墓碑与两个到期索引；Run→Draft→Files锁序、真实过期守卫、原子删除/解绑七天期限、不变性含TRUNCATE；零回填、旧PENDING/正式证据守卫保持、拒绝破坏性降级。
- 新周期任务无payload，默认dry-run；三项期限省略，不推测已批准政策。生产输入五项可选白名单兼容旧runtime且继续拒绝未知/非法输入，无公共API/UI或指标变化。
- 保留边界、引用/共享附件、锁竞争、存储与完成事务故障、预览和生产配置有定向实际证据。独立复核三项已重现并修正；完整集成1146通过/8旧head或历史ORM预期失败，修正后48项定向均通过，精确命令和版本边界见[实施记录](../../.trellis/tasks/10-05-geo-901-retention/implement.md)。
- Browser仅本轮已检查开发环境N/A；不宣称生产状态。未实施903恢复或其他后续任务，状态仅review，不提交、发布或自行done。


## 人工优先与 Browser 延期范围调整 — 2026-10-05（决策 Accepted，治理交付 review）

- 用户明确接受[ADR-006](./05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)：MANUAL 回答级观测为核心正式采集方式，R6 直接进入 R8，R7 为 post-core 可选扩展。原 ADR-005 首发条件被显式替代，安全和平台批准门禁保留。
- GEO-801～803 保持 done，代码/测试/验收证据不回退；804 blocked→deferred，805～807 planned→deferred，release=post-core，补原因、恢复条件和待定责任。保留804原阻断与基线历史，不伪造完成。
- R8 的 Browser 临时清理/会话恢复条件适用，未部署且无材料时有依据地记录 N/A；904/906 必须验证 Browser false、服务未启用且无生产会话。延期不阻断核心，也不豁免实际材料保护/清理。
- 新增[人工观测 SOP](./02-business/05-manual-geo-observation-sop.md)，覆盖计划Run、精确问题、环境、完整回答/引用/截图、缺URL、冻结、分析复核和重复采样；部分引用不完整必须留草稿补证，复核不放行缺失样本。
- 产品/业务/技术、路线图/WBS/manifest、任务模板、执行指南、单任务与合并提示词同步；修正合并提示词69个旧索引锚点。OpenAPI、数据库、迁移、运行配置与MANUAL/API行为、指标、历史无变化，没有实现真实Browser Adapter或访问第三方平台。
- 实际本轮验证、独立只读复核与限制见[治理实施记录](../../.trellis/tasks/10-05-geo-browser-scope-adjustment/implement.md)；不宣称生产开关/会话或R8上线已实测，不提交、发布或归档。

## GEO-803 / R7 本地模拟AI产品与Browser合同 — 2026-10-05（review）

- 新增完全回环的streaming/引用/登录/selector漂移/挑战页/敏感UI模拟站和可复用Adapter合同。
- 测试专用参考实现与违规驱动自测；真实POST计数/哈希，既有Collector类型校验，打印前canary扫描。
- CI采用同版Playwright独立network none容器；根make e2e先通过本地合同，不放宽生产安全配置。
- 无OpenAPI/数据库/Alembic/前端行为变化，不实施804真实Adapter或805证据捕获。
  实际结果与限制见[GEO-803实施证据](../../.trellis/tasks/10-05-geo-803-browser-contract/implement.md)；只交付review。

## GEO-801 / R7 独立 Browser Collector 骨架 — 2026-10-05（review）

- 独立package/锁文件/镜像与三环境共享geo-browser profile，默认关闭并保留默认STOP。
- 非root Chromium sandbox、只读根、资源限额和network_mode none；真实离线DOM健康与会话NOT_IMPLEMENTED区分。
- 稳定UUID内部入口显式拒绝，普通API Worker忽略误投非API Run，不创建lease或改写历史。
- 无新OpenAPI/DDL/Alembic、会话/真实平台/截图/管理UI。实际验证与独立复核见[实施记录](../../.trellis/tasks/10-05-geo-801-browser-collector/implement.md)；仅review等待人工接受，不实施802/803。


## GEO-707 / R6 机会闭环 E2E、审计与验收 — 2026-10-04（review）

- 补真实新建机会的 `geo_opportunity.opened` 同事务最小审计；重放、追加评估和未触发不重复创建事件，显式 request_id 不进入幂等指纹。
- 补前端复测审计动作及闭合安全字段登记，未知字段继续失败。
- 新增真实分析/规则、ContentTask 完成、严格 RETEST 与显式解决的 PG/真实栈浏览器纵向验收，并登记默认 E2E 入口。
- 不改变样本、指标、状态机、安全或生产门禁，无 DDL/历史回填。实际结果、独立复核和限制见 [R6 验收](./04-delivery/10-r6-opportunity-acceptance.md) 与 [实施记录](../../.trellis/tasks/10-04-geo-707-r6-acceptance/implement.md)；仅 review，不自行 done，不实施 GEO-901/902。


## GEO-706 / R6 干预比较与机会解决 — 2026-10-04

- 新增比较 GET、显式 resolve/continue 和服务端恢复裁决；前后窗口、样本与排除、完整环境/模型/采集方式及冻结恢复参考可追溯，单次变化不宣称因果。
- 首次触发历史身份固定，复测采用最新有效证据；CAS、比较指纹和 User→有序 Batch→有序 Run→Opportunity 锁保护选择，状态/处理历史/安全审计原子提交。
- 0062 加法新增不可变 decision 历史和提交守卫，无历史回填；人工解决独立于复测恢复，继续保持 IN_PROGRESS。前端只消费 generated OpenAPI，不复算指标或恢复政策。
- 精确命令、前滚和独立复核证据见[实施记录](../../.trellis/tasks/10-04-geo-706-retest-comparison/implement.md)。本地完成后仅 review，等待人工接受；GEO-707、Browser、生产保留和上线均未实施。

## GEO-705 / R6 严格复测规划与基线冻结 — 2026-10-04

- 新增只读差异预览与严格复测创建；完整复制首次触发来源批次的矩阵、输入和规则，未知或变化的必要版本显式阻断。
- 基线、RETEST、机会 revision、回执和审计原子提交；同键重放、不同键 CAS 与配置锁保证并发不重复。0061 新增不可变基线/回执和提交时逐单元守卫，无历史回填，旧无回执 RETEST 迁移安全停止。
- 契约、generated 类型、SQL 旁路/迁移和真实 HTTP/PG 验证见[实施记录](../../.trellis/tasks/10-04-geo-705-retest-planner/implement.md)。本地交付仅 review；结果比较/解决、Browser 和生产上线未实施。

## GEO-704 / R6 跨域行动集成 — 2026-10-04（review）

- 三个行动API调用现有事实、内容和发布领域服务；事实导航到唯一Markdown工作区，内容使用已批准事实和活动发布平台，发布可创建/关联开放问题及创建唯一修复任务。
- 行动、机会revision、来源快照及成功审计一次提交；actor/key幂等、完整请求摘要、最终CAS与失败整体回滚。目标完成不自动解决机会。
- 0060加法保存行动回执及来源身份，历史缺失快照保持null；不可变和普通删除守卫保留，合法归档aggregate永久删除后显式显示目标缺失。
- 更新根合同、generated类型、已有行动导航及相关架构说明；基线、真实PG反例、完整门禁与独立复核修正见[实施记录](../../.trellis/tasks/10-04-geo-704-action-integration/implement.md)。只交付review，复测/比较/解决留705及以后；无生产迁移或上线。

## GEO-702 / R6 Opportunity 模型与批量评估 — 2026-10-04

- 新增opportunities/sources/actions及追加评估记录，确定性SHA身份、开放态partial unique、来源去重和完整规则触发快照；低样本/不可比/阈值未配置仅记录不可用。
- 十条纯规则复用既有公式/current有效分析及Review；质量和连续失败使用完整批次/profile治理候选，业务筛选不隐藏分母或成功打断项。
- 0059加法前滚、RESTRICT身份与Batch来源FK、状态/revision和不可变守卫；非空历史逐行保留，悬空旧引用原子停止，无回填或生产迁移。
- OpenAPI仅增加数据组件并重生成前端类型；不接线703API/工作台、704行动、705/706复测/解决。实际命令、独立复核与限制见[实施证据](../../.trellis/tasks/10-04-geo-702-opportunity-evaluation/implement.md)，仅review不自行done。

## GEO-607 / R5 洞察性能与验收 — 2026-10-04

- 新增真实PG虚构100k Run fixture、固定30天/前期的认证HTTP P95、实际EXPLAIN及稀疏/密集固定查询数门禁；性能目标纳入make verify。候选/合格数量严格断言，空结果不能假通过。
- 0057只新增Run日期访问索引，无表/列/历史回填；有界事务DDL与仅索引撤销，历史逐行对账保持。
- 按实际CPU/计划证据优化冻结binding筛选、完整输入去重、Core Row、UUID数组参数、请求内URL/维度/绑定元信息及原指标owner的批量基础资格；专属公式、current/latest、SOV、权限和不可变守卫保持。
- OpenAPI/generated/前端无本任务变化。初期失败、原始样本、三个独立复核及最终完整门禁以[GEO-607实施记录](../../.trellis/tasks/10-04-geo-607-insight-performance/implement.md)和[R5性能验收](./04-delivery/06-r5-insight-performance-acceptance.md)为准；技术交付仅review，人工接受不自动完成。
- GEO-902/905、Opportunity行动、Browser及生产启用没有实施。

## GEO-605 / R5 总览与回答洞察前端 — 2026-10-04

- 新增总览和回答洞察路由，保留文章关系洞察及打印入口；URL 与 query key 统一管理完整筛选、明细选择器和分页。
- 展示服务端指标卡、双窗口趋势、产品矩阵、问题覆盖、平台表现、SOV、引用、事实风险、质量费用及版本。null、低样本、不可比与未知费用保留原义，无客户端业务公式或总分。
- 所有图形提供可访问表格，明细保持完整服务端筛选与只读证据；键盘焦点、异步取消、响应式与真实 API 证据见 [实施记录](../../.trellis/tasks/10-04-geo-605-insights-ui/implement.md)。
- API、数据库和 Alembic head 不变，不实施 GEO-606/706、行动闭环、Browser 或生产启用；状态仅 review，仍需人工接受。

## GEO-604 / R5 引用、事实风险与质量洞察 — 2026-10-04

- 扩展回答级insights及运行贡献指标，新增引用、声明和质量运行三个只读GET；公开摘要/下钻、域名覆盖、事件分母及有效current review身份。
- 共享域名、review backlog与去重排除计数进入质量说明；费用按币种、未知不补零，采集及分析版本保留真实null与覆盖分母。
- 对齐PRD旧判断标签到已批准UNJUDGEABLE枚举，补方法§21、API、只读数据库合同和追踪证据；不改变601公式、ADR、状态机或安全边界。
- 无DDL/Alembic/回填，前端只重生成OpenAPI类型；605、702、Browser和生产启用均范围外。最低门禁及独立只读复核的实际结果见[实施证据](../../.trellis/tasks/10-04-geo-604-citation-risk-quality/implement.md)。状态由manifest记录，本地完成后仅review。

## GEO-507 / R4 人工复核与当前结果 — 2026-10-03（review）

- 新增confirm/correct复核API和闭合请求/回执，锁后重验当前账号、Run revision、成功analysis与四栏归属；复核、revision、首次完成及安全审计原子提交。
- 详情返回机器及review历史和最新有效投影；latest Review不累计旧修正，新成功pointer使旧复核仅作历史。未完成必要复核阻断业务指标使用，完整资格仍未实现。
- 0056只扩展受控Run发布guard，无新增表/列或历史回填；旧Review不能授权新终态更新，采集字段继续冻结，降级安全停止。
- 真实PG权限、并发、旧review supersede、correction schema、读一致性、失败回滚和非空前滚证据见[实施记录](../../.trellis/tasks/10-03-geo-507-run-review/implement.md)。只同步generated类型和fixture，不实现508页面、601指标或其他后续任务，不自行done。

## GEO-506 / R4 Analysis Worker 与 revision 生命周期 — 2026-10-03（review）

- 接入COLLECTED claim、冻结输入hash幂等、追加revision和四段确定性规则；结果/current pointer/首次Run与Batch状态原子提交。
- 独立revision lease、提交后UUID派发/数据库补投递、过期失败和旧token拒绝；失败保留AnswerSnapshot/原始Citation，重分析不倒退采集终态。
- 0055只新增Job元数据与不可变引用分类，RESTRICT/guard/延迟装配保护，无历史回填；停新Worker后前向修复。
- 内部管理员reanalyze及受控原因码审计；无新OpenAPI operation/前端，GEO-507复核/读取、指标/Opportunity/Browser仍未实现。
- 基线、实际门禁、独立复核修正和限制见[实施记录](../../.trellis/tasks/10-03-geo-506-analysis-worker/implement.md)；状态以manifest为准，不自行done。

## GEO-505 / R4 声明和事实核验 — 2026-10-03

- 只读批量装配每个产品最高合格 APPROVED FactVersion，绕开编辑工作区和陈旧 ORM 状态；正文仅本地比较。
- 十类声明使用明确属性及条件规则；事实不足、冲突和未知表达保守 UNJUDGEABLE，关键替代和高危错误要求复核。
- 新增独立声明金标、共享声明金标对照与真实 PG 资格验证；结果与修正见 [实施记录](../../.trellis/tasks/10-03-geo-505-claim-assessment/implement.md)。
- OpenAPI/表结构/Alembic 不变，数据库合同补充选择规则；无 Worker/前端接线、指标、Opportunity 或 Browser。本地验证后仅 review，不自行 done。

## GEO-504 / R4 引用归属和来源类别 — 2026-10-03

- 纯引用阶段使用规范 hostname 的相等/点分子域边界；复用原始 IDNA 身份与 Citation ID、实际位置，不使用字符串 contains 或 URL 路径推测归属。
- 依据 Subject 类型和显式域名关系确定自有/竞品/经销商等类别；第三方类别只消费显式版本化字典，未知为 UNKNOWN。共享/重叠保留全部候选，类别冲突要求复核。
- 人工修正复用已有引用修正组件，返回独立投影并保留机器证据；真实 PostgreSQL 证明原始引用不变、越界拒绝和新分析后旧复核不覆盖。
- 无 OpenAPI/数据库/Alembic、事务/锁/状态机、Worker 或前端接线变化。实际门禁、首轮测试构造与类型检查修正见 [实施证据](../../.trellis/tasks/10-03-geo-504-citation-attribution/implement.md)。本地验证完成后仅 review；不自行 done，不实现后续任务。

## GEO-503 / R4 推荐分类与可靠位置 — 2026-10-03

- 从冻结提及输入生成RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN、原文依据、可空rank和复核原因；名称出现不自动等于推荐。
- 对象分句/并列/否定/条件/冲突显式判定；只有可靠优先级语义与一致位置证据产rank，不按字符位置、普通编号或项目符号排名。
- 新增独立推荐金标，实际对照共享13场景且不改写旧预期；复用离线Schema/引用/隐私校验。初次失败、修复及最低门禁见[实施记录](../../.trellis/tasks/10-03-geo-503-recommendation-ranking/implement.md)。
- 无OpenAPI/数据库/Alembic、事务、锁、状态机、Worker或前端变化；GEO-506及指标/Opportunity/Browser均未实施。完成本地验证后交付review，不自行done。

## GEO-502 / R4 别名快照与确定性提及 — 2026-10-03

- 从已校验分析输入复制不可变字典，保留身份/revision/别名种类/语言；canonical_name 参与匹配，不猜 display_name 或未登记的无连字符形式。
- 纯函数输出原文字符位置、计数、匹配别名与否定线索。统一检查整个匹配键的型号边界，不能按对象类型过滤候选而隐式消歧；共享、规范化碰撞和重叠均返回全部候选及 ALIAS_AMBIGUOUS。
- 新增独立 mentions-v1 金标，并实际运行既有13场景；新金标复用离线格式/证据关系/敏感数据边界。完整命令及先红后绿反例见 [实施记录](../../.trellis/tasks/10-03-geo-502-mention-matching/implement.md)。
- 无 OpenAPI/数据库/Alembic、事务、状态机、Worker 或前端接线；推荐、声明和分析 revision 提交留后续任务。最终交付状态以 manifest 为准，不自行 done。

## GEO-501 / R4 分析与复核契约和表 — 2026-10-03（review）

- 新增分析输入、revision、三个子结果、类型化复核与当前选择组件；无新公共 operation。
- 0054 增加六张表和 Run 显式 current pointer；完整输入哈希、强事实引用、单调 revision、不可变历史、追加复核及并发防线由 PostgreSQL 保证。历史数据不回填，破坏性降级安全停止。
- 接入事实/复核者删除阻断与 Catalog 实际分析引用计数；前端仅重生成类型和补齐删除阻断元数据。
- 隔离空库前滚、非空 0053 历史保留、unique、UPDATE/DELETE、哈希与双连接反例通过；完整命令、初次失败及定向修复结果见 [实施证据](../../.trellis/tasks/10-03-geo-501-analysis-contract/implement.md)。独立只读复核与审计已完成。
- 不实现 GEO-502～508、指标、Opportunity 或 Browser Collector；本地验证后交付 review，等待人工接受。

## GEO-408 / R3 API 自动观测 — 2026-10-03（review）

- 补齐活跃 Run 自动读取、费用/独立 usage/外部调用状态/HTTP 与 Retry-After、安全错误和显式新 attempt。
- 无幂等键命令的 pending/unknown 阻断属于会话，跨详情关闭/切换保留，未知回执只读尝试链；后台读取由 Query focus 管理恢复。
- 新增隔离真实 API/PG/Celery + loopback fake provider 三阶段验收与 R3 运维说明，生产批准、分类、安全边界及 Alembic head 不变。
- 完整 make e2e 与 make verify 均退出0；canonical真实26、GEO三个阶段各1、页面498通过/58条件跳过。两次独立只读复核完成，子代理审计已校验。
- 实际门禁、失败修复和人工接受状态以 [实施记录](../../.trellis/tasks/10-03-geo-408-api-acceptance/implement.md) 与 task-manifest 为准，不自行标记 done。

## GEO-308 / R2 — 2026-10-02

- 补齐确定锁等待的取消/提交和草稿/提交竞态，以及已提交聚合和取消终态的 SQL 不可变验收。
- 补齐新旧 GEO 导航、旧书签和历史详情刷新；上传证据使用实际对象字节/hash，观测面只读验收采用独立账号。
- 新增 R2 试用边界与验收记录；生产合同、Alembic head 和状态机不变，取消公共命令与自动采集仍未接入。
- 实际门禁与 review 状态以 GEO-308 实施记录和 task-manifest 为准，不自行标记 done。


## GEO-307 运行中心与人工证据页面 — 2026-10-02（review）

- 新增运行中心双层列表、完整批次summary、URL筛选分页/选择和计划批次创建。
- RHF人工草稿、dirty/409输入保留、真实截图上传与canonical文件恢复、引用编辑、同键提交恢复和只读证据详情。
- 组件和真实栈Playwright验证保存刷新、三次人工采样、哈希/截图/引用位置及375/768/1024/1440宽度，编辑器另验证CSS 200%缩放。前端1121项测试与静态检查通过；完整make e2e保留两项既有失败，定向真实栈和补充fixture通过，未将完整门禁标为通过。独立复核与审计聚合限制见[实施记录](../../.trellis/tasks/10-02-geo-307-run-center/implement.md)。
- 不新增根合同或Alembic，不交付Collector/分析/指标/机会；本地验证后进入review，等待人工接受。

## GEO-306 Batch/Run 稳定读取 — 2026-10-02（review）

- 五个GET与13个公共读模型组件，同一RR快照返回冻结输入、原始证据、summary、attempts与真实时间线。
- 最新cell状态与完整attempt费用分离；筛选分页和固定批量查询，当前资格与冻结历史分离。
- 大文件限时签名，data quality为NOT_IMPLEMENTED/null；没有新持久化schema或Alembic revision，没有GEO-307页面或后续引擎。
- 实际门禁、独立复核及环境恢复见[实施证据](../../.trellis/tasks/10-02-geo-306-read-model/implement.md)。本地验证完成，已进入review，不自行done。

## GEO-305 MANUAL 草稿与正式提交 — 2026-10-02（review）

- 依赖 GEO-303、GEO-304 均已人工 done；任务 planned→in_progress→review，等待人工审查。
- 三个人工端点及七个公共数据组件；未保存revision0、独立草稿冲突与同值保存、提交身份摘要及稳定回执。
- 一次事务冻结Answer/Citations/Files并清除草稿、Run推进COLLECTED、完整Batch投影、最小成功审计；失败全部回滚，证据实时GC和账号历史引用完整接入。
- 0051仅expand两表/守卫，无历史回填；不可变提交身份，降级安全停止。分析回执明确NOT_IMPLEMENTED，不创建队列或分析假成功。
- 实际门禁、并发/证据/非MANUAL反例、独立只读复核及环境恢复见 [实施证据](../../.trellis/tasks/10-02-geo-305-manual-collection/implement.md)。没有GEO-306或其他后续实现。


## GEO-304 原始回答、引用与证据防线 — 2026-10-02

- 新增闭合回答/引用组件和 0050 两张不可变证据表，原文 UTF-8 SHA-256 由数据库生成。
- 引用按规范 URL 去重并保留全部实际位置；原始引用不保存分析分类/匹配事实。
- 文件引用使用 RESTRICT、真实 HEAD 资格复核和 GC 防线；raw summary 不接受任意正文、Header 或 secret。
- 提交完整性、UPDATE/DELETE/追加反例及前滚/安全停止证据见 GEO-304 Task Brief；状态进入 review 后等待人工接受，不标记 done。


## GEO-303 批次工厂、计划快照和创建幂等 — 2026-10-02

- 从计划与临时完整配置冻结安全快照，原子创建Batch与根Runs，稳定回执与用户作用域手工幂等共用两个API入口。
- 内部调度工厂规范UTC窗口，不含plan revision；只创建，不计算窗口或派发。
- 0049增量创建身份与主体历史关系，回填既有快照引用；接入真实删除保护和最小成功审计。
- 真实PostgreSQL覆盖同键并发、1000 runs、配置变化及全回滚；最终状态与门禁/独立复核证据见GEO-303 Task Brief，不自行标记done。

## GEO-302 Batch/Run 状态策略与动作投影 — 2026-10-02（review）

- GEO-301已人工done；GEO-302 planned→in_progress→review，等待人工接受，未实现GEO-303。
- Run合法边/终态/模式与答案事实、过期撤销lease恢复、采集retry/cancel资格和typed workflow；非法转换稳定409，retry追加attempt而非回退。
- Batch以完整初始cell集合的最新attempt确定性投影，非终态优先，不择优答案；独立复核发现遗漏真实后继会误投影，先红后绿修复并复核。
- 新增8个独立OpenAPI组件和generated类型，无operation、数据库schema/Alembic revision、HTTP/Worker、页面或真实外部调用。
- 最终1355定向、2636后端单元/1067前端单元、656集成以及contract/lint/type/diff门禁通过。既有0048隔离前滚、精确命令、复核审计和环境清理见 [实施证据](../../.trellis/tasks/10-02-geo-302-state-policy/implement.md)。

## GEO-301 Batch/Run 数据契约 — 2026-10-02（review）

- 依赖 GEO-208、GEO-002 已 done；任务仅 planned→in_progress→review，等待人工接受。
- 新增 21 个公共数据/快照/状态/错误组件、generated 类型、独立两表和冻结 0048 迁移；Plan run-now 仍 501。
- 数据库冻结输入/身份和四种 Run 终态，cell/attempt 唯一、同输入连续链及唯一后继；提交时初始 root 数相等，同调度窗口唯一不含计划 revision；Batch 状态可重建。
- SQL 外壳限制敏感扩展键和叶子类型，lease token 仅内部使用，费用未知不补零。旧 GeoObservation 非空历史保持原样；downgrade 明确安全拒绝，恢复前向修复/备份。
- 状态策略、创建工厂/锁存、答案与 Collector 均留各自后续任务，没有真实外部请求、历史回填或生产迁移。实际命令、诊断、独立只读复核和环境清理见 [实施证据](../../.trellis/tasks/10-02-geo-301-batch-run/implement.md)。


## GEO-209 监测计划列表与向导 — 2026-10-02（review）

- 新增 `/geo/plans` 和八步向导，完整配置一次创建/修订；选项分页搜索与跨页保留，角色显式指定。
- 矩阵、模式计数、费用和 blocker 完全使用服务端 preview；字段变化使旧预览失效，blocker 可定位步骤及资源。
- URL 列表/详情、状态确认、归档只读、复制/删除、dirty 与409保留输入，写命令不自动重放。
- 无 OpenAPI/数据库语义或 Alembic 新修订，无 Batch/Run、执行、真实外部平台、指标或机会；本地验证及独立复核见 [实施记录](../../.trellis/tasks/10-02-geo-209-plan-ui/implement.md)。

- Plan真实栈、最终1067项前端测试、lint/types通过；完整verify/e2e保留三项范围外失败，串行部署脚本与Compose配置通过。状态只到review，不自行done。


## GEO-208 Plan命令、查询、状态机与API — 2026-10-02（review）

- GEO-207依赖done；12个标准Plan操作、完整typed读模型、服务端动作/revision/资格与同事务审计已接线，状态等待人工验收。
- 新建/复制DISABLED revision0、集合顺序no-op稳定、ACTIVE实际修改重验资格、归档只读；锁旧/新资源并集后锁Plan，锁后重验版本与身份漂移。
- GET/preview认证前RR禁autoflush，列表批量查询；审计仅status/revision，业务失败或审计失败整体回滚，未知数据库异常不冒充业务错误。
- run-now只接受命令边界后501，无成功审计/幂等结果/Batch/Run/dispatch；默认费用仍unknown，不实施GEO-209/301/303。
- 根OpenAPI/generated与数据库语义合同同步；无新Alembic revision、历史迁移或生产操作，head仍0047。实际测试、独立复核和环境清理见[GEO-208实施记录](../../.trellis/tasks/10-02-geo-208-plan-api/implement.md)。

## GEO-207 服务端运行矩阵预览和费用覆盖 — 2026-10-02（review）

- GEO-206、GEO-204 已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- RunMatrixBuilder 唯一计算 prompt×profile×repeat，10×3×3=90；Subject 不乘入、同 Surface 的不同 Profile 不合并，缺失/停用不删格，三模式及 unresolved 数保持完整。
- 资格复用 GEO-204，blocker/warning 定位资源；内部估价保留 Decimal、分币小计与 known/unknown 运行覆盖，默认全部 unknown/null，包括人工模式。明确零、部分估价、预算相等/超出、混币与未知预算均有固定语义。
- 只读应用服务要求调用方 RR/SERIALIZABLE 快照，三次批量 SELECT 禁 autoflush，无锁/写/commit/rollback、秘密正文或外部请求。根 OpenAPI 仅追加预览数据组件，前端仅同步 generated 类型。
- 无数据库合同、ORM 或 Alembic 变化，既有 head 为 0047，无历史迁移或生产操作。没有 Plan API/页面、Batch/Run、Collector 定价/执行预算、指标或机会；GEO-208/303 未实施。
- 指定门禁、定向矩阵/真实 PostgreSQL 证据、独立只读复核与环境清理见 [GEO-207 实施记录](../../.trellis/tasks/10-02-geo-207-run-matrix/implement.md)。

## GEO-206 MonitoringPlan 数据契约 — 2026-10-02（review）

- 依赖 GEO-202、GEO-205 均已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- 新增闭合配置组件与 generated 类型、四表 ORM 和 0047；计划状态、repeat、Cron/IANA 时区、预算、rule_set_revision/revision 与追溯字段一致，没有运行状态。
- 至少一个 PRIMARY、prompt、profile、关系唯一和 RESTRICT 删除阻断由真实 PostgreSQL 验证；可延迟约束支持事务内替换，父 Plan 锁与 MVCC 写冲突阻止 RC/RR 的最后 PRIMARY 并发写偏斜。归档标量/关系只读。
- 既有 Subject/Prompt/Profile/User 删除预检和批量投影接入真实配置引用，只精确映射新 FK；不锁存历史首次运行、不冻结配置维护、不改变权限/CSRF/审计。前端只同步类型和删除说明。
- 无数据回填、历史重写、生产迁移或新依赖；不实现 GEO-207/208/209、Batch/Run、外部采集、指标或机会。实际门禁、首次失败诊断、独立只读复核和隔离环境清理见 [实施证据](../../.trellis/tasks/10-02-geo-206-monitoring-plan/implement.md)。

## GEO-205 观测面与 Profile 管理 — 2026-10-02（review）

- GEO-204 已人工接受为 done；交付观测面/Profile 各七个公共操作及管理员工作台，任务等待人工验收，不自行 done。
- 闭合非敏感配置与角色读模型使用 generated OpenAPI；ENGINEER 仅摘要，管理员写入沿用 CSRF。新 Profile 停用/UNTESTED，真实配置更新清除测试资格并停用；启用复用 Registry 资格，未批准 BROWSER 不能启用。
- Application Service 拥有 User→Channel→Model→Surface→Profile 锁、revision、真实引用/历史标记删除保护与原子最小审计；读模型使用认证前 RR 快照。业务错误只映射已知数据库约束，校验错误不回显秘密值或未知键名。
- `/configuration/geo-surfaces` 提供 CRUD、启停确认、服务端阻断、URL 筛选/详情、409 保留草稿和主体/卸载守卫；提交后取消关联旧读取，204 消费完成后再关闭删除详情。
- 无新 Alembic revision 或数据回填，隔离空库前滚到既有 `0046_geo_surfaces_profiles`；仅测试容器只读挂载根合同。没有连接测试、自动 adapter、外部采集、Plan/Batch/Run、指标或会话运维能力。
- 实际门禁、独立复核、真实 API 与桌面/窄屏证据见 [GEO-205 实施记录](../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。

## GEO-204 Collector Registry 与 Profile 资格 — 2026-10-02

- 新增精确 key、不可变元数据、capabilities、validate_profile 和共享配置资格；默认仅 manual。
- 未知/重复 adapter、模式/能力不匹配明确失败；自动模式受批准、环境、合规、启停、测试和功能开关门禁。
- 当前资格从 PostgreSQL 非敏感列一次读取，模型解绑后不复用旧 PASSED，不读取凭据正文或 provider 参数。
- 无公共 OpenAPI/数据库 Schema/Alembic 变化，不创建 Plan/Batch/Run、Worker 或 provider 请求；既有安全与历史边界保留。
- [Task Brief](../../.trellis/tasks/10-02-geo-204-collector-registry/prd.md)与[实施证据](../../.trellis/tasks/10-02-geo-204-collector-registry/implement.md)记录基线、实际验证与独立复核；本地完成后进入 review，不自行 done。

## GEO-203 EngineSurface/Profile 数据契约 — 2026-10-02（review）

- GEO-004/GEO-101 依赖均 done；新增两类主数据公共 components、模式判别 Schema、ORM 与 0046 expand 迁移，只交付 GEO-203。
- MANUAL/API/BROWSER、闭合六项能力、合规枚举、非敏感 settings、同渠道 AIModel 复合 FK、成对 SET NULL 与 User/Surface RESTRICT；新配置默认停用/UNTESTED，revision 和创建身份受数据库守卫。
- PRD 的旧 surface_type/合规名称及技术默认值统一到详细领域与权威根合同。旧行不回填；0046 拒绝有损 downgrade，使用前滚恢复或备份。
- Task 记录保存指定门禁、模式/FK/秘密/迁移直接 SQL 证据与独立只读复核；不把未执行门禁视为通过。无新端点、页面、Registry、运行资格、外部调用、Batch/Run、指标或生产迁移。
- [实施证据](../../.trellis/tasks/10-02-geo-203-surface-profile/implement.md)记录精确结果、初次失败修正和环境清理。

## GEO-202 问题变体 API 与工作区 — 2026-10-02（review）

- GEO-201 已人工接受为 done；本任务按 planned→in_progress→review 交付，等待人工验收，不自行 done。仅实现当前变体配置切片。
- 七个标准 OpenAPI 操作、closed workspace 投影与 generated types；Application Service 拥有业务事务、User→Topic→Variant 锁与 revision、历史冻结、原子最小审计及精确错误映射。列表/详情用 RR、固定 join/count/page，显式维度、字面搜索与稳定分页。
- 独立只读复核发现并修复同账号主题审计FK锁环和同Cookie改密Session锁环：User使用FOR NO KEY UPDATE，舍弃不参与安全决定的pending活动提示；认证、撤销、过期和CSRF保留，三个真实修前死锁与修后回归保存到Task证据。
- `/geo/questions` 支持业务主题选择、显式点名/语言/地区/优先级、CRUD/启停/复制、URL恢复和详情；409/后台失败保留草稿，principal/unmount/dirty守卫；运行入口禁用并说明NOT_IMPLEMENTED。
- 无新Alembic revision、数据回填、生产迁移、Batch/Run、外部采集、指标、机会或GEO-206能力；隔离前滚仍为0045。完整AC-TOPIC-02的至少一个活动变体使用门禁随计划/运行任务落实，不宣称本任务完成该总体验收。
- lint/typecheck/contract、987项后端单元、940项前端、495项PG集成及问题库真实API E2E通过；完整真实栈22 passed/1既有失败，fixture497 passed/48 skipped/1既有失败。隔离数据库、Redis、端口和存储已清理，Colima恢复初始停止状态。
- 实际命令、验证结果、前端真实API E2E和全仓门禁分类见[实施证据](../../.trellis/tasks/10-02-geo-202-question-workspace/implement.md)。

## GEO-201 PromptVariant 契约与数据模型 — 2026-10-02（review）

- 确认 GEO-003、GEO-101 均 done，按 planned→in_progress→review 交付；本地原已位于 geo/GEO-201，保留共享工作树，未提交或自行 done。
- 新增一张 geo_prompt_variants，复用 QueryTopic；公共 closed Schema、BRANDED/UNBRANDED、语言、地区、CORE/STANDARD/EXPLORATORY、revision 及 generated types 一致，无 GEO-202 operation 或页面。
- 0045 只 expand，不回填旧 variants 或改写旧 GEO；UTF8 SHA-256 generated hash、NFKC/Unicode 空白规范化、含停用的五维 UNIQUE、RESTRICT FK 及命名历史/revision 守卫。按当前任务要求收紧历史变体为只能停用，真实消费者未来必须同事务锁存+快照+RESTRICT 引用。
- QueryTopic/User 删除预检计入新表；既有前端仅同步 blocker。27 项初始定向、后端980/前端926单元、481 PostgreSQL 集成及指定合同/静态检查通过，复核后时间守卫补测的最终定向28项通过。独立只读复核无确认阻断问题；coverage gap 与审计证据见 implement.md。
- 隔离 PostgreSQL 16 前滚与安全拒绝降级验证通过；无生产迁移、真实 AI/采集或回答级 Run。未运行 E2E/完整 verify/浏览器矩阵，不能声称这些门禁通过。

## GEO-106 Catalog 纵向验收和产品引导 — 2026-10-02（review）

- 依赖 GEO-105 已人工接受 done；本任务只增加 PostgreSQL 产品事实不变验收、Playwright real API Catalog 流程及使用指南，不新增 Catalog 运行时能力。
- 后端比较整个 Product 行、全部 FactVersion 和审核历史；页面创建 OWN_PRODUCT、竞品品牌/产品及双方 alias/domain，验收规范化、唯一冲突保留输入、URL/刷新和 ENGINEER 只读。新真实用例登记到 canonical E2E 集合，保留隔离、秘密扫描和清理。
- 增加当前 R1 使用指南、索引与测试/追踪入口；实际验证确认搜索文案含域名但后端未实现域名搜索，明确记录限制，不扩大本任务查询能力。
- Catalog 定向、后端 967/前端 926 单元、467 PostgreSQL 集成、静态/合同/构建与脚本检查通过。make e2e/make verify 的真实集合为 21 passed/1 未修改上传断言失败；单独 fixture 为 497 passed/46 skipped/1 未修改编辑器焦点失败。秘密扫描 clean，清理成功，完整门禁未通过，不自行 done。
- 无 OpenAPI/数据库合同变化、新 Alembic revision、数据回填、生产迁移或真实外部 AI 调用。验证结果、首次失败诊断与环境清理见 GEO-106 implement.md；GEO-502/GEO-504 未实施。

## GEO-105 Catalog 管理页面 — 2026-10-02（review）

- 确认 GEO-104 manifest=done、Trellis completed 与人工接受记录，GEO-105 按 planned→in_progress→review 交付，未自行 done。
- 新增 canonical Catalog domain 与 `/configuration/geo-entities` 路由，管理员导航接线；搜索/筛选/分页/选中对象可由 URL 恢复。五类身份、父级、别名/域名、启停与删除阻断使用已存在的 12 个 API 和 generated 类型。
- ENGINEER 只读；OWN_PRODUCT 不编辑产品绑定、名称或事实；所有字典写采用父 revision。409 保留输入、不自动重放，显式读取/再次确认；后台读取失败保留编辑器，延迟成功不恢复旧筛选，主体切换不写旧 continuation。
- 完成 63 项 Catalog API/模型/组件/文件路由定向验证、后端 967/前端 926 项单元、指定 lint/typecheck/generated/contract 检查，以及两个明确 fixture 的 Chromium production artifact 布局/键盘/URL/只读检查和敏感产物扫描。独立复核两项发现已修正，具体命令、首次失败及证据见 GEO-105 implement.md。
- 无 OpenAPI/数据库语义变更、新 Alembic revision、历史回填、生产迁移或外部 AI/DNS/HTTP 调用。数据库文档仅校正过时实施状态/路径；GEO-106 与其他任务未实施。

## GEO-104 Catalog 应用服务与 API — 2026-10-02（review）

- GEO-103 为 done；GEO-104 从 planned 进入 in_progress，完成本地验证后交付 review，人工验收前不标记 done。
- 接线 12 个冻结 Catalog 操作并删除 CONTRACT_ONLY 扩展；总操作数 176，严格 runtime drift gate 保持，generated types 同步。公共删除 blocker 增加 GEO_SUBJECT，既有前端仅补删除/审计文案和运行时枚举适配，没有 Catalog 页面。
- Application Service 拥有 Product→UUID 顺序品牌→Subject→子行锁序、锁后 identity/revision 校验、同态 no-op、精确 SQLSTATE/constraint 映射及业务/revision/成功审计同事务。读取采用 REPEATABLE READ 和批量投影；Product 身份读取当前事实，不保存副本。
- 子 Subject（包含停用）真实引用阻止删除；Product/User 删除接入 Catalog 引用。未来四个未建表引用域显式零并保留接入义务。十个审计动作只保存稳定目标 UUID 与 revision/is_active，删除后保留 tombstone。
- 读取在认证前关闭 autoflush，避免同 Cookie 的认证更新时间在 RR 快照内发生冲突；搜索词和当前 Product/显示名称共用 Unicode 规范化。flush 前保存唯一冲突的稳定身份，避免失败事务读取过期 ORM。39 项 Catalog 定向、466 项完整 PostgreSQL 集成及3轮独立只读复核通过；最低门禁和完整记录见 implement.md。
- 无新 Alembic revision、历史回填、生产迁移、外部 AI/DNS/HTTP 调用。当前 head 0044 的隔离前滚、API/并发/事务证据和最低验证命令结果见 GEO-104 implement.md；GEO-105 及后续能力未实施。

## GEO-103 Catalog Schema 与领域策略 — 2026-10-01（review）

- 依赖 GEO-101、GEO-102 均已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- 实施闭合 Catalog 创建/PATCH/响应 Schema；拒绝未知类型、只读字段及 OWN_PRODUCT 事实副本，保留省略/null 意图。NFKC/Unicode 空白/casefold 保留型号区别；受控语言标签小写；IDNA2008/UTS #46 non-transitional + STD3 严格往返，非法输入显式失败且无网络调用。
- 无 I/O 的领域策略验证真实父子、自引用和别名候选歧义；显式完整引用计数形成 ADMIN/ENGINEER stage/actions/deletion。OWN_PRODUCT 从当前 Product 投影 identity/revision，不修改 Catalog 名称或 Subject revision。
- Pydantic 生成声明补齐 minProperties/条件与 hostname not，九个入口及所有引用与已接受根合同机器形状一致。修正前失败、修正后通过的合同保护、98 项定向、后端 953/前端 863 项单元、427 项 PostgreSQL 集成与静态检查见 GEO-103 implement.md；保留两条既有 metadata warning。
- 首次独立复核确认的声明机器形状 P2 已由最小修正及第二次 fresh 只读复核解除，执行审计与原始证据保留。
- 将现有 idna 3.18 声明为直接依赖，锁定包版本不变；无新 OpenAPI 操作或 Alembic revision，无历史回填、生产迁移或前端改动。GEO-104 CRUD/Router、页面及后续采集/分析/指标均未实施。

## GEO-102 Catalog ORM 与 Alembic — 2026-10-01（review）

- 唯一直接依赖 GEO-101 已经人工接受，状态 done；GEO-102 按门禁 planned→in_progress→review，不自行 done。
- 新增三表 ORM、共享 metadata 注册与冻结迁移 `0044_geo_catalog`；活动 OWN_PRODUCT partial unique、真实父类型 MATCH FULL 复合 FK、身份 trigger、字典约束/索引及 RESTRICT/CASCADE 与已接受合同一致。
- 空库及含旧 Product/GEO 的 0043 前滚通过，不回填或改写历史；0001～0043 和 migration_schema_v1 的 44 项指纹保持一致。downgrade 明确拒绝删除三表，恢复使用前滚修复或迁移前备份。
- 定向 77 项、后端单元 855 项、前端 863 项、完整集成 427 项、lint/typecheck/contract 检查通过；保留 metadata 的两项 SQLAlchemy warning。fresh critical_reviewer 未确认阻断问题，执行摘要与审计校验通过。精确命令、环境、局部早期失败与修复见 GEO-102 implement.md。
- 同步数据库实施状态、导航、需求覆盖、manifest、哈希及 Trellis 证据；OpenAPI、generated types、Service/Router/UI、部署配置与旧 GEO 行为没有本任务变化，GEO-103 保持 planned。

## GEO-101 Catalog 合同 — 2026-10-01（review）

- GEO-003、GEO-002 均为 done，本任务从 planned 进入 in_progress；仅冻结三类 Catalog 资源的公共 Schema、12 个待接线操作和数据库合同。
- OWN_PRODUCT 只引用 Product；自有名称由当前 Product 投影，Catalog 不保存第二份产品身份或事实。明确父 revision、规范化、父子类型、活动身份唯一、typed actions/blockers 与聚合删除语义。
- 操作使用显式 CONTRACT_ONLY 扩展，GEO-104 才迁入标准 paths；当前 runtime drift gate 保持严格。仅同步 generated types，不实施 ORM/Alembic/Service/Router/页面。
- 产品、领域、数据和 API 文档的 Catalog 草案已统一到根合同；测试、独立复核及实际验证见本任务 implement.md。交付状态 review，不自行 done，GEO-102/103/201/203 未实施。

## GEO-005 虚构夹具与分析金标 — 2026-10-01（review）

- 确认 GEO-003=done，GEO-005 按门禁从 planned 进入 in_progress；交付进入 review，不自行 done。
- 新建单一 v1 JSON 语料、独立 gold 目录及严格 Schema：2 个产品、4 个问题、13 个回答、4 条原引用和 13 个分析场景；保留重复引用、歧义与 unknown/null，不实现分析算法或指标公式。
- 定义版本与敏感数据规则；全部手工虚构，只允许专用 HTTPS .test 地址，无真实平台调用。Python 统一执行格式/证据关系/敏感数据校验，前端 Node 测试运行时读取同一语料，避免 frontend-only 构建上下文依赖。
- Fixture 定向 27+2 项、后端 821 项、前端 863 项测试及 contract/lint/typecheck 通过；无 backend 邻目录的前端隔离构建通过。make test-deploy-scripts 因缺少 Docker socket 在前置镜像构建失败，其后续 recipe 与真实容器未验证。
- 更新格式说明、导航、质量策略、Trellis 证据、任务状态与文档哈希；OpenAPI、数据库、Alembic 和现有 GEO 业务语义未变，GEO-402/GEO-501 保持 planned。

## GEO-004 安全配置 — 2026-10-01（review）

- 确认唯一依赖 GEO-003=done，按门禁从 planned 进入 in_progress；四项 GEO 启动开关默认 false，拒绝总开关关闭而子能力开启的配置。
- Production 模板增加四键；旧 runtime 可省略并由 Settings 默认关闭，其余必填、未知键、secret 和既有生产安全边界不变。
- 45 项配置及生产边界单测、18 组三套 Compose 与真实入口初始化探针通过；contract/lint/typecheck 和后端 794、前端 861 项单元测试通过。make test-deploy-scripts 因缺少 Docker socket 在前置 frontend 镜像构建失败，未运行其后续测试；真实容器与 Worker/Beat 进程未验证。
- 独立只读配置复核未确认阻断问题；同步权威配置说明、技术文档实施状态、Trellis 证据与文档哈希，GEO-004 进入 review，等待人工验收。
- 不新增 Collector、GEO 调度或机会业务；OpenAPI、数据库、Alembic、前端和旧人工 GEO 保持原合同，GEO-203/405 等后续任务未实施。

## GEO-003 当前实现基线 — 2026-10-01（review）

- GEO-001、GEO-002 均为 done，五份 ADR 为 Accepted；GEO-003 按任务门禁从 planned 进入 in_progress，盘点与本地验证后进入 review，未自行标记 done。
- 冻结源码 HEAD `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814` 的 12 个 API path、16 个 operation、74 个 schema、7 张表、43 个迁移和 35 个相关测试源文件，保存 143 个源码/合同/依赖指纹。
- 新增基线清单与快照，明确现有人工文章关系、legacy 模型历史与未来回答级 Batch/Run 的字段、统计单位、查询、路由、锁和历史删除边界。
- 八项指定命令均实际执行；契约、lint、typecheck、后端 749 单元测试、前端 861 测试和桌面 GEO fixture E2E 57 项通过。make verify 被缺失 Docker socket 阻断；PostgreSQL 定向测试跳过与真实栈缺少 DATABASE_URL 的证据分别保留。
- 仅更新本任务文档、导航、校验清单、任务状态和 Trellis 证据；业务代码、根 OpenAPI/数据库合同、Alembic、generated types、页面交互、其他任务与依赖保持原样。

## GEO-002 人工接受 — 2026-10-01（已完成）

- 用户明确接受 ADR-001 至 ADR-005，以及本轮架构评审记录中的修订；五份 ADR 更新为 Accepted，分别记录接受日期、依据和适用范围。
- 接受已修订的架构方向与约束；具体业务/技术合同按这些约束在后续任务中对齐，本轮不实施功能、不启用平台自动采集。
- GEO-002 从 review 更新为 done，保留其他任务状态、依赖与原最终验收要求。
- 当前分支及本地文档基线无 GEO-002 Trellis 记录，补建对应任务并记录人工接受与实际文档验证；不提交或归档其他任务。
- 保留原评审发现和阶段记录，更新文档导航与 SHA256SUMS；仅修改文档和任务记录。

## GEO-002 架构评审 — 2026-10-01（待人工决策）

- 以代码基线 `83ff42e7` 和文档基线 `122884b3` 完成五项 ADR 的逐项架构评审，新增评审记录及当前实现、迁移、部署证据。
- 当前分支原无 GEO 文档目录；仅从本地 `docs/geo-monitoring-v1` 分支恢复文档目录，不合并其代码或其他文件。
- 导入基线的五份 ADR 原带 `Accepted` 标签，本轮未取得其人工架构接受证据；按本轮仅评审授权将文档状态记录为 `Review`，保留原正文和源提交历史，追加待批准的评审补充。
- GEO-002 更新为 `review`，保留最终接受验收要求；其他任务状态不变，不实施后续任务。
- 本轮只修改评审文档、导航、任务状态及文档哈希；不修改源码、根级合同、迁移或部署配置。

## GEO-001 纳入仓库 — 2026-10-01（已验收）

- 确认文档根路径为 `docs/geo-monitoring/`，保留既有产品、业务、技术文档和 ADR 状态。
- 增加仓库 README 导航、完整文档索引、可点击阅读顺序和根 AGENTS 执行入口。
- 校验文档清单与相对链接，删除 SHA256SUMS 自引用条目，同步本次编辑文件的哈希。
- 按现有 Trellis 约定记录 GEO-001 范围与验证证据，任务清单先进入 `review`；2026-10-01 经用户确认批准，更新为 `done`。

## V1.0 — 2026-10-01

- 建立 PartSignal GEO 监测核心版完整产品与技术文档体系。
- 纳入现有《GEO 监测核心版 PRD V1.0》。
- 明确产品定位、业务能力、领域实体和统一观测运行模型。
- 明确人工、API、浏览器三种采集方式的分阶段策略。
- 固定可见率、推荐率、SOV、引用、准确性、稳定性和数据质量口径。
- 给出目标数据库表、API 资源、前端路由、Worker/Collector 架构和安全边界。
- 给出按发布增量划分的实施路线图、WBS、追踪矩阵和机器可读任务清单。
- 给出 Codex 单任务执行规则和任务模板。
- 记录五项初始架构决策。
