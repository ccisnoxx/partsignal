# A04 平台分类

## Goal

验收 `/settings/platforms/types` 分类表、引用数量、命令与服务端阻断原因。

## Requirements

- 前置 A01 已按本轮证据完成；权威为平台分类合同、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A04 与 OpenAPI。
- 页面不新增一级导航；列表消费服务端 projection 与引用计数。创建/编辑/删除使用 revision 与 blocker，删除阻断显式展示原因，未知 action/错误不猜测。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖 projection、引用计数、权限、revision、阻断删除与失败。
- [x] 当前 production artifact 严格 fixture mobile/desktop 覆盖 URL、命令、确认、错误与焦点。
- [x] 记录实际代码、独立复核、残余风险及 A11 后继；检查实际 diff/工作树。

## 本轮实施与验证证据

- `frontend/src/domains/configuration/platform-types-page.tsx` 在 POST/PATCH 成功后立即 upsert canonical 并关闭 Editor；DELETE 成功先移除 exact Types cache 并关闭 Dialog。Types/Platform lists/details 刷新异步执行，失败只显示可重试 Notice，attempt token 防止旧结果覆盖，重试不重发命令。
- DELETE 409 由页面 `Map<Type ID, PlatformRequestError>` 持有；关闭重开、被动 projection 与另一 Type 冲突都不解除。成功 exact reload/DELETE/目标消失只清对应 ID。直接回归 **13/13**；PostgreSQL `test_platform_types.py` **7/7**；当前 production artifact `platform-types.spec.ts` mobile/desktop **12/12**；`npm run typecheck`、owned ESLint、`git diff --check` 通过。
- 独立高风险复核确认成功交接和 per-ID hold 无阻断。覆盖缺口是双 ID 用例未额外验证“成功删除 A 后 B hold 仍在”；源码按 ID 清理且现有 reload A/B 回归覆盖核心隔离。下一步 A11 收口 Configuration 真实闭环。

## Notes

- 设计与实施顺序见同目录 `design.md`、`implement.md`。
