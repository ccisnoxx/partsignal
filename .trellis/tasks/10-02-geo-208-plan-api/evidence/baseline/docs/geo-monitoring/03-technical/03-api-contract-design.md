# PartSignal GEO API 契约设计

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 前缀 | `/api/v1/geo/*` |
| 契约流程 | 先更新 `contracts/openapi.yaml`，再实现后端和前端生成类型 |

## 1. 通用约定

### 1.1 认证与 CSRF

- 全部 GEO 接口需要登录；
- 写请求需要 `X-CSRF-Token`；
- 管理配置接口需要 ADMIN；
- 业务观测、复核、机会处理允许 ENGINEER；
- 每个响应继续返回 `X-Request-ID`；
- 错误使用统一 `ErrorEnvelope`。

### 1.2 并发

可变资源请求必须携带 `expected_revision`。冲突返回：

```text
409 REVISION_CONFLICT
```

### 1.3 幂等

以下创建命令要求 `Idempotency-Key`：

- 创建立即运行批次；
- 创建调度批次（内部 schedule identity）；
- 提交人工回答；
- 创建显式重试；
- 从机会创建行动；
- 创建复测批次。

同键同载荷返回首次结果，同键异载荷返回稳定冲突。

### 1.4 分页

默认：

```yaml
page: 1
page_size: 20
```

允许 `10 | 20 | 50`，大导出使用专门接口，不通过 `page_size=10000`。

### 1.5 时间

- API 时间使用 ISO 8601、UTC 或含时区；
- 时间范围使用半开区间 `[from, to)`；
- 报告返回数据库统一 `as_of`；
- Cron 计划保存 IANA timezone。

## 2. 资源分组

```text
/api/v1/geo/subjects
/api/v1/geo/engine-surfaces
/api/v1/geo/collection-profiles
/api/v1/geo/prompt-variants
/api/v1/geo/monitoring-plans
/api/v1/geo/observation-batches
/api/v1/geo/observation-runs
/api/v1/geo/overview
/api/v1/geo/insights
/api/v1/geo/opportunities
/api/v1/geo/reports
/api/v1/geo/rules
```

## 3. 监测对象 API

| 方法 | 路径 | operationId | 权限 |
|---|---|---|---|
| GET | `/geo/subjects` | `listGeoSubjects` | ENGINEER |
| POST | `/geo/subjects` | `createGeoSubject` | ADMIN |
| GET | `/geo/subjects/{subject_id}` | `getGeoSubject` | ENGINEER |
| PATCH | `/geo/subjects/{subject_id}` | `updateGeoSubject` | ADMIN |
| POST | `/geo/subjects/{subject_id}/enable` | `enableGeoSubject` | ADMIN |
| POST | `/geo/subjects/{subject_id}/disable` | `disableGeoSubject` | ADMIN |
| DELETE | `/geo/subjects/{subject_id}` | `deleteGeoSubject` | ADMIN |
| POST | `/geo/subjects/{subject_id}/aliases` | `createGeoSubjectAlias` | ADMIN |
| PATCH | `/geo/subjects/{subject_id}/aliases/{alias_id}` | `updateGeoSubjectAlias` | ADMIN |
| DELETE | `/geo/subjects/{subject_id}/aliases/{alias_id}` | `deleteGeoSubjectAlias` | ADMIN |
| POST | `/geo/subjects/{subject_id}/domains` | `createGeoSubjectDomain` | ADMIN |
| DELETE | `/geo/subjects/{subject_id}/domains/{domain_id}` | `deleteGeoSubjectDomain` | ADMIN |

### 3.1 GEO-101 公共合同与接线边界

GEO-104 已将以上 12 个冻结操作迁入 [根 OpenAPI](../../../contracts/openapi.yaml) 的标准 paths 并接线真实 Router/Application Service，删除 CONTRACT_ONLY 扩展。请求/响应和枚举在标准 components，generated types 只来自根合同；全部 176 个实际 operation 接受严格 runtime drift gate。实施与验证见 [GEO-104 证据](../../../.trellis/tasks/10-02-geo-104-catalog-api/implement.md)，状态 review；Catalog 页面仍由 GEO-105 实施。

- create 按 subject_type 判别：OWN_PRODUCT 只接收 Product 引用、可空品牌父级和监测用途说明，禁止提交名称或 Product 事实；其他类型提交监测名称且不能提交 product_id。
- PATCH 按 immutable subject_type 判别，提交 expected_revision 和至少一个可编辑字段；省略保留原值，parent=null 清空。请求 subject_type 必须与资源相同，不能改变类型/Product。
- SubjectOut 包含 parent/product 只读摘要、aliases/domains、当前 references、workflow_stage/primary_task/available_actions/deletion/revision。OWN_PRODUCT 名称从当前 Product 一致读取，不能回写。
- Alias/Domain 无独立 revision。所有子写命令携带父 expected_revision；成功包括子 DELETE 返回完整 SubjectOut（200）；Subject POST 为 201，Subject DELETE 为 204。
- ADMIN 具有真实 typed 写动作及 deletion blocker；ENGINEER 全部写动作为空、deletion=null。projection 不构成授权；所有写入口需 ADMIN/session/CSRF。
- 列表使用 q/subject_type/product_id/parent_subject_id/is_active/sort/page/page_size，页大小 10/20/50，返回 total；排序稳定 tie-break id。q 与检索名称统一 NFKC/Unicode 空白/casefold 的字面子串，保留型号分隔符和后缀；当前 Product/显示名称在快照中批量规范后以匹配 UUID 过滤，规范字典键转义 SQL LIKE 通配符。读模型在同一 REPEATABLE READ 快照批量投影并关闭 autoflush，避免认证会话隐式写入，名称过滤读取当前 Product，前端不 join。
- 每个写操作逐项声明 400/401/403/404/409/422 的适用错误及 X-Request-ID。Catalog 五项领域错误由 GeoCatalogErrorCode 冻结；REVISION_CONFLICT 和统一认证/校验错误沿用现有合同。错误位置、精确 constraint 映射和删除 references 见 [数据库合同](../../../contracts/database.md)，未知完整性错误不猜测。
- 无 Catalog Idempotency-Key，重复创建返回唯一性冲突，stale revision 不自动重放。IDNA 转换和字典编辑只作用于当前配置，无 DNS/HTTP/外部 AI 调用。

## 4. 观测面与采集配置 API

GEO-203 / R1 建立数据 components；GEO-204 建立 Registry 与共享资格策略。GEO-205 在这些合同上接入以下 14 个管理操作，标准前缀为 `/api/v1`，公共权威仍是 `contracts/openapi.yaml`。实现与本地验收见 [任务记录](../../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。

Create/Out 按 collection_mode 判别，Update 使用不可变模式和完整可编辑配置、必填 expected_revision，不接受 Surface 身份/模式变更或创建元数据。三种 settings 均 additionalProperties=false；只返回非敏感布尔/数值。API refs 两空或两非空，MANUAL/BROWSER refs 只能 null，model 实际归属由数据库复合 FK 确认。

| 方法 | 路径 | operationId |
|---|---|---|
| GET/POST | `/geo/engine-surfaces` | `listGeoEngineSurfaces` / `createGeoEngineSurface` |
| GET/PATCH | `/geo/engine-surfaces/{id}` | `get/updateGeoEngineSurface` |
| POST | `/geo/engine-surfaces/{id}/enable` | `enableGeoEngineSurface` |
| POST | `/geo/engine-surfaces/{id}/disable` | `disableGeoEngineSurface` |
| DELETE | `/geo/engine-surfaces/{id}` | `deleteGeoEngineSurface` |
| GET/POST | `/geo/collection-profiles` | `listGeoCollectionProfiles` / `createGeoCollectionProfile` |
| GET/PATCH | `/geo/collection-profiles/{id}` | `get/updateGeoCollectionProfile` |
| POST | `/geo/collection-profiles/{id}/enable` | `enableGeoCollectionProfile` |
| POST | `/geo/collection-profiles/{id}/disable` | `disableGeoCollectionProfile` |
| DELETE | `/geo/collection-profiles/{id}` | `deleteGeoCollectionProfile` |

两类列表和详情返回显式 `summary` 与管理员 `configuration`。ENGINEER 的 `configuration/deletion/activation_blockers` 为 null（Surface 无 activation_blockers），`available_actions=[]`，`primary_task=VIEW_SUMMARY`；不返回 adapter/settings、渠道/模型绑定、创建者或网站配置。ADMIN 也只得到闭合的非敏感配置，不返回凭据、Cookie、敏感 Header 或浏览器资料路径。422 仅返回安全定位、类型和静态错误消息，不回显输入值或 Pydantic context。

列表支持 `q/is_active/sort/page/page_size`，页大小 10/20/50；Surface 另支持 `surface_kind`，Profile 另支持 `engine_surface_id/collection_mode`。读模型使用同一 REPEATABLE READ 快照与批量查询。PATCH/启停必填 `expected_revision`，DELETE 通过必填 query 参数提交该值；stale revision 返回 409，无自动重放或 Idempotency-Key。

创建一律停用且 Profile 为 UNTESTED。Profile 实际配置变化清除旧测试事实并停用；无变化不递增 revision 或写成功审计。启用使用当前共享资格策略，未通过 BROWSER 合规/批准/环境/测试等门禁时返回 `GEO_PROFILE_INELIGIBLE` 与非敏感 blocker。当前运行时只登记 manual；未知自动 adapter 在写配置时显式失败。本任务不提供 `/test`；连接测试由 GEO-403、浏览器会话由 GEO-806 拥有。

| 状态 | 管理错误码 | 条件 |
|---|---|---|
| 409 | `REVISION_CONFLICT` | 提交版本与当前版本不一致 |
| 409 | `GEO_SURFACE_SLUG_EXISTS` / `GEO_PROFILE_NAME_EXISTS` | slug 或 Surface 下 Profile 名称唯一冲突 |
| 409 | `GEO_SURFACE_IN_USE` | 真实子 Profile 或首次历史引用阻止删除 |
| 409 | `GEO_PROFILE_INELIGIBLE` | 当前配置不能启用 |
| 422 | `GEO_MODEL_BINDING_INVALID` | 渠道/模型不存在或归属错误 |
| 422 | `GEO_ADAPTER_UNKNOWN` / `GEO_PROFILE_CONFIGURATION_INVALID` | adapter 未登记或配置不满足其闭合合同 |

权限/CSRF/NOT_FOUND 沿用现有 ErrorEnvelope。业务写入与最小白名单审计在同一事务；锁顺序和历史引用合同见 `contracts/database.md` 的 GEO-205 管理命令章节。

### 4.1 能力响应

```yaml
capabilities:
  answer_text: true
  citations: true
  web_search_signal: true
  model_version: false
  usage: true
  cost: false
```

这是配置能力，不是本次运行结果。

## 5. 问题变体 API

GEO-201 冻结问题变体语义与持久化合同；GEO-202 已接线以下七个端点，标准前缀为 `/api/v1`，公共权威为 `contracts/openapi.yaml`。语言、地区、模式、优先级必须显式提供，创建者由服务端决定。PATCH 只写显式字段，已引用变体只能停用；新语义需创建新变体。`normalized_hash` 为内部生成列，首次引用标记只读。

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/prompt-variants` | `listGeoPromptVariants` |
| POST | `/geo/query-topics/{query_topic_id}/prompt-variants` | `createGeoPromptVariant` |
| GET | `/geo/prompt-variants/{id}` | `getGeoPromptVariant` |
| PATCH | `/geo/prompt-variants/{id}` | `updateGeoPromptVariant` |
| POST | `/geo/prompt-variants/{id}/enable` | `enableGeoPromptVariant` |
| POST | `/geo/prompt-variants/{id}/disable` | `disableGeoPromptVariant` |
| DELETE | `/geo/prompt-variants/{id}` | `deleteGeoPromptVariant` |

当前列表支持 `q/query_topic_id/intent_type/mention_mode/language_code/region_code/priority/is_active/sort/page/page_size`；页大小 10/20/50，排序 UPDATED_DESC 或 TEXT_ASC，稳定 tie-break UUID。`q` 对问题文本及当前主题问题进行 NFKC/Unicode 空白规范化后的字面子串匹配，保留大小写与型号；SQL LIKE 通配符转义。计划引用和最近运行过滤属于未来消费方任务，不在 GEO-202 中伪造字段。

ADMIN 与 ENGINEER 均可配置变体；当前资源属于内部单租户共享配置，created_by 为服务端审计身份。所有写请求需要 session 与 CSRF。Application Service 以 User→QueryTopic→Variant（User 使用 FOR NO KEY UPDATE，与审计 FK KEY SHARE 兼容） 顺序锁定、重读身份与 revision；历史首次引用后只允许停用及复制为新身份，禁止编辑、重启和删除。相同值更新/启停不增加 revision、更新时间或成功审计；无 Idempotency-Key，重复身份创建返回 409，不自动重放。

列表/详情包含当前主题摘要、workflow_stage、primary_task、available_actions、deletion.blockers 和 run_entry；读取采用认证前建立的 REPEATABLE READ 快照并关闭 autoflush，不做逐行查询。当前主题摘要不是历史运行快照。运行入口固定不可用（NOT_IMPLEMENTED），无运行端点或 Batch/Run。删除使用 required expected_revision query，启停使用 RevisionRequest body。成功审计同业务事务，仅含 revision/is_active 与稳定身份，不记录问题正文。

GEO-202 命令入口舍弃认证依赖待写的 `SessionRecord.last_seen_at` 活动提示，避免 User→Session 与改密的 Session→User 形成锁环；不修改 expires_at/revoked_at，也不放宽认证或 CSRF。会话有效期按 expires_at、撤销按 revoked_at 裁决，last_seen_at 不参与安全决定。User 的 FOR NO KEY UPDATE 仍阻止资格字段更新与删除；主题/变体继续 FOR UPDATE。真实同账号主题编辑/删除与同 Cookie 改密交错均由 PostgreSQL 回归验证。

## 6. 监测计划 API

GEO-206 交付 `GeoMonitoringPlanCreate/Update/Out/RevisionRequest`、状态/关系/调度枚举和 generated 类型。Create/Update 是完整配置，Update 另需 expected_revision；创建者、身份、状态与逻辑 revision 不接受客户端写入，预算 JSON 输入/输出均为非负十进制字符串（最多8位整数/6位小数）或 NULL，内部使用 Decimal；拒绝数字、符号、前导零、指数和尾随字符。GEO-207 新增下述预览数据组件和内部只读服务；仍无 Plan 路径或动作读模型，下表由 GEO-208 接线。既有 Subject/Prompt/Profile 的删除读模型已接入真实 MONITORING_PLAN 阻断，沿既有权限和 CSRF，不新增外部调用。

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/monitoring-plans` | `listGeoMonitoringPlans` |
| POST | `/geo/monitoring-plans` | `createGeoMonitoringPlan` |
| GET | `/geo/monitoring-plans/{id}` | `getGeoMonitoringPlan` |
| PATCH | `/geo/monitoring-plans/{id}` | `updateGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/preview` | `previewGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/{id}/activate` | `activateGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/{id}/pause` | `pauseGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/{id}/resume` | `resumeGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/{id}/archive` | `archiveGeoMonitoringPlan` |
| POST | `/geo/monitoring-plans/{id}/run` | `runGeoMonitoringPlanNow` |
| POST | `/geo/monitoring-plans/{id}/copy` | `copyGeoMonitoringPlan` |
| DELETE | `/geo/monitoring-plans/{id}` | `deleteGeoMonitoringPlan` |

### 6.1 预览请求

预览使用与 create/update 相同的完整配置，但不写数据库。

### 6.2 `GeoMonitoringPlanPreview`

GEO-207 的权威组件见 [根 OpenAPI](../../../contracts/openapi.yaml)，实现见 `backend/app/services/geo_plans.py`。请求使用完整配置，服务端显式转换内部选择；Subject 数不参与乘法，Profile 不按 Surface 合并。缺失/停用保留请求 run_count，返回可定位 blocker；缺失 Profile 的运行计入 unresolved_run_count。三种模式加 unresolved 等于 run_count。只读服务要求调用方的 REPEATABLE READ 或 SERIALIZABLE 事务，三次批量应用 SELECT 禁止 autoflush，不提交、不锁、不写。预览是当前快照，后续命令及发送仍需重新裁决。

资格复用 GEO-204；blocker 的 code 为闭合计划原因或 ProfileBlockerCode，field/resource_id/related_resource_id 定位选项，不返回名字、问题、settings 或秘密。混合模式、Profile 环境、问题/Profile 语言地区差异及缺少模型版本观测能力给 warning，不改变点名属性、状态机或执行授权。

估价仅接受内部服务端无 I/O 计算结果，当前没有生产估价实现，默认全部 unknown，包括 MANUAL。不能从 cost 能力、模型身份或测试状态推断费用。按 prompt×profile×repeat 汇总明确 Decimal 金额；JSON 金额为非负十进制字符串（最多6位小数，聚合整数位不受单格预算精度上限限制）。known_run_count + unknown_run_count = run_count，coverage 为 NONE/PARTIAL/COMPLETE。唯一币种的 value 是已知部分小计，不能解释为整个批次价格；全未知 value/currency=null。known_costs 保留分币已知小计，混币 value/currency=null，不换汇。有预算时混币返回 BUDGET_CURRENCY_MISMATCH；当前 budget 没有单独币种，仅与唯一估价币种的数额比较。已知小计超过 budget 时 BUDGET_EXCEEDED，相等不阻断；还有未知格时 BUDGET_UNVERIFIED，不能保证最终未超限。执行预算预留/扣费不在 GEO-207。

以下示例表示默认无估价实现；API/BROWSER 还会按当前共享资格返回实际 blocker：

```yaml
prompt_count: 10
profile_count: 3
repeat_count: 3
run_count: 90
manual_run_count: 30
api_run_count: 30
browser_run_count: 30
unresolved_run_count: 0
estimated_cost:
  value: null
  currency: null
  coverage: NONE
  known_run_count: 0
  unknown_run_count: 90
  known_costs: []
blockers: []
warnings:
  - code: COST_UNKNOWN
    field: estimated_cost
    resource_id: null
    related_resource_id: null
```

## 7. 批次 API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/observation-batches` | `listGeoObservationBatches` |
| POST | `/geo/observation-batches` | `createGeoObservationBatch` |
| GET | `/geo/observation-batches/{id}` | `getGeoObservationBatch` |
| POST | `/geo/observation-batches/{id}/cancel` | `cancelGeoObservationBatch` |
| GET | `/geo/observation-batches/{id}/runs` | `listGeoObservationBatchRuns` |

`createGeoObservationBatch` 支持：

- 计划立即运行；
- 临时选择变体/profile/对象；
- 不直接支持 RETEST，复测通过机会命令创建。

## 8. 运行 API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/observation-runs` | `listGeoObservationRuns` |
| GET | `/geo/observation-runs/{id}` | `getGeoObservationRun` |
| POST | `/geo/observation-runs/{id}/retry` | `retryGeoObservationRun` |
| POST | `/geo/observation-runs/{id}/cancel` | `cancelGeoObservationRun` |
| GET | `/geo/observation-runs/{id}/manual-entry` | `getGeoManualEntryContext` |
| PUT | `/geo/observation-runs/{id}/manual-draft` | `saveGeoManualDraft` |
| POST | `/geo/observation-runs/{id}/manual-submit` | `submitGeoManualObservation` |
| POST | `/geo/observation-runs/{id}/reanalyze` | `reanalyzeGeoObservationRun` |
| POST | `/geo/observation-runs/{id}/review` | `reviewGeoObservationRun` |

### 8.1 `GeoRunDetail`

必须一次返回：

- run identity/status/input snapshot；
- batch and plan summary；
- prompt/topic/subject/profile snapshots；
- answer snapshot；
- citations；
- current analysis and history summaries；
- current review and review history；
- attempts timeline；
- linked opportunities/actions/retest；
- `workflow_stage/primary_task/available_actions`；
- data quality and eligibility。

不得把大 raw payload 字节直接塞入详情；使用限时下载或受控查看接口。

### 8.2 人工提交

`GeoManualObservationSubmit`：

```yaml
expected_draft_revision: 2
answer_text: "..."
source_product: "豆包"
source_model: null
source_version: null
web_search_observed: true
citations:
  - url: "https://example.com/a"
    title: "..."
    position: 1
screenshot_file_id: "uuid"
comment: "人工观测完成"
```

服务端从 run snapshot 读取问题和环境，客户端不能替换 run 输入。

## 9. 分析与复核 API

### 9.1 重分析

`POST /geo/observation-runs/{id}/reanalyze`

请求：

```yaml
expected_current_analysis_revision: 2
fact_version_id: uuid-or-null
analyzer_mode: CURRENT_DEFAULT
reason: "别名和事实版本已更新"
```

创建异步分析 revision，返回 `202` 和 revision summary。

### 9.2 人工复核

`POST /geo/observation-runs/{id}/review`

```yaml
analysis_revision_id: uuid
expected_run_revision: 4
decision: CORRECTED
comment: "模型把型号后缀识别成另一产品"
corrections:
  mentions: [...]
  recommendations: [...]
  claims: [...]
```

corrections 必须使用判别联合 Schema，不能接受任意 JSON。

## 10. 总览和洞察 API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/overview` | `getGeoOverview` |
| GET | `/geo/insights` | `getGeoInsights` |
| GET | `/geo/insights/filter-options` | `getGeoInsightFilterOptions` |
| GET | `/geo/insights/runs` | `listGeoInsightRuns` |
| GET | `/geo/insights/citations` | `listGeoInsightCitations` |
| GET | `/geo/insights/claims` | `listGeoInsightClaims` |

### 10.1 通用筛选

- `date_from/date_to`
- `subject_ids`
- `product_ids`
- `query_topic_ids`
- `prompt_variant_ids`
- `engine_surface_ids`
- `collection_profile_ids`
- `collection_modes`
- `language_codes`
- `region_codes`
- `login_states`
- `mention_mode`
- `review_policy`
- `sample_level`

数组参数使用重复 query 参数或约定格式，必须在 OpenAPI 中固定。

### 10.2 Metric schema

```yaml
code: UNBRANDED_VISIBILITY_RATE
label: 自然可见率
value: 0.4
numerator: 4
denominator: 10
sample_level: STABLE
eligible_run_count: 10
excluded_run_count: 2
previous_value: 0.2
change_points: 0.2
unavailable_reason: null
```

### 10.3 数据质量

`GeoInsightDataQuality` 至少返回：

- candidate runs；
- eligible runs；
- excluded by status；
- excluded pending review；
- excluded evidence；
- incompatible dimensions；
- cost coverage；
- model version coverage；
- unavailable sections。

## 11. 机会 API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/opportunities` | `listGeoOpportunities` |
| GET | `/geo/opportunities/{id}` | `getGeoOpportunity` |
| POST | `/geo/opportunities/evaluate` | `evaluateGeoOpportunities` |
| POST | `/geo/opportunities/{id}/acknowledge` | `acknowledgeGeoOpportunity` |
| POST | `/geo/opportunities/{id}/dismiss` | `dismissGeoOpportunity` |
| POST | `/geo/opportunities/{id}/actions/content-task` | `createContentTaskFromGeoOpportunity` |
| POST | `/geo/opportunities/{id}/actions/publication-repair` | `createPublicationRepairFromGeoOpportunity` |
| POST | `/geo/opportunities/{id}/actions/fact-revision` | `startFactRevisionFromGeoOpportunity` |
| POST | `/geo/opportunities/{id}/actions/additional-monitoring` | `createMonitoringFromGeoOpportunity` |
| POST | `/geo/opportunities/{id}/retest` | `createGeoOpportunityRetest` |
| POST | `/geo/opportunities/{id}/resolve` | `resolveGeoOpportunity` |

### 11.1 行动命令

行动命令由 GEO service 组装上下文后调用现有领域应用服务，必须保留：

- 原 opportunity ID；
- 来源运行/指标；
- 创建的目标资源 ID；
- request ID；
- 原子或可恢复的跨模块结果。

如果跨模块命令不能同事务，必须使用明确补偿/失败状态，不能只写半条关联。

## 12. 规则 API

管理员接口：

- `GET /geo/rules`
- `PUT /geo/rules`
- `POST /geo/rules/preview`

核心版可以使用单一当前规则集，不必先建设复杂版本管理 UI；但批次和机会必须保存实际规则快照与 revision。

## 13. 报告 API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/reports/preview` | `getGeoReportPreview` |
| GET | `/geo/reports/print` | `getGeoPrintReport` |
| GET | `/geo/reports/runs.csv` | `exportGeoRunsCsv` |
| GET | `/geo/reports/citations.csv` | `exportGeoCitationsCsv` |
| GET | `/geo/reports/claims.csv` | `exportGeoClaimsCsv` |
| GET | `/geo/reports/opportunities.csv` | `exportGeoOpportunitiesCsv` |

导出必须：

- 使用同一筛选和公式；
- 只输出批准字段；
- 写导出审计；
- 大结果流式生成；
- 文件名带 UTC 时间和报告类型。

## 14. 稳定错误码

### Catalog

```text
GEO_SUBJECT_IN_USE
GEO_SUBJECT_PRODUCT_EXISTS
GEO_SUBJECT_ALIAS_EXISTS
GEO_SUBJECT_DOMAIN_EXISTS
GEO_SUBJECT_PARENT_INVALID
```

### Planning

```text
GEO_PROMPT_VARIANT_EXISTS
GEO_PLAN_EMPTY
GEO_PLAN_PROFILE_INELIGIBLE
GEO_PLAN_BUDGET_EXCEEDED
GEO_PLAN_SCHEDULE_INVALID
GEO_PLAN_ARCHIVED
GEO_SCHEDULE_WINDOW_EXISTS
```

### Run

```text
GEO_RUN_NOT_MANUAL
GEO_RUN_NOT_PENDING
GEO_RUN_ALREADY_STARTED
GEO_RUN_NOT_RETRYABLE
GEO_RUN_HAS_SUCCESSOR
GEO_MANUAL_DRAFT_CONFLICT
GEO_EVIDENCE_REQUIRED
GEO_ANSWER_EMPTY
GEO_COLLECTION_DISABLED
GEO_BROWSER_COLLECTION_DISABLED
GEO_DATA_CLASSIFICATION_FORBIDDEN
```

### Analysis

```text
GEO_ANALYSIS_NOT_AVAILABLE
GEO_ANALYSIS_ALREADY_CURRENT
GEO_ANALYSIS_RESPONSE_INVALID
GEO_REVIEW_REQUIRED
GEO_REVIEW_STALE_ANALYSIS
GEO_FACT_VERSION_INELIGIBLE
```

### Opportunity

```text
GEO_OPPORTUNITY_ALREADY_RESOLVED
GEO_OPPORTUNITY_ACTION_EXISTS
GEO_RETEST_NOT_COMPARABLE
GEO_RETEST_ALREADY_EXISTS
GEO_RESOLUTION_EVIDENCE_REQUIRED
```

## 15. OpenAPI 设计规则

- 所有状态使用显式 enum；
- 使用 discriminated union 表示采集模式和行动类型；
- 不使用自由 JSON 代替公共 correction/action Schema；
- read model 与 command response 分离；
- operationId 全局唯一且稳定；
- 所有列表返回服务端 `total`；
- 所有写命令声明 401/403/409/422 等稳定错误；
- async 命令使用 202 并返回目标资源，而不是空成功；
- request/response 中不回显敏感配置；
- 生成前端类型后必须执行 contract check。
