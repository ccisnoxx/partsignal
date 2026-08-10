# Frontend V2 Content AI Production

## 目标

在 Editor Core 稳定后，独立交付 AI generation、进度/失败、exact snapshot retry 和 humanization，不修改人工编辑合同或把 AI DRAFT 变成可原地编辑对象。

## 前置条件

- `frontend-v2-content-editor-core` 已合并并提供稳定 Editor Context、action matrix 和 content query keys。

## 范围内

- generation-options 按需加载与 Prompt/model 明确确认。
- 稳定 Idempotency-Key 的 create generation job。
- 仅 PENDING/RUNNING 轮询，terminal 后停止并 refetch Editor Context。
- exact GenerationJob detail/snapshot 按需读取与原 snapshot retry。
- `CREATE_HUMANIZATION_JOB` 驱动的新 job/新版本流程。
- Prompt/model/fact revalidation、success/failure/retry/humanization fixture 和独立 real-stack。

## 范围外

- Core 人工编辑重构、Content Review、Publication、History、浏览器 snapshot 拼装或固定成功 fallback。

## 验收标准

- [ ] AI DRAFT 保持不可变，成功后 current 只由服务端 pointer 确认。
- [ ] retry 重放原 snapshot，不读取当前 Prompt/事实替换历史输入。
- [ ] humanization 创建新 GenerationJob 和新版本，源版本不变。
- [ ] idempotency、terminal polling、failure 和独立 AI real-stack 有直接测试证据。
