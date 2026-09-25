# R00 候选基线与轻量路由表

## 可恢复点与归属

- 原仓库 `/Users/sc/PycharmProjects/partsignal`：启动时 `main...origin/main`，工作树干净，HEAD `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。既有活动 Trellis 任务为 `09-04-integrity-error-domain-mapping`、其子任务 `09-14-publication-geo-integrity-error-contract-decision` 和 `09-16-geo-observation-context-code-reconciliation`，均属另一条后端工作线；本轮不接管它们。
- 本轮候选在 `/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`，从同一 HEAD 建立；候选仍使用仓库唯一 `frontend/` 源码目录。当前 worktree 是 detached HEAD，未提交；恢复基准为上述 commit，候选改动通过本 worktree 的 `git diff` 与未跟踪 Trellis 文件定位。创建分支或提交前再依据当时用户指示和根规则决定。
- 已归档的 `09-21-frontend-redevelopment-plan-document` 与 `09-21-frontend-redevelopment-full-backlog` 只完成规划文档，不提供本轮实施验收。父任务为 `09-21-frontend-redevelopment-delivery`；R00、F01 等分别作为可审查子任务。

## 路由清单

来源：`docs/frontend-v2/02-information-architecture-and-routing.md` 第 6 节，共 37 个 canonical route。表内文件均在 `frontend/src/routes/` 下；对应页面实现位于 `frontend/src/domains/`。此处「入口存在」只表示静态路径与组件可定位，不等于本轮行为验收。具体差距在该编号进入时按页面卡细查。

| ID | Canonical route | Pattern | 当前 route 文件 | 明显依赖/待验收 |
|---|---|---|---|---|
| F03 | `/login` | Form | `login.tsx` | 会话、return-to、服务端认证 |
| F03 | `/account/security` | Form | `account/security.tsx` | 强制改密、退出与缓存 |
| W01 | `/` | Inbox | `_app/index.tsx` | Workbench aggregate，业务域完成后验收 |
| P01 | `/products` | Table | `_app/products/index.tsx` | Product list，视觉样板与 URL |
| P02 | `/products/new` | Form | `_app/products/new.tsx` | Product create 与响应 ID |
| P03 | `/products/$productId` | Detail | `_app/products/$productId.tsx` | Product detail read model |
| P04 | `/products/$productId/facts` | Workspace | `_app/products/$productId_.facts.tsx` | facts context、revision |
| P05 | `/products/$productId/facts/review` | Workspace | `_app/products/$productId_.facts_.review.tsx` | review context、权限 |
| P06 | `/products/$productId/facts/versions` | Table | `_app/products/$productId_.facts_.versions.tsx` | `page/pageSize` URL 与只读历史 |
| P07 | `/products/$productId/facts/versions/$versionId` | Detail | `_app/products/$productId_.facts_.versions_.$versionId.tsx` | 版本身份与只读边界 |
| C01 | `/content/tasks` | Table | `_app/content/tasks/index.tsx` | ContentTask list projection |
| C02 | `/content/tasks/new` | Form | `_app/content/tasks/new.tsx` | creation-options 与 handoff |
| C03 | `/content/tasks/$taskId` | Detail | `_app/content/tasks/$taskId.tsx` | task detail projection |
| C04–C05 | `/content/tasks/$taskId/editor` | Workspace | `_app/content/tasks/$taskId_.editor.tsx` | editor context、Markdown、AI job |
| C06 | `/content/tasks/$taskId/review` | Workspace | `_app/content/tasks/$taskId_.review.tsx` | review context、token |
| C07 | `/content/versions/$versionId` | Detail | `_app/content/versions_.$versionId.tsx` | 不可变版本 |
| U01 | `/publishing/work` | Queue/Table | `_app/publishing/work/index.tsx` | ready queue、work list |
| U02 | `/publishing/work/$workId` | Workspace | `_app/publishing/work/$workId.tsx` | workspace context、登记与核验 |
| U03 | `/publishing/articles` | Table | `_app/publishing/articles/index.tsx` | 成果只读列表 |
| U04 | `/publishing/articles/$articleId` | Detail | `_app/publishing/articles/$articleId.tsx` | 成果 snapshot |
| U05 | `/publishing/issues` | Table | `_app/publishing/issues/index.tsx` | issue list projection |
| U06 | `/publishing/issues/$issueId` | Workspace | `_app/publishing/issues/$issueId.tsx` | issue context、修复 |
| G01 | `/geo/observations` | Table | `_app/geo/observations/index.tsx` | observation list-items |
| G02 | `/geo/observations/new` | Workspace | `_app/geo/observations/new.tsx` | 候选文章与证据上传 |
| G03 | `/geo/observations/$observationId` | Detail | `_app/geo/observations/$observationId.tsx` | chain detail |
| G04 | `/geo/observations/$observationId/correct` | Workspace | `_app/geo/observations/$observationId_.correct.tsx` | correction context、tail redirect |
| G06 | `/geo/insights` | Analytics | `_app/geo/insights/index.tsx` | 聚合与七参数 URL |
| G07 | `/geo/insights/print` | Print | `_app/geo/insights/print.tsx` | 同一只读 read model |
| G05 | `/geo/topics` | Table | `_app/geo/topics/index.tsx` | Topic list-items |
| A01 | `/settings/platforms` | Table | `_app/settings/platforms/index.tsx` | readiness、服务端分页 |
| A04 | `/settings/platforms/types` | Settings Table | `_app/_admin/settings.platforms.types.tsx` | ADMIN 边界与删除条件 |
| A02–A03 | `/settings/platforms/$platformId` | Workspace | `_app/settings/platforms/$platformId.tsx` | `overview/accounts/generation` URL tab |
| A05–A06 | `/settings/prompts` | List/Workspace | `_app/_admin/settings.prompts.tsx` | Prompt 编辑与真实预览 |
| A07 | `/settings/ai` | Table | `_app/_admin/settings.ai.tsx` | ADMIN、安全摘要 |
| A08–A10 | `/settings/ai/$channelId` | Workspace | `_app/_admin/settings.ai_.$channelId.tsx` | `basic/request/models/usage/logs` URL tab |
| S01 | `/system/users` | Table | `_app/_admin/system.users.tsx` | ADMIN、revision、bulk |
| S02 | `/system/audit` | Table/Detail | `_app/_admin/system.audit.tsx` | ADMIN、按需 Detail |

`/login`、`/account/security` 以外的业务路由受 `_app/route.tsx` 会话边界保护；管理员配置与 System 走 `_admin/route.tsx`。根 `__root.tsx` 定义 404。`frontend/src/routeTree.gen.ts` 可定位上述 path，但仅作为生成产物核对，不手工编辑。

## Legacy 与明显缺口

- `02` 第 13 节的旧入口由 `frontend/src/routes/-legacy-routing.model.ts` 及 `_app` 下的 `tasks/`、`observations/`、`configuration/`、`users.tsx`、`audit.tsx`、`publications.tsx`、`change-password.tsx` 等显式 redirect 处理；这些不算 canonical 页面，留给 I01 本轮验收。
- 静态检查未发现 37 个 canonical URL 缺少 route 文件或页面组件。尚未验证浏览器 direct/refresh/Back/Forward、真实 API、生产产物、响应式或权限运行时行为；不能据此关闭 F01–I03。
- `/products` 的详细页面卡见 `research/products-page-card.md`。下一项 F01 核对应用入口、generated API、Provider 与构建；F02–F07 完成 Foundation 后进入 P01 视觉与业务验收。
