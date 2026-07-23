# 输出预览与 AI 渠道能力调查

## 已有能力（事实）

- **没有“输出预览”API/页面。** `frontend/src/features/content-tasks/ContentTasksPage.tsx:225-256` 仅请求 `GET /api/v1/content-tasks/{content_task_id}/generation-options`，编辑工程师 `user_prompt_markdown`、选择模型后点击“生成草稿”；没有预览按钮、预览查询或临时生成结果展示。配置页 `frontend/src/features/configuration/PlatformPromptsPage.tsx:45-51` 仅提供 Prompt Markdown 文本编辑/保存，也无预览。
- 现有 Markdown 预览仅针对已生成/人工修订内容：`ContentEditorPage.tsx:324,423-430` 和 `RevisionForm.tsx:32-36,78-82` 用 `marked.parse` 后 `DOMPurify.sanitize`，只读内容版本或本地修订草稿；不能预览 Prompt 执行输出。
- 生成选项服务端来源：`backend/app/routers/production.py:75-127` 锁定任务平台当前 `PlatformPrompt.template_markdown`，并筛选 `AIModel.is_enabled=true`、`test_status='PASSED'` 且所属 `AIChannel.is_enabled=true`，按渠道名/模型显示名排序返回；响应只含渠道名、模型显示名和 `model_id`，不含密钥、Header 或完整渠道配置。
- 真实调用链：`backend/app/routers/production.py:136-158` POST 创建作业；`backend/app/services/content_production.py:411-444` 锁定 OPEN 任务并调用 `_create_job`，提交后派发 Celery；`backend/app/services/openai_client.py:129-220` 的 `OpenAICompatibleClient.complete` 对选定快照调用 `/chat/completions`，非流式、无重试、严格四字段 JSON（`parse_generated_draft`，57-70）。配置 `settings.content_generator == 'deterministic'` 时使用开发确定性生成器，否则要求受支持协议并执行 PUBLIC 出站校验（`content_production.py:152-163`）。
- 渠道/模型状态与配置约束：`backend/app/services/content_production.py:93-102` `_enabled_channel` 未启用渠道报 `AI_CONFIGURATION_DISABLED`(409)，模型未启用或未通过测试报 `AI_MODEL_NOT_TESTED`(409)；缺 Prompt、未批准事实、空工程师 Prompt、非 OPEN 任务等分别在 `build_generation_input`（`content_production.py:116-190`）显式报错。
- 网络/失败行为：`openai_client.py:72-126` 校验凭据字符、Header、URL；HTTP 3xx 报 `AI_REDIRECT_FORBIDDEN`，>=400 报 `AI_PROVIDER_ERROR`；JSON/Schema 无效报 `AI_RESPONSE_INVALID`(502)。传输层使用固定 DNS、超时参数与响应大小保护（`backend/app/services/pinned_http.py:1-90`）。
- Prompt/密钥泄露边界：生成快照由 `content_production.py:103-220` 生成，保留 system/user 消息、模型参数及非敏感渠道字段；敏感 Header 仅保留名称，API key 不进入快照（`_channel_snapshot`）。审计/诊断约束见 `contracts/database.md:71,73,171,245,257`：不得记录凭据、完整 Prompt、响应体或敏感 Header。

## 缺口与最小边界（推断）

- 当前“预览”若指 Prompt 管理页面的实时输出，产品没有临时/试运行合同；新增前需明确输入来源（当前平台 Prompt + 工程师 Prompt + 任务事实/要求，或仅 Prompt 示例）及是否允许真实第三方调用。现有生成链会创建不可变 `generation_jobs`，不适合作为无痕预览。
- 若复用已有只读全屏能力，内容审核页的 Tabs（`ContentEditorPage.tsx:415-430`）和 `.review-reading-surface` 样式（`frontend/src/styles/global.css:734-742,1264-1265`）可承载只读 Markdown HTML；必须继续经 DOMPurify，禁止直接渲染原始 Prompt/模型 HTML。配置 Prompt 编辑目前为 `Input.TextArea`（`PlatformPromptsPage.tsx:47-51`），没有全屏只读预览组件。
- 最小可行方案应新增独立预览合同（建议明确为“创建草稿作业”或“临时调用且不落库”二选一），复用 `OpenAICompatibleClient.complete` 的协议、超时和错误码；服务端仍必须检查渠道/模型启用及测试状态、完整输入 PUBLIC 与 Prompt 已配置，且响应只返回严格 `GeneratedDraft`/安全 Markdown，不回显密钥、内部快照或原始 provider body。未配置、超时、provider 错误、响应不合规应沿用现有显式错误，不做静默 fallback。
- 权限：现有 generation-options 要求 `CurrentUser`（`production.py:79-81`），真正创建作业要求 `EngineerUser` + CSRF（`production.py:136-158`）；预览若调用真实模型至少应继承工程师权限与服务端分级校验，不能仅靠前端隐藏按钮。

## 相关测试证据

- `frontend/src/features/content-editor/ContentEditorPage.test.tsx:129-133,164-181` 验证 Markdown 预览 DOMPurify 去除 `onerror`；没有 Prompt 输出预览测试。
- `frontend/src/features/content-tasks/ContentTasksPage.test.tsx:77,178-193` 覆盖 generation-options 失败与模型选择/生成输入，但没有预览路径。
- `backend/tests/unit/test_ai_boundaries.py:82-90` 覆盖严格模型 JSON 解析失败；`backend/tests/integration/test_generation_reliability.py:557-610` 覆盖真实 HTTP 人工化作业；未覆盖“预览”合同（因不存在）。
