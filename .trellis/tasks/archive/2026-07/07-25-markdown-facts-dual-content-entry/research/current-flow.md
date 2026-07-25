# 当前实现与变更证据

## 产品事实

- `backend/app/schemas/product_facts.py:52-163`：当前 `ProductFactsBody` 只包含参考型号、参数、替代关系、证据和声明，没有 Markdown 正文。
- `backend/app/services/product_facts.py:445-585`：事实工作区保存采用删除全部结构化子项后重建的全量替换。
- `backend/app/services/product_facts.py:588-642`：事实版本从当前结构化工作区构造 `snapshot_json`。
- `frontend/src/features/product-facts/ProductFactsPage.tsx:246-254`：工作区 UI 固定为参考型号、证据、参数、替代关系和声明五个章节。

## 内容任务与生成

- `backend/app/models/content.py:27-97`：任务持有事实版本、平台规则版本、任务要求、任务 Prompt 和任务分级。
- `backend/app/services/content_planning.py:411-479`：新任务要求批准事实、ACTIVE 平台规则和当前平台 Prompt，并把任务 Prompt 初始化为空。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx:198-211`：创建弹窗要求产品、批准事实、配置完整平台和全部任务要求字段。
- `backend/app/services/content_production.py:116-225`：当前 system message 是固定契约加平台 Prompt；user message 拼接工程师输入、事实 JSON 和任务要求 JSON。
- `backend/app/routers/production.py:82-161`：模型只在创建生成作业时选择，归属 `GenerationJob`。

## 人工版本、审核与发布

- `backend/app/services/content_production.py:635-709`：人工修订必须基于已有版本并沿原始 AI 快照执行质量检查，无法从空任务创建。
- `backend/app/models/content.py:100-145`：`ContentVersion.source_job_id` 和 `based_on_id` 可空，现有模型可以承载无 AI 来源的首个人工版本。
- `contracts/openapi.yaml:3386-3405`：内容审核上下文已经允许 `generation_trace = null`。
- `backend/app/services/review.py:337-408`：AI 与 HUMAN 版本共用内容审核状态机和唯一批准版本门禁。
- `backend/app/services/publication.py:162-259`：人工发布绑定批准内容、平台账号、栏目 URL、内容哈希和幂等键。

## 平台规则是否仍有独立价值

- `backend/app/schemas/configuration.py:120-143`：平台规则包含受众、标题/正文长度、语气、外链、表格、联系方式、禁用表达和栏目列表。
- `backend/app/services/generation.py:359-398`：长度、禁用表达和事实数字检查消费平台规则和结构化事实。
- `backend/app/services/publication.py:162-212`：人工发布的真实栏目 URL 由用户提交，并只通过 `PlatformProfile.allowed_domains` 校验；规则中的 `sections` 不是发布完整性权威。
- 用户已确认受众、长度、安全和输出规则全部由平台 Prompt 自身负责，并明确要求删除 `PlatformProfileVersion / PlatformRules`。

## 删除平台规则版本的后端影响

- `backend/app/models/content.py:27-97`：`ContentTask.platform_profile_version_id` 是非空外键并带创建时间索引；任务还重复保存平台类型及其快照。
- `backend/app/services/content_planning.py:411-479`：任务创建要求 ACTIVE 规则版本和当前 Prompt，需改为只验证批准事实与活动平台；Prompt 门禁下移到 AI 作业。
- `backend/app/services/content_production.py`、`backend/app/services/generation.py`：生成快照、质量检查和人工修订沿规则版本取值；新路径必须改为平台当前 Prompt与冻结事实 Markdown，旧快照只读。
- `backend/app/services/publication_queries.py`、`backend/app/services/publication.py`：发布列表和修复任务通过规则版本回到平台；需直接使用任务的 `platform_profile_id`。
- `backend/alembic/versions/0003_content_planning.py`、`0009_config_center.py`、`0013_publication_closure.py`、`0015_platform_rule_draft_editing.py`、`0023_platform_management.py`：旧迁移建立了表、触发器、索引和查询约束。新迁移必须先确定性回填任务平台，再更新当前约束，最后删除规则版本表；不得修改旧迁移历史。

## 删除平台规则版本的前端影响

- `frontend/src/app/App.tsx:61-70`、`AppLayout.tsx:49-55`、`routeLoaders.ts` 和 `routePrefetch.ts`：存在平台规则路由、导航、动态加载和预取映射，需实际删除而非隐藏。
- `frontend/src/features/configuration/PlatformRulesPage.tsx`、`PlatformRuleDetail.tsx`、`PlatformRuleMetaPanel.tsx`：整套规则工作台及其测试可以删除。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx:198-247`：创建表单和详情以规则版本为平台值，并显示任务 Prompt、生成选项和快照；需改为平台 ID、AI/手工双入口。
- `frontend/src/features/publications/PublicationRepairPage.tsx:97`：修复任务选择当前规则版本，需改为直接使用原发布平台。
- `frontend/src/shared/api/schema.d.ts` 由 OpenAPI 生成，只能通过更新契约后运行 `npm run api:generate` 重建，不得手工编辑。

## 最小回归面

- 后端：事实工作区/事实审核、任务创建、精确生成消息、人工首稿、历史快照读取、迁移、发布修复与审核闭环。
- 前端：`ProductFactsPage`、`ContentTasksPage`、`ContentEditorPage`、`PublicationsPage`、配置导航与路由测试。
- E2E：核心 `mvp-flow.spec.ts` 更新为 Markdown 事实、直接平台任务、AI/手工首稿和共用审核发布；删除仅验证平台规则页面的步骤。
