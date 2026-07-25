# 设计：Markdown 产品事实与双模式内容任务

## 设计目标

用现有产品、事实版本、内容任务和内容版本完成需求，不新增知识库、任务类型、文章表或通用工作流。变更后的三个权威来源是：

1. `Product` 持有当前可编辑事实 Markdown，`FactVersion` 持有不可变审核快照。
2. `PlatformPrompt` 持有平台当前唯一 system Prompt，`PlatformProfile` 持有稳定平台身份与发布域名。
3. `ContentVersion` 持有 AI 或人工产生的不可变 Markdown 文章，两种来源共用审核与发布。

`PlatformProfileVersion / PlatformRules`、结构化事实子表和内容任务生成要求字段全部删除，不建立兼容字段或替代规则层。

## 核心不变量

- 一个产品只有一个事实工作区；保存工作区使用 `facts_revision` 乐观锁。
- 事实工作区可以处于尚未录入的空初态，但保存命令和新事实版本都拒绝空白正文；事实版本创建后冻结正文与分级。
- 内容任务只绑定同一产品的 `APPROVED` 事实版本和一个活动 `PlatformProfile`。
- 第三方原始生成只允许 `PUBLIC` 事实；发送内容严格等于平台 Prompt 和事实版本 Markdown。
- 人工首稿不依赖 Prompt、模型、生成作业或既有内容版本。
- AI 与人工首稿都只创建 `DRAFT ContentVersion`，审核、唯一批准版本和发布门禁不分来源。
- 平台发布 URL 继续只由 `PlatformProfile.allowed_domains` 校验；平台 Prompt 不参与发布校验。
- 历史内容、审核、发布、GEO 和生成快照不可变；旧规则数据不再成为运行时配置。

## 数据模型

### 产品事实

在现有 `products` 表上增加：

- `facts_body_markdown TEXT NOT NULL DEFAULT ''`
- `facts_classification VARCHAR(16) NOT NULL DEFAULT 'RESTRICTED'`
- `facts_revision` 继续作为事实工作区乐观锁

不新增一对一工作区表。API 对外仍返回独立事实工作区对象，避免把产品基础资料更新与事实保存混为一个命令。

`fact_versions` 改为保存：

- `body_markdown TEXT NOT NULL`
- `classification VARCHAR(16) NOT NULL`
- 既有 `version/status/change_summary/revision/created_by/approved_by/created_at/approved_at`

删除 `snapshot_json`。删除 `reference_parts`、`evidences`、`part_parameters`、`replacement_relations`、`fact_claims` 及三张证据关联表；文件记录本身不删除。

事实工作区与版本 Schema 只暴露 Markdown、分级、修订和审核信息。`FactReviewContext` 与 `ContentReviewContext` 删除证据状态列表，内容审核直接展示冻结事实 Markdown。

### 平台与内容任务

保留：

- `platform_profiles`
- `platform_prompts`
- `platform_types`
- `platform_profiles.allowed_domains`

删除：

- `platform_profile_versions`
- PlatformRules CRUD、状态转换、影响分析和对应审计写入
- 内容任务的 `platform_profile_version_id`
- 内容任务的 `platform_type_id`、`platform_type_snapshot`
- 内容任务的受众、角度、转化、格式、长度、官网 URL、任务 Prompt 和任务分级字段

`content_tasks` 增加非空 `platform_profile_id`，外键 `ON DELETE RESTRICT`，并建立 `(platform_profile_id, created_at)` 索引。保留 `query_topic_id` 和 `source_publication_attention_id` 作为 GEO/发布修复的服务端来源关联，它们不进入人工创建请求。

`ContentTaskCreate` 精确为：

```text
product_id
fact_version_id
platform_profile_id
```

任务创建验证产品活动、事实版本已批准且属于该产品、平台活动。它不检查 Prompt 或可用模型。列表筛选、发布查询和修复任务统一使用 `platform_profile_id`。

### 内容版本

`ContentVersion` 现有空来源外键已能承载人工首稿，无需改表：

```text
source_type = HUMAN
source_job_id = null
based_on_id = null
status = DRAFT
```

新增任务级命令 `POST /content-tasks/{content_task_id}/manual-versions`，复用 `ContentRevisionCreate` 的标题、摘要、正文、标签和变更说明字段。服务端验证任务为 `OPEN`、事实版本仍存在且与任务一致，然后使用现有版本号、内容哈希和审计规则创建首个人工版本。

既有 `POST /content-versions/{id}/revisions` 保留，用于 AI 或人工版本的后续人工修订；其质量检查不得再要求 AI lineage。

## AI 生成契约

### 原始生成

创建作业时读取任务的 `platform_profile_id`、平台当前 `PlatformPrompt`、冻结 `FactVersion` 和所选可用模型。仅检查 Prompt 和事实正文去除空白后非空，不改变原字符串。

适配器实际请求固定为：

```text
messages[0] = {"role": "system", "content": PlatformPrompt.template_markdown}
messages[1] = {"role": "user", "content": FactVersion.body_markdown}
```

不再使用固定系统契约、任务 Prompt、任务要求、事实 JSON、产品信息或平台规则。模型返回仍由现有严格四字段 JSON 解析器验证；不修复、不补值、不回退。

### 生成快照

新作业使用 `contract_version = "content-markdown-v2"`，只冻结执行和追溯需要的数据：

- 非敏感渠道与模型快照
- 平台身份快照
- 事实版本身份与 `PUBLIC` 分级
- `system_message` 与 `user_message`
- 既有请求参数和哈希所需字段

旧 `chat-json-v1` 快照保留为只读历史类型，避免重写不可变审计数据。部署后：

- 不再创建旧快照。
- 上线迁移前必须清空或终止旧契约的 `PENDING / RUNNING` 作业；存在未结束旧作业时迁移前置检查失败。
- 旧作业不得创建新重试；接口返回明确的旧契约不支持错误。
- 新 v2 重试继续逐字段复制原快照，因此 Prompt 或事实变更不会影响重试。

这是唯一保留的有界历史兼容，不恢复规则表，也不允许旧字段参与新任务或新作业。

### 自然化作业

自然化是既有文章后处理，不属于“平台 Prompt + 事实原文”的原始生成。保留现有全局自然化 Prompt 和来源文章快照，但把结构化事实与任务要求替换为冻结事实 Markdown/身份；不再读取平台规则或已删除任务字段。人工首稿不自动创建自然化作业。

## 质量、审核与发布

- 删除基于平台规则的标题/正文长度、禁用表达、外链、表格、联系方式检查。
- 删除基于结构化事实的参数数字来源比对，以及依赖任务受众、角度、格式或长度的检查。
- 保留严格响应 JSON、标题/摘要/正文非空、Markdown 清洗与预览安全、标签类型、内容哈希、状态转换、唯一批准版本和发布域名等确定性规则。
- 人工首稿和人工修订使用相同的结构校验，但不伪造 `GenerationJob` 或生成快照。
- 审核上下文的 `generation_trace` 继续可空；旧 AI 内容仍可读取旧快照，新内容读取 v2 快照。
- 发布记录继续绑定 `ContentVersion` 和 `PlatformProfile`；发布修复任务直接复用原关注记录的平台身份，不再选择规则版本。

## API 与前端

### 产品事实页

用现有 Markdown 编辑/预览组件模式替换五段结构化表单，不引入新编辑器依赖。页面包含：

- Markdown 编辑与安全预览
- 数据分级
- 保存修订状态
- 创建事实版本、提交审核、批准/退回/退役
- 不可变事实版本列表与正文查看

### 内容任务页

创建弹窗只选择产品、该产品的批准事实版本和活动平台。任务详情提供两个并列入口：

- “系统 AI 生成”：加载当前平台 Prompt 和可用模型，选择模型后创建作业。
- “手动录入”：复用内容修订表单字段，直接创建首个人工草稿。

缺少 Prompt 或模型只让 AI 入口显示明确不可用状态，不阻断手动录入。任务详情不再显示或编辑受众、角度、格式、长度、官网 URL、任务 Prompt、规则版本或平台类型快照。

### 配置与发布页

删除平台规则导航、路由、预取、页面、组件、请求和测试。平台配置页继续管理平台身份、类型、域名、品牌信息和独立 Prompt。

发布列表、详情和修复页从任务的 `platform_profile_id` 读取平台；不显示规则版本。

## 迁移

新增单一前向 Alembic 迁移，旧迁移文件保持不变。顺序如下：

1. 给产品、事实版本和内容任务增加可空/带安全默认的新列。
2. 将当前结构化工作区和每个 `FactVersion.snapshot_json` 用迁移文件内冻结的确定性渲染器转换成 Markdown。章节和记录按固定顺序输出，只写数据库已有值；无数据时工作区和旧事实版本保持空正文，旧空版本只供历史引用且不能创建新任务。
3. 分级取现有证据分级中的最高限制级；没有可确定分级时使用 `RESTRICTED`，绝不推断为 `PUBLIC`。
4. 通过 `content_tasks.platform_profile_version_id -> platform_profile_versions.platform_profile_id` 回填任务平台；任一任务无法唯一回填则迁移失败。
5. 更新依赖任务平台的当前触发器、约束和索引，并把新列设为非空。
6. 删除任务旧字段、结构化事实表和平台规则版本表。
7. 保持 `migration_schema_v1.py` 与全部历史迁移冻结；当前目标 Schema 由新迁移、运行时 ORM 和数据库契约共同表达。

迁移部署前必须备份 PostgreSQL。该迁移包含有意的数据形态收敛和删表，自动 downgrade 不尝试重建已删除的结构化关系与规则版本；downgrade 应明确失败并要求从备份恢复，避免制造伪造数据。

## 文档与审计历史

- OpenAPI 是 API 唯一权威，更新后生成 `frontend/src/shared/api/schema.d.ts`。
- `contracts/database.md` 记录新字段、外键、状态与迁移边界。
- 三份架构/GEO 文档改为 Markdown 事实、直接平台任务、双首稿和严格两消息流。
- `.trellis/spec/backend/ai-configuration-guidelines.md`、数据库规范及相关前端规范只记录最终稳定约束。
- 已有平台规则审计记录允许继续按历史动作名称显示，但系统不再产生新的平台规则审计记录。

## 风险与控制

- **删表不可逆**：部署前备份，迁移内逐项计数和非空断言，失败即回滚事务。
- **旧事实转换失真**：只做固定顺序文本渲染，不总结、不归并、不猜测；迁移测试覆盖代表性 JSON 和空数据。
- **消息被无意改写**：在适配器边界测试完整 `messages` 数组逐字相等，而不是只测试快照。
- **手动内容绕过审核**：手动入口只创建 `DRAFT`，发布仍只接受唯一批准版本。
- **历史快照兼容扩散**：旧类型仅用于读取，迁移前确保没有未结束旧作业，创建和重试入口只接受 v2。

## 不采用的方案

- 不新增 `FactDocument`、知识库、任务模式枚举或手工文章表。
- 不把模型永久保存到内容任务。
- 不把规则内容搬到另一张配置表或 Prompt 前缀。
- 不保留隐藏的 PlatformRules 页面、兼容请求字段、规则默认值或从历史快照恢复规则的分支。
- 不解析 Markdown 来重建参数、证据或密级。
- 不为外部网页版模型建立自动化接入。
