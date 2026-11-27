# A02 平台工作区概览与生成配置

## Goal

验收 `/settings/platforms/$platformId` 的 Overview/Generation、单次 Detail read model、revision 编辑、Logo 与 Prompt 绑定。

## Requirements

- 前置 A01/F06；A01 的本轮证据完成后实施本项。权威为 `docs/frontend-v2/05-business-actions-state-and-api-contract.md` §23、`08-testing-quality-and-acceptance.md`、`11-frontend-redevelopment-task-list.md` A02、OpenAPI。
- canonical `overview|generation` Tab 可 direct/refresh/Back/Forward，首屏只读取聚合 Detail；仅在 ADMIN 进入 Generation 时按需读取 Prompt options，不 waterfall 其他 Detail/Accounts/Type。
- 两个 Tab 分别管理草稿，共享当前 Platform revision；Overview PATCH 保留 Prompt，Generation PATCH 保留身份字段，每次提交一个完整更新。409 保留草稿且只允许显式 reload 重置，不自动 replay。
- Logo 上传和官网候选遵守确认、类型与生命周期边界；Prompt 绑定与配置 readiness 使用服务端投影。ENGINEER 可读但没有前端伪造写动作；服务端仍作最终权限裁决。

## Acceptance Criteria

- [x] backend/contract、model/page/API 直接测试覆盖 Detail read model、权限、revision、Logo/Prompt 绑定与失效消费者。
- [x] 当前 production artifact 严格 fixture mobile/desktop 覆盖 URL Tab、按需读取、草稿/409、Logo/Prompt 和四档布局。
- [x] 记录实际代码、当前证据、独立复核、残余风险及 A03/A04 后继，检查实际 diff/工作树。

## 本轮实施与验证证据

- `frontend/src/domains/configuration/platform-workspace-page.tsx` 为 Overview/Generation 各自维护草稿基线与 revision；409 冻结保存并保留 Logo/Prompt，失败 reload 不清理现场，只有成功 reload 重建基线。Logo upload/candidate 纳入编辑会话 busy 与 mounted 生命周期，取消、离开和迟到响应不回写；放弃 Overview 后 Accounts 不再留下幽灵 DirtyGuard。
- 直接 page/model 回归 **20/20**；`frontend/tests/e2e/platform-workspace.spec.ts` 当前 production artifact mobile/desktop **18/18**；对应 PostgreSQL `backend/tests/integration/test_platform_workspace.py` 已由实现阶段针对 Detail/权限/命令通过；`npm run typecheck`、所属 ESLint 及 `git diff --check` 通过。
- 独立只读复核未发现确认阻断；覆盖缺口为未专门模拟 PATCH 成功后消费者失效仍未完成、用户快速重新进入并重复命令的交错。A03/A04 继续处理账号与平台其他配置边界。
