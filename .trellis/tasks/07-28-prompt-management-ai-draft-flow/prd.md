# 优化 Prompt 管理与 AI 草稿创建

## 目标

让配置中心的 Prompt 入口和平台绑定信息更清晰、紧凑，并让用户在内容任务中明确知道何时可以创建 AI 草稿、何时被业务状态阻断以及下一步应做什么。

## 已确认事实

- 配置中心导航仍显示“平台 Prompt”，而页面标题和面包屑已使用“Prompt 管理”；入口文案不一致，见 `frontend/src/app/AppLayout.tsx:54` 与 `frontend/src/features/configuration/PlatformPromptsPage.tsx:373`。
- Prompt 详情使用带感叹号的大号 `Alert` 展示“已绑定 N 个平台”，平台名称已作为 `Tag` 放在描述区，见 `frontend/src/features/configuration/PlatformPromptsPage.tsx:458`。
- 内容任务详情已经实现“生成 AI 草稿”弹窗；弹窗读取任务级生成选项，展示只读平台 Prompt，并只列出已启用、测试通过且所属渠道已启用的模型，见 `frontend/src/features/content-tasks/ContentTasksPage.tsx:304`、`frontend/src/features/content-tasks/ContentTasksPage.tsx:543` 与 `backend/app/routers/production.py:91`。
- 创建生成作业必须提交当前 Prompt 身份和 revision；服务端会再次校验任务状态、事实版本、平台、Prompt 和模型，见 `contracts/openapi.yaml:1316`、`contracts/openapi.yaml:1343` 与 `backend/app/services/content_production.py:375`。
- 前端目前在任务非 `OPEN` 或事实分级不是 `PUBLIC` 时直接禁用生成按钮，未在按钮附近完整解释终态任务的禁用原因，见 `frontend/src/features/content-tasks/ContentTasksPage.tsx:405` 与 `frontend/src/features/content-tasks/ContentTasksPage.tsx:453`。
- 最近部署记录明确说明现有内容任务均不允许再次生成，因此线上无法打开弹窗首先是当前任务数据状态与现有门禁共同造成的，不是弹窗或接口缺失，见 `.trellis/workspace/777/journal-1.md`。
- 现有前端单元测试已验证“打开弹窗—确认 Prompt—选择模型—创建作业”链路通过；现有 E2E 脚本仍保留弹窗改造前的选择顺序，需要随本次修正更新。

## 需求

### R1 导航命名一致

- 配置中心下 `/configuration/prompts` 的导航名称改为“Prompt 管理”。
- 页面标题、面包屑、全局搜索和导航上下文保持同一名称。

### R2 平台绑定信息紧凑化

- 删除当前大号警告 `Alert` 和感叹号表达。
- 有绑定时以紧凑说明和平台名称标签展示真实绑定平台；绑定数量只作为次级信息，不抢占编辑器主层级。
- 无绑定时使用中性说明，并保留“未绑定模板可删除”的真实业务含义。
- 颜色只使用现有语义 Token 和 Ant Design 组件，不新增主题值或视觉依赖。

### R3 AI 草稿入口与阻断反馈

- 合格任务继续通过现有弹窗确认当前平台 Prompt、选择当前可用模型并创建 AI 草稿，不新增第二套生成接口或状态源。
- 任务状态、事实分级、Prompt 缺失、无可用模型和查询失败必须显示明确、可恢复的中文反馈；不得用静默禁用掩盖原因。
- 终态任务保持不可变；页面提供“新建内容任务”入口并复用现有创建弹窗，不新增重新打开状态。
- 从阻断提示创建的新任务成功后进入新任务详情；当所选事实版本满足 `PUBLIC` 门禁时，以一次性页面意图自动打开现有 AI 生成弹窗。
- Prompt 身份和 revision 仍由服务端最终校验，配置变化时必须重新加载后确认。
- 不降低 `PUBLIC` 数据出站、模型启用/测试和渠道启用门禁。

## 范围外

- 不新增 Prompt 模板版本、任务级 Prompt、默认 Prompt 或兼容回退。
- 不新增 AI 渠道、模型协议或模型自动启用逻辑。
- 不改变历史生成快照、已批准事实或内容版本。
- 不在内容任务列表复制一套生成弹窗和生成状态。
- 不新增组件库、图标库、全局 Store 或页面级主题。

## 验收标准

- [ ] 配置中心导航、页面标题和路由上下文统一显示“Prompt 管理”。
- [ ] Prompt 已绑定平台时不再显示大号感叹号警告；平台名称以紧凑标签清晰展示，浅色、深色和窄屏均不溢出。
- [ ] Prompt 未绑定平台时显示中性说明，且仍可按既有规则删除。
- [ ] 合格的 `OPEN` + `PUBLIC` 任务点击“生成 AI 草稿”后打开弹窗，展示当前平台 Prompt 和可用模型。
- [ ] 选择模型并提交后调用现有创建生成作业接口，载荷包含 `ai_model_id`、`platform_prompt_id` 和 `platform_prompt_revision`。
- [ ] 不合格任务不绕过服务端门禁，并明确展示不能生成的原因和下一步。
- [ ] 终态任务可以复用现有表单创建新任务；创建成功后进入新任务详情，满足出站门禁时自动打开现有 AI 生成弹窗。
- [ ] Prompt 缺失、没有可用模型、生成选项加载失败和 Prompt revision 变化均有可感知反馈与适用的恢复入口。
- [ ] 相关单元测试、类型检查、主题颜色守卫和目标 E2E 流程通过。

## 关键决策

- 历史任务保持不可变；`COMPLETED`、`CANCELLED` 任务不新增生成能力，也不新增重新打开状态转换。
- 新任务创建后的自动打开只是一种前端一次性导航意图，不写入 URL、全局 Store 或服务端业务状态。
- 页面只消费现有任务、事实版本、平台 Prompt 和模型契约；本任务不修改 OpenAPI、数据库或后端实现。
