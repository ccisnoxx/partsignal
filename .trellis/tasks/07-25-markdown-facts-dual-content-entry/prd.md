# 简化产品事实与双模式内容任务

## 目标

把产品事实从参考型号、参数、证据、替代关系和声明组成的结构化图谱，收敛为每个产品唯一的一份可编辑 Markdown 工作区及其不可变审核版本；内容任务以批准事实原文和平台 Prompt 原文构造严格的两消息 AI 请求，同时允许用户不经过系统 AI、直接录入首个人工 Markdown 草稿。两种首稿进入同一内容审核、人工发布和验证历史。

用户价值：

- 数据手册的 AI 总结在系统外完成，系统只负责维护已经总结好的 Markdown 事实。
- 系统内 AI、网页版豆包、网页版 DeepSeek、系统外 GPT API 和人工撰写都能进入同一内容版本与发布闭环。
- 发送给模型的内容可逐字核对，不存在隐藏前缀、任务字段拼接或事实 JSON 包装。

## 背景与已确认事实

- 当前产品事实契约是结构化图谱，`ProductFactsBody` 包含 `reference_parts`、`parameters`、`replacement_relations`、`evidences` 和 `claims`，没有 Markdown 正文字段。
- 当前 `ContentTask` 保存受众、内容角度、转化目标、格式、长度、官网 URL、任务级 `user_prompt_markdown` 及其数据分级。
- 当前生成请求在平台 Prompt 前追加固定系统契约，并把工程师输入、批准事实 JSON 和任务要求 JSON 拼成用户消息。
- 当前人工修订只能基于已有 `ContentVersion` 创建，空任务不能直接创建首个人工版本。
- `ContentVersion`、内容审核、人工发布记录、发布状态事件和内容哈希已经提供可复用的不可变历史。
- 用户已确认平台 Prompt 将自行包含安全、输出格式、受众、角度、长度等全部要求；管理员误删必要规则导致新作业失败是接受的产品行为。
- 用户已确认删除整套 `PlatformProfileVersion / PlatformRules`；内容任务改为直接绑定稳定的 `PlatformProfile`。

## 需求

### R1：Markdown 产品事实

- 每个产品只有一份当前可编辑事实 Markdown 工作区，不新增多文档知识库或独立 `FactDocument` 层。
- 工作区保存 `body_markdown` 原文、明确数据分级和乐观锁修订号；新产品可以是尚未录入的空初态，但保存命令和新事实版本必须拒绝空白正文。
- 事实版本冻结 Markdown 原文、数据分级、版本号、变更说明、审核状态和创建/批准信息。
- 只有 `APPROVED` 事实版本可以创建内容任务；只有明确分级为 `PUBLIC` 的批准事实版本可以创建第三方 AI 作业。
- 已批准事实版本不可原地修改，工作区修改后必须创建新版本。
- 新事实工作区、事实版本、审核上下文和前端页面不再维护参考型号、参数、证据、替代关系或声明。

### R2：严格 AI 消息契约

- 新原始生成作业只发送两条消息：
  - `system.content` 逐字等于任务所选平台当前 `PlatformPrompt.template_markdown`。
  - `user.content` 逐字等于任务绑定 `FactVersion.body_markdown`。
- 除检查去除空白后是否为空外，发送前不得 `trim`、添加前后缀、插入标题、序列化 JSON、补充产品信息、追加任务要求或格式化原文。
- 系统不得再追加固定安全契约；安全、输出结构和平台规范全部由平台 Prompt 自身负责。
- 平台 Prompt 缺失时拒绝创建新 AI 作业；模型响应不符合严格四字段文章 JSON 时作业显式 `FAILED`，不得修复、补值、切换 Prompt、切换模型或回退开发生成器。
- 生成快照继续冻结渠道非敏感配置、模型、参数、平台身份、事实版本身份、两条消息原文和哈希；追溯元数据不得进入模型消息。
- Prompt 或事实后续变化不得改写历史作业快照；新契约作业的重试继续复制原快照，旧契约历史作业不允许新建重试。

### R3：精简内容任务

- 新内容任务不再接收或保存 `target_audience`、`content_angle`、`conversion_goal`、`desired_format`、`desired_length_min`、`desired_length_max`、`canonical_url`、任务级 `user_prompt_markdown` 或任务级生成数据分级。
- 新内容任务请求只接收 `product_id`、`fact_version_id` 和 `platform_profile_id`；GEO 修复来源等服务端内部关联不成为人工创建字段。
- 删除 `PlatformProfileVersion` 数据表、ORM、Schema、服务、接口、路由、导航和前端页面，不保留停用入口、兼容请求字段或第二套平台规则读取路径。
- 删除任务的 `platform_profile_version_id`、`platform_type_id` 和 `platform_type_snapshot`；平台身份由 `platform_profile_id` 唯一持有，平台类型通过当前 `PlatformProfile` 关联读取。
- 保留 `PlatformProfile`、`PlatformPrompt` 和 `PlatformProfile.allowed_domains`：平台身份负责任务与发布归属，平台 Prompt 负责 AI system message，允许域名负责人工发布 URL 校验。
- AI 模型属于一次 `GenerationJob`，不成为内容任务的永久字段；用户可以对同一开放任务选择不同模型创建不同作业。
- 内容任务只保留 `OPEN / COMPLETED / CANCELLED` 宏观生命周期；生成、审核和发布进度继续从作业、内容版本与发布记录推导。
- 新建任务时不得因为平台缺少 Prompt 而阻断手动首稿；平台 Prompt 门禁只属于 AI 作业创建。

### R4：双首稿入口

- 内容任务详情并列提供可按次选择的“系统 AI 生成”和“手动录入”入口，不创建两套任务表或永久任务类型。
- 系统 AI 生成要求可用模型、非空平台 Prompt和 `PUBLIC` 批准事实，并创建真实 `GenerationJob`。
- 手动录入要求用户明确填写标题、摘要、Markdown 正文、标签和变更说明，直接创建：
  - `source_type = HUMAN`
  - `source_job_id = null`
  - `based_on_id = null`
  - `status = DRAFT`
- 手动首稿不得创建虚假生成作业，不计入 AI 成功率、耗时或 Token 指标。
- 网页版模型或系统外 API 产生的正文由用户粘贴后按手动录入处理；本任务不接入或自动化这些外部网页。
- 手动首稿的后续人工修订必须继续可用，不得要求内容链上存在 AI 生成快照。

### R5：统一审核和发布

- AI 草稿和手动首稿使用同一 `ContentVersion`、提交审核、批准、退回、版本替代、发布候选和人工发布流程。
- 每个内容版本继续绑定任务所选不可变事实版本；每个任务最多一个 `APPROVED` 内容版本。
- 内容审核上下文允许 `generation_trace = null`，但必须展示冻结事实 Markdown、内容差异、质量问题和审核历史。
- 人工发布继续只接受批准内容，保留平台账号匹配、允许域名、最终 URL、内容哈希、幂等键、状态事件和发布验证。

### R6：确定性质量与失败边界

- 删除依赖已移除任务字段或结构化事实图谱的受众、角度、长度、禁用表达和参数数字来源检查。
- 保留不依赖猜测的结构检查：严格文章 JSON、标题/摘要/正文非空、Markdown 正文唯一来源、内容哈希、审核状态和发布域名。
- 不为事实 Markdown 新建模糊解析器，不从正文猜测参数、单位、来源或密级。
- 外部输入、Markdown 预览、URL、权限、CSRF、幂等和 AI 出站安全边界继续由现有服务端规则控制。

### R7：契约、迁移和文档一致性

- `contracts/openapi.yaml`、`contracts/database.md`、后端运行时 Schema、前端生成类型、迁移和测试必须在同一任务中更新。
- 迁移不得调用 AI 总结旧结构化事实，也不得把未知数据或密级猜为 `PUBLIC`。
- 既有不可变内容、生成快照、审核、发布和 GEO 历史不得被重写或删除。
- 旧结构化事实工作区和事实版本需要一次性转换为可读、确定性的 Markdown；转换只能渲染已有字段，不补充未知事实。缺少可确定公开分级的旧数据必须采用禁止第三方发送的安全分级。
- 没有任何可渲染事实的旧版本保留为空 Markdown 和安全分级，只供历史引用；它不能创建新内容任务或 AI 作业。
- 既有任务的 `platform_profile_id` 必须在删除规则版本表前由原规则版本外键确定性回填；不可回填时迁移必须失败。
- 既有生成快照允许保留只读的旧规则元数据以维持审计历史，但新建、重试、审核、发布和修复流程不得再从中恢复或使用平台规则。
- 更新 `docs/architecture.md`、`docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md`，删除与新实现冲突的结构化事实和任务输入说明。

## 验收标准

- [ ] AC1：产品事实页面只展示 Markdown 编辑、预览、分级、修订状态和事实版本；页面及新契约不再出现参考型号、证据、参数、替代关系和声明编辑字段。
- [ ] AC2：保存事实工作区保持原始 Markdown，使用 `expected_revision` 拒绝并发覆盖；空白正文不能创建事实版本。
- [ ] AC3：批准事实版本冻结 Markdown 原文和分级，后续工作区编辑不改变版本内容。
- [ ] AC4：新建内容任务请求只提交 `product_id`、`fact_version_id` 和 `platform_profile_id`，不提交受众、角度、转化、格式、长度、官网 URL、任务 Prompt、任务分级或规则版本字段。
- [ ] AC5：手动模式可以在没有平台 Prompt、没有可用模型和没有既有内容版本时创建首个 `HUMAN DRAFT`。
- [ ] AC6：AI 模式实际 HTTP 请求只有一条 system 和一条 user 消息；两条 `content` 分别与数据库中的平台 Prompt 和冻结事实 Markdown逐字相等。
- [ ] AC7：AI 作业创建时缺少平台 Prompt、事实非 `PUBLIC`、模型不可用或响应格式错误均明确失败，且不产生内容版本或替代调用。
- [ ] AC8：作业详情快照能追溯模型、平台、事实版本、精确消息和哈希；修改当前 Prompt 或事实工作区后旧快照保持不变。
- [ ] AC9：手动首稿可以继续创建人工修订、提交审核、批准并进入人工发布；审核上下文不要求 AI lineage。
- [ ] AC10：AI 与手动来源内容都受同一“每任务唯一批准版本”和发布门禁约束。
- [ ] AC11：旧事实数据的迁移结果只包含原有字段的确定性 Markdown 表达，未知分级不会变成 `PUBLIC`，历史内容/作业/发布引用保持有效。
- [ ] AC12：契约检查、后端目标单元/集成测试、迁移测试、前端目标测试和核心 Playwright 主流程通过。
- [ ] AC13：`PlatformProfileVersion / PlatformRules` 的表、运行时类型、接口、导航、页面和新业务引用全部删除；内容任务、发布修复和查询统一使用 `platform_profile_id`。
- [ ] AC14：权威数据库、API、架构和两份 GEO 方案文档与最终实现一致，不保留旧结构化事实、任务 Prompt 或平台规则作为第二权威来源。

## 范围外

- 在系统内上传数据手册并调用 AI 总结产品事实。
- 集成或自动操作网页版豆包、DeepSeek、ChatGPT 等网站。
- 自动修复平台 Prompt、模型返回 JSON 或文章正文。
- 自动选择、切换或回退 AI 模型。
- 自动发布到外部平台。
- 多产品批量生成、Prompt 模板语言或通用工作流编排。
- 新增角色系统、强制审核职责分离或另一套内容版本模型。
