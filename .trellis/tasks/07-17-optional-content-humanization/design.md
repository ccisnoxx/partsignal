# 可选文章自然化修订技术设计

## 1. 设计结论

最小可行设计是在现有 `generation_jobs` 上增加作业类型和源内容版本引用，让原始生成与自然化共用同一 PostgreSQL/Celery 状态机。全局自然化 Prompt 使用一个独立单例配置表；自然化成功继续写入现有 `content_versions`，不新增第二套内容或作业模型。

该方案满足三个核心不变量：

1. 一个 AI 作业只调用供应商一次，只创建一个内容版本。
2. 原始内容和自然化结果都是不可变版本，关系由 `source_job_id` 与 `based_on_id` 唯一表达。
3. 全局当前配置可以变化，历史语义只读取不可变作业快照。

不拆分子任务。数据库、作业快照、Worker、审核追溯和 UI 共享同一作业类型契约，拆开实施会在中间状态造成公共契约或历史读取漂移。

## 2. 现有边界与改动位置

- `backend/app/services/content_production.py` 继续拥有作业创建、幂等、重试、提交与审计。
- `backend/app/services/generation.py` 继续拥有 Worker 认领、供应商调用、质量检查和内容版本落库。
- `backend/app/services/generation_dispatch.py` 与 `backend/app/worker.py` 保持一个 Redis UUID 消息和一套补投递/租约恢复，不新增 Celery task。
- `backend/app/services/review.py` 继续装配审核证据，但需要读取完整 AI 版本链。
- `backend/app/services/platform_configuration.py` 或同层配置服务拥有全局自然化 Prompt 的创建和更新；Router 只映射 HTTP。
- `frontend/src/features/configuration/PlatformPromptsPage.tsx` 在现有 Prompt 管理页增加全局自然化 Prompt 区块，不新增路由。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx` 增加自然化入口、模型选择和统一 AI 作业展示。

## 3. 数据模型与迁移

新增迁移 `0017_content_humanization`，`down_revision = "0016_fact_review_cleanup"`。不得修改冻结的历史迁移或 `migration_schema_v1.py`。

### 3.1 全局 Prompt

新增 `content_humanization_prompts`：

| 列 | 约束 | 含义 |
|---|---|---|
| `id` | `SMALLINT PRIMARY KEY`, `CHECK (id = 1)` | 数据库级单例 |
| `template_markdown` | `TEXT NOT NULL` | 当前自然化 Prompt |
| `revision` | `INTEGER NOT NULL DEFAULT 0` | 乐观锁版本 |
| `updated_by` | `users.id RESTRICT NOT NULL` | 真实管理员 |
| `created_at` / `updated_at` | timezone timestamp | 配置时间 |

迁移不插入行。API 首次保存使用 `expected_revision=null` 创建固定 `id=1`；后续更新锁定该行并要求 revision 相等。MVP 不提供删除接口，不使用代码默认值或环境变量回退。

### 3.2 共用 AI 作业

在 `generation_jobs` 增加：

| 列 | 约束 | 含义 |
|---|---|---|
| `job_type` | `VARCHAR`, `NOT NULL`, `CHECK IN ('GENERATE','HUMANIZE')` | 作业目的 |
| `source_content_version_id` | `content_versions.id RESTRICT`, nullable | 自然化源版本 |

迁移把全部历史行回填为 `GENERATE`，随后移除数据库默认，要求新代码显式写入类型。增加成对约束：`GENERATE` 必须没有源版本，`HUMANIZE` 必须有源版本。

增加 PostgreSQL 部分唯一索引：

```sql
UNIQUE (source_content_version_id)
WHERE job_type = 'HUMANIZE' AND status IN ('PENDING', 'RUNNING')
```

服务端先做可读业务校验，数据库索引处理并发竞态。既有 `content_versions.source_job_id` 唯一约束继续保证一个作业最多创建一个版本。

### 3.3 内容版本

不新增列。自然化结果写入：

- `source_type = 'AI'`
- `source_job_id = humanization_job.id`
- `based_on_id = source_content_version.id`
- `status = 'DRAFT'`
- `fact_version_id` 与 `task_id` 继承源版本
- `change_summary = 'AI 自然化作业创建的草稿'`

源版本不更新。现有内容不可变触发器无需增加兼容分支。

## 4. HTTP 与 Schema 契约

### 4.1 Prompt 配置

新增管理员接口：

- `GET /api/v1/content-humanization-prompt`
  - 已配置返回 `HumanizationPrompt`；未配置返回 `404`。
- `PUT /api/v1/content-humanization-prompt`
  - 请求 `HumanizationPromptPut {template_markdown, expected_revision}`。
  - 首次创建要求 `expected_revision=null`；已有配置要求精确 revision。
  - 空白正文返回 `422`，并发冲突返回 `409 REVISION_CONFLICT`。

不增加 DELETE、历史 Prompt 列表或激活状态。历史作业已冻结实际 Prompt，不需要另建 Prompt 版本表。

### 4.2 自然化作业

新增工程师接口：

```text
POST /api/v1/content-versions/{content_version_id}/humanization-jobs
Headers: X-CSRF-Token, Idempotency-Key
Body: { "ai_model_id": "uuid" }
Response: 202 GenerationJob
```

现有 `GET /content-tasks/{id}/generation-jobs` 返回该任务的 `GENERATE` 和 `HUMANIZE` 作业；现有详情和重试接口同时支持两类作业，不新建列表、详情或重试端点。

`GenerationJob` 增加必填 `job_type` 和可空 `source_content_version_id`。`GenerationJobDetail.input_snapshot` 改为 `oneOf(GenerationSnapshot, HumanizationSnapshot)`，服务端按 `job_type` 选择严格 Schema，不尝试候选解析或字段兼容。

`GenerationOptions` 增加 `humanization_prompt_configured: boolean`，只暴露可用性，不向普通工程师暴露当前全局 Prompt 正文。作业详情仍按现有权限展示其已冻结 system/user message。

### 4.3 审核追溯

保留现有 `ContentReviewContext.generation_trace` 表示最初生成作业，新增 `humanization_traces: HumanizationTrace[]`，按版本链从早到晚返回。`HumanizationTrace` 包含作业 ID、源版本 ID 和严格 `HumanizationSnapshot`。

这两个字段表达不同阶段，不是重复来源：原始生成追溯负责批准事实和初稿来源，自然化追溯负责后续 AI 改写。人工修订沿 `based_on_id` 仍能读取其祖先的两类追溯。

## 5. 自然化快照与消息

新增严格 `HumanizationSnapshot`，至少包含：

- `adapter_name = "openai-compatible-chat-completions"`
- `contract_version = "humanization-json-v1"`
- 冻结 `channel`、`model`
- `humanization_prompt: {revision, template_markdown}`
- `source_content: {id, task_id, fact_version_id, version, content_hash, title, summary, body_markdown, tags}`
- `source_generation_job_id`
- 原始 `user_prompt_markdown`、`approved_facts`、`task_requirements`
- 原始 PUBLIC 分类、分类人和分类时间
- 最终 `system_message`、`user_message`

自然化不支持确定性“成功”适配器。开发和测试通过现有 OpenAI-compatible HTTP 假服务验证真实传输与严格解析，避免用原文直返或固定成功结果掩盖未实现行为。

`system_message` 由三部分组成：

1. 现有严格四字段 JSON 与批准事实契约。
2. 固定自然化契约：只编辑给定源内容、保留含义和必要披露、不得增加事实或输出说明。
3. 作业创建时读取的全局自然化 Prompt。

`user_message` 明确分区发送源文章、批准事实和任务要求。建议模板不得要求虚构第一人称经历、专家意见、用户反馈或具体数据；这些内容与项目事实契约冲突。

## 6. 权威数据流

### 6.1 创建

1. 无锁读取源版本以取得 `task_id`，再按固定顺序锁定 `ContentTask -> ContentVersion`。
2. 校验任务 `OPEN`、源版本 `AI`、状态合法、任务/事实绑定一致。
3. 解析版本链，定位最初 `GENERATE` 作业和严格 `GenerationSnapshot`；不得把 `HUMANIZE` 快照猜成生成快照。
4. 同时校验当前任务/事实以及原始冻结快照均满足第三方 PUBLIC 出站条件。
5. 读取全局 Prompt；不存在时返回 `HUMANIZATION_PROMPT_MISSING`。
6. 校验所选模型及渠道当前启用且模型测试通过，构造并验证 `HumanizationSnapshot`。
7. 按 `job_type + source_content_version_id + ai_model_id` 复核幂等键；写入作业和审计后提交，再复用现有 UUID 投递。
8. 部分唯一索引冲突映射为 `HUMANIZATION_ALREADY_ACTIVE`，不重试或创建隐藏作业。

### 6.2 Worker

1. 复用现有 `PENDING -> RUNNING` 原子认领、动态租约和重复消息短路。
2. 按 `job_type` 严格验证快照；共享渠道、凭据、固定目的地址和 Chat Completions 传输。
3. `HUMANIZE` 在调用前校验源版本身份、类型、状态和哈希；调用后锁定任务及源版本并再次校验。
4. 把输出转换为 `GeneratedDraft`，用从两类快照显式构造的窄 `QualityContext` 复用 `run_quality_checks`，再运行近重复提示。
5. 计算任务内下一个版本号，创建一个自然化 `ContentVersion`，回写作业指标和 `SUCCEEDED`。
6. 任一失败显式写入现有 `FAILED`、错误码和安全摘要；不得切换模型、Prompt、适配器或重新调用。

### 6.3 重试

自然化重试只接受 `FAILED` 作业，复制原 `HumanizationSnapshot`、`job_type`、源版本和模型引用。重试时重新校验任务及源版本当前资格、PUBLIC 出站和当前凭据可用性；不读取当前全局 Prompt，也不允许另选模型。需要更换模型或 Prompt 时，用户应从源版本创建新的自然化作业。

## 7. 版本链单一所有者

现有 `source_generation_input` 与审核追溯都会遇到自然化作业。实现时提取一个聚焦的内容 AI 链路解析函数，沿 `based_on_id` 和 `source_job_id` 返回：

- 唯一最初 `GENERATE` 作业及 `GenerationSnapshot`
- 按顺序排列的 `HUMANIZE` 作业及 `HumanizationSnapshot`

内容人工修订质量检查、创建自然化快照和审核上下文共同使用该解析结果，避免三个调用方各自猜测快照类型或形成第二套追溯逻辑。链路缺失、跨任务/事实或快照类型与 `job_type` 不一致时显式返回 `GENERATION_SNAPSHOT_INVALID` / `REVIEW_CONTEXT_INCOMPLETE`。

## 8. 前端交互

### 8.1 配置中心

在现有 `/configuration/prompts` 页面增加“全局自然化 Prompt”卡片：

- `404` 表示未配置，展示说明和首次创建表单。
- 已配置时显示 revision、更新时间和编辑表单。
- 保存成功更新 TanStack Query 缓存/失效对应 query key；冲突展示服务端错误。
- 页面附上建议模板文档入口和“不得写入凭据、私密事实或虚构指令”的提示。

不新增路由、全局 Store 或第二套编辑器。

### 8.2 内容任务

- 复用 `GenerationOptions.models` 作为自然化模型选项。
- 内容版本表只对满足客户端可见条件的 AI 草稿提供“自然化”入口；服务端始终重新校验。
- 点击后打开模型选择确认框，明确这是额外一次模型调用并会创建新草稿。
- “生成作业”区改为区分 `GENERATE` / `HUMANIZE` 的统一 AI 作业列表，显示源版本、结果版本、状态、失败和指标；任何活动作业存在时继续轮询。
- 自然化成功后失效 jobs/versions，提供结果链接和现有版本比较入口；同源活动作业期间入口禁用。

## 9. 错误与安全边界

新增或明确使用以下错误：

- `HUMANIZATION_PROMPT_MISSING`
- `HUMANIZATION_SOURCE_INVALID`
- `HUMANIZATION_ALREADY_ACTIVE`
- 复用 `INVALID_STATE_TRANSITION`、`AI_DATA_CLASSIFICATION_FORBIDDEN`、`AI_MODEL_NOT_TESTED`、`AI_CONFIGURATION_DISABLED`、`AI_CONFIGURATION_DELETED`、`GENERATION_SNAPSHOT_INVALID`、严格响应和 Transport 错误。

错误摘要、日志和审计不得包含 Prompt、源正文、响应正文、Header 值或凭据。日志可记录 `job_id`、`job_type`、源版本 ID、状态、耗时和稳定错误码。

## 10. 迁移、发布与回滚

迁移是对现有作业表的可前向读取扩展，历史作业全部成为 `GENERATE`，全局 Prompt 初始为空，因此部署后功能默认休眠。

发布顺序：

1. 备份并执行 `0017`。
2. 部署后端、Worker/Beat 和前端。
3. 在 Prompt 未配置状态完成健康与契约检查。
4. 管理员审阅建议模板并首次保存，显式开启自然化入口。
5. 完成一条 fake/预发布模型自然化 smoke 后再投入使用。

如果尚无 `HUMANIZE` 作业，可回退应用并降级迁移；Prompt 当前配置会丢失，需先备份。只要已存在任一 `HUMANIZE` 作业，迁移 downgrade 必须拒绝，因为旧应用不能解释其快照和历史内容来源；此后只能前滚修复，不能删除或伪装历史。

## 11. 文档影响

- `contracts/openapi.yaml`：接口和 Schema 权威来源。
- `contracts/database.md`：单例 Prompt、作业类型、部分唯一索引、版本关系和降级门禁。
- `docs/architecture.md`：一个共用 AI 作业状态机、自然化数据流和追溯。
- `docs/testing.md`：自然化真实 HTTP 假服务、并发、分类和 E2E 门禁。
- `docs/content-humanization-prompt.md`：项目安全版建议模板、使用边界、`Humanizer-zh` 来源和 MIT 归属说明。
- `.trellis/spec/backend/ai-configuration-guidelines.md` 与 `database-guidelines.md`：稳定可执行契约。

## 12. 被刻意省略的复杂度

- 不新增 `HumanizationJob` 表、第二 Celery task、第二恢复器或通用工作流引擎。
- 不做 Prompt 历史表、平台覆盖、删除/停用状态、用户临时编辑或自动串行处理。
- 不做语义相似度模型、AIGC 检测器、自动事实判定或确定性假自然化。
- 不重命名现有 `GenerationJob` 表和公共端点；只增加明确的作业类型字段。

只有出现多个独立 AI 后处理类型时，才评估把 `GenerationJob` 更名或抽象为通用 AI 作业；本次不为未来需求预建框架。
