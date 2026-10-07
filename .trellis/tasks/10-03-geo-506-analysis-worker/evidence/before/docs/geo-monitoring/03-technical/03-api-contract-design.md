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

创建一律停用且 Profile 为 UNTESTED。Profile 实际配置变化清除旧测试事实并停用；无变化不递增 revision 或写成功审计。启用使用当前共享资格策略，未通过 BROWSER 合规/批准/环境/测试等门禁时返回 `GEO_PROFILE_INELIGIBLE` 与非敏感 blocker。GEO-403 增加已实现的 `openai-compatible-chat` 连接诊断登记，采集批准仍为 false；未知 adapter 仍显式失败。浏览器会话由 GEO-806 拥有。

| 状态 | 管理错误码 | 条件 |
|---|---|---|
| 409 | `REVISION_CONFLICT` | 提交版本与当前版本不一致 |
| 409 | `GEO_SURFACE_SLUG_EXISTS` / `GEO_PROFILE_NAME_EXISTS` | slug 或 Surface 下 Profile 名称唯一冲突 |
| 409 | `GEO_SURFACE_IN_USE` | 真实子 Profile 或首次历史引用阻止删除 |
| 409 | `GEO_PROFILE_INELIGIBLE` | 当前配置不能启用 |
| 422 | `GEO_MODEL_BINDING_INVALID` | 渠道/模型不存在或归属错误 |
| 422 | `GEO_ADAPTER_UNKNOWN` / `GEO_PROFILE_CONFIGURATION_INVALID` | adapter 未登记或配置不满足其闭合合同 |

权限/CSRF/NOT_FOUND 沿用现有 ErrorEnvelope。业务写入与最小白名单审计在同一事务；锁顺序和历史引用合同见 `contracts/database.md` 的 GEO-205 管理命令章节。

### GEO-403 连接诊断

`POST /geo/collection-profiles/{profile_id}/test` / `testGeoCollectionProfile`：管理员 + CSRF，body 为必填 `expected_revision`，200 返回 canonical `GeoCollectionProfileRead`。Profile 读模型增加服务端 `TEST` 动作、`test_blockers` 与固定安全 `test_error {code, summary}`；工程师两字段为 null。未通过门禁返回 `GEO_PROFILE_INELIGIBLE` 409；过期或并发结果 `REVISION_CONFLICT` 409。provider/凭据/SSRF/TLS/响应失败提交 FAILED/时间和固定安全摘要后返回200，不回显响应正文、URL、Header 或 exception message。

固定诊断使用当前渠道/模型参数与 Profile temperature，固定 user 消息 `hi`、stream=false，未指定 Profile 输出上限时保留模型参数；显式覆盖沿用模型的 max_completion_tokens 键（若无则使用 max_tokens），不为未指定上限的模型注入另一个键，不使用业务问题/品牌/草稿 Schema，不解析采集引用/usage/cost。只有 answer_text 为明确已实现能力；REQUESTED/REQUIRED 搜索策略显式阻断。复用 pinned transport 和共享资格策略；诊断只豁免 Profile 启用、旧测试和采集批准，仍要求 API/main 开关、批准且启用的 Surface、模型及渠道已启用、模型已测试、协议/凭据/能力匹配。

预留/完成各递增一次 revision，网络期间无行锁。结果只适用于预留和当前依赖 revisions；中断保持 UNTESTED/停用，可从最新版本显式再试。成功不启用，不创建业务 Run/Batch 或业务指标。启用仍需另一个显式命令并满足全部采集资格；GEO-404 完成前 adapter 尚未批准采集。依赖失效与迁移见根 database 合同。

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

列表/详情包含当前主题摘要、workflow_stage、primary_task、available_actions、deletion.blockers 和 run_entry；读取采用认证前建立的 REPEATABLE READ 快照并关闭 autoflush，不做逐行查询。当前主题摘要不是历史运行快照。Prompt页面直接运行入口仍不可用（NOT_IMPLEMENTED）；GEO-303通过计划/临时批次创建API冻结变体输入，Prompt自身不拥有创建端点。删除使用 required expected_revision query，启停使用 RevisionRequest body。成功审计同业务事务，仅含 revision/is_active 与稳定身份，不记录问题正文。

GEO-202 命令入口舍弃认证依赖待写的 `SessionRecord.last_seen_at` 活动提示，避免 User→Session 与改密的 Session→User 形成锁环；不修改 expires_at/revoked_at，也不放宽认证或 CSRF。会话有效期按 expires_at、撤销按 revoked_at 裁决，last_seen_at 不参与安全决定。User 的 FOR NO KEY UPDATE 仍阻止资格字段更新与删除；主题/变体继续 FOR UPDATE。真实同账号主题编辑/删除与同 Cookie 改密交错均由 PostgreSQL 回归验证。

## 6. 监测计划 API

GEO-206 交付 `GeoMonitoringPlanCreate/Update/Out/RevisionRequest`、状态/关系/调度枚举和 generated 类型。Create/Update 是完整配置，Update 另需 expected_revision；创建者、身份、状态与逻辑 revision 不接受客户端写入，预算 JSON 输入/输出均为非负十进制字符串（最多8位整数/6位小数）或 NULL，内部使用 Decimal；拒绝数字、符号、前导零、指数和尾随字符。GEO-207 提供下述预览数据组件与内部只读服务；GEO-208 已接线下表12个操作及typed详情/列表/动作读模型，当前等待人工验收。既有 Subject/Prompt/Profile 的删除读模型已接入真实 MONITORING_PLAN 阻断，沿既有权限和 CSRF，不新增外部调用。

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

GEO-208 当前命令以 session 和 CSRF 保护，ADMIN/ENGINEER 管理内部共享Plan；服务端拥有状态、revision、追溯和资格裁决。PATCH 完整替换配置而非集合片段；请求不可写 status/creator/revision。所有已存在Plan命令必须 expected_revision，DELETE 为 required query，其余 body。实际配置/状态变化恰好+1；集合顺序 no-op不变；stale409 REVISION_CONFLICT，无自动重放。合法状态与锁协议见[数据库合同](../../../contracts/database.md#geo-208-命令快照与审计)。DISABLED/PAUSED允许保存可修复的运行阻断，引用不存在仍422；activate/resume与ACTIVE实际修改必须锁内重验当前资格。复制请求另需name，返回新DISABLED/revision0，不改变源；ARCHIVED只读/复制。DELETE仅DISABLED，204空响应，审计保留。

详情 `GeoMonitoringPlanDetail` 包含完整配置、preview、workflow_stage、primary_task、available_actions、deletion与run_entry；列表items使用同一模型，不返回未实施的last_batch/运行健康/成功率。列表q为名称字面子串，status/schedule_kind为闭合筛选，sort为UPDATED_DESC/NAME_ASC，page从1、page_size=10/20/50（默认20），稳定UUID次序。GET/preview在认证前RR且禁autoflush，不写心跳；count/page/关系/资格共享快照且固定批量查询。

GEO-303 已开放计划创建 API：`POST /geo/monitoring-plans/{id}/run` 必填 expected_revision 和1..160字符可见ASCII Idempotency-Key，返回201 `GeoBatchCreated` 稳定回执。非归档计划在当前资格满足时可手工创建，计划状态/revision不变；同用户同键同请求重放原回执，异请求409 IDEMPOTENCY_CONFLICT。当前R1页面仍不提供运行交互，run_entry为 `{available:false,reason_code:UI_NOT_IMPLEMENTED}`，不投影RUN_NOW；运行页面由后续任务交付。计划存在批次历史时删除投影增加 HAS_BATCH_HISTORY，不提供 DELETE，命令返回 GEO_PLAN_IN_USE。

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

GEO-304 / R2 已新增 GeoRawPayloadSummary、GeoAnswerSnapshotOut、GeoAnswerCitationInput、GeoAnswerCitationOut 四个闭合公共数据组件，无新 HTTP 端点；人工提交由 GEO-305 接线，详情仍由后续任务交付。原始 URL/位置/采集标题保持证据语义，分类/Subject/Article 归 AnalysisRevision。

GEO-301 / R2 已建立根OpenAPI基础数据和闭合快照组件；GEO-302已建立状态与动作策略；GEO-303开放两个批次创建入口。GEO-306已开放五个Batch/Run读取端点；GEO-406开放显式重试；取消、分析与复核操作仍尚未开放。公共Run隐藏lease_token；费用未知为null，不返回异常或供应商原始正文。

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/geo/observation-batches` | `listGeoObservationBatches` |
| POST | `/geo/observation-batches` | `createGeoObservationBatch` |
| GET | `/geo/observation-batches/{id}` | `getGeoObservationBatch` |
| POST | `/geo/observation-batches/{id}/cancel` | `cancelGeoObservationBatch` |
| GET | `/geo/observation-batches/{id}/runs` | `listGeoObservationBatchRuns` |

GEO-303 `POST /geo/observation-batches` / `createGeoObservationBatch` 使用required Idempotency-Key与闭合source判别联合：

- `PLAN`：plan_id与expected_revision；与计划run-now入口共用请求身份。
- `AD_HOC`：configuration为完整计划配置形状，但schedule_kind只能MANUAL_ONLY、cron_expression只能null；不保存临时Plan。
- 返回201 `{batch_id,requested_run_count,created_at}`；不把之后变化的Batch状态写入幂等回执。
- 两入口都要求ADMIN/ENGINEER、session与CSRF；当前共享内部业务权限，用户仅限定key命名空间。鉴权后优先重放首次结果，首次创建才锁内校验当前revision/资格。
- 错误复用AUTH_REQUIRED/PASSWORD_CHANGE_REQUIRED/FORBIDDEN/VALIDATION_ERROR/NOT_FOUND/REVISION_CONFLICT/GEO_PLAN_REFERENCE_INVALID/GEO_PLAN_PROFILE_INELIGIBLE/GEO_PLAN_BUDGET_EXCEEDED/GEO_PLAN_ARCHIVED/IDEMPOTENCY_CONFLICT；未知内部失败不伪造成功。
- 不支持客户端actor/status/snapshot/classification/scheduled_for、SCHEDULED或RETEST。调度创建仅内部应用服务，窗口UTC规范化且身份不含plan revision；Scheduler循环仍属后续任务。
- 创建不调用外部平台，不派发Redis；稳定执行ID和后续状态读模型由对应任务接入。

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

GEO-306 / R2 已实现 `GeoRunDetail`，在认证前建立同一 REPEATABLE READ 快照并禁止 autoflush，一次返回：

- `run`：身份、状态、冻结输入、真实错误、当前采集资格、服务端 workflow/action 与最新 attempt 标记；
- `batch`：冻结计划摘要、完整批次计数、workflow/action；不嵌入全部批次 runs；
- `answer/citations/evidence_files`：所选 attempt 的不可变原始证据，引用保留去重及实际位置；
- `attempts/timeline`：同 cell 全部 attempts 与真实 created/started/collected/finished 时间，不推断未记录的状态时间；
- `data_quality`：`assessment=NOT_IMPLEMENTED`、`metric_eligible=null`，明确未实现的 ANALYSIS/REVIEW/METRICS/OPPORTUNITIES/RETEST；
- `as_of`：数据库事务时钟，全部关联来自同一快照。

正式分析、复核、机会与重测关联仍是后续增量；本任务不伪造历史、指标分母或派发成功。大文件只返回白名单元数据和限时签名 URL，不返回 raw 字节、object_key、上传者或文件名；GET 不做外部 HEAD/HTTP。详情使用 `Cache-Control: no-store`。缺失历史/证据返回409 GEO_READ_MODEL_INCOMPLETE，不合格文件返回409 FILE_INTEGRITY_FAILED；已知签名不可用返回503 DEPENDENCY_UNAVAILABLE。

Batch列表筛选 `q/plan_id/subject_id/status/trigger_type/created_from/created_to`；Run列表支持 `batch_id/plan_id/subject_id/product_id/query_topic_id/prompt_variant_id/collection_profile_id/engine_surface_id/collection_mode/status/error_code/needs_review/latest_only/q/created_from/created_to`，批次内Run列表由路径固定batch_id。q为冻结计划名称或冻结问题正文的字面子串，转义LIKE通配符；所有历史维度使用冻结身份。时间为含起点、不含终点的带时区窗口。页大小10/20/50，默认20；排序CREATED_DESC（默认）/CREATED_ASC，UUID用于稳定tie-break。

Run默认 `latest_only=true`，先选每cell最新attempt，再应用状态等筛选；显式false查看历史。Batch状态及筛选从完整最新attempt集合复用GEO-302规则，不依赖持久化状态缓存。状态计数与requested_run_count按cell，attempt_count和费用按全部attempt；未知费用保持未知计数，已知金额按币种分组，不能把未知当零或跨币种相加。完整summary不受run分页影响。当前profile资格与冻结展示分离，模式/Surface绑定变化阻断动作；历史仍可读，监测停用不删除历史。

五个GET均要求ADMIN/ENGINEER共享内部业务权限；created_by只追溯。只读接口不写状态、revision、审计、认证heartbeat，不加行锁。GEO-406在资格满足时投影RETRY动作，取消仍未实现。精确公共类型和错误集合以根OpenAPI为准。

### 8.2 人工录入（GEO-305 / R2）

GEO-305 已开放上表三个 `manual-*` 端点，完整路径均带 `/api/v1`。Batch/Run读取由GEO-306开放，显式retry由GEO-406开放；其他运行操作仍是后续设计。精确字段及类型以根 OpenAPI 为权威。

- GET manual-entry：冻结 `input_snapshot`、Run/Batch ID、run_revision、截图要求、当前草稿与独立 draft_revision、当前 collection_blockers 和服务端 workflow/action。未保存为 revision0/null draft；配置停用或监测关闭仍可读取草稿，但没有可写动作。
- PUT manual-draft：`{expected_draft_revision,draft}`；可保存未完成的文本、引用和可选证据，首次 revision1，实际修改恰好+1，同值保存保留原版本和时间，不重复审计。Run revision 不变。
- POST manual-submit：完整最终观测及 `expected_draft_revision`，允许最后未保存的编辑；需要 session、CSRF 和可见 ASCII `Idempotency-Key`（1..160）。同账号同键同请求重放首次201回执，跨Run或内容变更返回409 IDEMPOTENCY_CONFLICT；首次提交仍必须具备当前资格。

```yaml
expected_draft_revision: 2
answer_text: "保留空格与换行的原始回答"
answer_format: MARKDOWN
source_product: "平台产品名或null"
source_model: null
source_version: null
web_search_observed: true
raw_payload_summary: {}
citations:
  - original_url: "https://example.com/a"
    title: "首次引用标题"
    position: 1
    extraction_source: MANUAL
screenshot_file_id: "uuid"
raw_payload_file_id: null
collected_at: "2026-10-02T16:00:00+08:00"
```

仅冻结模式为 MANUAL、PENDING/NOT_STARTED 且无答案/后继的 Run 可录入。问题、语言、区域、登录态、搜索策略与截图要求来自冻结输入，客户端不能替换。正式提交要求非空回答、截图或原始证据；冻结 require_screenshot=true 时必须截图。证据只接受当前提交者的 VERIFIED INTERNAL/RESTRICTED 文件，重验对象 HEAD；截图限10MiB、png/jpeg/webp，raw限50MiB、text/plain。人工上传前必须裁剪/清理账号、凭据和支付信息。

正文、去重后的引用及全部实际位置、文件引用、Run COLLECTED/revision+1、Batch投影、幂等身份和审计同事务提交；清除临时草稿。错误完全回滚。采集时间带时区，范围为 Run.created_at 至锁内数据库时钟。引用URL只规范化，不访问网络。

回执包含 run_id、answer_snapshot_id、answer_sha256、提交时 run_revision/draft_revision、collected_at/submitted_at、collection_status=COLLECTED、analysis_dispatch=NOT_IMPLEMENTED。分析尚未实现，没有Redis消息、分析结果或dispatch计数增长；后续分析按COLLECTED稳定ID加载，不能把占位理解为投递成功。

稳定错误：409 REVISION_CONFLICT / GEO_MANUAL_MODE_REQUIRED / INVALID_STATE_TRANSITION / GEO_PROFILE_CHANGED / IDEMPOTENCY_CONFLICT；422 GEO_PLAN_PROFILE_INELIGIBLE / GEO_ANSWER_EMPTY / GEO_EVIDENCE_REQUIRED / GEO_SCREENSHOT_REQUIRED / FILE_INTEGRITY_FAILED / VALIDATION_ERROR；403 PERMISSION_DENIED / CSRF_INVALID / PASSWORD_CHANGE_REQUIRED；401 AUTH_REQUIRED；503 DEPENDENCY_UNAVAILABLE。身份和CSRF检查也适用于成功回执重放，未知内部失败不得映射成功。

### 8.3 显式采集 retry（GEO-406 / R3）

`POST /api/v1/geo/observation-runs/{run_id}/retry` / `retryGeoObservationRun`：

- 请求闭合为 `{expected_revision}`，只接受非负整数；ADMIN/ENGINEER、session 和 CSRF。
- 只允许无答案、无后继的 FAILED/BUDGET_BLOCKED 且 error_stage=COLLECTION 的前序。
  服务锁内重验当前资格与冻结 Profile revision/绑定/adapter version；配置变化要求新建批次。
- 返回 201 `{run_id,batch_id,previous_attempt_id,attempt_no,created_at}`，为稳定身份回执，
  不保存后续可变状态。原 attempt 终态、错误、外发事实、输入及证据原样保留。
- 不使用 Idempotency-Key；同前序唯一后继与行锁禁止分叉，重复命令返回
  `409 GEO_RUN_HAS_SUCCESSOR`，不能自动重放或创建第二个后继。
- 其他业务错误为 `409 REVISION_CONFLICT / GEO_RUN_NOT_RETRYABLE / GEO_PROFILE_CHANGED`、
  `422 GEO_PLAN_PROFILE_INELIGIBLE`；标准 401/403/404/422 沿用公共错误合同。
  新 Run、Batch 投影及成功审计原子提交，之后才派发稳定新 Run UUID；Broker 失败不撤销回执。
- 服务端已接线 RETRY 动作；前端只重生成 OpenAPI 类型，自动页面交互仍属后续任务。

## 9. 分析与复核 API

### 9.1 重分析

`POST /geo/observation-runs/{id}/reanalyze`

请求：

```yaml
expected_current_analysis_revision: 2
fact_versions: [{subject_id: uuid, fact_version_id: uuid}]
analyzer_mode: CURRENT_DEFAULT
reason: "别名和事实版本已更新"
```

以上为后续 GEO-507 的命令草案，未在 GEO-501 新增 operation；具体装配必须按 ADR-003 验证多产品事实归属与资格。创建异步分析 revision，返回 `202` 和 revision summary。

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

GEO-501 已定义闭合 GeoReviewCorrectionPayload，以 mentions/recommendations/claims/citations 分栏判别目标类型，包含 schema_version=1；至少一项修正且每栏目标唯一，不能接受任意 JSON。后续命令必须复用该组件，不维护第二套修正合同。

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

## 16. GEO-302 当前交付：独立 workflow 组件

根 OpenAPI 新增 `GeoRunWorkflowProjection`、`GeoBatchWorkflowProjection`，以及各自的 WorkflowStage、PrimaryTask、Action 六个闭合 enum；所有对象字段必填，未知 token/扩展字段失败。Batch 投影还返回 `status`，Run 投影消费 GEO-301 的状态事实。

本次不改变 GEO-301 基础 Out，不新增 operation；服务端纯策略生成 `workflow_stage`、`primary_task`、`available_actions`。人工录入、取消、重试只有 actor/逐 cell 当前资格/真实接线能力满足时才投影；后续读 API 组合投影，命令锁内重验。具体合法边及投影优先级以 [业务状态机](../02-business/03-workflows-and-state-machines.md) 为准。前端仅重生成 OpenAPI 类型，无路由、query key、URL 或页面变化。


## 17. GEO-407 当前元数据与限速配置

根 OpenAPI GeoApiSettings 新增可选 max_concurrency（默认1，1..100）与
requests_per_minute（默认60，1..60000）。管理员沿现有 Profile PATCH保存，仍受revision、
配置资格失效、认证/CSRF保护。既有表单承载并保留这两项设置，没有新增路由或 query key。

Run 详情/列表新增可空 provider_status（100..599）和 retry_after_seconds（非负整数）；
后者仅为已完整接收429/PROVIDER_RATE_LIMITED的已报告秒数。未知为NULL，不猜重试时间。
成功引用和 usage/cost 消费既有 Answer/Citation/Run 字段；费用覆盖按全部 attempt统计，
不是指标或分析资格。引用、元数据、COLLECTED与结算同事务，不返回部分结果。

未设置预算允许未知；受 batch/day 预算约束时未知估价、已发送未结未知费用或混币阻断。
PENDING→BUDGET_BLOCKED/BUDGET_EXCEEDED 使用既有状态/错误码；Profile限速保持PENDING，
由服务器与PG预留裁决，前端不能自行改变预算结果或制造第二套状态机。

## GEO-501 / R4 契约落地边界

根 OpenAPI 新增 AnalysisRevision、Mention、Recommendation、Claim、RunReview、闭合分析输入/配置、多产品事实绑定、类型化修正及 GeoAnalysisSelection 数据组件；没有新增 operation。精确字段以 [OpenAPI](../../../contracts/openapi.yaml) 为权威，关系与并发以 [数据库合同](../../../contracts/database.md#geo-analysisrevision--子结果--runreview-合同geo-501--r4) 为权威。

Run 当前成功指针是唯一选择来源；当前有效 review 仅在该 analysis 内按 created_at DESC,id DESC 选取。旧 review 不覆盖新分析。CONFIRMED 无修正；CORRECTED 有说明与至少一项类型化修正；不改机器结果或原始引用。后续 GEO-507/508 才接入详情、重分析、复核命令和权限策略。现有详情分析区继续显式 NOT_IMPLEMENTED。

事实删除阻断类型追加 GEO_ANALYSIS，继续使用 FACT_VERSION_IN_USE；用户 reviewer 历史沿用 USER_BUSINESS_HISTORY。仅前端类型及已有阻断元数据映射同步，无新页面状态。
