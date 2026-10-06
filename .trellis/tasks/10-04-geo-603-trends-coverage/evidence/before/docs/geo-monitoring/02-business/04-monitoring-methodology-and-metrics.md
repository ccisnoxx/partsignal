# PartSignal GEO 监测方法与指标口径

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 核心原则 | 重复采样、同口径比较、分子分母透明、原始证据可追溯 |

## 1. 测量目标

GEO 监测不是测量一个静态排名，而是估计在给定问题、平台、时间和环境下，公司品牌或产品被发现、推荐、引用和正确描述的概率与变化。

系统测量的是受控观测样本，不声称代表所有用户、地区、账号和时刻。

## 2. 分析单位

### 2.1 单次运行

最小单位：

```text
一个 PromptVariant
× 一个 CollectionProfile
× 一个 repeat_index
× 一个时间点
```

### 2.2 数据单元 Metric Cell

默认比较维度：

- 监测对象或产品；
- QueryTopic/PromptVariant；
- EngineSurface；
- CollectionMode；
- 语言；
- 地区；
- 登录状态；
- 点名属性；
- 模型/产品版本（已知时）；
- 时间窗口。

除非指标明确允许，任一维度不同的运行不得静默放入同一 cell。

### 2.3 批次

一组同一计划快照下创建的运行。批次用于：

- 判断采集完整性；
- 计算重复采样稳定性；
- 管理失败和费用；
- 建立基线和复测。

## 3. 运行资格

### 3.1 通用合格运行

运行满足以下条件才可进入回答级业务指标：

1. `Run.status = COMPLETED`；
2. 存在非空 `AnswerSnapshot`；
3. 存在当前成功 `AnalysisRevision`；
4. 如被标记需复核，存在当前有效人工复核；
5. 不存在数据完整性错误；
6. 采集方式和筛选维度满足目标指标；
7. 未被管理员以明确原因排除。

### 3.2 指标特定资格

- 引用指标：回答实际发生引用或平台明确支持“无引用”结论；
- 推荐位置：存在可靠、可解析顺序；
- 声明准确率：至少存在一个可判断声明；
- 稳定性：同一批次同一 cell 至少 2 个成功重复；
- 趋势：当前和前窗口都满足最低样本。

### 3.3 不进入分母的情况

- FAILED/CANCELLED/PENDING/RUNNING；
- 只有错误页或登录页；
- 回答截断且影响结论；
- 人工录入未提交；
- 机器要求人工复核但尚未复核；
- 平台返回“无法回答”且指标规则明确排除；
- 采集环境与筛选不一致；
- 数据损坏或证据缺失达到阻断级别。

不得把失败运行当作“未提及”。

## 4. 样本等级

默认阈值由管理员规则配置，初始建议：

| 等级 | 合格运行数 | 使用规则 |
|---|---:|---|
| NONE | 0 | 指标 `NULL` |
| OBSERVED | 1–2 | 可展示原始比例，不生成趋势机会 |
| REPORTABLE | 3–4 | 可用于内部报告和确定性低风险规则 |
| STABLE | ≥5 | 可用于趋势、竞品突增和干预比较 |

这不是统计显著性声明，只是核心版的运营门禁。未来可引入置信区间和统计检验。

## 5. 基础布尔事实

对每个合格运行和监测对象，形成以下事实：

| 字段 | 定义 |
|---|---|
| `mentioned` | 回答正文中至少一次有效提及对象或别名 |
| `recommended` | 回答明确将对象作为选择、建议、候选或优先项 |
| `rank` | 可靠推荐顺序中的 1-based 位置，否则为空 |
| `cited_owned_source` | 至少一个引用属于自有域名 |
| `cited_competitor_source` | 至少一个引用属于受监测竞品域名 |
| `has_assessable_claim` | 至少一个声明可依据事实版本判断 |
| `has_incorrect_claim` | 至少一个声明为 INCORRECT |
| `has_critical_error` | 至少一个 HIGH/CRITICAL 错误声明 |

推荐判断必须由结构化分析依据支持；不得简单使用情感词或提及次数代替。

## 6. 可见度指标

设：

- `R` 为筛选后的合格运行集合；
- `M_s(r)` 为对象 `s` 在运行 `r` 是否被提及；
- `Rec_s(r)` 为是否被推荐；
- `Rank_s(r)` 为可靠推荐位置。

### 6.1 回答覆盖率

适用于全部问题：

```text
回答覆盖率(s) = Σ M_s(r) / |R|
```

### 6.2 自然可见率

只使用 `UNBRANDED` 问题：

```text
自然可见率(s) = 非点名合格运行中提及 s 的运行数 / 非点名合格运行数
```

### 6.3 点名回答率

只使用 `BRANDED` 问题：

```text
点名回答率(s) = 点名合格运行中有效描述 s 的运行数 / 点名合格运行数
```

点名回答率不进入自然可见度趋势。

### 6.4 产品提及率

```text
产品提及率(product) = 与该产品相关的合格运行中提及该产品的运行数 / 相关合格运行数
```

“相关”由计划的 subject binding 和问题适用对象决定，不通过答案内容反推分母。

## 7. 推荐指标

### 7.1 推荐率

```text
推荐率(s) = 推荐 s 的合格运行数 / 合格运行数
```

### 7.2 首位推荐率

```text
首位推荐率(s) = Rank_s(r)=1 的运行数 / 存在可靠推荐顺序的合格运行数
```

### 7.3 平均推荐位置

```text
平均推荐位置(s) = Σ Rank_s(r) / 有 Rank_s(r) 的运行数
```

无可靠顺序时不补默认位置。

### 7.4 推荐稳定性

对同一批次、问题和 profile 的重复运行：

```text
推荐稳定性(s) = max(推荐次数, 未推荐次数) / 成功重复运行数
```

该值描述结果一致程度，不表示结果好坏。全部未推荐也可能稳定性为 1。

## 8. Share of Voice

核心版使用运行级 SOV，避免长回答重复提及造成偏置。

设监测集合 `S` 包含公司对象和受监测竞品。

### 8.1 提及 SOV

```text
Mention SOV(s) = 提及 s 的运行-对象事件数 / Σ_{x∈S} 提及 x 的运行-对象事件数
```

同一运行可以同时贡献多个对象事件。

### 8.2 推荐 SOV

```text
Recommendation SOV(s) = 推荐 s 的运行-对象事件数 / Σ_{x∈S} 推荐 x 的运行-对象事件数
```

### 8.3 使用约束

- 只比较计划明确选择的 competitor set；
- competitor set 变化后不与旧窗口静默比较；
- 点名问题默认不进入 SOV；
- 若分母为 0，则返回 `NULL`；
- 页面展示实际对象集合和事件数。

## 9. 引用指标

### 9.1 引用归一

URL 归一包括：

- scheme 和 hostname 小写；
- 移除默认端口；
- 移除 fragment；
- 保留影响页面身份的 query 参数，移除已批准追踪参数；
- IDNA 主机名规范化；
- 保存原始 URL 和规范 URL。

### 9.2 自有信源覆盖率

```text
自有信源覆盖率 = 有至少一个自有引用的合格引用运行数 / 合格引用运行数
```

### 9.3 自有引用份额

```text
自有引用份额 = 自有域名引用事件数 / 全部引用事件数
```

引用事件按回答中实际引用条目计算。同一 URL 在同一回答重复出现时，核心版按规范 URL 去重后计一次，同时保留原位置。

### 9.4 域名覆盖

```text
域名运行覆盖率(domain) = 引用该域名的合格运行数 / 合格引用运行数
```

### 9.5 来源类别

初始类别：

```text
OWNED
COMPETITOR
INDUSTRY_MEDIA
DISTRIBUTOR
COMMUNITY
SOCIAL
SEARCH_ENGINE
ACADEMIC_OR_INSTITUTIONAL
OTHER
UNKNOWN
```

分类规则版本化；人工修正使用复核记录。

## 10. 声明准确性

### 10.1 声明类型

```text
IDENTITY
PARAMETER
PACKAGE
TEMPERATURE_GRADE
CERTIFICATION
LIFECYCLE_STATUS
APPLICATION
REPLACEMENT_RELATION
COMPATIBILITY_CONDITION
OTHER
```

### 10.2 结论

| 结论 | 定义 |
|---|---|
| ACCURATE | 与绑定事实一致，且未遗漏改变结论的关键条件 |
| PARTIAL | 部分正确，但缺失重要条件或表达不完整 |
| INCORRECT | 与事实冲突、错误归属或给出不成立的替代结论 |
| UNJUDGEABLE | 当前事实不足或声明过于模糊，不能可靠判断 |

### 10.3 严重度

```text
LOW
MEDIUM
HIGH
CRITICAL
```

高严重度示例：

- 错误安全/认证声明；
- 关键电气参数明显错误；
- 无条件宣称可替代但事实仅支持条件性替代；
- 把其他厂商产品归为公司产品；
- 错误生命周期状态影响采购判断。

### 10.4 准确声明率

```text
准确声明率 = ACCURATE 声明数 / (ACCURATE + PARTIAL + INCORRECT 声明数)
```

`UNJUDGEABLE` 不进入分母，但必须单独显示数量。

### 10.5 错误声明率

```text
错误声明率 = INCORRECT 声明数 / 可判断声明数
```

### 10.6 严重错误运行率

```text
严重错误运行率 = 包含至少一个 HIGH/CRITICAL INCORRECT 声明的运行数 / 有可判断声明的合格运行数
```

## 11. 问题覆盖

### 11.1 问题主题覆盖率

```text
问题主题覆盖率 = 至少一个变体达到目标结果的问题主题数 / 已监测问题主题数
```

“目标结果”由视图选择：提及、推荐、自有引用或准确。

### 11.2 变体覆盖

对每个问题主题分别展示不同变体的结果，不能只用最佳变体代表整个主题。

### 11.3 覆盖分类

默认以合格运行提及率为例：

| 分类 | 条件 |
|---|---|
| DATA_INSUFFICIENT | 样本低于 REPORTABLE |
| NOT_VISIBLE | 提及率 = 0 |
| OCCASIONAL | 0 < 提及率 < 0.6 |
| STABLE | 提及率 ≥ 0.6 且样本达到 STABLE |

阈值可配置，历史报告保存实际阈值快照。

## 12. 运行和数据质量指标

| 指标 | 公式 |
|---|---|
| 运行成功率 | COMPLETED 运行数 / COMPLETED、FAILED、CANCELLED 终态运行数；BUDGET_BLOCKED 单独统计 |
| 采集成功率 | 成功保存 AnswerSnapshot 的运行数 / 已开始采集运行数 |
| 运行级分析覆盖率 | 具有成功 current analysis 的已采集 Run 数 / 全部已采集 Run 数（不按 revision 数或当前 COLLECTED 状态计） |
| 复核积压 | NEEDS_REVIEW 且未有当前复核的运行数 |
| 证据完整率 | 满足 profile 证据要求的 COMPLETED 运行数 / COMPLETED 运行数 |
| 调度完整率 | 实际创建批次数 / 应创建调度窗口数 |
| 平均采集耗时 | 成功采集 duration_ms 平均值 |
| 单次平均成本 | 已报告成本总额 / 有成本数据的运行数 |

费用未知时不补零；报告必须显示费用覆盖率。

## 13. 趋势比较

### 13.1 时间窗口

支持：

- 7 天；
- 30 天；
- 90 天；
- 自定义；
- 批次对批次；
- 基线对复测。

### 13.2 前周期

时间趋势使用紧邻等长前周期：

```text
当前：[date_from, date_to)
前期：[date_from - duration, date_from)
```

### 13.3 变化

```text
百分点变化 = 当前比率 - 前期比率
相对变化 = (当前比率 - 前期比率) / 前期比率
```

核心版机会规则优先使用百分点变化。前期为 0 时相对变化为 `NULL`。

### 13.4 可比性门禁

只有以下条件一致或显式分层时才计算变化：

- competitor set；
- prompt variant identity/version；
- engine surface/profile；
- collection mode；
- language/region/login state；
- metric eligibility rule version；
- human review policy。

模型版本变化可比较但必须标记；如果平台无法提供版本，则显示“版本未知”。

## 14. 干预与复测

### 14.1 基线

机会创建时冻结：

- 来源窗口；
- 问题集合；
- profile 集合；
- 对象和竞品集合；
- 指标公式和阈值；
- 合格运行 ID；
- 当时的指标值。

### 14.2 复测

复测优先创建与基线完全相同的运行矩阵。若某 profile 或问题已不可用：

- 不得静默替换；
- 显示差异；
- 用户选择“创建新基线”或取消；
- 新旧结果不作为严格复测结论。

### 14.3 结果表达

系统可以表达：

- “干预后同口径样本的自然可见率从 20% 变为 40%”；
- “当前样本为 5 次，仍需继续观测”；
- “平台模型版本未知，无法排除平台变化影响”。

系统不能表达：

- “该文章导致可见率提升 20 个百分点”；
- “已保证未来推荐”；
- “一次复测证明优化成功”。

## 15. 初始机会规则

| 规则代码 | 条件摘要 | 最低样本 | 建议动作 |
|---|---|---:|---|
| VISIBILITY_DROP | 自然可见率较前周期下降达到阈值 | 当前和前期均 STABLE | 补测/内容诊断 |
| RECOMMENDATION_DROP | 推荐率下降达到阈值 | 当前和前期均 STABLE | 内容与替代结论检查 |
| COMPETITOR_SURGE | 竞品推荐 SOV 上升且超过我方 | 当前和前期 REPORTABLE | 竞品信源分析 |
| TOPIC_COVERAGE_GAP | 核心问题达到稳定样本但零提及 | STABLE | 创建内容任务 |
| OWN_CITATION_LOST | 前期有自有引用，当前稳定样本为零 | 当前/前期 REPORTABLE | 页面/发布修复 |
| CRITICAL_FACT_ERROR | 出现 HIGH/CRITICAL INCORRECT | 1 条即可 | 事实核验和风险处理 |
| REPEATED_FACT_ERROR | 同类错误跨多个运行重复出现 | ≥3 运行 | 事实/内容专项任务 |
| UNSTABLE_RESULT | 重复运行一致性低于阈值 | ≥3 重复 | 增加采样，不直接优化 |
| DATA_QUALITY_PROBLEM | 证据完整率或成功率低 | 批次级 | 修复采集配置 |
| RUN_FAILURE | 同 profile 连续失败 | 配置阈值 | 运维处理 |

规则必须返回：当前值、阈值、分子、分母、来源运行和不可用原因。

## 16. 人工复核对指标的影响

- 默认指标使用最新有效人工复核；
- 未复核且无需复核的机器分析可以进入指标；
- NEEDS_REVIEW 在复核前不进入业务分母，但进入数据质量统计；
- 筛选可以选择“仅人工复核”；
- 报告必须显示人工复核覆盖率；
- 人工修正不修改历史机器分析，便于评估分析器质量。

## 17. 指标响应通用结构

所有比率型指标建议返回：

```yaml
code: UNBRANDED_VISIBILITY_RATE
value: 0.4              # 无分母时为 null
numerator: 4
denominator: 10
sample_level: STABLE
eligible_run_count: 10
excluded_run_count: 2
previous_value: 0.2
change_points: 0.2
unavailable_reason: null
```

前端不得仅接收 `value` 后自行推断样本、趋势或告警。


## 18. GEO-601 回答级公式字典（当前内部计算合同）

2026-10-03 用户裁决首位推荐率和严重错误运行率均采用本文方法口径；见 ADR-004 的 GEO-601 裁决记录。内部纯计算唯一入口为 `backend/app/services/geo_metrics.py:calculate_metric`，版本 `geo-answer-v1`。此版本不提供 Overview、趋势、数据质量卡片、洞察明细、管理员配置或 HTTP 指标响应；后续 API 必须显式投影本库结果，前端不复制公式。旧文章关系指标保持独立。

### 18.1 输入与资格

`MetricRun`/`MetricDimensions`/`MetricScope` 是冻结内部模型；`metric_run_from_snapshot` 显式转换服务端一致快照，按 current analysis pointer 和它绑定的 current review 调用 GEO-507 的有效结果投影，不能回退历史成功分析、不能累计旧人工修正。回答与分析的运行 ID、回答 ID、答案哈希必须匹配；required review 不能用旧 analysis 的 review 清门禁。无成功 current analysis 的输入排除。

调用方负责在同一一致读快照加载输入，以及确定 latest attempt、题目适用 subject binding、实质描述事实、管理员明确排除、完整性和“无引用可观察”的证据。错误页/登录页、影响结论的截断、未提交人工录入、profile 必需证据缺失必须由完整性门禁排除，不从字符串猜测。`described` 独立于 `mentioned`，点名问题中只复述品牌名称不算实质回答；不得把 mention 自动提升为 described。无引用事实不能由 surface.capabilities 或 web_search_observed 自动推出。

输入可保留被 superseded 的 attempt，但不能计入分母。同一逻辑样本只接受一条未 superseded 的 attempt；重复 run ID 或同一 batch/prompt/profile/repeat 的多条 active attempt 均显式报错，即使其中一条失败也不择优。通用资格是 COMPLETED、非空答案、成功 current analysis、必要 current review、完整性通过、未管理员排除、维度一致且目标在事先确定的适用 binding 中。

`metric_scope_from_snapshot` 从冻结对象类型确定产品资格，从 PRIMARY/COMPETITOR 角色形成 SOV 集合，REFERENCE 不贡献默认 SOV。集合必须包含目标且是冻结 binding 的子集。不要用当前可变 Catalog 或答案提及情况反推历史适用集合。

### 18.2 可比维度与结果

每次只计算调用方显式指定的 cell；不匹配输入按 `DIMENSION_MISMATCH` 排除。维度包括 topic/prompt/profile/surface 身份和 revision、MANUAL/API/BROWSER、语言/地区/登录状态、BRANDED/UNBRANDED、意图、已知采集模型/产品及版本、规则/分析配置指纹、冻结 subject revision、声明事实版本绑定、时间窗口。未知版本保持 null。SOV 的实际对象集合另存入结果 scope，集合变化后不能静默比较。稳定性另要求同一 batch、至少两个不同 repeat 的合格运行。

所有结果返回 `metric_code`、`formula_version`、`dimensions`、`scope`、`value`、`numerator`、`denominator`、`sample_level`、`eligible_run_count`、`excluded_run_count`、`exclusion_reason_counts`、`eligible_run_ids` 和 `unjudgeable_claim_count`。`value` 是原始比值，位置均值可大于 1，不是百分数；无分母返回 null。样本等级始终依据进入该指标的合格运行数，不能用引用或声明事件数提升等级。0/1–2/3–4/≥5 对应 NONE/OBSERVED/REPORTABLE/STABLE；显式传入冻结 SamplePolicy 可改变门槛，但本任务不保存管理员配置，不触发规则。

排除原因计数按原因分别计，同一运行可有多个原因，`excluded_run_count` 仍只计一次。原因码包括未完成运行、缺失答案、不可用 current analysis、缺必要 current review、完整性错误、管理员排除、旧 attempt、维度不匹配、对象/意图/点名不适用、无可靠排序/目标 rank、引用不可观察/分类不完整、无可判断声明、重复样本不足。没有任何事件的 SOV/引用份额可以有 OBSERVED 等合格运行等级但 value=null；不是 0%。

### 18.3 指标字典

以下公式均先应用通用资格；“目标”是 scope.subject_id。推荐适用意图为现有 PRODUCT/REPLACEMENT/COMPARISON/APPLICATION，当前公共枚举没有 PURCHASE，不在本任务新增。

| metric_code | 统计单位 | 分子 / 分母 | 特定资格或排除 |
|---|---|---|---|
| answer_coverage | 运行 | 目标 mentioned 运行 / 合格运行 | 全部适用题目 |
| natural_visibility | 运行 | 目标 mentioned 运行 / 合格运行 | 仅 UNBRANDED |
| branded_answer | 运行 | 目标 described 运行 / 合格运行 | 仅 BRANDED，described 为实质描述独立事实 |
| product_mention | 运行 | 目标 mentioned 运行 / 产品相关合格运行 | 产品类型；适用 binding 事先确定 |
| recommendation_rate | 运行 | 目标 RECOMMENDED 运行 / 推荐适用合格运行 | CONSIDERED/NOT_RECOMMENDED/UNKNOWN 不贡献分子 |
| top_recommendation_rate | 运行 | 目标可靠 rank=1 运行 / 有可靠排序的推荐适用合格运行 | 任一对象有可靠正整数 rank；目标缺席仍进入分母 |
| average_recommendation_rank | 目标有序运行 | 目标可靠 rank 总和 / 目标有 rank 的运行 | 无可靠顺序不补默认位置 |
| mention_sov | 运行—对象事件 | 目标提及事件 / 监测集合提及事件 | UNBRANDED；每运行每对象至多一次；固定集合 |
| recommendation_sov | 运行—对象事件 | 目标推荐事件 / 监测集合推荐事件 | UNBRANDED、推荐适用；固定集合 |
| owned_source_coverage | 运行 | 有 OWNED 引用运行 / 合格引用运行 | 实际引用或明确可观察无引用；分类完整 |
| owned_citation_share | 引用事件 | OWNED 规范 URL 数 / 全部规范 URL 数 | 同一回答的规范 URL 去重；冲突分类报错 |
| domain_coverage | 运行 | 引用指定 hostname 运行 / 合格引用运行 | 调用方明确提供已归一域名；精确 hostname |
| accurate_claim_rate | 目标声明 | ACCURATE / 可判断目标声明 | 有可判断目标声明的运行 |
| partial_claim_rate | 目标声明 | PARTIAL / 可判断目标声明 | 部分正确不计入准确分子 |
| incorrect_claim_rate | 目标声明 | INCORRECT / 可判断目标声明 | UNJUDGEABLE 不进入分母，数量另返 |
| severe_error_run_rate | 运行 | 有 HIGH/CRITICAL INCORRECT 目标声明运行 / 有可判断目标声明运行 | HIGH/CRITICAL PARTIAL 不计严重错误 |
| mention_stability | 同批次重复运行 | max(目标提及次数,未提及次数) / 合格重复数 | 至少 2 个；不跨 batch |
| recommendation_stability | 同批次重复运行 | max(目标推荐次数,未推荐次数) / 合格重复数 | 至少 2 个；推荐适用；不跨 batch |

准确性各项按 scope 目标声明计算，不将其他对象错误归给目标。UNJUDGEABLE 单独计数包含仅因“没有可判断声明”被排除的运行；失败、旧 attempt、维度不符等通用不合格运行中的声明不计数。稳定性全未提及/未推荐可以为 1，描述一致性而不是表现好坏。

完整独立金标在 `backend/tests/unit/geo_metrics_gold.py`，使用四条虚构运行及人工复算常量；18 项公式覆盖与边界由 `test_geo_metrics.py` 验证，current pointer/review 转换由 `test_geo_metric_inputs.py` 验证。不得用同一待测公式生成预期值。


## 19. GEO-602 Overview 当前读合同

2026-10-03 本会话用户完成 ADR-004 剩余裁决：运行成功率使用 COMPLETED/(COMPLETED+FAILED+CANCELLED)，预算阻断单列状态计数；分析质量命名为 `analysis_run_coverage`，以非空 Answer 的唯一 latest Run 为分母、匹配答案的成功 current analysis 为分子，不受重分析次数影响。该分析覆盖率不等同于业务指标资格，必要复核和完整性仍可阻断。质量版本 `geo-overview-quality-v1`，业务公式仍为 `geo-answer-v1`。

Overview 的候选是 Run.created_at 半开窗口内每逻辑 cell 的最新 attempt；先过滤冻结主题、问题、profile/surface、模式、环境、意图、点名，再在同一 binding 上应用 subject/product 交集。REVIEWED_ONLY 只保留 current analysis 的有效 latest Review，作用于全部区块。对象适用集合来自批次事先冻结的 subject binding，不根据提及内容反推。

业务卡片按 §18 完整 MetricDimensions 和目标对象/冻结监测集合分栏，不跨模式、点名、profile/revision、模型版本、事实版本或分析配置指纹汇总；字典revision取实际有效current analysis的冻结输入，重分析不能沿用采集旧字典版本。不计算趋势/SOV/矩阵。每栏公开维度、样本等级、排除原因及事件分子分母。准确率是声明事件比率，组成样本每 Run 保留声明贡献，明细条数不等于事件分母。自然可见、推荐、首位推荐、自有信源、准确与严重错误复用601；点名时自然可见返回明确不适用。

质量卡片字典：

| code | 分子 / 分母 |
|---|---|
| eligible_runs | 通用资格通过 Run / 候选 Run |
| run_success_rate | COMPLETED / 三类终态 Run |
| analysis_run_coverage | 有成功匹配 current analysis 的已采集 Run / 已采集 Run |
| review_backlog | current analysis 要求复核且无有效 Review 的 Run / 候选 Run |
| evidence_completeness | 原始答案、引用数量、引用文件 VERIFIED、冻结 profile 必需截图齐全的 COMPLETED Run / COMPLETED Run |
| cost_coverage | 费用与币种均已报告的 Run / 候选 Run |
| model_version_coverage | 有 source_model 和 source_version 的已采集 Run / 已采集 Run |

上述操作质量可按当前筛选汇总；业务表现始终按cell分栏。预算阻断保留独立状态，不偷换为FAILED。eligible_runs的eligible_run_count为资格通过数，其他质量卡为分母运行数；sample_level基于此数。排除原因可重叠，excluded_run_count按运行去重。无分母null；费用未知不补零、不换币、不在602计算均价。维度差异显式分栏并返回dimension_count，不把已正确分栏数据当作错误排除。

存在引用时按601资格计算；当前未保存独立的“可观察无引用”事实，因此无引用回答排除 CITATION_OBSERVATION_UNAVAILABLE，不能从能力或web_search_observed推断。完整性读取仅证明PG证据元数据与引用完整，不声称对象存储当前可下载；不在GET中进行外部I/O。LENGTH/CONTENT_FILTER回答不进入业务指标。没有独立实质描述事实，不推出branded_answer。

每卡片drilldown带规范filters、metric_code、cell_key、cohort和可空batch_id。DENOMINATOR/NUMERATOR/CANDIDATE/EXCLUDED均由同一服务路径计算；下钻响应每运行提供稳定ID、current analysis/review身份、事件分子分母与排除原因，能跳到既有Run Detail。实时下钻重新取得RR快照，不承诺跨请求冻结；数据变动时as_of不同，失效cell返回404，不回退另一cell。机会尚未实现，available=false/NOT_IMPLEMENTED且数量和分母null，不伪装0。最近批次只统计同筛选候选，最多5批，不能把该筛选子集当作整个Batch状态。
