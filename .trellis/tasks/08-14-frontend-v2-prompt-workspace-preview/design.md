# 设计方案

## 1. 架构与权威

```text
Prompt Workspace (Configuration UI)
  -> Prompt Preview Options query
  -> content.api public GenerationJob/JobList/ContentVersion functions

production router
  -> content_task_queries Preview Options read model
  -> existing content_production GenerationJob command
  -> existing Worker / GenerationJob / ContentVersion
```

Configuration拥有Preview UI与Prompt query；Content backend拥有eligibility、model、snapshot、Job/Version。不得导入Content内部页面组件或复制状态机。

## 2. Contract

新增path：

```http
GET /api/v1/platform-prompts/{platform_prompt_id}/preview-options
```

Dependency：`AdminUser`。Responses至少包含200/401/403/404。

```text
PlatformPromptPreviewOptions
  platform_prompt: PlatformPromptSnapshot
  contexts: PlatformPromptPreviewContext[]
  models: GenerationOptionModel[]

PlatformPromptPreviewContext
  content_task_id: uuid
  identifier: CT-XXXXXXXX
  product_id: uuid
  brand: string
  part_number: string
  platform_profile_id: uuid
  platform_profile_name: string
  fact_version_id: uuid
  fact_version: integer >= 1
```

Response intentionally excludes Markdown、actions和业务历史。Prompt identity用于与Core Detail baseline比较并提交existing command。

## 3. Backend Read Model

`content_task_queries.py`新增：

- `generation_model_options(db)`：现有generation-options和Preview Options共用enabled/tested模型查询。
- `get_platform_prompt_preview_options(db, prompt_id)`：
  1. 读取Prompt或404。
  2. 查询平台绑定该Prompt的OPEN/non-archived/no-current候选，按`updated_at DESC,id DESC`。
  3. 调用现有`content_tasks_out`，只保留含`CREATE_GENERATION_JOB`的items。
  4. 批量读取eligible Fact version identity并映射窄context。
  5. 返回Prompt snapshot、contexts、models。

预筛只减少候选；最终资格仍由action projection决定。Integration以sparse/dense SQL counter固定查询次数，禁止逐行Fact/Product/Platform/model查询。

`production.py`只装配dependency/response并让existing generation-options调用shared model helper；不新增mutation service。

## 4. Frontend API / State

Core的`prompt.api.ts`新增：

```text
promptKeys.previewOptionsRoot()
promptKeys.previewOptions(promptId)
platformPromptPreviewOptionsQueryOptions(promptId, enabled)
```

`content.api.ts`新增窄`contentVersionQueryOptions(versionId)`，调用既有`GET /content-versions/{id}`；GenerationJob create/list继续复用现有exports。

Local state：selectedContextId、selectedModelId、submittedJob、command key map、active/terminal seen sets、fullscreen dialog。Prompt或options revision变化时清理selection但不覆盖Core editor草稿。

## 5. UI / Flow

Preview放在Core reference pane中、Bound Platforms上方：

```text
Preview
├─ saved/dirty/revision gate
├─ Test Context Select
├─ Model Select
├─ Create confirmation
├─ Job status / failure
└─ immutable ContentVersion + fullscreen
Bound Platforms
```

Command signature：`GENERATE:{taskId}:{modelId}:{promptId}:{promptRevision}`。同signature失败重试复用key；payload变化或IDEMPOTENCY_CONFLICT删除key。

Polling使用existing `generationJobsQueryOptions(taskId, trackedJobId)`：query只在tracked ID存在时启用，interval只在该ID active时返回2s。Terminal refetch以Set防重复。ContentVersion query只在SUCCEEDED且ID存在时启用，结果可用无限stale或immutable语义。

不自动打开完整Job snapshot，不提供retry；失败后用户可按同确认显式再提交，仍受服务端current eligibility约束。

## 6. Cache Matrix

| Event | Set/local | Invalidate |
|---|---|---|
| Job create | submittedJob + context label | exact task Job list、Preview Options root、Content lists/details/editor contexts |
| Job terminal | stop polling；enable Version query | Preview Options root、Content lists/details/editor contexts |
| Prompt update | Core set Detail | exact Preview Options、Prompt list、Platform lists/details、generation-options |
| Prompt delete | remove Detail/result仍保留local identity | Preview Options root、Prompt/Platform/Content current consumers |
| Platform bind/unbind | Platform canonical response | Prompt list/details、Preview Options root、Content current consumers/generation-options |

历史Job/Version不失效来采用当前Prompt；当前result以content_version_id为唯一owner。

## 7. Test Strategy / Existing Evidence

- Backend integration证明read model权限、资格、排序、模型和query count。
- Component/fixture证明UI状态、idempotency、polling stop、immutable result、cache和responsive。
- Existing `content-ai-real-stack.spec.ts`已证明相同POST/Worker/provider/snapshot/Version，不修改共用命令时不重跑或复制。
- 若implementation改变existing generation command/shared action projection，必须把受影响existing targeted test和real-stack加入Required。

## 8. 文件与回滚

- `contracts/openapi.yaml`
- `backend/app/schemas/content.py`
- `backend/app/routers/production.py`
- `backend/app/services/content_task_queries.py`
- `backend/tests/integration/test_prompt_preview_options.py`（新增）
- V1/V2 generated schema
- `frontend-v2/src/domains/content/content.api.ts`
- Core的Prompt API/model/page/tests/fixture/spec
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

无migration/database rollback。回滚Preview path/UI后，已创建的GenerationJob/ContentVersion仍是合法业务历史，不得删除或改写。
