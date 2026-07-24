# 修复未配置自然化 Prompt 的控制台 404

## Goal

全局自然化 Prompt 尚未配置是合法的首次使用状态。管理员打开
`/configuration/prompts?tab=humanization` 时，页面应继续提供明确、可编辑的空状态，
同时不得产生预期资源 404 或浏览器控制台错误。

## Confirmed facts

- 2026-07-24 对真实部署 `https://geo.962850.xyz` 做只读验收时，管理员在桌面与移动端均可进入全局自然化 Prompt 工作区。
- 当前数据库未配置全局自然化 Prompt；页面正确显示“尚未配置 Prompt；首次保存后才可用于新生成作业。”和“自然化 Prompt Markdown”输入框。
- `GET /api/v1/content-humanization-prompt` 稳定返回 `404`，Chrome 控制台同步记录
  `Failed to load resource: the server responded with a status of 404`；全页面直达与页内 Tab 切换均可复现。
- 后端 `backend/app/routers/configuration.py:get_content_humanization_prompt`、权威契约
  `contracts/openapi.yaml` 和集成测试均把未配置状态定义为 404。
- 前端 `frontend/src/features/configuration/PlatformPromptsPage.tsx` 把该 404 转换为合法空状态，
  所以业务界面可用，但浏览器网络层仍记录错误。
- 数据库单例、无种子值和首次显式创建约束仍以 `contracts/database.md` 为准，本任务不改变这些业务事实。

## Requirements

### R1 — 合法未配置状态不得污染控制台

管理员读取尚未配置的全局自然化 Prompt 时，API 必须使用成功类的无内容结果表达“当前无记录”，
浏览器不得产生资源错误、`console.error` 或 `pageerror`。

### R2 — 空状态和首次保存流程保持不变

前端必须继续显示现有未配置说明、空编辑器和“首次保存”流程；不得创建默认 Prompt、自动保存、
猜测内容或引入第二个 Prompt 来源。

### R3 — 既有权限与并发契约保持不变

- 非管理员读取仍返回 403。
- 已配置时读取仍返回 200 和完整 `ContentHumanizationPrompt`。
- 首次创建、修订更新、空白校验、CSRF、审计记录和 `expected_revision` 冲突行为保持不变。
- 真正的网络、权限、服务端和契约错误仍必须显式进入现有失败反馈，不得全局吞错或增加控制台 allowlist。

### R4 — 契约、生成类型和测试同步

`contracts/openapi.yaml` 是 API 唯一事实源；后端实现、生成的
`frontend/src/shared/api/schema.d.ts`、前端消费逻辑、集成测试和 E2E 契约必须同步。

## Acceptance Criteria

- [ ] AC1：管理员在无记录数据库中调用 `GET /api/v1/content-humanization-prompt` 得到 204 且响应体为空。
- [ ] AC2：管理员在有记录数据库中调用同一接口仍得到 200 和当前 Prompt；非管理员仍得到 403。
- [ ] AC3：未配置时打开全局自然化 Prompt Tab，现有空状态、可编辑输入框和“首次保存”语义完整保留。
- [ ] AC4：上述未配置浏览器流程没有 `console.error`、`pageerror` 或失败请求；测试不得以 Prompt 已配置为由跳过该断言。
- [ ] AC5：意外 4xx/5xx 或网络错误仍显示既有失败反馈，且不会被当作“尚未配置”。
- [ ] AC6：OpenAPI、生成 TypeScript 类型、后端实现和所有 200/204 状态判断一致，契约漂移检查通过。
- [ ] AC7：既有首次创建、更新、修订冲突、权限、CSRF、审计和 MVP 自然化流程回归通过。

## Out of scope

- 不配置或修改真实部署中的 Prompt 内容，不创建业务数据。
- 不调整 Prompt 工作区视觉、布局、字体、主题或交互文案。
- 不新增 API 包装层、错误抑制器、服务工作线程、依赖或通用“可选资源”抽象。
- 不顺带改变平台 Prompt 缺失时的 404 契约；如后续独立复现同类浏览器错误，另行评估范围。
- 不修改数据库模型、迁移、种子、审计分类或自然化业务流程。

## Blocking questions

无。任务保持 `planning`，需在最终计划获批后另行执行 `task.py start`。
