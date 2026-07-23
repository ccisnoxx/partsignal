# Prompt 实际调用链研究

## 已证实调用顺序

### 原始生成（GENERATE）

入口 `create_generation_job` → `content_production._create_job` → `build_generation_input`（`backend/app/services/content_production.py:101-220`）。服务端读取任务绑定 `FactVersion`、`PlatformProfileVersion.rules`、具体平台 `PlatformPrompt`、任务级 `user_prompt_markdown`、产品/任务要求及所选模型/渠道，构造不可变 `GenerationSnapshot`。

组合顺序：

1. `system_message = FIXED_SYSTEM_CONTRACT + "\\n\\n" + prompt.template_markdown`（`content_production.py:183-184`）。固定系统安全契约明确“批准事实优先、不得使用输入之外事实、只返回 JSON”；平台 Prompt 追加在其后。
2. `user_message` 依次为“## 工程师输入”任务 Prompt → “## 已批准事实（只读）”JSON → “## 任务要求（只读）”JSON（`content_production.py:185-193`）。平台规则不单独进入消息，而冻结在 `task_requirements.platform_rules` 并用于质量检查。
3. `GenerationSnapshot` 同时冻结平台身份/规则版本、系统消息、用户 Prompt、事实分级/批准事实、任务要求、渠道非敏感配置、模型参数（`content_production.py:194-220`）。

执行时 `generate_for_job` 使用快照中的 `system_message`/`user_message` 调 OpenAI-compatible 客户端（`backend/app/services/generation.py:449-494`）；重试复用原 `input_snapshot`（`content_production.py:346-382`），不读取当前 Prompt。

### 自然化（HUMANIZE）

`build_humanization_input`（`content_production.py:238-331`）先沿源内容不可变链取得原始生成快照，再读取当前全局单例 `ContentHumanizationPrompt`。组合顺序为 `FIXED_SYSTEM_CONTRACT` → `HUMANIZATION_FIXED_CONTRACT`（仅改写源文、保留事实/披露、禁止新增事实及非 JSON 输出）→ 全局自然化 Prompt（`content_production.py:302-305`）。用户消息依次为只读源文章 JSON、原始批准事实 JSON、原始任务要求 JSON（`306-315`）。快照保存自然化 Prompt 的 `revision` 与 Markdown（`HumanizationPromptSnapshot`，`316-331`），以及原始 `user_prompt_markdown`、原始生成作业 UUID。

## 所有权、编辑边界与生效

- 具体平台唯一当前 Prompt 属于 `PlatformPrompt.platform_profile_id`；管理员可创建/按 `expected_revision` 原地更新或物理删除，均记录审计（`backend/app/services/platform_configuration.py:401-523`）。删除后平台仍可管理，但新任务/生成选项/作业因缺 Prompt 明确拒绝；历史作业快照可继续追溯。数据库契约明确无类型级 fallback（`contracts/database.md:107-111,235-238`）。
- 全局自然化 Prompt 是 `content_humanization_prompts` 单例，管理员首次创建或按 revision 更新；无删除、无种子值/环境 fallback（`platform_configuration.py:449-492`; `contracts/database.md:125-129`）。配置缺失时自然化创建报 `HUMANIZATION_PROMPT_MISSING`。
- 工程师可编辑任务级 `user_prompt_markdown`，与数据分级在同一 revision 更新；仅 OPEN 任务允许，终态拒绝（`backend/app/services/content_planning.py:399-430`）。平台 Prompt、系统固定契约、平台规则、批准事实均不可由工程师编辑。
- Prompt/规则更新仅影响之后新建的 GenerationJob 快照；已创建作业、重试及历史内容使用冻结快照。平台规则版本本身不可变，任务绑定版本可为 ACTIVE/RETIRED（`content_production.py:119-125`）。

## 审核、发布与历史追溯

每次成功作业创建不可变 `ContentVersion`，写入 `source_job_id`、`based_on_id`、内容哈希及质量问题；源版本不原地更新（`backend/app/services/generation.py:615-665`）。审核上下文 `get_content_review_context` 返回 `generation_trace.input_snapshot`、全部 `humanization_traces.input_snapshot` 和审核历史（`backend/app/services/review.py:237-255`），因此可追溯系统/平台/自然化 Prompt、用户输入、事实与规则。发布服务仅消费审核通过的不可变版本；未发现发布阶段重新拼接 Prompt 的代码。

## 测试与缺口/风险

- 单测覆盖固定系统/自然化约束及快照校验：`backend/tests/unit/test_generation.py:252-275`；集成测试覆盖全局自然化 Prompt 首次创建、revision 冲突、审计（`backend/tests/integration/test_publication_review_closure.py:402-504`）及平台 Prompt 删除/配置完整性（同文件约 `1099-1205`）。
- 已证实风险：平台 Prompt 只有当前行 revision，不保留独立历史表；历史含义依赖 GenerationJob 快照，未创建作业前的 Prompt 变更无法回溯正文。全局自然化 Prompt 同理，仅当前行，但自然化作业快照保存 revision/正文。
- 未发现删除全局自然化 Prompt API；这是契约设计（不可删除），非遗漏兼容分支。未发现发布阶段再次调用模型或读取 Prompt。
