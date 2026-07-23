# Prompt 管理权威与任务历史调查

> 目的：为 `07-22-prompt-management-fidelity` 提供可继承决策。下列“设计意图”来自契约/规范/任务文档；“已实现证据”仅指文档中明确记录的代码或验证路径，不能把任务勾选当作实现证明。

## 调查启动时的任务状态

- 本调查启动时，PRD 还是 Goal/Requirements/Acceptance Criteria 均为占位内容的模板（当时的 `.trellis/tasks/07-22-prompt-management-fidelity/prd.md:3-18`）。因此调查没有从模板推导交互、字段或实现范围，而是要求主 Agent 以真实路由、OpenAPI、服务、前端代码、批准原型和后续用户决策确认；最终范围以任务目录中已收敛的 `prd.md`、`design.md`、`implement.md` 为准。

## 权威业务决策（可继承）

1. **具体平台 Prompt 的唯一所有者**：`platform_prompts.platform_profile_id`，每个具体 `PlatformProfile` 零或一条当前 Markdown Prompt；`0014` 移除类型级 Prompt，不允许双读、双写、类型级 API、默认 Prompt 或兼容回退（`contracts/database.md:107-111`；`.trellis/spec/backend/ai-configuration-guidelines.md:42`）。权威 API 为 `GET/PUT/DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt`（同上）。
2. **Prompt 与生成历史**：生成作业的 `input_snapshot` 是不可变输入权威，冻结非敏感渠道/模型身份、参数、system/user message、批准事实和任务要求；凭据及敏感 Header 永不进入快照（`contracts/database.md:71-73`）。新快照还必须包含具体平台身份和最终消息；旧快照缺平台对象仅允许只读（`contracts/database.md:129-133`；`.trellis/spec/backend/ai-configuration-guidelines.md:46`）。
3. **任务 Prompt 保存与数据分级必须同一修订更新**：保存任务 Prompt 同时替换完整生成输入分类并记录分类人和 UTC 时间；第三方模型创建/重试仅在任务为明确 `PUBLIC` 且绑定事实快照所有 Evidence 均为 `PUBLIC` 时允许，历史 `NULL` 不得自动补 `PUBLIC`（`contracts/database.md:89-93`；`.trellis/spec/backend/ai-configuration-guidelines.md:42,53-55`）。
4. **平台规则前置门禁**：创建内容任务需具体平台的 `ACTIVE` 规则版本，并且该平台存在当前 Prompt；缺失返回 `PLATFORM_PROMPT_MISSING`，不得回退类型或其他平台 Prompt（`contracts/database.md:109-111`；`.trellis/spec/backend/ai-configuration-guidelines.md:46,54`）。
5. **全局自然化 Prompt 是另一条独立所有权**：`content_humanization_prompts.id=1` 单例；迁移不种子默认值，管理员首次创建或按 revision 更新，不提供删除、平台副本、用户临时 Prompt 或代码回退；缺失返回 `HUMANIZATION_PROMPT_MISSING`（`contracts/database.md:123-131`；`.trellis/spec/backend/ai-configuration-guidelines.md:43,55`）。自然化快照冻结全局 Prompt Markdown/revision、源文章完整正文与哈希、模型、事实、分类和最终消息；重试只复制原快照（`contracts/database.md:127-131`）。
6. **生成可靠性边界**：PostgreSQL `generation_jobs.status` 是唯一执行权威，Redis 只传 Job UUID；RUNNING 租约过期显式失败，不能自动重放，显式重试才新建可追溯 Job（`.trellis/tasks/07-11-generation-reliability/prd.md:9-15`；`design.md:7-12,88-92`）。该任务明确不拥有 PUBLIC-only 分类契约，生成服务应消费父任务结果（`prd.md:34-37`）。
7. **AI 渠道/平台管理不能制造第二配置源**：协议只有 `openai-compatible-chat-completions`；品牌仅管理身份/筛选/图标，不决定调用协议；未知组合必须失败；不做双读、双写、兼容别名或静默默认（`.trellis/tasks/07-22-ai-channel-model-management/prd.md:15-32,63-79,96-118`；`design.md:9-25,34-47`）。
8. **权限与安全**：Prompt/具体平台/AI 配置写接口仅管理员，服务端权限与 CSRF 是最终边界；普通用户可只读所选具体平台 Prompt。审计、日志、读取投影、浏览器持久化不得含 API Key、敏感 Header 或完整敏感响应（`.trellis/tasks/07-22-ai-channel-model-management/prd.md:76-85`；`docs/GEO多平台内容运营系统方案设计.md:878,931,996`）。

## 相关任务的范围与依赖

- `07-22-platform-management-fidelity` 负责平台管理页、平台启停、平台详情和跳转；其设计明确 Prompt 入口跳转 `/configuration/prompts?platform_profile_id=<id>`，目标页必须解析并发送真实平台筛选，不得占位或另建数据源（`.trellis/tasks/07-22-platform-management-fidelity/design.md:132-135,164-175`）。Prompt 任务应复用该平台集合契约，不重复实现平台管理查询/状态。
- `07-22-platform-rules-fidelity` 负责规则版本工作台与规则生命周期；其研究指出具体平台 Prompt 与规则版本均为既有权威来源，内容任务锁定具体 `platform_profile_version_id`，不可把规则页字段误当 Prompt 字段（`.trellis/tasks/07-22-platform-rules-fidelity/research/gap-analysis.md:1-8,23-30,76-79`）。
- `07-22-ai-channel-model-management` 负责 AI 渠道/模型管理、真实测试、统计、审计和配置安全；Prompt 任务只消费其已确认的可用模型/生成链，不应新增 Provider 工厂、第二配置源或固定成功适配器（`.trellis/tasks/07-22-ai-channel-model-management/prd.md:63-79,116-118`）。
- `07-11-generation-reliability` 仅负责 Job 投递/租约/至多一次调用；不要在 Prompt UI 或保存接口加入队列状态、恢复表或自动重试（`design.md:23-25,47-61`）。

## 设计意图 vs 已实现证据

- 上述契约与任务文档是批准的设计意图；它们没有证明当前工作区代码全部实现。调查开始时 Prompt 任务 PRD 尚未收敛，因此本调查没有据此宣称页面、权限、删除、revision 或视觉闭环已完成。
- 可作为后续实证入口的已记录路径：`contracts/openapi.yaml` 明确列出平台 Prompt与全局自然化 Prompt端点（`contracts/openapi.yaml:705-768`）；内容任务任务级 Prompt 保存和生成选项端点位于 `contracts/openapi.yaml:1243-1272`。主 Agent 需读取对应 FastAPI 路由、服务、模型、前端页面和生成类型，核对契约漂移。
- 方案文档在部分历史段落仍描述“平台 Prompt 可覆盖/删除、非版本化”（`docs/GEO多平台内容运营系统方案设计.md:35-37,824-848`），与 `0014`/当前规范一致；但文档末尾写“截至 2026-07-22 已完成”属于方案声明，不是测试证据（`docs/GEO多平台内容运营系统方案设计.md:1115`）。

## 已知冲突/风险（需主 Agent 实证或裁决）

1. 调查开始时 `07-22-prompt-management-fidelity` 尚无批准范围或验收项；视觉复刻字段、默认文案、分页/筛选和 Prompt 编辑交互后来已通过当前实现、批准原型和用户决策收敛到任务 `prd.md`，实施不得回退到调查前假设。
2. `docs/GEO多平台内容运营系统方案设计.md` 是长期方案文档，包含历史“平台类型 Prompt”叙述；以 `contracts/database.md:107-111` 与 `.trellis/spec/backend/ai-configuration-guidelines.md:42` 的具体平台所有权为准，并检查代码是否仍有遗留类型级路由或回退。
3. “删除当前平台 Prompt”在契约中允许（`contracts/openapi.yaml:705-743`），而“删除/缺失 Prompt 后新任务拒绝”是业务门禁（`contracts/database.md:109-111`）。需确认 UI 是否正确区分管理员删除、普通用户只读、历史快照可读和新作业拒绝，不能用默认 Prompt 填洞。
4. 全局自然化 Prompt 的单例与平台 Prompt 是两个不同所有者；禁止把自然化 Prompt 复用到平台 Prompt 页面，或把平台 Prompt 做成自然化副本（`contracts/database.md:123-131`）。

## 主 Agent 最小实证清单

- `rg`/完整读取当前 Prompt 路由、服务、模型、schema、前端页及生成选项/任务 Prompt 保存调用链；确认是否存在类型级 API、默认/兼容回退、双读或第二状态源。
- 对照 `contracts/openapi.yaml` 与 `contracts/database.md`，运行针对 Prompt 的后端测试/`make contract-check`（若改动代码）；确认 revision、权限、CSRF、分类记录和删除错误码。
- 用真实数据库/HTTP 或现有集成测试验证：具体平台 Prompt 缺失时 `PLATFORM_PROMPT_MISSING`；自然化 Prompt 缺失时 `HUMANIZATION_PROMPT_MISSING`；历史作业快照仍可读且不带敏感值。
- 检查 Prompt 页面从平台管理入口的 URL 状态恢复与移动/桌面原型证据；调查当时尚未取得批准视觉规格，后续已由用户批准 1581×995 原型，最终证据见 `research/accepted-visual-spec.md`。
