# PartSignal GEO 需求追踪矩阵

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
| CAP-GEO-05 | 批次和运行统一管理 | Batch/Run | 运行中心 | GEO-301～303、306～308 | 并发、状态机、E2E-02 |
| CAP-GEO-06 | 保存原始回答、引用、截图和采集环境 | AnswerSnapshot/Citation/FileRecord | 运行详情 | GEO-304～307 | 不可变、文件完整性、XSS |
| CAP-GEO-07 | 识别自有对象、竞品、推荐和位置 | AnalysisRevision/Mention/Recommendation | 运行详情/洞察 | GEO-501～503、506 | 分析金标 |
| CAP-GEO-08 | URL/域名/来源类别分析 | Citation + ownership projection | 引用洞察 | GEO-504、604 | IDNA、共享域名、URL 去重 |
| CAP-GEO-09 | 声明提取和事实准确性 | ClaimAssessment/FactVersion | 事实风险 | GEO-505、604 | 参数/替代/事实不足金标 |
| CAP-GEO-10 | 人工确认和修正机器结果 | RunReview | 运行复核 | GEO-507～508 | stale revision、追加式历史 |
| CAP-GEO-11 | 可见率、推荐率、SOV、引用、准确性和稳定性 | GeoOverview/GeoInsights | 总览/洞察 | GEO-601～607 | 指标金标、性能、下钻 |
| CAP-GEO-12 | 规则驱动机会和告警 | GeoRules/Opportunity | 机会与告警 | GEO-701～703 | 阈值、样本、去重、状态机 |
| CAP-GEO-13 | 连接事实、内容、发布和补测行动 | OpportunityAction | 机会详情 | GEO-704 | 跨域服务、失败恢复、审计 |
| CAP-GEO-14 | 冻结基线并严格复测 | Retest Batch/Comparison | 机会-复测 | GEO-705～707 | 可比性、前后样本、E2E-04 |
| CAP-GEO-15 | 打印报告和安全导出 | GeoReportPreview | 报告 | GEO-606 | CSV 注入、字段白名单、E2E-05 |
| CAP-GEO-16 | 调度、费用、失败、恢复和浏览器治理 | Worker/Collector/Ops metrics | 运行中心/配置 | GEO-401～408、801～906 | Worker、SEC、OPS、PERF |

## 2. 关键产品需求

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
| R7 | CAP 16 的 Browser 部分 | 一个真实界面合规试点 |
| R8 | 全部 | 生产运维和恢复门禁完成 |

## 4. 追踪维护规则

- 新需求必须获得 `REQ-GEO-*`；
- 新任务至少关联一个需求；
- 一个需求没有任务或测试时不得标记“已实现”；
- 指标公式变更必须更新 REQ、金标和报告；
- 任务拆分后保留原 ID 为 Epic 或在 manifest 中明确 superseded；
- 关闭需求需要 ADR/产品决策，不能只删除任务。

## GEO-203 数据契约证据（R1 / review）

CAP-GEO-03 的模式、环境、能力、合规数据与非敏感 Profile 响应由 [Task Brief](../../../.trellis/tasks/10-02-geo-203-surface-profile/prd.md)、[实施证据](../../../.trellis/tasks/10-02-geo-203-surface-profile/implement.md)、test_geo_surface_contract.py 与 test_geo_surfaces_profiles.py 覆盖模式组合、FK、秘密字段缺失和迁移。REQ-GEO-SEC-001 本任务只实现合规状态与秘密配置数据边界；运行批准、权限和管理操作由 GEO-204/205/804 后续验收，不能把数据契约通过视为自动采集资格已实现。
