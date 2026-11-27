# A10 AI 渠道 Usage/Logs tab

## Goal

验收 `/settings/ai/$channelId?tab=usage|logs` 的 URL 恢复、服务端聚合/分页与安全审计 Detail。

## Requirements

- 前置 A08 已按本轮证据完成；权威为 AI Runtime blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A10 与 OpenAPI。
- Usage 只在 active tab 读取服务端 period 聚合，严格区分计数 0 与 nullable 暂无数据；浏览器不重算。
- Logs 保持服务端顺序、分页与响应 actor，不读取 Users、不客户端聚合。Audit Detail 由全局 Audit owner 按需读取并安全投影，未知字段显式错误。
- canonical period/page URL 支持 direct/refresh/history；权限、焦点、响应式与失败恢复保持明确。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖 lazy queries、period/page、聚合/分页、actor、Audit Detail、未知字段和权限。
- [x] 当前 production 验收覆盖 URL 恢复、统计边界、日志顺序、Detail Sheet、失败/焦点与四档布局；A11 再验证真实配置闭环产生的 Usage/Logs。
- [x] 记录实际代码、独立复核、残余风险及 A11 后继；检查实际 diff/工作树。

## Notes

- 设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- 后端 AI Channel Logs 不再排除 `actor_id IS NULL` 的历史；PostgreSQL 真实物理删除操作者后，total、ID 顺序与分页集合保持，仅 actor 投影变为 null。`test_ai_channel_management.py` 当前 **9/9** 通过。
- Audit owner 在 queryFn 写入 TanStack Query cache 前安全重建 List/Detail：固定错误不回显输入，拒绝 raw extras、对象/嵌套数组/非有限数/原型字段，facts/change 按 business module 白名单投影。global list、channel logs 与 detail 响应身份精确绑定 page/pageSize/logId query key；actor ID 同空或精确一致。
- related registry 使用 `Map` 避免 `__proto__/constructor/toString` 原型链绕过；登记类型严格匹配 backend status/kind/parent 矩阵，`AVAILABLE` target 必须是 UUID 并以小写 canonical 身份进入 cache/DOM/link。未知 action 仅在当前行安全失败，不阻断其他日志或分页。cached Detail 刷新 403/404/409/503 保留已验证数据，retry 只读同一 logId。
- 当前定向 Vitest **5 files / 63 tests**，typecheck、所属 ESLint 通过；System Audit + AI Runtime production Playwright **25 passed / 1 desktop-only skipped**，并完成 production build。`git diff --check` 通过。
- 两轮独立 critical review 先后找到 cache 前验证、请求身份、actor/related 矩阵、原型链与 AVAILABLE UUID 边界；最终复核确认无阻断。残余风险是前后端 related/fact/change registry 未来变更需同步；当前以脚本比对为 exact match。
