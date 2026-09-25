# A08 AI 渠道 Basic/Request 工作区

## Goal

验收 `/settings/ai/$channelId` 的 Basic/Request 工作区、secret/header 生命周期、完整配置 PATCH 与 revision 冲突恢复。

## Requirements

- 前置 A07/F06 已按本轮证据完成；权威为 `docs/frontend-v2/05-business-actions-state-and-api-contract.md` AI Channel Workspace 合同、`08-testing-quality-and-acceptance.md`、`11-frontend-redevelopment-task-list.md` A08 与 OpenAPI。
- Basic 与 Request 共用一个草稿和当前 channel revision；离开到 Models/Usage/Logs 由 DirtyGuard 保护。配置 PATCH 必须完整、replacement-only，并保留另一表面字段。
- API Key 与 Header 的明文只存在私有 Dialog form/当前请求，不进入 Query/Mutation cache、URL、DOM、错误或 trace；关闭、成功、失败与卸载均清理，迟到响应不得回写。
- 409 保留草稿、请求 ID 和动作冻结；只有当前 exact Detail 显式成功 reload 才恢复。reload 失败即使有旧缓存也不得清除冲突或推进草稿 baseline。
- 服务端权限、secret 不回显、Header replacement/remove、消费者失效和未知投影均保持显式失败语义。

## Acceptance Criteria

- [x] model/page/API 直接测试覆盖 pending secret cache、卸载、失败 reload、跨 Dialog baseline、409 freeze、Header replacement/remove 与权限边界。
- [x] 当前 production artifact 严格 fixture 在 mobile/desktop 覆盖 Basic/Request URL、DirtyGuard、secret/header 交错、409 失败/成功 reload 和无敏感值产物。
- [x] 记录实际代码、PostgreSQL/浏览器/类型检查证据、独立复核、残余风险及 A09/A10 后继；检查实际 diff/工作树。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- 本任务为复杂状态交付，设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- `frontend/src/domains/configuration/ai-channel-workspace-page.tsx` 将 API Key/Header replacement 改为 Dialog 私有 async 请求与同步 pending 锁，secret 不进入 MutationCache；成功、失败、关闭和卸载均清理表单。Detail reload 检查真实错误；dirty 配置时 secret reload 不推进旧草稿 baseline；写入成功但 canonical handoff 失败时由父页面展示可重试 Notice，重试只刷新缓存，不重发 secret。
- `ai-channel-workspace-page.test.tsx` 直接回归 **18/18**：pending/卸载 sentinel、409 后 503 保持冻结、dirty baseline、Header/Key 失败清理，以及 deferred C5→C6 consumer refresh 期间 detail 始终保持新 revision。`backend/tests/integration/test_ai_channel_management.py` **8/8**；当前 production artifact `frontend/tests/e2e/ai-channel-workspace-core.spec.ts` mobile/desktop **8/8**；`npm run typecheck`、所属 ESLint、`git diff --check` 通过。
- 独立高风险复核推动修复三层 handoff 交错：已关闭 Dialog 的交接错误改为页面 Notice；所有 canonical adoption 同步推进 epoch；Notice 重试只刷新消费者、不再写旧 canonical 或重发 secret。最终复核未发现阻断。Header deferred 复用同一私有生命周期，未另建重复 fixture。下一步为 A09 Models 与 A10 Usage/Logs。
