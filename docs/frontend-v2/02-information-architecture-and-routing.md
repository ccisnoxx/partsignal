# PartSignal Frontend V2 信息架构与路由

## 1. 设计原则

V2 信息架构按 **业务生命周期** 组织，而不是按数据库表、当前代码 feature、API endpoint 或“审核/查看/编辑”等动作名称组织。

核心链路：

```text
产品事实
   ↓
内容生产
   ↓
发布
   ↓
GEO 观测
   ↓
洞察 / 优化
```

辅助域：平台/Prompt/AI 配置，以及身份/审计。

## 2. 推荐左侧导航

```text
PartSignal

工作
└── 工作台

内容运营
├── 产品事实
├── 内容任务
├── 发布管理
└── GEO 观测

分析
├── GEO 洞察
└── GEO 问题库

业务配置
├── 平台与账号
├── Prompt
└── AI 渠道

系统                         [ADMIN]
├── 用户
└── 系统审计
```

底部用户菜单：修改密码、退出登录。

## 3. 为什么取消“审核”一级导航

事实审核和内容审核是对象生命周期里的任务/action，不是业务资产。入口应放在：

1. 工作台 Inbox；
2. 对象列表的 Primary Action；
3. 对象 Workspace；
4. 深链接。

例如：`工作台 → 待审核内容 6 → /content/tasks/:taskId/review`。

## 4. 发布管理信息架构

后端已经形成三个不同生命周期：

- `PublicationWork`
- `PublishedArticle`
- `PublishedContentIssue`

前端也必须分成三个 URL：

```text
发布管理
├── 发布工作
├── 发布成果
└── 内容问题
```

避免继续用一个 `/publications?tab=...` 承载完全不同的资源。

## 5. 平台配置的信息架构

V1 中 `/settings`、`/configuration/platforms`、`/configuration/platform-types`、`/configuration/prompts` 分散用户心智。

V2 合并为：

```text
平台与账号
   ↓
平台 Workspace
   ├── 概览
   ├── 发布账号
   └── 生成配置
```

平台分类保留 URL，但降为 subsettings，不占 Sidebar。Prompt 保持独立工作台，因为其编辑/预览体验与普通平台配置完全不同。

## 6. 完整 V2 路由

| URL | 页面 | Pattern | Sidebar |
|---|---|---|---|
| `/login` | 登录 | Form | 无 |
| `/account/security` | 修改密码 | Form | 用户菜单 |
| `/` | 工作台 | Workspace / Inbox | 工作台 |
| `/products` | 产品事实 | Table | 产品事实 |
| `/products/new` | 新建产品 | Form | 产品事实 |
| `/products/$productId` | 产品详情 | Detail | 产品事实 |
| `/products/$productId/facts` | 事实工作区 | Workspace | 产品事实 |
| `/products/$productId/facts/review` | 事实审核 | Workspace | 产品事实 |
| `/products/$productId/facts/versions?page=1&pageSize=20` | 事实版本历史 | Table | 产品事实 |
| `/products/$productId/facts/versions/$versionId` | 事实历史版本 | Detail | 产品事实 |
| `/content/tasks` | 内容任务 | Table | 内容任务 |
| `/content/tasks/new` | 创建内容任务 | Form | 内容任务 |
| `/content/tasks/$taskId` | 任务详情 | Detail / Shell | 内容任务 |
| `/content/tasks/$taskId/editor` | 内容编辑 | Workspace | 内容任务 |
| `/content/tasks/$taskId/review` | 内容审核 | Workspace | 内容任务 |
| `/content/versions/$versionId` | 历史内容版本 | Detail | 内容任务 |
| `/publishing/work` | 发布工作 | Table + Queue | 发布管理 |
| `/publishing/work/$workId` | 发布处理 | Workspace | 发布管理 |
| `/publishing/articles` | 发布成果 | Table | 发布管理 |
| `/publishing/articles/$articleId` | 发布成果详情 | Detail | 发布管理 |
| `/publishing/issues` | 内容问题 | Table | 发布管理 |
| `/publishing/issues/$issueId` | 问题处理 | Workspace | 发布管理 |
| `/geo/observations` | GEO 观测 | Table | GEO 观测 |
| `/geo/observations/new` | 新建观测 | Workspace | GEO 观测 |
| `/geo/observations/$observationId` | 观测详情 | Detail | GEO 观测 |
| `/geo/observations/$observationId/correct` | 更正观测 | Workspace | GEO 观测 |
| `/geo/insights` | GEO 洞察 | Analytics Workspace | GEO 洞察 |
| `/geo/insights/print` | GEO 打印报告 | Print | GEO 洞察 |
| `/geo/topics` | GEO 问题库 | Table | GEO 问题库 |
| `/settings/platforms` | 平台与账号 | Table | 平台与账号 |
| `/settings/platforms/types` | 平台分类 | Settings Table | 平台与账号 |
| `/settings/platforms/$platformId?tab=overview|accounts|generation` | 平台 Workspace | Workspace | 平台与账号 |
| `/settings/prompts` | Prompt 管理 | List + Workspace | Prompt |
| `/settings/ai` | AI 渠道 | Table | AI 渠道 |
| `/settings/ai/$channelId?tab=basic|request|models|usage|logs` | AI 渠道配置、模型与 Runtime | Workspace | AI 渠道 |
| `/system/users` | 用户 | Table | 用户 |
| `/system/audit` | 系统审计 | Table + Detail Pane / Sheet | 系统审计 |

## 7. TanStack Router 文件结构示意

```text
src/routes/
├── __root.tsx
├── login.tsx
├── account/
│   └── security.tsx
└── _app/
    ├── route.tsx
    ├── index.tsx
    ├── products/
    ├── content/
    ├── publishing/
    ├── geo/
    ├── settings/
    └── _admin/
        ├── system.users.tsx
        └── system.audit.tsx
```

子路由继续按 `$id` / `facts` / `review` / `editor` 等层级展开。

## 8. Breadcrumb

Breadcrumb 不再手写 pathname 特判，由 route hierarchy + metadata 自动生成：

```text
内容任务 / TPS5430 · 知乎 / 内容审核
平台与账号 / 知乎 / 发布账号
发布管理 / 发布成果 / TPS5430 国产替代选型指南
```

## 9. Search Params 规范

通用列表：

```text
q
page
pageSize
sort
```

业务需要时增加：

```text
status
workflowStage
productId
platformId
from
to
```

示例：

```text
/products?q=tps&factStatus=PENDING_REVIEW&page=2
/content/tasks?archiveStatus=ACTIVE&platformId=...&workflowStage=REVIEW_PENDING&page=1&pageSize=20
/geo/observations?productId=...&geoPlatform=chatgpt&accuracy=INCORRECT&from=2026-07-01&to=2026-08-01&page=3
/system/audit?page=1&pageSize=20&createdFrom=...&createdTo=...&actorId=...&logId=...
```

## 10. URL 状态边界

Content Task List 固定使用 `q/workflowStage/archiveStatus/platformId/page/pageSize`；canonical 默认 URL 显式保留 `archiveStatus=ACTIVE&page=1&pageSize=20`。这些字段全部映射到后端权威搜索、筛选和分页，不保存列配置或客户端视图。

必须进入 URL：搜索、筛选、sort、pagination、日期范围、analytics 维度、具有业务意义的 workspace section。

不要进入 URL：dropdown open、hover、toast、modal 动画、尚未提交的 form draft、Markdown selection。

## 11. Sidebar Active 状态

禁止通过 `pathname.startsWith()` 和特殊 case 猜所属模块。每个 route 声明 `navId`，子路由继承，Sidebar active state 由 router match 决定。

## 12. 权限

`/system/*` 和管理员配置既要在前端隐藏无权限导航，也必须继续由服务端校验。隐藏导航从来不是授权机制。

## 13. 旧路由迁移

V1 URL 只作为迁移入口，由 V2 TanStack Router 的显式 file routes 通过 `replace` 进入唯一 canonical URL。Nginx 只负责 SPA fallback；backend、Nginx 和 V1 不维护平行 redirect 表，也不存在接管未知路径的通用 redirect engine。

| V1 | Canonical V2 |
|---|---|
| `/login`、`/`、`/products`、`/products/:productId` | 原路径保持；Product Detail 继续从页面进入 `/products/:productId/facts` |
| `/change-password` | `/account/security` |
| `/tasks`、`/tasks/:taskId` | `/content/tasks`、`/content/tasks/:taskId` |
| `/content/:versionId` | `/content/versions/:versionId`，ID 直接作为 ContentVersion identity |
| `/observations` | `/geo/observations` |
| `/observations/insights`、`/observations/insights/print` | `/geo/insights`、`/geo/insights/print` |
| `/observations/topics` | `/geo/topics` |
| `/observations/:observationId/correct` | `/geo/observations/:observationId/correct`；静态 insights/topics routes 优先于动态 ID |
| `/settings` | `/settings/platforms`；有效 `platform_profile_id` 进入对应 `?tab=accounts` Workspace |
| `/configuration`、`/configuration/ai` | `/settings/ai` |
| `/configuration/ai/channels/:channelId` | `/settings/ai/:channelId?tab=basic` |
| `/configuration/platform-types` | `/settings/platforms/types` |
| `/configuration/platforms` | `/settings/platforms`；有效 `platform` 进入对应 `?tab=accounts` Workspace |
| `/configuration/prompts` | `/settings/prompts` |
| `/users`、`/audit` | `/system/users`、`/system/audit` |
| `/publications` | 依 `kind+selected`、articles、resolved issues、closed work、active work 的固定优先级进入 `/publishing/work|articles|issues` |

Legacy query 只按已审计白名单转换，并立即交给目标 domain 的现有 search schema 规范化。snake_case 只在存在语义等价字段时转换为 canonical camelCase；未知、淘汰或语义不等价字段不透传。ID 不触发数据查询或资源类型猜测。V1 `tab=history&status=RESOLVED` 进入 Issues；其他 `tab=history` 精确进入 `/publishing/work?status=CLOSED`，canonical Work list 直接复用 backend 已支持的 `CLOSED` 枚举。

匿名访问受保护 deep link 时，`/_app` 只把经过单一 return-to owner 批准的原始站内 URL 写入 `/login?redirect=`；登录成功后先 replace 回 legacy URL，再由显式 route replace 到 canonical URL。校验拒绝双斜杠、scheme/host、反斜杠、控制字符、畸形或重复编码绕过和 `/login` 自循环；无效输入回安全默认 `/`。must-change-password 仍优先进入 `/account/security`，完成后保持回 `/`，不增加 pending redirect 状态。

管理 legacy URL 先转换为 canonical 管理地址，再由既有 ADMIN boundary 裁决：ADMIN 正常进入，ENGINEER 保持地址并显示 403，服务端仍是权限最终权威。根 route 的 `notFoundComponent` 持有未知 SPA path 的显式 404；不存在资源继续由 canonical 页面呈现既有 404/403/error，asset 404 仍归 Nginx/static owner。

## 14. 当前路由基线参考

当前 `frontend/src/app/App.tsx` 把 `/tasks` 与 `/tasks/:taskId` 都指向 `ContentTasksPage`，`/content/:contentVersionId` 单独指向编辑器，`/publications` 承载发布管理，`/observations/:observationId/correct` 又指向 `GeoObservationsPage`。V2 需要重新建立资源边界和 Workspace 深链接。

参考：https://github.com/ccisnoxx/partsignal/blob/main/frontend/src/app/App.tsx
