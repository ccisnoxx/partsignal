# S01 用户管理

## Goal

验收 `/system/users` 的 ADMIN-only 视图、用户生命周期命令、revision-bound 批量选择与临时密码保护。

## Requirements

- 前置 F03/F05 已按本轮证据完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` §8.1、`05-business-actions-state-and-api-contract.md` 对应 Users 合同、`08-testing-quality-and-acceptance.md`、`11-frontend-redevelopment-task-list.md` S01、OpenAPI。
- 列表由服务端 projection、URL 筛选分页和全局 summary 驱动；ADMIN-only 前端路由及后端最终权限均成立。
- 创建、编辑、reset、启停、删除遵守各自 revision 与服务端 actions/blockers；删除 409 只由显式成功 reload 解冻。bulk confirmation 必须绑定当前查询范围、选择、目标存在性与 revision；200 partial 逐项反馈，顶层失败保留选择。
- 创建/reset 临时密码只在私有 form 与当前请求，Dialog 卸载后不得留在 Query/Mutation cache、DOM、URL 或 artifact。当前管理员状态/权限变化后，auth 同步不能被 Users list 刷新挂起阻塞。

## Acceptance Criteria

- [x] backend/PostgreSQL 与 model/page/API 直接测试证明权限、projection、revision、bulk partial、密码生命周期及当前 actor auth 同步。
- [x] 当前 production artifact 严格 fixture 在 mobile/desktop 覆盖 URL、命令、失败、选择漂移、响应式与敏感值边界。
- [x] 记录实际代码、当前证据、独立复核、残余风险及 S02 后继；检查实际 diff/工作树。

## Notes

- 只读审计已确认 pending create/reset 离开页后的 MutationCache 密码残留、bulk Dialog 旧目标越界及 actor auth refresh 被列表读取阻塞。历史 V2 门禁不算本轮结果。

## 本轮实施与验证证据

- `frontend/src/domains/identity/user-list-page.tsx` 将 create/reset 密码改为 Dialog 私有请求状态；创建/重置成功后若 Dialog 已卸载仍失效 Users lists，但不回写 UI。删除 409 以 User ID 分别冻结，只有该目标 exact list 成功显式 reload 才解冻。bulk confirmation 绑定 scope、选择代次与 revision，迟到响应不清掉新选择；actor auth refresh 与 Users list invalidation 并行。
- 直接 model/page 回归 **31/31**；`backend/tests/integration/test_identity_management.py` **14/14**；当前 production artifact 严格浏览器 `frontend/tests/e2e/system-users.spec.ts` mobile/desktop **16/16**。`npm run typecheck`、所属 ESLint、`git diff --check` 通过。
- 独立高风险复核确认 per-ID 409 hold、卸载后 list invalidation、bulk scope/selection epoch 三项已修复；复核未发现阻断。残余覆盖：未对 Users 之外所有身份消费者做全局 secret 审计；S02/S03 继续覆盖系统审计与真实闭环。
