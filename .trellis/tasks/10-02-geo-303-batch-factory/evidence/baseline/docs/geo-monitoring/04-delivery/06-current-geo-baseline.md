# GEO-003：当前 GEO 实现与契约基线

| 项目 | 冻结值 |
|---|---|
| 发布增量 / 记录日期 | R0 / 2026-10-01 |
| 任务状态 | review，等待人工验收；不代表 R0 全阶段完成 |
| 分支 | `geo/GEO-003` |
| 源码 HEAD | `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814` |
| 依赖 | GEO-001、GEO-002 均为 done；ADR-001～005 均为 Accepted |
| 变更性质 | 文档、快照和任务记录；业务代码、公共合同、数据库和页面交互零变化 |
| 证据限制 | 源码、合同、ORM 和迁移源已冻结；未取得运行数据库 catalog、实际 revision 或生产状态证据 |

本文件回答“该 HEAD 已经实现什么”。[PRD](../01-product/02-geo-core-prd.md)、[领域模型](../02-business/02-domain-model.md)、[状态机](../02-business/03-workflows-and-state-machines.md) 和 [技术架构](../03-technical/01-technical-architecture.md) 描述未来目标，不能据此推断现有功能。五份 ADR 的接受范围与后续待对齐项见 [GEO-002 评审记录](../05-decisions/GEO-002-architecture-review.md)。

## 1. 三类观测的身份与统计单位

| 维度 | 当前人工文章搜索 | 当前历史模型记录 | 未来回答级观测（尚未实现） |
|---|---|---|---|
| 类型 | `MANUAL_ARTICLE_SEARCH` | `LEGACY_MODEL_RESULT` | `GeoObservationBatch` / `GeoObservationRun` |
| 持久化根 | `geo_observations` | 同表的历史 discriminator | 新 Batch/Run 表，不改造旧表 |
| 一次观测 | 人工在一个平台用一个搜索词核对一个产品的完整候选文章集合 | 历史问题/模型/摘要及原评估结果 | 冻结的问题变体 × profile × repeat；attempt 是执行尝试 |
| 事实粒度 | 每条 `GeoObservationPublication` 的发现、提及和准确性 | 根记录提及、推荐、准确性及 legacy citations | 完整回答涉及多个 subject 的提及、推荐、引用和声明 |
| 原始内容 | `search_platform/search_query`；没有回答正文、AnswerSnapshot 或 Collector | 旧 `actual_prompt/model_name/answer_summary` 只读历史 | 不可变 AnswerSnapshot、原始引用和证据 |
| 生命周期 | 追加更正链、服务端 current tail；管理员整链删除 | 不接受新写入、不能更正或单独删除 | 批次、采集尝试、分析 revision、人工复核分别管理 |
| 当前指标 | 文章关系分母；问题覆盖另按观测 ID 去重 | 旧模型样本分母，单独返回 | 合格回答样本、subject presence、claim 等独立单位 |

**旧 `answer_summary` 不是新 AnswerSnapshot；旧 `supersedes_id` 更正链不是 Run attempt；QueryTopic 的字符串 `variants` 不是 GeoPromptVariant。不得迁移、合并或复用旧分母来表示新回答级指标。** `GeoInsights.analysis_unit` 当前唯一值为 `MANUAL_OBSERVATION_PUBLICATION_RELATION`。Legacy 响应类型虽允许 `CORRECT` token，服务实际投影为空动作；不能只凭类型允许值推断历史可编辑。

## 2. 可复查的冻结文件

| 证据 | 内容与边界 |
|---|---|
| [openapi.json](./geo-003-baseline/openapi.json) | 当前 12 个 path、16 个 operation；74 个 schema 和递归组件引用闭包，保留 request/response、枚举、参数、security；来源仍以 [根 OpenAPI](../../../contracts/openapi.yaml) 为权威 |
| [routes.json](./geo-003-baseline/routes.json) | operation ID、状态码、参数、11 个前端 route 源文件及实际 geoKeys 定义；capture 时与运行时 OpenAPI operation ID 对账 |
| [database.json](./geo-003-baseline/database.json) | 7 张表的 ORM 列、类型、可空性、PK/FK 和 ORM constraints；不冒充完整 Alembic schema 或 live catalog |
| [migrations.json](./geo-003-baseline/migrations.json) | 全部 43 个 revision/down_revision，源码唯一 head；GEO/QueryTopic 源码提及标记用于定位，不表示变更清单完备性 |
| [queries.json](./geo-003-baseline/queries.json) | GEO/QueryTopic 服务符号、行号及后端静态调用入口；不是动态 trace 或性能测量 |
| [tests.json](./geo-003-baseline/tests.json) | 35 个 GEO 与关联回归测试源文件的声明位置；包含整份共享 suite，声明数不等于参数展开后的执行数 |
| [sources.json](./geo-003-baseline/sources.json) | 143 个相关源码、合同、迁移、测试、依赖锁文件的 SHA-256；不包含真实配置、凭据或业务数据 |
| [validation.md](./geo-003-baseline/validation.md) | 本轮精确命令、结果、跳过、环境阻断、未到达门禁及原始日志链接 |

快照只作冻结证据，不能替代现行 `contracts/openapi.yaml`、`contracts/database.md` 或 Alembic。后续源码变化后保留本快照，通过 source hash 与该 HEAD 对比；不得重写快照以伪装当时已有新能力。生成脚本及 Task Brief 见 [Trellis 任务](../../../.trellis/tasks/10-01-geo-003-current-baseline/prd.md)，脚本拒绝覆盖，复现应写到新的临时目录。

## 3. 后端 API、schema 与权限

GEO Router 为 [observation.py](../../../backend/app/routers/observation.py)，QueryTopic Router 为 [planning.py](../../../backend/app/routers/planning.py)。下表省略共同 `/api/v1` 前缀；完整状态码和参数见 routes/openapi 快照。

| 方法 / 路径 | operation ID | 当前用途 |
|---|---|---|
| GET `/geo-observation-publications` | `listGeoObservationPublications` | 产品当前全部合格 PublishedArticle 候选 |
| GET `/geo-observations` | `listGeoObservations` | 共享筛选的完整对象列表；默认链尾，`include_history=true` 读历史 |
| POST `/geo-observations` | `createGeoObservation` | 新建人工观测，或通过 `supersedes_id` 追加更正 |
| GET `/geo-observations/list-items` | `listGeoObservationItems` | canonical 前端紧凑分页列表 |
| GET `/geo-observations/{observation_id}` | `getGeoObservation` | 单条旧/人工响应投影；canonical Detail 使用另一接口 |
| DELETE 同一路径 | `deleteGeoObservation` | ADMIN 删除完整人工更正链 |
| GET `/geo-observations/{observation_id}/detail` | `getGeoObservationDetail` | 一次请求返回 Legacy Detail 或 selected/root/tail 完整人工链 |
| GET `/geo-observations/{observation_id}/correction-context` | `getGeoObservationCorrectionContext` | 当前人工链尾更正上下文、候选与主题选项 |
| GET `/geo-metrics` | `getGeoMetrics` | 旧模型与人工文章关系分别聚合 |
| GET `/geo-insights` | `getGeoInsights` | 全部人工文章关系洞察区块的单一读模型 |
| POST `/geo-insights/optimization-content-tasks` | `createGeoOptimizationContentTask` | 复算异常，原子创建普通 ContentTask 与 GEO 来源 |
| GET / POST `/query-topics` | `listQueryTopics` / `createQueryTopic` | 问题选项与创建 |
| GET `/query-topics/list-items` | `listQueryTopicItems` | 搜索、排序、分页和批量引用投影 |
| PATCH / DELETE `/query-topics/{query_topic_id}` | `updateQueryTopic` / `deleteQueryTopic` | 按 expected revision 修改/删除，删除受引用阻断 |

所有读写要求现有 session。人工创建/更正、优化任务及 QueryTopic 写入由 ADMIN/ENGINEER 执行；观测整链删除仅 ADMIN。mutation 保留 CSRF，优化任务要求 `Idempotency-Key`（8–128 字符）。不可把 UI 隐藏或 `available_actions` 当授权凭证。

[geo_files.py](../../../backend/app/schemas/geo_files.py) 的权威边界：

- `GeoObservationCreate` 必填产品、问题主题、搜索平台/搜索词、测试时间、至少一个 article result、notes；附件默认为空，可指定 supersedes_id。文章 ID 与附件 ID 不允许重复。
- `GeoArticleResultCreate` 显式提交独立的 discovered、mentioned 和可空 accuracy；不存在逐篇 recommendation/cited。准确性枚举为 `ACCURATE | PARTIAL | INCORRECT | UNJUDGEABLE`。
- `GeoObservation` 与 `GeoObservationDetail` 按 observation_kind 判别。Legacy 保留原模型字段；Manual 保存搜索上下文和逐篇结果，不带新回答级字段。
- 列表返回 compact outcomes 计数、recorder 和动作。人工 Detail 返回 selected/root/tail、按 root→tail 排列的 history 及每节点直接 evidence；链尾普通响应的 attachment IDs 可聚合祖先可见证据，两种归属语义不能混淆。
- `GeoMetrics` 分别返回 legacy 四率和 manual 文章发现/提及/准确率。`GeoInsights` 返回周期、筛选选项、三项趋势、平台表现、内容排行、问题覆盖、建议和数据质量。
- `GeoOptimizationContentTaskCreate` 只有 `CONTENT_DECLINE | LONG_UNMENTIONED | QUESTION_COVERAGE_GAP`，显式来源、日期与产品/事实版本/内容平台目标；这些旧规则不是未来 GeoOpportunity 实体。

QueryTopic 当前只有 canonical_question、六种 intent、至少一个字符串 variant、revision 和 created_at；没有 prompt variant ID、点名属性、语言、地区、priority、计划引用或 active 状态。

## 4. 表、约束与历史删除边界

根 [数据库合同](../../../contracts/database.md) 与 [ORM](../../../backend/app/models/geo_files.py) 联合迁移源解释；metadata 没有表达全部迁移约束。

| 表 | 当前内容 | 关键关系 / 边界 |
|---|---|---|
| `geo_observations` | discriminator、产品、可空主题、人工搜索/legacy 字段、tested_at、notes、tested_by、supersedes_id、created_at | 无 revision、lease、status、batch、attempt；产品/主题/用户/前驱 RESTRICT |
| `geo_observation_publications` | `(observation_id,published_article_id)` 复合 PK；可空 discovered/mentioned/accuracy | 当前 article FK 为 CASCADE；服务的成果删除预检仍阻断在用关系，不能以 FK 代替业务删除资格 |
| `geo_observation_citations` | legacy URL、OFFICIAL/EXTERNAL_COMPANY/OTHER、可空 article | article FK 为 SET NULL；当前不接受新人工 citation，不等同新回答引用 |
| `geo_observation_attachments` | `(observation_id,file_id)` 复合 PK | 文件必须 VERIFIED；人工 service 还要求 OPERATION_SCREENSHOT；两侧 FK RESTRICT |
| `query_topics` | 问题文本、intent、字符串 variants ARRAY、revision、created_at | 删除 blocker：CONTENT_TASK、GEO_OPTIMIZATION_SOURCE、GEO_OBSERVATION |
| `content_task_geo_sources` | 每 ContentTask 一条规则/周期/文章或问题/GEO 平台/basis_snapshot/创建人 | 来源不可原地改写；不是 opportunity、retest 或可写指标表 |
| `file_records` | 对象元数据、hash、access_level、上传/校验/延迟清理状态 | 共享文件服务所有；GEO、发布附件及平台 logo 是当前三类真实引用 |

必须保留的当前防线：

- `uq_geo_observations_supersedes_once` 是非空 supersedes_id 的独立 partial unique index，并非 pg_constraint UNIQUE 行。
- `ck_geo_observations_kind_fields` 区分 legacy 与人工字段。0022 的 `NOT VALID` 保留老人工空主题，但继续校验新 INSERT/UPDATE，不回填猜测主题。
- `ck_geo_observation_publications_independent_facts` 允许 legacy 全空事实；人工 discovered/mentioned 必须显式非空，accuracy 可空；没有“发现→提及→引用→准确”的累计漏斗。
- 当前 article result INSERT guard 按 PublishedArticle→PublicationWork→ContentVersion→ContentTask 核验同产品、COMPLETED、final URL，且排除 OPEN/RETIRED issue。
- 0037 后四张 GEO 表的 append_only trigger 为 **UPDATE 防线**，旧 0029 DELETE 专用守卫已移除。citation 只允许明确的 FK 级联置空例外；整链删除和历史清理资格由当前 application service 及关联 lifecycle 裁决。不得宣称当前仍有 0029 整链 DELETE trigger。
- 已归档 content-task aggregate 的永久删除按现有合同可清理失去全部文章关系的人工链，共享链/文件继续保留。`content_task_geo_sources` 的删除同样随该生命周期调整，早期“永不 DELETE”条款是中间态。
- PublishedArticle 的历史平台身份由 PublicationWork 的 `platform_profile_id_snapshot` 与 name snapshot 拥有；实时配置删除不能按平台名称猜测旧身份。

## 5. Alembic 基线与前滚限制

`alembic heads` 实际输出 `0043_geo_platform_identity (head)`。这是源码 head，不是运行数据库的 `alembic_version`。全链保存在 migrations.json，各迁移源哈希保存在 sources.json。

| revision / 文件 | GEO 相关演进 |
|---|---|
| 0003 / `0003_content_planning.py` | 创建共享 QueryTopic；它的旧 variants 继续是 ARRAY |
| 0007 / `0007_geo_observation.py` | 从 frozen `migration_schema_v1` 创建三张旧 GEO 表、时间/维度索引和唯一后继索引 |
| 0008 / `0008_files.py` | 创建 GEO 附件与文件验证/追加防线 |
| 0018 / `0018_manual_geo_observation.py` | 增加人工 discriminator/搜索字段；保留 legacy 业务字段；人工维度 partial index；当时的逐篇推荐和证据规则后续已替换 |
| 0022 / `0022_geo_observation_insights.py` | 新写入要求主题；保留旧空值；当时新增 discovered/mentioned/cited/accuracy 阶段事实 |
| 0029 `0029_geo_evidence_management` / `0029_manual_geo_independent_facts.py` | 删除 cited/recommendation_status，保留三种独立事实，允许可选截图；引入当时的人工整链删除守卫 |
| 0034 `0034_publication_redesign` / `0034_publication_workflow_redesign.py` | publication_record_id 改为 published_article_id；替换 PublishedArticle 归属/可观测 guard；旧发布或依赖 GEO 数据非空会阻断，不能无损直接迁移 |
| 0035 `0035_business_workflow` / `0035_business_workflow_primary_tasks.py` | 创建不可变 content_task_geo_sources，旧 GEO 异常可以形成内容任务 |
| 0037 `0037_simplify_deletion_lifecycle` / `0037_simplify_deletion_lifecycle.py` | 当前删除生命周期、CASCADE/SET NULL、UPDATE-only 防线替换，删除旧 GEO DELETE guard |
| 0038 / `0038_published_article_delete.py`、0039 / `0039_published_article_delete_missing_platform.py` | 成果永久删除及失去实时平台后的生命周期；GEO 下游引用阻断 |
| 0043 `0043_geo_platform_identity` / `0043_geo_insight_platform_identity.py` | 冻结平台 UUID；无法证明已发布历史平台身份时 55000 失败，不猜测回填 |

相关演进还涉及 0025 Markdown 事实、0028 文件清理、0030 旧发布删除、0032 ContentTask 幂等和 0033 任务自有历史；完整顺序以 migrations.json 为准。0001～0008 的 frozen metadata 不可随 runtime model 更新。

本任务没有新 revision、前滚、回填或数据迁移。四项 GEO 迁移测试本轮因缺少 PostgreSQL 测试配置跳过；未证明现存数据可升级，也未执行 downgrade。历史 0034 有数据预检、0037 不可逆历史清理、0043 无法回填阻断均为后续迁移必须保留的限制，本任务不修复或放宽它们。

## 6. 查询、事务、幂等与调用者

[geo_observation.py](../../../backend/app/services/geo_observation.py) 当前集中拥有旧 GEO 业务。后续新回答级聚合应建立独立职责，不能因为文件名相同继续往旧模型塞数据。当前主要入口：

| owner / 符号 | 查询和一致性边界 |
|---|---|
| `geo_observation_query`、`geo_observation_list_query` | current tail 的 NOT EXISTS；日期使用 tested_at；SQL 内按产品、问题、搜索、人工/legacy 结果、recorder 等过滤 |
| `geo_observations_out`、`geo_observation_list_items_out` | 批量关联产品/用户/文章/文件，服务端投影动作和结果计数 |
| `_manual_observation_chain`、`get_geo_observation_detail`、`get_geo_observation_correction_context` | recursive CTE 找 root，再验证完整链；详情、上下文在 Router 设置 REPEATABLE READ 的请求中读取，不在浏览器遍历链 |
| `get_geo_metrics` | 两次条件聚合；legacy 与 manual 分开；共享基础筛选 |
| `_geo_insight_rows`、`_complete_geo_insight_scope` | 读取链尾人工关系；先以整次观测排除缺失，再做内容平台/文章筛选，不能隐藏同次观测的坏关系 |
| `get_geo_insights` | 选项、当前/前期/历史、趋势、排行、覆盖、建议、质量统一返回；GET 在 REPEATABLE READ 下，不保存第二份汇总状态 |
| `_query_topic_reference_counts`、`list_query_topic_items` | 三类直接引用用 UNION ALL / GROUP BY 批量计数，与 blockers 共用 owner |

当前 formulas：discovery/mention 分母为完整人工文章关系数；accuracy 分母排除 NULL/UNJUDGEABLE。零分母返回 NULL。问题覆盖按 `(query_topic_id,geo_platform,observation_id)` 去重，同次任一文章被提及即命中；少于 3 次为 INSUFFICIENT_DATA，比例 ≥0.6 为 STABLE，≥0.3 为 OCCASIONAL，否则 UNCOVERED。当前趋势 `change=(current-previous)/previous` 为**相对变化**；前期 0/未知时 NULL。它不是未来回答级趋势“百分点”合同。当前内容下降规则使用至少各 3 次样本、下降 ≥0.1，长期未提及要求至少 30 日窗口及三次当前样本，排名各最多 5 项。

创建/更正命令先锁 Product，再锁按发布时间/ID 排序的全部合格 PublishedArticle，校验提交 ID 集合完全相等；校验已验证截图后，更正再锁 previous Observation。不接受部分提交，不自动补“未发现”。产品、搜索平台、搜索词和既有主题不允许更正时改绑；旧空主题必须补全真实关联。观察根/关系/附件同事务提交，没有普通 observation idempotency key 或 expected revision。唯一后继竞争精确匹配 `23505 + uq_geo_observations_supersedes_once`，rollback 后返回 `409 GEO_OBSERVATION_HAS_SUCCESSOR`。

删除命令按 Product→root→其余节点 ID 顺序锁定，重新校验链，再 tail→root 删除关联和节点；安排无引用文件清理、最小成功审计与删除同事务。文件实际清理由既有 lifecycle 执行。更正链 helper 还被 `publication.py` 的任务删除预览/普通删除/永久删除复用，后续不能只核对 GEO Router。

优化任务使用 `content-task-create:<Idempotency-Key>` 事务 advisory lock，平台→产品→批准事实的锁和资格检查；重新计算来源异常，原子保存任务和 basis_snapshot。同 key 同目标及同来源重放，不同完整 identity 返回 IDEMPOTENCY_CONFLICT。只在任务 INSERT 的 `23505 + uq_content_tasks_idempotency_key` 路径回滚重读并校验 winner，其他完整性错误继续失败。

GEO_CONTEXT 类错误实际为 `GEO_OBSERVATION_CONTEXT_INCOMPLETE`、`GEO_OBSERVATION_CHAIN_CHANGED` 和 `GEO_INSIGHT_CONTEXT_INCOMPLETE`，不是无 revision owner 的 REVISION_CONFLICT；`GEO_PUBLICATIONS_CHANGED`、`GEO_INSIGHT_STALE` 均不自动重放 mutation。QueryTopic 是真实可变 revision owner。未知 FK/CHECK/trigger 错误保持未知失败，不能猜测业务冲突。

服务函数的静态调用者包括 observation Router、product_detail、workbench、publication；完整行号见 queries.json。[product_facts.py](../../../backend/app/services/product_facts.py) 还直接读取 GeoObservation 判断产品引用及删除资格，属于模型消费方，不在函数调用快照中。现有 worker.py 管理内容生成和文件清理，未注册回答级 GEO collect/analyze task；没有 GEO Collector、Scheduler、lease 或 external_call_state。已有内容生成 worker 的稳定 ID、凭据/网络设施可供未来独立集成，不能据此宣称 GEO 自动采集已实现。

## 7. 前端路由、query key 与页面状态

当前领域为 `frontend/src/domains/geo`，请求、query options 与 **geoKeys 的唯一 owner 是 geo.api.ts**。`frontend/src/shared/api/queryKeys.ts` 当前不存在；根架构中的该路径是已在 GEO-002 记录的文档差异。GEO API 类型来自 `shared/api/generated/schema.d.ts`，Form/URL Schema 只校验输入和 URL，不成为第二套 API、状态机或指标公式。

| 真实路由 | 当前用途与 URL 状态 |
|---|---|
| `/geo/observations` | compact list；q/productId/queryTopicId/geoPlatform/accuracy/from/to/sort/page/pageSize |
| `/geo/observations/new` | 新建 Workspace；queryTopicId、geoPlatform handoff；候选和提交服务端最终校验 |
| `/geo/observations/$observationId` | 只读 Detail，single read model 展示 history/direct evidence/服务端动作 |
| `/geo/observations/$observationId/correct` | 更正 Workspace；历史 ID canonical 到服务端 tail，草稿与上传状态本地管理 |
| `/geo/topics` | QueryTopic CRUD；q/sort/page/pageSize；server references/deletion/actions |
| `/geo/insights` | 七项筛选统一作用所有区块，默认 UTC 今天及前 29 日 |
| `/geo/insights/print` | 同 read model、同七项筛选，只读报告，调用浏览器打印 |
| `/geo` | 只有 Outlet 父布局，没有已实现的总览页面 |

Insights 七项为 from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId，显式映射 snake_case API 参数。不存在已实现的 `/geo/plans`、`/geo/runs`、`/geo/opportunities` 或 `/geo/reports`。未来 PRD 将 runId 用在 observations 的建议路径尚需后续导航合同设计，不能覆盖旧 observationId 页面。

Query cache 分类为 insights、observations list/detail/correction-context、topics/options/list、publication candidates；候选和更正上下文 staleTime=0，其余当前 GEO 查询主要为 30 秒、focus always、retry=false。scope/URL 的 identity、动作撤销、后台读失败和写入成功后的精准失效由既有 domain/page 管理，本任务不新增 key 或轮询。

现有页面/test覆盖 loading、空/筛选空、首次错误、后台读取撤销、409 保留草稿及显式刷新、dirty 离开、上传 pending/complete、服务端动作撤销和成功 ID 交接。打印页不提供优化/删除写入口；所有率从服务端读取，前端只格式化。实际 fixture E2E 结果及真实栈限制见 validation.md。

## 8. 安全、隐私与证据范围

继续沿用 ADMIN/ENGINEER、session/CSRF 与 FileRecord 的 VERIFIED/category 边界；PostgreSQL 是状态权威，对象存储保存字节。文章 URL 来自发布 owner，前端不提交替代值。保留现有文件上传及下载资格、签名 URL、敏感产物扫描，不把截图、正文、真实配置或凭据复制到本基线。

本轮测试未访问真实外部 AI 平台、生产账号或业务数据。fixture E2E 只证明现有页面对严格声明响应的行为；它不证明数据库写入、SSRF/TLS 或真实采集代表性。普通真实栈测试仍须 PostgreSQL/Redis 隔离、fake provider、资源所有权清理和 sensitive artifact scan。已有成功动作审计白名单与删除摘要保持原样，不能按目标文档声称当前每次 GEO 创建都有新增审计。

## 9. 测试基线与当前差异

后端现有直接套件：`test_geo_observation_list/detail/correction/deletion.py`、`test_geo_insights.py`、`test_query_topic_list.py`；共享回归位于 migration、publication_workflow、product_detail、workbench、contract/runtime-schema 等文件。前端 GEO 有 13 个 Vitest 源文件；七份 E2E spec 覆盖 list、new、detail、correction、topics、insights/print 及两个 real-stack Flow。仓库根不存在独立 tests 目录。

已有查询数测试保护 compact list、Detail 和 Correction context 不随关联/链长度线性增加；已有集成源码保护精确唯一冲突、回滚、真实并发和 snapshot。未运行的数据库测试不能据代码存在记为通过，也没有本轮 GEO Insights SQL plan、100k Run 或 P95 证据。

当前与目标的后续边界：

- Catalog、PromptVariant、EngineSurface/Profile、MonitoringPlan、功能开关和金标目录尚未实现；QueryTopic 字符串 variants 与搜索平台自由文本不能替代目标实体。
- Batch/Run/AnswerSnapshot/AnalysisRevision/RunReview、独立采集失败/费用/attempt 模型尚未实现；旧 Legacy 数据也不能用来证明新采集框架。
- 旧 GeoInsights 及三个优化命令已存在；新的可解释回答指标、SOV、事实分析、Opportunity 和严格 Retest 不存在，旧优化 task source 不能代替机会闭环。
- GEO-002 已接受的统计单位、重试归属、终态/重分析、指标分母、外发分级和首发门禁约束仍须在后续对应合同任务对齐。这些目标差异不影响只读冻结，不在 GEO-003 中裁决。
- 数据库合同的 0018/0029/0035 条款保留历史规则，0034/0037/0043 后续条款与当前源码才确定现状；本任务记录时间演进，不改写历史迁移或根级合同。

本任务本地盘点与可执行验证已完成；完整 `make verify`、运行库 schema/迁移、真实栈写入和移动浏览器执行仍有明确缺口。具体结果及恢复条件见 validation.md。直接后续为 GEO-004、GEO-005、GEO-101、GEO-201；它们仍为 planned，本任务不启动它们。
