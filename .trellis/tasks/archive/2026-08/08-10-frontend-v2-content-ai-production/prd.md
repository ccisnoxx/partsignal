# Frontend V2 Content AI Production

## 目标

在 Editor Core 稳定后，独立交付 AI generation、进度/失败、exact snapshot retry 和 humanization，不修改人工编辑合同或把 AI DRAFT 变成可原地编辑对象。

## 前置条件

- `frontend-v2-content-editor-core` 已合并并提供稳定 Editor Context、action matrix 和 content query keys。

## 范围内

- `generation-options` 只在用户打开生成或 humanization 界面时加载。
- 生成前完整展示只读 Prompt 名称、revision 和 Markdown；模型不得默认选中，用户明确选择并确认后才能创建作业。
- create generation、retry 和 humanization 使用与精确命令输入绑定的稳定 `Idempotency-Key`；网络结果不确定时复用原 key，命令输入改变后才生成新 key。
- AI surface 只对当前跟踪作业的 `PENDING/RUNNING` 状态轮询 summary；进入 `SUCCEEDED/FAILED` 后停止轮询并 refetch Editor Context。
- 展示 generation/humanization 的 progress、success 和 failure；失败动作只消费服务端 `available_actions`。
- 完整 `GenerationJobDetail` 与 `input_snapshot` 只在用户显式查看时加载。
- retry 只提交失败 job ID 和稳定幂等键，由服务端重放原 snapshot；浏览器不得读取当前 Prompt/事实重建输入。
- `CREATE_HUMANIZATION_JOB` 驱动 humanization，并在 terminal 后通过 Editor Context 确认新 job、新 ContentVersion 和 current pointer。
- 修复单 job detail 与 retry command 对“最新失败作业”资格判断不一致的问题。
- 扩展 typed fixture、组件测试，并在既有隔离 E2E orchestration 内增加独立 AI real-stack 流程。

## 范围外

- Core 人工编辑 payload 或不可变规则重构。
- Content Review、Publication、History、SSE/WebSocket 或通用 workflow/job framework。
- 浏览器 snapshot 拼装、固定成功 fallback、第二套 real-stack orchestration 或 V1 重构。
- 新依赖、OpenAPI shape 或数据库 schema 变更；只有现有能力无法满足且另获批准时才重新评估。

## 验收标准

- [x] AI DRAFT 保持不可变，成功后 current 只由服务端 pointer 确认。
- [x] retry 重放原 snapshot，不读取当前 Prompt/事实替换历史输入。
- [x] humanization 创建新 GenerationJob 和新版本，源版本不变。
- [x] options/detail 保持按需；模型明确选择，Prompt identity 和 Markdown 在确认前可见。
- [x] 相同命令的不确定重试复用 `Idempotency-Key`，不同输入不复用。
- [x] 只有当前跟踪的活动 job 轮询；terminal 后停止并 refetch Editor Context。
- [x] 非最新或不满足服务端资格的失败 job 不提供且不能执行 retry。
- [x] success、failure、exact retry、humanization fixture 与独立 AI real-stack 有直接测试证据。
- [x] Editor Core 的人工首稿、修订、保存、提交、删除和 abandon 回归保持通过。
