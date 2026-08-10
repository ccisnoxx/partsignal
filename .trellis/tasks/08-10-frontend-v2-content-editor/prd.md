# Frontend V2 Content Editor

## 目标

在 `/content/tasks/$taskId/editor` 建立以 `ContentTask.current_content_version_id` 为唯一主线的 Content Editor vertical slice，并把同步人工编辑与异步 AI 生产拆成两个可独立 review、验证和回滚的子任务。

## 已确认事实

- 现有 Task Detail、Review Context、版本列表和作业列表无法用一次一致快照绘制 Editor；V1 依赖请求 waterfall 和客户端 join，不能复制。
- 当前内容只能由 `current_content_version_id` 确定，历史版本、AI 版本、已审核版本和 `CHANGES_REQUESTED` 版本不可原地编辑。
- 只有当前、未审核、无下游引用且服务端返回 `SAVE` 的 HUMAN DRAFT 可以 PUT 保存。
- 完整范围同时跨越合同、backend projection、同步表单、异步作业、retry/humanization、fixture 与多条 real-stack 流程，单 PR 不具备稳定 review 边界。

## 子任务与顺序

1. `frontend-v2-content-editor-core`
   - Editor Context、人工首稿、revision、HUMAN DRAFT save、preview/diff、submit、delete/abandon、Workspace 和 Human real-stack。
2. `frontend-v2-content-ai-production`
   - generation options、AI generation、progress/failure、exact snapshot retry、humanization 和 AI real-stack。

第二个子任务依赖 Core 的 Editor Context、action matrix 和 query key 稳定后开始。父任务不直接承载产品代码。

## 跨任务约束

- 服务端 action token 决定页面动作资格，前端不得按 status、版本排序或历史集合重建流程。
- V1 继续可运行；新合同优先 additive，不增加兼容 wrapper 或第二套 projection。
- 不新增依赖、全局 editor store、通用 Editor/workflow framework、repository 或 command bus。
- Content Review、Version Detail、Publication、History 不属于本父任务。

## 集成验收

- [ ] Core 和 AI Production 分别通过各自 required validation 并独立归档。
- [ ] OpenAPI、生成类型、backend projection、V2 页面、fixture、real-stack 与权威文档一致。
- [ ] current pointer、不可变边界、revision conflict、action token 和 V1 兼容均有直接测试证据。
- [ ] 父任务最终自审未夹带 Review、Publication 或通用框架。
