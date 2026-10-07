# PartSignal GEO 需求追踪矩阵

GEO-803 / R7：Worker §12/17、质量策略§5.2、PRD AC-RUN-02/03及AC-SEC-02的本地Browser
合同部分由[模拟站与套件](../../../tests/browser-fixture/README.md)覆盖。27项真实Chromium合同与
反例自测、18份后端权威类型结果校验及CI仅回环容器边界，具体实际结果以
[GEO-803实施证据](../../../.trellis/tasks/10-05-geo-803-browser-contract/implement.md)为准。
生产证据捕获/敏感截图、真实平台与试点仍由804–807负责，不能据本地合同宣称完成这些能力。

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 目的 | 将产品需求映射到业务实体、页面、API、任务和测试，避免“实现了页面但未实现语义” |

## 1. 能力级追踪

| 能力 ID | 需求摘要 | 主要实体/读模型 | 页面 | 主要任务 | 核心测试 |
|---|---|---|---|---|---|
| CAP-GEO-01 | 管理自有产品、品牌、竞品、参考型号、别名和域名 | GeoSubject/Alias/Domain | 配置-监测对象 | GEO-101～106 | TEST-GEO-INT Catalog、E2E-01 |
| CAP-GEO-02 | 规范问题主题与具体运行变体分离 | QueryTopic/PromptVariant | 问题库 | GEO-201～202 | 唯一性、branded/unbranded、E2E-01 |
| CAP-GEO-03 | 管理 AI 观测面、采集模式和环境 | EngineSurface/CollectionProfile | 配置-GEO 平台 | GEO-203～205 | Profile mode、权限、secret |
| CAP-GEO-04 | 组合对象、问题、profile、重复、调度和预算 | MonitoringPlan/Preview | 监测计划 | GEO-206～209 | 矩阵金标、状态机、E2E-01 |
| CAP-GEO-05 | 批次和运行统一管理 | Batch/Run | 运行中心 | GEO-301～303、306～308、408 | 并发、状态机、E2E-02、R3 fake 纵向验收 |
| CAP-GEO-06 | 保存原始回答、引用、截图和采集环境 | AnswerSnapshot/Citation/FileRecord | 运行详情 | GEO-304～307、407～408 | 不可变、文件完整性、XSS、usage/cost/null |
| CAP-GEO-07 | 识别自有对象、竞品、推荐和位置 | AnalysisRevision/Mention/Recommendation | 运行详情/洞察 | GEO-501～503、506 | 分析金标 |
| CAP-GEO-08 | URL/域名/来源类别分析 | Citation + ownership projection | 引用洞察 | GEO-504、604～605 | IDNA、共享域名、URL 去重、只读明细 |
| CAP-GEO-09 | 声明提取和事实准确性 | ClaimAssessment/FactVersion | 事实风险 | GEO-505、604～605 | 参数/替代/事实不足金标、安全文本明细 |
| CAP-GEO-10 | 人工确认和修正机器结果 | RunReview | 运行复核 | GEO-507～508 | stale revision、追加式历史 |
| CAP-GEO-11 | 可见率、推荐率、SOV、引用、准确性和稳定性 | GeoOverview/GeoInsights | 总览/洞察 | GEO-601～607 | 指标金标、性能、下钻 |
| CAP-GEO-12 | 规则驱动机会和告警 | GeoRules/Opportunity | 机会与告警 | GEO-701～703 | 阈值、样本、去重、状态机 |
| CAP-GEO-13 | 连接事实、内容、发布和补测行动 | OpportunityAction | 机会详情 | GEO-704 | 跨域服务、失败恢复、审计 |
| CAP-GEO-14 | 冻结基线并严格复测 | Retest Batch/Comparison | 机会-复测 | GEO-705～707 | 可比性、前后样本、E2E-04 |
| CAP-GEO-15 | 打印报告和安全导出 | GeoReportPreview | 报告 | GEO-606 | CSV 注入、字段白名单、E2E-05 |
| CAP-GEO-16 | 调度、费用、失败、恢复和浏览器治理 | Worker/Collector/Ops metrics | 运行中心/配置 | GEO-401～408、801～906 | Worker、SEC、OPS、PERF |

## 2. 关键产品需求

GEO-204 已落实 CAP-GEO-03/CAP-GEO-16 的 Registry 与配置资格部分及 AC-SEC-03 的自动模式
合规/开关基础；单元合同见 `backend/tests/unit/test_geo_collector_registry.py`，当前模型删除、
旧 identity map、单查询/无写/无敏感正文的 PostgreSQL 证据见
`backend/tests/integration/test_geo_profile_eligibility.py`。默认仅 manual，自动测试项是无 I/O
元数据，不是生产 Collector。具体状态与验证见
[实施记录](../../../.trellis/tasks/10-02-geo-204-collector-registry/implement.md)。
GEO-205 已接线管理接口/页面；GEO-207 的服务端矩阵、当前资格定位和估价覆盖见下节。
GEO-401 已定义内部采集值对象、能力/adapter 协议及必填发送状态的稳定错误，支持
REQ-GEO-RUN-007、REQ-GEO-OPS-002 的合同基础；78 项抽象测试覆盖不可变值、未知值、
来源/引用证据边界及发送后禁止 SAFE_BEFORE_SEND，见
`backend/tests/unit/test_geo_collector_contract.py` 和
[实施记录](../../../.trellis/tasks/10-03-geo-401-collector-contract/implement.md)。
真实请求计数、lease/token 持久化与恢复仍由 GEO-404/405/406 验收，不能将整项能力标记完成。

### 2.1 监测对象

GEO-101 的公共/数据库合同已被人工接受，状态 done；公共 Schema 正反例见 `backend/tests/unit/test_geo_catalog_contract.py`。GEO-102 已落实三表 ORM、迁移、数据库身份守卫、真实父子约束及活动 OWN_PRODUCT 唯一并发仲裁，验证见 [GEO-102 实施证据](../../../.trellis/tasks/10-01-geo-102-catalog-orm/implement.md)。GEO-103 已实现闭合 Schema、Unicode/IDNA 规范化、真实父子/别名歧义及 stage/actions/deletion/当前 Product 只读投影，定向、声明机器形状与完整验证见 [GEO-103 实施证据](../../../.trellis/tasks/10-01-geo-103-catalog-policy/implement.md)。GEO-104 已实现 CRUD Service/API、当前子 Subject 引用查询、Product/User 删除接入、原子审计、锁后 revision 与精确约束映射，证据见 [GEO-104 实施记录](../../../.trellis/tasks/10-02-geo-104-catalog-api/implement.md)。GEO-105 页面已人工接受；GEO-106 补当前 Catalog 真实 API 纵向验收、产品事实不变和 [使用指南](../01-product/04-catalog-user-guide.md)，证据见 [实施记录](../../../.trellis/tasks/10-02-geo-106-catalog-acceptance/implement.md)。未来计划/运行/分析/机会引用域和运行时冻结字典尚未实施，不能将整项能力标记完成。

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-SUBJECT-001 | 一个现有 Product 最多有一个活动 OWN_PRODUCT 监测对象 | 并发创建只成功一个，稳定冲突 | GEO-101～104 |
| REQ-GEO-SUBJECT-002 | 支持品牌、产品、竞品和参考型号 | 类型和父子约束由服务端/DB 共同执行 | GEO-101～104 |
| REQ-GEO-SUBJECT-003 | 支持多个别名和域名 | 同 subject 规范别名唯一，域名 IDNA 规范 | GEO-102～105 |
| REQ-GEO-SUBJECT-004 | 历史引用后只能停用 | 删除返回精确 blocker | GEO-103～106 |
| REQ-GEO-SUBJECT-005 | 分析使用运行时冻结 alias snapshot | 后续别名变化不重写历史 | GEO-502 |

### 2.2 问题和计划

GEO-207 已实现 CAP-GEO-04、AC-PLAN-01/02 的内部服务与预览数据组件。
90 个唯一矩阵单元、Subject 不参与乘法、同 Surface 的不同 Profile、停用/缺失/能力阻断、
known/unknown 数量、Decimal/预算边界及混币证据见 `backend/tests/unit/test_geo_run_matrix.py`；
组件/真实序列化见 `test_geo_plan_preview_contract.py`；当前列/无写/一致 RR 快照见
`backend/tests/integration/test_geo_plan_preview.py`。默认无估价实现，未知费用不补零。
状态与完整验证见 [GEO-207 实施记录](../../../.trellis/tasks/10-02-geo-207-run-matrix/implement.md)。
GEO-208已接线Plan API和服务端状态机，覆盖REQ-GEO-PLAN-001/003/005、AC-PLAN-04与AC-AUDIT-01；真实PostgreSQL生命周期/审计回滚/并发/权限和RR批量读证据见[实施记录](../../../.trellis/tasks/10-02-geo-208-plan-api/implement.md)。Plan向导由下文GEO-209交付，执行预算与真实批次冻结仍分别属于GEO-407、GEO-303，REQ-GEO-PLAN-004尚不能宣称完成。

GEO-209 前端消费既有 Plan API，落实 REQ-GEO-PLAN-002 的最终矩阵权威、REQ-GEO-PLAN-003 的配置定位及 REQ-GEO-PLAN-005 的只读动作投影；向导、URL、dirty、409 与真实创建/启停证据见 [实施记录](../../../.trellis/tasks/10-02-geo-209-plan-ui/implement.md)。批次冻结仍属于后续任务，本任务不宣称执行、预算扣费或完整 R1 人工验收完成。

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-QUESTION-001 | QueryTopic 与 PromptVariant 分离 | 同主题可有多语言、点名/非点名变体 | GEO-201～202 |
| REQ-GEO-QUESTION-002 | 点名属性显式 | 不从文本自动改变 | GEO-201～202 |
| REQ-GEO-PLAN-001 | 计划选择对象、变体、profile | 缺任一项不能启用 | GEO-206～208 |
| REQ-GEO-PLAN-002 | 运行数服务端预览 | 10×3×3=90 | GEO-207、209 |
| REQ-GEO-PLAN-003 | 计划支持重复、Cron、时区和预算 | 规则校验和阻断完整 | GEO-206～209 |
| REQ-GEO-PLAN-004 | 已创建批次冻结计划快照 | 修改计划不改变历史 runs | GEO-301～303 |
| REQ-GEO-PLAN-005 | 归档计划只读 | 只能复制为新计划 | GEO-208～209 |

### 2.3 批次和运行

GEO-301 / R2 为 REQ-GEO-RUN-001/002/003 提供数据库最终防线与公共模型：初始 cell 提交数量、cell/attempt 唯一、输入/终态不可变和独立旧观测保留，证据见 [实施记录](../../../.trellis/tasks/10-02-geo-301-batch-run/implement.md)。Batch 缓存可从最新 attempts 重建；原子创建服务、投影/重试命令和执行调用仍属于 GEO-302/303/406，不能据模型交付宣称完整用户流程已完成。


| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-RUN-001 | 一个批次原子创建全部运行 | 无部分批次 | GEO-301～303 |
| REQ-GEO-RUN-002 | 单元为 prompt×profile×repeat | 批次内唯一 | GEO-301、303 |
| REQ-GEO-RUN-003 | Run 输入不可变 | DB 反例失败 | GEO-301～302 |
| REQ-GEO-RUN-004 | 失败重试创建新 attempt | 原 run 终态不改 | GEO-302、406 |
| REQ-GEO-RUN-005 | 失败不等于未提及 | FAILED 不进业务分母 | GEO-601 |
| REQ-GEO-RUN-006 | Redis 只传 run ID | 队列不含正文/凭据 | GEO-405 |
| REQ-GEO-RUN-007 | 外部请求发送后不自动重试 | 调用计数每 attempt ≤1 | GEO-406 |
| REQ-GEO-RUN-008 | 迟到结果不覆盖终态 | lease/token 防线 | GEO-405～406 |
| REQ-GEO-RUN-009 | MANUAL 正式提交冻结证据 | 提交后不可编辑 | GEO-304～305 |
| REQ-GEO-RUN-010 | Batch 状态可从 runs 重建 | 缓存不是权威 | GEO-302、405 |

### 2.4 原始证据

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-EVIDENCE-001 | 保存完整问题和非空回答 | 空回答不能 COLLECTED | GEO-304～305、404 |
| REQ-GEO-EVIDENCE-002 | 保存引用 URL、位置和提取来源 | 引用不由分析器虚构 | GEO-304、404 |
| REQ-GEO-EVIDENCE-003 | 保存截图/受控 raw payload | 文件必须 VERIFIED 且哈希匹配 | GEO-304、805 |
| REQ-GEO-EVIDENCE-004 | 原始证据不可变 | UPDATE 直接 SQL 失败 | GEO-304、308 |
| REQ-GEO-EVIDENCE-005 | secret 不进入证据 | API/log/audit/file 扫描无密钥/Cookie | GEO-402、404、904 |

GEO-402 已提供本地真实 TCP fake provider 与 Collector 合同套件：生成虚构 API/Header/Cookie canary，验证原值及 URL/JSON/Base64 形式不进入结果、错误、日志与测试产物；故意泄漏驱动和污染文件能使检查失败。证据见 [GEO-402 实施记录](../../../.trellis/tasks/10-03-geo-402-fake-provider/implement.md)。该证据限于本地采集合同，业务 API/audit、生产 adapter 与 Worker 的安全验收仍由后续任务负责，不能据此宣称 REQ-GEO-EVIDENCE-005 全链路完成。

### 2.5 分析和复核

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-ANALYSIS-001 | 每次分析形成 revision | 历史可查看，新 revision 不覆盖旧结果 | GEO-501、506 |
| REQ-GEO-ANALYSIS-002 | 识别自有和竞品提及 | 中文型号金标通过 | GEO-502 |
| REQ-GEO-ANALYSIS-003 | 列举不等于推荐 | 推荐金标通过 | GEO-503 |
| REQ-GEO-ANALYSIS-004 | 无可靠顺序 rank 为空 | 不补默认位置 | GEO-503 |
| REQ-GEO-ANALYSIS-005 | 引用归属按 hostname | 子域名/共享域名正确 | GEO-504 |
| REQ-GEO-ANALYSIS-006 | 声明只绑定 APPROVED FactVersion | 不合格事实明确失败 | GEO-505 |
| REQ-GEO-ANALYSIS-007 | 事实不足为 UNJUDGEABLE | 不自动判对错 | GEO-505 |
| REQ-GEO-ANALYSIS-008 | 低置信和严重风险需复核 | Run NEEDS_REVIEW | GEO-506～507 |
| REQ-GEO-ANALYSIS-009 | 人工复核追加式 | 原分析和旧复核保留 | GEO-507～508 |
| REQ-GEO-ANALYSIS-010 | 新分析使旧复核失效 | stale review 不能应用 | GEO-507 |

### 2.6 指标

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-METRIC-001 | 每个比率返回 value/numerator/denominator | API 契约和页面均显示 | GEO-601～605 |
| REQ-GEO-METRIC-002 | 分母 0 返回 NULL | 金标和 UI 不显示 0% | GEO-601、605 |
| REQ-GEO-METRIC-003 | 自然可见率只使用非点名 | branded 不进入分母 | GEO-601 |
| REQ-GEO-METRIC-004 | 推荐率只计明确 RECOMMENDED | CONSIDERED 不计 | GEO-601 |
| REQ-GEO-METRIC-005 | SOV 使用运行级事件和冻结竞品集合 | competitor set 变化不可比 | GEO-601、603 |
| REQ-GEO-METRIC-006 | 引用覆盖和引用份额口径分离 | 运行分母和引用事件分母正确 | GEO-601、604 |
| REQ-GEO-METRIC-007 | 准确率排除 UNJUDGEABLE | 单独显示数量 | GEO-601、604 |
| REQ-GEO-METRIC-008 | 样本不足不触发趋势机会 | OBSERVED/REPORTABLE/STABLE 生效 | GEO-601、701～702 |
| REQ-GEO-METRIC-009 | MANUAL/API/BROWSER 默认分层 | 不静默混合 | GEO-601～605 |
| REQ-GEO-METRIC-010 | 所有指标可下钻到运行 | summary 和明细一致 | GEO-602～605 |
| REQ-GEO-METRIC-011 | 数据质量展示排除原因 | 不可用 section 有稳定 code | GEO-602、604 |
| REQ-GEO-METRIC-012 | 报告显示公式版本、筛选和 as_of | 打印和 CSV 一致 | GEO-606 |

### 2.7 机会和复测

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-OPP-001 | 机会由确定性规则触发 | 每个机会含规则/阈值/来源 | GEO-701～702 |
| REQ-GEO-OPP-002 | 同 identity 开放机会去重 | 并发只一条 | GEO-702 |
| REQ-GEO-OPP-003 | 可以创建事实、内容、发布或补测行动 | 通过现有 service | GEO-704 |
| REQ-GEO-OPP-004 | 任务完成不自动解决 | 状态保持 IN_PROGRESS | GEO-704、706 |
| REQ-GEO-OPP-005 | 复测冻结基线 | 保存运行和公式快照 | GEO-705 |
| REQ-GEO-OPP-006 | 不可比时禁止严格复测结论 | 显示差异或新基线 | GEO-705～706 |
| REQ-GEO-OPP-007 | 解决/驳回需要原因 | 审计和历史保留 | GEO-703、706～707 |

GEO-706 的 OPP-004/006/007 实现由比较 GET、resolve/continue、冻结恢复应用服务和不可变 `geo_opportunity_decisions` 共同保护。前后窗口、低样本、未恢复、模型变化、人工解决及 CAS/指纹冲突由定向单元/真实 PostgreSQL 测试验证；页面使用 generated DTO，展示环境差异和非因果说明。已有机会的显式继续、人工解决及刷新历史由真实 API 专项 `geo-comparison-real-stack.spec.ts` 验证，完整 E2E-04 的当前证据和覆盖边界见 [R6 机会闭环验收](./10-r6-opportunity-acceptance.md)。实际结果见 [GEO-706 实施证据](../../../.trellis/tasks/10-04-geo-706-retest-comparison/implement.md)，状态以 manifest 为准。

### 2.8 安全和运维

| 需求 ID | 需求 | 验收 | 任务 |
|---|---|---|---|
| REQ-GEO-SEC-001 | 自动采集需合规 APPROVED | 非批准 profile 服务端阻断 | GEO-203～205、804 |
| REQ-GEO-SEC-002 | API 凭据密文且永不回显 | secret scan | GEO-403～404、904 |
| REQ-GEO-SEC-003 | 浏览器 Cookie 独立加密 | DB/log/screenshot 无明文 | GEO-802、805、904 |
| REQ-GEO-SEC-004 | SSRF/TLS/peer/redirect 防线 | 安全集成测试 | GEO-404、904 |
| REQ-GEO-SEC-005 | INTERNAL/RESTRICTED 不外发 | 数据分级门禁 | GEO-404、505、904 |
| REQ-GEO-OPS-001 | PENDING 可补投递 | 消息丢失恢复且不重复调用 | GEO-405 |
| REQ-GEO-OPS-002 | SENT/UNKNOWN 不自动重发 | UNKNOWN_OUTCOME 可见 | GEO-406 |
| REQ-GEO-OPS-003 | 预算和费用未知可见 | 未知不补零 | GEO-407 |
| REQ-GEO-OPS-004 | 核心运行有监控和告警 | oldest pending/lease/cost/session | GEO-902 |
| REQ-GEO-OPS-005 | 数据库/OSS/密钥可恢复 | 隔离恢复演练 | GEO-903 |
| REQ-GEO-OPS-006 | 大数据量仍可查询/导出 | 性能门禁 | GEO-607、905 |
| REQ-GEO-OPS-007 | 自动能力可立即停止 | 功能开关/kill switch | GEO-004、806、906 |

## 3. 发布增量追踪

| 发布 | 完成能力 | 关键用户验收 |
|---|---|---|
| R0 | 文档、ADR、基线、开关 | Codex 可选择独立任务，无业务变化 |
| R1 | CAP 01–04 | 能配置计划并准确预览矩阵 |
| R2 | CAP 05–06 | 能保存人工回答级观测和证据 |
| R3 | CAP 16 的 API 部分 | 能可靠自动采集且不重复调用 |
| R4 | CAP 07–10 | 能分析并人工复核 |
| R5 | CAP 11、15 | 能查看可解释指标、报告和明细 |
| R6 | CAP 12–14 | 异常可行动并复测 |
| R7（post-core 可选） | CAP 16 的 Browser 部分目标保留 | 801～803 done，804～807 deferred；不作为核心门禁 |
| R8 | 当前核心范围 | R6 后直接进入；MANUAL 正式闭环与运维/恢复/安全完成，Browser false 且无生产会话 |

范围及条件性验收以[ADR-006](../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)和当前 manifest 为准；Browser 需求保持追踪，未实现项不标已实现。

## 4. 追踪维护规则

- 新需求必须获得 `REQ-GEO-*`；
- 新任务至少关联一个需求；
- 一个需求没有任务或测试时不得标记“已实现”；
- 指标公式变更必须更新 REQ、金标和报告；
- 任务拆分后保留原 ID 为 Epic 或在 manifest 中明确 superseded；
- 关闭需求需要 ADR/产品决策，不能只删除任务。

## GEO-203 数据契约证据（R1 / done）

CAP-GEO-03 的模式、环境、能力、合规数据与非敏感 Profile 响应由 [Task Brief](../../../.trellis/tasks/10-02-geo-203-surface-profile/prd.md)、[实施证据](../../../.trellis/tasks/10-02-geo-203-surface-profile/implement.md)、test_geo_surface_contract.py 与 test_geo_surfaces_profiles.py 覆盖模式组合、FK、秘密字段缺失和迁移。REQ-GEO-SEC-001 的合规状态与秘密配置数据边界由 GEO-203 实现，GEO-204 已落实上文配置资格基础（review）；管理权限、操作和发送批准仍由 GEO-205/804 及后续执行任务验收，不能把配置资格通过视为实际发送授权。


### GEO-508 / R4 分析复核验收切片

CAP-GEO-07/08/09/10 与 AC-ANA-02～07 的运行详情可追溯展示、结构化复核和历史由GEO-508接入。原文、机器、人工有效投影和历史分别可见，严重机器错误逐条主动核对并说明；服务端GEO-507继续拥有权限、revision和当前选择。

全部分析金标、真实PG严重错误→复核→新revision与过期复核验收，以及Vitest/Playwright/完整门禁的实际状态见 [R4质量报告](./09-r4-analysis-acceptance.md) 和 [实施证据](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/implement.md)。本切片不宣布CAP-GEO-11指标、机会闭环或Browser完成；task-manifest状态仅review，待人工接受。

### GEO-602 / R5 Overview 读模型切片

CAP-GEO-11的Overview切片实现透明卡片、重点产品、严重错误风险、筛选内最近批次、未实施机会占位及数据质量。REQ-GEO-METRIC-010/011由两个公共GET的同筛选下钻与闭合不可用/排除code覆盖；业务指标按完整冻结维度分栏，质量分母以2026-10-03用户裁决及方法字典§19为准。

`backend/tests/unit/test_geo_overview.py`覆盖运行/事件分母、null、资格与分栏；`backend/tests/unit/test_geo_metric_inputs.py`覆盖current重分析字典版本；`backend/tests/integration/test_geo_overview.py`覆盖真实HTTP/PG一致读、固定查询数、卡片贡献复现、筛选、current/review、必需截图/强制改密、latest attempt及分页。实际门禁状态见[实施证据](../../../.trellis/tasks/10-03-geo-602-overview/implement.md)。本切片仅到review，CAP-GEO-11的603/604/605/607和其他R5交付仍按manifest独立验收，不宣告全能力完成。

### GEO-603 / R5 趋势、覆盖与竞争切片

CAP-GEO-11、REQ-GEO-METRIC-001～009及AC-METRIC-01～07的603切片以完整冻结cell提供等长前期、产品矩阵、问题覆盖、平台表现与两类SOV。竞争集合改变、多cell、无分母和低样本均明确不可比；自然可见/SOV排除点名。所有变体及事件/运行分母分别保留，不用统一分数或客户端公式。

`test_geo_metric_trends.py`覆盖competitor set变化、样本不足、点名及可比维度；单元`test_geo_answer_insights.py`保护全部变体、冻结集合、不可判断声明数；同名集成测试保护等长窗口、真实PG筛选贡献、当前复核、RR/固定查询数、认证和422日期边界。合同与生成类型校验见[实施证据](../../../.trellis/tasks/10-04-geo-603-trends-coverage/implement.md)。本切片仅review，604/605/702及其余任务继续独立验收。

### GEO-604 / R5 引用、风险与质量切片

CAP-GEO-11与REQ-GEO-METRIC-010/011的引用/风险/质量切片提供域名、URL、来源类别、声明/严重程度、排除、费用/版本覆盖和三个同筛选明细GET。引用/声明按完整业务cell，质量按同筛选候选去重Run；共享域名与必要复核backlog显式说明。UNJUDGEABLE不计正确/错误，严重错误只计INCORRECT HIGH/CRITICAL，未知费用不补零。

新增单元`test_geo_insight_details.py`保护独立人工复算事件/运行分母、共享/backlog、币种及未知/混合版本；同名真实PG/HTTP测试保护规范URL去重和occurrences、人工修正与新pointer隔离、不可判断明细、稳定分页、摘要/下钻计数、RR及固定SELECT、认证/闭合422和静态/运行时响应校验。既有精确operation/response metadata门禁同步三个新GET；完整实际结果见[实施证据](../../../.trellis/tasks/10-04-geo-604-citation-risk-quality/implement.md)。无DDL/回填或新页面，仍需GEO-605和独立R5验收；不宣布整个CAP完成，状态以manifest为准。

### GEO-605 / R5 总览与回答洞察前端切片

落实 REQ-GEO-METRIC-001/002/009/010/011 的页面展示与 CAP-GEO-08/09/11 的只读分析入口。URL 基础筛选应用于完整摘要与所有明细，服务端 formula/sample/null/竞争集合保留；前后两窗使用各自 cell 与 descriptor，不跨维度汇总。总览关键产品/风险/批次/质量以及洞察趋势/矩阵/问题/平台/SOV/引用/风险/质量均可访问，图形具有等价表格。

`frontend/src/domains/geo-insights/insights.model.test.ts`、`insights-page.test.tsx`、`evidence-sections.test.tsx` 保护 URL、全部 descriptor 条件、样本等级/null、独立服务端 value、迟到取消、输入校验、Decimal、安全文本与外链。`frontend/tests/e2e/insights-real-stack.spec.ts` 在独占 PostgreSQL/API 栈保护全筛选、真实组成样本/引用/事实、刷新、Back/Forward、键盘焦点、四种宽度、200% 缩放与旧文章入口；canonical runner 已接线。实际门禁及失败修复见 [实施证据](../../../.trellis/tasks/10-04-geo-605-insights-ui/implement.md)。无后端合同或迁移变化；报告/导出、机会、干预比较及整项 R5 独立验收不在本次完成范围，状态只 review。


### GEO-707 / R6 纵向验收

CAP-GEO-12/13/14 与 REQ-GEO-OPP-001～007 的纵向路径由 `test_geo_opportunity_loop.py` 和 `geo-loop-real-stack.spec.ts` 验证：真实分析/规则从 0/5 触发 TOPIC_COVERAGE_GAP，ContentTask 完成仍 IN_PROGRESS，严格同口径 RETEST 5/5 恢复但不自动关闭，显式 RETEST resolve 保存不可变处理证据。opened 重放/并发创建、审计失败回滚和五段安全投影保护审计边界。当前状态及指定门禁实际结果见 [R6 验收](./10-r6-opportunity-acceptance.md) 和 [GEO-707 实施记录](../../../.trellis/tasks/10-04-geo-707-r6-acceptance/implement.md)，不代表已人工接受或生产上线。

### GEO-906 / R8 核心发布准备与最终验收

CAP-GEO-16、REQ-GEO-OPS-004～007的发布/恢复/监控部分按[核心Runbook](../03-technical/10-core-rollout-runbook.md)执行，
目标/候选、阶段批准、Browser负证据、MANUAL正式闭环、内部试用和观察期逐项见[验收矩阵](./13-r8-core-release-acceptance.md)。
本地配置门禁仍覆盖18场景、共享Settings、启动零外部调用，仅精确允许已验收retention注册。
实际命令和失败分类以[Trellis证据](../../../.trellis/tasks/10-05-geo-906-rollout/implement.md)为准。
生产阶段NOT_STARTED/NOT_VERIFIED，不能将上述REQ全部标完成；生产Plan cron与自动evaluator仍NOT_IMPLEMENTED。
ADR-006只延期Browser804～807，核心未验证项与延期证据分别保留，未知Browser材料适用性不标N/A。
