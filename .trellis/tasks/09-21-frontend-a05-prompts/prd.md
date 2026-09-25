# A05 Prompt Library 与编辑

## Goal

验收 `/settings/prompts` 的服务端列表、按需详情、Markdown 唯一编辑源与 revision/DirtyGuard。

## Requirements

- 前置 A02/F06 已按本轮证据完成；权威为 Prompt blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A05 与 OpenAPI。
- 列表只消费服务端摘要，Detail 仅在用户打开时读取；编辑只写 Markdown，不能保存独立 HTML/editor JSON。409 保留草稿并冻结，只有成功显式 reload 恢复；平台绑定摘要只读。
- canonical URL、权限、焦点与失败语义保持显式，未知 action/field 不猜测。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖列表/Detail、Markdown round trip、revision/409、绑定摘要、权限与错误。
- [x] 当前 production artifact 严格 fixture mobile/desktop 覆盖 URL、lazy Detail、DirtyGuard、编辑、失败/焦点与四档布局。
- [x] 记录实际代码、独立复核、残余风险及 A06/A11 后继；检查实际 diff/工作树。

## 本轮实施与验证证据

- `frontend/src/domains/configuration/prompt-workspace-page.tsx` 将 POST/PUT/DELETE 成功与后续刷新拆分：创建先采用 canonical 并完成 URL handoff，更新先采用 revision，删除先关 Dialog、剔除列表并清 URL；页面 Notice 只重试读取/导航，不重发命令。
- 失败 Detail reload 检查 `refetch().error`，409→500/403 保留 Markdown、baseline、request ID 与冻结；成功读取才恢复。同步 `saveAttempt` 从 preflight 覆盖影响确认到 mutation，pending 时名称禁用且 Markdown readonly，防止重入和成功响应覆盖新输入。
- 直接 page/model **28/28**；PostgreSQL `test_platform_types.py` **7/7**（含 Prompt 持久化与冲突边界）；当前 production `prompt-workspace.spec.ts` mobile/desktop **16/16**；`npm run typecheck`、owned ESLint、`git diff --check` 通过。独立复核未发现阻断；覆盖缺口为未单独执行“取消影响确认后再保存”和“preflight 失败后再成功”的交互测试，源码释放路径已复核。下一步 A06/A11。

## Notes

- 复杂编辑交互的设计与实施顺序见同目录 `design.md`、`implement.md`。
