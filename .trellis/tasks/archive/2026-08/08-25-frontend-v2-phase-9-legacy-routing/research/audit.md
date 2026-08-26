# V1 → V2 Legacy Routing 审计

> 2026-08-26：本审计矩阵已实现并通过 unit、mobile/desktop production-artifact Playwright、typecheck、lint 与 build；未在 Staging 验证。

## 1. 审计基线与证据

- V1 注册路由：`frontend/src/app/App.tsx`。其 catch-all 当前回 `/`，该行为不得带入 V2。
- V1 query/selected/tab：对应 V1 pages 的实际 `URLSearchParams` 读写。
- V2 canonical search：各 `frontend-v2/src/domains/**` model 与 `src/routes/_app/**` route 的当前 parser。
- Auth：`frontend-v2/src/routes/_app/route.tsx`、`login.tsx`、`account/security.tsx`。
- 权限：`frontend-v2/src/routes/_app/_admin/route.tsx` 当前让 ENGINEER 在原 canonical 管理地址进入 403。
- 404：`__root.tsx` 当前只有 `Outlet`，没有根 `notFoundComponent`。
- Router 本地类型确认 `ParsedLocation.href` 是 path/search/hash，`redirect`/`navigate` 原生支持 `href` 与 `replace`。

## 2. 精确 Redirect Matrix

`{id}` 表示原值不变；所有转换均使用 replace。标记“保持”的路径不新增 redirect。

| V1 输入 | Canonical V2 | 备注 |
| --- | --- | --- |
| `/login` | `/login` | 保持 |
| `/` | `/` | 保持 |
| `/products` | `/products` | 保持 |
| `/products/{productId}` | `/products/{productId}` | 保持 Product Detail；验证可进入 `/facts` |
| `/change-password` | `/account/security` | Auth boundary 仍先裁决 session/must-change |
| `/tasks` | `/content/tasks` | query 见 §3.2 |
| `/tasks/{taskId}` | `/content/tasks/{taskId}` | ID 原样 |
| `/content/{versionId}` | `/content/versions/{versionId}` | 直接按 ContentVersion identity |
| `/observations` | `/geo/observations` | query 见 §3.3 |
| `/observations/insights` | `/geo/insights` | query 见 §3.4 |
| `/observations/insights/print` | `/geo/insights/print` | query 见 §3.4 |
| `/observations/topics` | `/geo/topics` | 无已证实的 URL list search |
| `/observations/{observationId}/correct` | `/geo/observations/{observationId}/correct` | 静态 route 优先；ID 原样 |
| `/settings` | `/settings/platforms` 或 workspace | query 见 §3.5 |
| `/configuration` | `/settings/ai` | query 见 §3.7 |
| `/configuration/ai` | `/settings/ai` | query 见 §3.7 |
| `/configuration/ai/channels/{channelId}` | `/settings/ai/{channelId}?tab=basic` | 明确冻结到 basic；不继承旧 tab |
| `/configuration/platform-types` | `/settings/platforms/types` | 未发现等价 list query |
| `/configuration/platforms` | `/settings/platforms` 或 workspace | query 见 §3.5 |
| `/configuration/prompts` | `/settings/prompts` | query 见 §3.6 |
| `/users` | `/system/users` | query 见 §3.8 |
| `/audit` | `/system/audit` | query 见 §3.9 |
| `/publications` | 依 §4 优先级 | closed-history 的 D1 已批准 |

### Configuration workspace 特例

- `/settings?platform_profile_id={id}` 与 `/configuration/platforms?platform={id}` → `/settings/platforms/{id}?tab=accounts`。
- 没有有效 selected ID 时 → `/settings/platforms`。
- 不猜选中项，不 lookup，不把未知 query 带入 canonical URL。

## 3. Query 转换表

### 3.1 Products

| V1 | V2 | 规则 |
| --- | --- | --- |
| `q` | `q` | 原值 |
| `page` | `page` | canonical schema 处理无效值 |
| — | `pageSize=20` | 保持 V1 固定页长；V2 支持 |

其他字段不传。Product Detail 不把旧路径解释成 Facts。

### 3.2 Content Tasks

| V1 | V2 | 规则 |
| --- | --- | --- |
| `q` | `q` | 原值 |
| `archive_status` | `archiveStatus` | 现有 V2 枚举校验 |
| `platform_profile_id` | `platformId` | 原值 |
| `page` | `page` | 现有 schema 校验 |
| — | `pageSize=10` | 保持 V1 固定页长 |
| `status=CANCELLED` | `workflowStage=CANCELLED` | 语义精确 |
| `status=COMPLETED` | `workflowStage=VERIFIED` | V1 completed 对应完成发布工作的终态投影 |

不转换：`status=OPEN` 跨多个 V2 workflow stages，单值不能等价；`filter_product_id`、`filter_fact_version_id` 在 V2 canonical schema 无对应字段。不得把这些字段静默改成 `queryTopic*`。

### 3.3 GEO Observations

| V1 | V2 |
| --- | --- |
| `search` | `q` |
| `product_id` | `productId` |
| `query_topic_id` | `queryTopicId` |
| `search_platform` | `geoPlatform` |
| `accuracy` | `accuracy` |
| `date_from` | `from` |
| `date_to` | `to` |
| `sort_order=ASC` | `sort=OBSERVED_ASC` |
| `sort_order=DESC` | `sort=OBSERVED_DESC` |
| `page` | `page` |
| `page_size` | `pageSize` |

不转换：`observation_kind`、`publication_search`、`discovered`、`mentioned`、`recorder_search`、`only_mine`、`include_history`、`all_time`、`record`、`create`、`search_query`。其中 `all_time` 不能伪装成 V2 默认日期范围。

### 3.4 GEO Insights / Print

| V1 | V2 |
| --- | --- |
| `date_from` | `from` |
| `date_to` | `to` |
| `product_id` | `productId` |
| `content_platform_id` | `contentPlatformId` |
| `geo_platform` | `geoPlatform` |
| `published_article_id` | `publishedArticleId` |
| `query_topic_id` | `queryTopicId` |

`filters_collapsed` 只是 V1 UI 状态，不转换。

### 3.5 Platforms / Settings

| V1 | V2 | 规则 |
| --- | --- | --- |
| `q` | `q` | 原值 |
| `platform_type_id` | `platformTypeId` | 原值 |
| `status` | `status` | 由 V2 schema 校验 |
| `page` | `page` | 由 V2 schema 校验 |
| `page_size` | `pageSize` | 由 V2 schema 校验 |
| `platform` 或 `platform_profile_id` | path `{platformId}` + `tab=accounts` | 仅非空 ID |

不转换 `configuration_status`：V1 的 COMPLETE/INCOMPLETE 是 prompt completeness，V2 的 COMPLETE/MISSING_PROMPT/MISSING_ACCOUNT 是 readiness，语义不等价。

### 3.6 Prompts

| V1 | V2 |
| --- | --- |
| `platform_prompt_id` | `promptId` |
| `new=1` | `new=1` |

不转换 `tab=humanization`：V2 无对应 surface。`tab=platform` 不需要额外 query。V1 本地搜索不是 URL 状态。

### 3.7 AI Configuration

列表 `/configuration`、`/configuration/ai`：

| V1 | V2 |
| --- | --- |
| `q` | `q` |
| `status=enabled` | `status=ENABLED` |
| `status=disabled` | `status=DISABLED` |
| `status=all` | 省略 |
| `provider_brand` | `provider` |
| `sort` | `sort` |
| `page` | `page` |
| `page_size` | `pageSize` |

Channel detail 固定 `tab=basic`，不继承旧 basic/request/models/usage/logs tab 或 list query，避免与已冻结目标冲突。

### 3.8 Users

| V1 | V2 |
| --- | --- |
| `q` | `q` |
| `account_type` | `accountType` |
| `status` | `status` |
| `page` | `page` |
| `page_size` | `pageSize` |

### 3.9 Audit

| V1 | V2 |
| --- | --- |
| `created_from` | `createdFrom` |
| `created_to` | `createdTo` |
| `actor_id` | `actorId` |
| `business_module` | `module` |
| `action` | `action` |
| `target_type` | `targetType` |
| `outcome` | `outcome` |
| `request_id` | `requestId` |
| `keyword` | `keyword` |
| `page` | `page` |
| `page_size` | `pageSize` |

不转换 `all_time`：V2 有强制默认日期范围，无等价 all-time 表达。V1 selected detail 是本地状态，不能映射到 V2 `logId`。

## 4. Publishing 优先级与转换

| 优先级 | V1 条件 | V2 结果 |
| --- | --- | --- |
| 1 | `kind=work&selected={id}` | `/publishing/work/{id}` |
| 2 | `kind=article&selected={id}` | `/publishing/articles/{id}` |
| 3 | `kind=issue&selected={id}` | `/publishing/issues/{id}` |
| 4 | `tab=articles` | `/publishing/articles?page={page}&pageSize=20` |
| 5 | `tab=history&status=RESOLVED` | `/publishing/issues?status=RESOLVED&page={page}&pageSize=20` |
| 6 | `tab=history` 其他 | `/publishing/work?status=CLOSED&page={work_page|page}&pageSize=20` |
| 7 | 其他 | `/publishing/work` + 支持的 active status + `page={work_page|page}` + `pageSize=20` |

规则：只有 kind 与非空 selected 同时成立才进入详情；未知 kind、单独 selected、互相矛盾的低优先级字段不猜测。Articles/history 使用 V1 对应分页 owner；active work 只接受当前 canonical 支持的精确枚举 `PREPARING`、`PLATFORM_REVIEW`、`AWAITING_VERIFICATION`、`ACTION_REQUIRED`。

### D1 审计结论与批准决定

V1 默认 history 是 closed work。Backend publication list 已接受 `CLOSED`，而 V2 `publication-work.model.ts` 当前 search status 白名单只有四个 active 状态。用户于 2026-08-26 批准最小扩展现有 V2 work list schema/request owner 接受 `CLOSED`；不允许增加前端推导、数据 lookup 或 backend/API 变更。

## 5. Return-to、权限与 404 审计结论

- `_app` 当前匿名固定去 `/login`；Login active 固定回 `/`；Security 完成固定回 `/`，尚无 approved return-to 状态。
- 计划只新增一个纯函数 owner，输入 Router `location.href`，输出 approved 同源 href 或 `/`。校验单 `/`、URL origin、反斜杠、编码/重复编码分隔符、畸形编码、危险 scheme 和 `/login` 自循环。
- must-change 不保存 return-to，继续优先 Security 并在完成后回 `/`。
- 管理 legacy route 在 `_app` 下转换 canonical；现有 `_admin` boundary 随后让 ADMIN 进入、ENGINEER 在 canonical 地址显示 403。服务端 403 不变。
- `__root.tsx` 是 SPA 未知 path 的唯一 404 owner。不存在资源仍进入 canonical domain route，由当前 API error/404/403 owner 呈现；legacy 层不查询、不吞 request ID/error code。
