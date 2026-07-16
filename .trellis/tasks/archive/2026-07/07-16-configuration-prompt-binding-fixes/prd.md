# 配置中心模型筛选与 Prompt 绑定修复

## 目标

修复配置中心中“已启用模型”展示失真、Prompt 删除语义不清和页面悬浮层遮挡三个问题，使管理员看到的数据与真实启用状态一致，并能按“平台类型 → 平台 → 当前 Prompt”关系独立管理配置。

## 用户反馈

- AI 渠道只启用了一个模型，但渠道卡片的“已启用模型”显示了该渠道所有可添加模型。
- Prompt 管理以平台为固定行展示；删除 Prompt 后该行仅变为“未配置 Prompt”，不符合独立管理 Prompt 的预期。
- 期望平台类型、平台和 Prompt 分别管理：平台表单下拉选择所属类型，Prompt 表单下拉选择所属平台，整体关系仍为“平台类型 → 平台 → 当前 Prompt”。
- 页面中的“事实可信 · 人工审核 · 历史可溯”悬浮层会遮挡 Prompt 管理内容。

## 已确认现状

- 后端渠道投影已经只收集 `AIModel.is_enabled=true` 的模型（`backend/app/routers/configuration.py:111`、`backend/app/routers/configuration.py:131`）。模型启停成功后，前端只失效模型列表缓存，没有失效渠道详情和渠道列表缓存（`frontend/src/features/configuration/AIChannelDetailPage.tsx:126`、`frontend/src/features/configuration/AIChannelDetailPage.tsx:131`）；渠道卡片因此可能继续显示旧的 `enabled_models`。
- 获取模型只返回供应商发现结果，单个发现模型必须经创建接口写入本地配置，且新模型默认未启用（`backend/app/routers/configuration.py:491`、`backend/app/services/ai_configuration.py:234`、`backend/app/models/ai_generation.py:104`）。发现结果与渠道摘要没有共用存储。
- `platform_prompts` 已经是独立表，每个平台最多一行，删除服务会真实执行 `DELETE`（`backend/app/models/configuration.py:58`、`backend/app/services/platform_configuration.py:161`）。当前 Prompt 页面却以全部平台作为表格数据源，所以删除后平台行仍在，仅由 `prompt_configured=false` 显示为“未配置 Prompt”（`frontend/src/features/configuration/PlatformPromptsPage.tsx:23`、`frontend/src/features/configuration/PlatformPromptsPage.tsx:28`）。
- 平台创建和编辑表单已经通过下拉框选择所属平台类型（`frontend/src/features/configuration/PlatformsPage.tsx:52`、`frontend/src/features/configuration/PlatformsPage.tsx:57`）。
- 信任说明条位于侧栏底部并使用绝对定位，菜单没有为它预留可滚动空间；配置中心子菜单展开后会进入相同区域（`frontend/src/app/AppLayout.tsx:112`、`frontend/src/styles/global.css:26`、`frontend/src/styles/global.css:32`）。

## 需求

### R1 已启用模型

- 渠道卡片只显示该渠道中实际已启用的已配置模型，不显示仅由 `/models` 发现但尚未添加或未启用的模型。
- 模型发现列表、已配置模型列表和已启用模型摘要必须保持清晰边界。
- 模型新增、测试、编辑、启用、停用或删除后，所有展示受影响模型摘要的渠道缓存必须同步失效。

### R2 配置关系与管理页面

- 配置中心继续保留三个并列页面：`平台类型`、`平台管理`、`Prompt 管理`。
- 平台表单通过下拉框选择一个所属平台类型。
- Prompt 表单通过下拉框选择一个所属平台。
- 一个具体平台同一时刻最多有一个当前 Prompt；工程师只使用该平台当前 Prompt 创建生成作业。
- Prompt 只归属于一个具体平台，不允许跨平台复用，不建设独立 Prompt 库或多平台绑定表。
- Prompt 管理应以真实存在的 Prompt 记录为主体；物理删除后该 Prompt 从列表消失，不保留伪装成 Prompt 记录的“未配置”占位行。
- 删除 Prompt 后平台本身保留，但因没有当前 Prompt 而不能供工程师创建内容任务，直到管理员重新配置。
- 新建 Prompt 时，管理员从尚未配置 Prompt 的平台下拉列表中选择所属平台；编辑既有 Prompt 时不改变所属平台。

### R3 页面层级

- “事实可信 · 人工审核 · 历史可溯”不得覆盖配置中心内容、下拉菜单、弹窗或抽屉。
- 直接从桌面侧栏移除“事实可信 · 人工审核 · 历史可溯”说明及其专用样式，不保留悬浮占位。
- 不得通过新增页面专属高 `z-index` 形成层级竞赛。

## 验收标准

- [ ] 渠道卡片展示的模型集合与数据库中该渠道 `is_enabled=true` 的模型完全一致。
- [ ] 发现但未添加、已添加但停用的模型均不会出现在“已启用模型”区域。
- [ ] 平台类型、平台和 Prompt 分别在三个页面管理，平台和 Prompt 表单使用明确的所属关系下拉框。
- [ ] Prompt 物理删除后对应记录从 Prompt 列表消失，平台保留并变为工程师不可用；重新配置后恢复可用。
- [ ] 页面内容、下拉菜单、确认框和编辑界面不再被信任说明条遮挡，桌面端、移动端及浅/深色主题均正常。
- [ ] 回归测试确认后端启用模型投影边界保持有效，并覆盖前端查询缓存和关键交互；不改变 OpenAI-compatible 调用协议或作业级 Prompt 快照规则。

## 非目标

- 不修改模型发现、模型测试或 Chat Completions 协议。
- 不改变生成作业已锁定 Prompt 快照的历史语义。
- 不新增 Prompt 名称、共享 Prompt 库、多平台绑定表或 Prompt 版本系统。
- 不借层级修复重做整个应用布局或引入新的样式框架。
