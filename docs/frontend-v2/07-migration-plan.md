# PartSignal Frontend V2 重构迁移计划

## 1. 总体策略

推荐新建 `frontend-v2/`，而不是在现有 `frontend/` 中逐页大改。

复用：Backend、OpenAPI、authentication contract、object storage、domain states、既有 E2E 业务场景思想。  
不直接复制：Ant Design layout、旧 table columns、pathname 特判、feature-level 通用 UI。

## 2. Phase 0 — Contract & Read Model

目标：先让后端 API 真正支持 V2，不让新 UI 继续背负客户端拼装问题。

工作：

- 审核所有 list endpoint；
- 明确 typed `workflow_stage`；
- 明确唯一 `primary_task`；
- 明确 `available_actions`；
- 增加 UI-friendly read model；
- 增加复杂 Workspace context endpoint（必要时）；
- stable error codes；
- revision concurrency。

退出：Products/Content/Publication/GEO 每行不需要多个 API；`primary_task` 能完全驱动主操作；冲突有稳定 error code。

## 3. Phase 1 — Foundation

实现 React/Vite/TS、TanStack Router/Query/Table、shadcn/Base UI、Tailwind 4、RHF/Zod、OpenAPI client、Storybook、Vitest、Testing Library、Playwright。

Design System 至少：Button/Input/Select/Dialog/Sheet/Tabs/Badge/PageHeader/StatusBadge/TableShell/FilterBar/RowActions/BulkActionBar/WorkspaceShell/StickyActionBar/DetailSection/EmptyState/ErrorState。

退出：Storybook 可运行；App shell responsive；demo server table；demo workspace；RowActions 规则固化；URL back/forward 恢复；CI green。

## 4. Phase 2 — Product Facts

实现：Products Table、New Product、Product Detail、Fact Workspace、Fact Review、Fact Version Detail。

验证第一套完整 Pattern：

```text
Table → Workspace → Review → Immutable Detail
```

退出：事实完整主流程 E2E；submit/review/revise 可用；无页面级 action UI 发明。

## 5. Phase 3 — Content

实现：Content Task Table、New Task、Task Detail、Content Editor、Content Review、Content Version Detail。

关键：CodeMirror、Preview、Diff、Fact reference、Generation snapshot、Quality warnings、Dirty guard、Sticky action。

必须围绕 `ContentTask.current_content_version_id` 建立主线。

退出：AI/Human draft、review approve/reject、revision、readonly history、dirty guard、browser back 全覆盖。

## 6. Phase 4 — Publishing

实现：Ready Queue、Publication Work、Work Workspace、Published Articles、Article Detail、Issues、Issue Workspace。

验证三个生命周期：`PublicationWork / PublishedArticle / PublishedContentIssue`。

退出：三 URL 独立；成果 readonly；失败核验不伪装成功；action 全 server-driven；timeline/evidence 可追溯。

## 7. Phase 5 — GEO

实现：Observation Table、New Observation、Observation Detail、Correction、Topics、Insights、Print。

退出：Correction append-only；Topic 引用感知删除；Insights filter URL 恢复；print/screen 同口径；mobile 不横向崩坏。

## 8. Phase 6 — Configuration

合并 Platform/PlatformAccount/PlatformType 到平台域；完成 Prompt Workspace；完成 AI Channel/Model Workspace。

退出：平台和账号统一心智；platform type 不占 Sidebar；API key 不出列表；Prompt dirty/revision 完整；AI table action 统一。

## 9. Phase 7 — System

Users：create/edit/reset/enable/disable/bulk。  
Audit：table + row detail pane，无 action column。

退出：admin 权限 E2E、bulk partial failure UX、mobile audit sheet。

## 10. Phase 8 — Workbench

最后实现首页，因为它聚合 Product/Content/Publishing/GEO。实现 actionable counts、attention queue、workflow health、GEO summary、recent anomalies。

退出：每个待办深链接具体筛选/Workspace；aggregate API 独立；不复制 domain state machine；不以 vanity metrics 为核心。

## 11. Phase 9 — Cutover

1. V2 staging；
2. production-like data rehearsal；
3. redirect map 验证；
4. 部署 V2 静态资源；
5. 保留短期 rollback；
6. 观察错误率/API；
7. 删除 V1 build pipeline。

不建议长期 `/v1` 与 `/v2` 并存。

## 12. V1 → V2 矩阵

| V1 | V2 | 动作 |
|---|---|---|
| `/` | `/` | 重做 |
| `/products` | `/products` | 重做 Table |
| `/products/:id` | Detail + Facts Workspace | 拆分 |
| `/tasks` | `/content/tasks` | 重做 |
| `/tasks/:id` | `/content/tasks/:id` | 从 list component 拆出 |
| `/content/:versionId` | Task Editor + Version Detail | 彻底拆分 |
| `/publications` | `/publishing/work|articles|issues` | 一拆三 |
| `/observations` | `/geo/observations` | 重做 |
| `/observations/:id/correct` | Correction Workspace | 拆出 |
| `/observations/insights` | `/geo/insights` | 保留业务，重做 UI |
| `/observations/topics` | `/geo/topics` | 重做 |
| `/settings` | Platform Workspace | 合并 |
| `/configuration/platforms` | Platform Workspace | 合并 |
| `/configuration/platform-types` | Platform subsettings | 降级 |
| `/configuration/prompts` | Prompt Workspace | 保留核心交互 |
| `/configuration/ai` | AI Channels | 重做列表 |
| `/users` | `/system/users` | 重做 |
| `/audit` | `/system/audit` | 优化 |

## 13. 每个 Phase 的 Definition of Done

Product：信息架构、Primary Action、empty/loading/error。  
Engineering：lint/typecheck/unit/component/e2e/build。  
UX：375/768/1024/1440、keyboard、Back/Forward、direct URL、refresh。  
Architecture：无跨 domain 反向依赖；feature 不自造通用 UI；页面不从 status 推导业务资格。

## 14. 开发节奏

按可运行 vertical slice 交付，而不是先写所有 Table、再写所有 Form。推荐 Product 完整闭环 → Content 完整闭环 → Publishing → GEO → Configuration → System → Workbench。

## 15. V1 的角色

V1 是业务行为/API/E2E/字段参考，不是 UI 结构、page architecture 或 component implementation 模板。
