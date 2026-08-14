# Frontend V2 AI Channel Workspace Runtime 设计

## 1. 设计结论

Runtime 以 read-only channel runtime 为唯一 vertical slice：在现有 Workspace route/page 和 `ai-channel.api.ts` 上开放 Usage 与 Logs，并复用全局 Audit Detail 安全投影。现有三个 GET 合同足够，不新增 API、DTO、数据库、依赖、全局 store、客户端聚合或通用 Runtime framework。

Frontend V2 没有共享 `MetricTile`，当前已有 Publication Summary 的局部语义 `<dl>` 指标布局。本 Task 复用同样的 primitive/Tailwind 形态，在 Runtime section 内直接绘制服务端指标；不为一个消费者移植 V1 组件或创建新 design-system abstraction。

## 2. 当前实现差距

| 主题 | 当前 `main` | 本 Task 目标 |
| --- | --- | --- |
| search | 只有 `{tab}`；usage/logs 参数被移除 | 条件式 union：配置/模型仅 tab，Usage 带 period，Logs 带 page/pageSize |
| delivered gate | `basic|request|models` | 最终开放五 tab |
| action handoff | Channel/Model Runtime 主动作禁用 | 都进入渠道 Usage |
| API owner | detail/models 与 logs invalidation root | 增 Usage、分页 Logs、按需 Audit Detail query |
| Usage | V1 local state；V2 无 section | URL period + server summary + null/zero 区分 |
| Logs | V1 local page 且另查 Users；V2 无 section | URL page/pageSize + response actor + safe detail |
| 详情 | V1 有安全详情组件，V2 无 Audit owner | domain-local Sheet，只展示当前合同白名单 |
| 测试 | Core/Models strict fixture | 扩 fixture + Runtime spec，并回归前两片 |
| 文档 | Runtime 标记未交付；backend spec 误写 page_size 枚举 | 标记五 tab 完成并纠正 API/UI 分层 |

## 3. 合同确认

### 3.1 Usage

```text
GET /api/v1/ai-channels/{channel_id}/usage-summary?period=7d|30d|90d|all
response: AIChannelUsageSummary
permission: ADMIN
```

- `period` 默认 30d，Frontend Workspace 始终显式发送 URL 值。
- `total_jobs/succeeded_jobs/failed_jobs` 为真实非空计数；其他指标按合同可空。
- `period_started_at=null` 只表示 `all`；`period_ended_at` 由服务端同次聚合生成。

### 3.2 Logs 与详情

```text
GET /api/v1/ai-channels/{channel_id}/audit-logs?page=&page_size=
response: AuditLogList

GET /api/v1/audit-logs/{audit_log_id}
response: AuditLogDetail
permission: ADMIN
```

- 通用 OpenAPI `PageSize` 是 `1..100`；Workspace 只给用户 `10|20|50` 三种 canonical 选择，不改变后端公共合同。
- 渠道列表稳定按 `created_at DESC, id DESC` 排序，actor 已由服务端联结并投影。
- detail 的 `changes/facts` 已由 `audit_logs.py` 的 CONFIGURATION whitelist 过滤；前端再做显示 allowlist 是 UI 完整性检查，不替代服务端安全边界。
- 无 OpenAPI、runtime schema、generated type 或数据库变化。

## 4. URL 与路由所有权

最终 search 是 discriminated union：

```text
{ tab: 'basic' | 'request' | 'models' }
{ tab: 'usage', period: '7d' | '30d' | '90d' | 'all' }
{ tab: 'logs', page: positive integer, pageSize: 10 | 20 | 50 }
```

`aiChannelWorkspaceSearchSchema` 先规范 tab，再按 tab 只保留对应字段。`isCanonicalAIChannelWorkspaceSearch` 比较键集合和值，确保默认值也显式写回；未知参数、跨 tab 遗留参数和非法值由 route `beforeLoad` 使用 `replace` 修正。

用户交互使用 push：

- 进入 Usage：`{tab:'usage', period:'30d'}`。
- 进入 Logs：`{tab:'logs', page:1, pageSize:20}`。
- 切到 Basic/Request/Models：只保留 tab。
- period 变化保留 Usage；page 变化保留 pageSize；pageSize 变化强制 page 1。

route loader 继续只 prefetch Detail。Runtime query 由 active section 自己读取，避免 Basic/Request/Models 请求 Usage 或 Logs。

## 5. Query 与 API ownership

继续扩展唯一 `frontend-v2/src/domains/configuration/ai-channel.api.ts`：

```text
aiChannelKeys.usageRoot(channelId)
aiChannelKeys.usage(channelId, period)
aiChannelKeys.logsRoot(channelId)
aiChannelKeys.logs(channelId, page, pageSize)
aiChannelKeys.auditDetail(auditLogId)

aiChannelUsageQueryOptions(channelId, period)
aiChannelLogsQueryOptions(channelId, page, pageSize)
aiChannelAuditDetailQueryOptions(auditLogId)
```

- key 只含 canonical URL/API 参数；不含 Channel Detail、form、secret 或完整 payload。
- Runtime queries `retry:false`；section 只挂载当前 tab 的 query，Audit Detail 只在有 selected ID 时 enabled。
- 现有 channel/header/model mutation 的 Logs invalidation 统一指向 `logsRoot(channelId)`；Usage 不因配置 mutation 自动刷新。
- channel delete 移除 detail/models/usageRoot/logsRoot 后再离开页面；safe Audit Detail cache 不承载凭据，但已知打开项随 surface 卸载。

## 6. Component ownership

```text
AIChannelWorkspacePage
├─ Configuration surface [basic|request]
├─ Models surface        [models]
└─ AIChannelRuntimeSection [usage|logs]
   ├─ Usage section
   │  ├─ period Select
   │  ├─ server metric <dl>
   │  └─ token/time facts
   └─ Logs section
      ├─ TableShell + mobile summary
      ├─ TablePagination
      ├─ out-of-range recovery
      └─ Audit Detail Sheet (on demand)
```

`AIChannelRuntimeSection` 是一个有真实 query、分页、详情生命周期和响应式责任的 domain boundary，可以独立源文件；Usage/Logs 不再拆成薄 wrapper。Workspace header/tabs 保持当前页面所有权，不抽通用 Settings Runtime 或 Tab framework。

## 7. Usage 呈现

- 顶部 period Select 使用 URL value；选项文案固定为最近 7/30/90 天与全部时间。
- 指标 `<dl>` 直接渲染业务作业、成功、失败、成功率、平均响应。Token 与最近使用/服务端窗口放在同一 `DetailSection` 的次级事实区域。
- `0` 通过 tabular numbers 显示；nullable 值走单一 formatter 返回“暂无数据”。成功率只对非空值乘 100；平均耗时不由客户端重新平均。
- initial pending 使用 Skeleton；initial error 显示 retry；已有 data 的 refresh error 保留指标并显示局部 retry。

## 8. Logs 与安全详情

### 8.1 列表

- primary cell 显示动作中文标签与 request ID；窄屏在同一 cell 追加时间、actor、account type、outcome 与安全摘要。
- 桌面辅助列展示时间、actor、outcome、summary；操作列只有“查看详情”。
- actor 只读 `row.actor`；null 显示“用户已删除/未记录”，不读取 `actor_id` 对应 User。
- `change_summary` 只通过 CONFIGURATION 显示 allowlist formatter；primitive 与 primitive list 使用文本展示，object/未知 key 显式投影错误，不 dump JSON。
- `TablePagination` 使用响应 `total` 计算 pageCount，但当前页仍由 URL 决定。越界只显示恢复按钮，不自动 navigate。

### 8.2 详情

- 点击 `VIEW_LOG_DETAIL` 保存 `{logId, focusReturn}` 到 local state并启用 detail query；Sheet close 清 local target并依赖现有 focus-return 行为。
- 基础字段：时间、动作、actor/account type、outcome、target、request ID。
- changes/facts：只接受 CONFIGURATION 的已登记字段和安全 primitive/list shape；未知内容使当前详情显式失败。
- result：`result_message` 与可空 `error_code`；related entry 只为 AIChannel/AIModel 提供当前 Workspace Basic/Models 入口，MISSING/UNSUPPORTED 使用只读说明。
- 不增加复制、导出、raw JSON、用户 join、日志搜索或 mutation。

## 9. 服务端 action authority

- `AIChannel.primary_task=VIEW_RUNTIME` 映射为 enabled `show-usage`，不再使用 disabled href。
- `AIModel.primary_task=VIEW_MODEL_RUNTIME` 映射为 enabled `view-runtime`；Models section 把它交给页面导航 Usage。
- tab 可达不等于写权限；Runtime 本身只读，仍由 ADMIN route/API 边界最终授权。
- 未知、重复或矛盾 channel/model token 保持现有显式错误，不从 status 补动作。

## 10. Error、cache 与 secret matrix

| 条件 | 页面处理 | Cache 行为 |
| --- | --- | --- |
| Usage/Logs initial error | 保留 Channel header/tabs，区块 error + retry | 不写伪成功 |
| refresh error 有 data | 保留旧 data，显示刷新失败 | 保留 safe stale data |
| Logs empty total=0 | 真实空态 | exact page 保留 |
| Logs empty total>0 | 越界提示 + 最后页按钮 | 不自动改 URL |
| Audit Detail 403/404/error | Sheet 内错误 + retry/close | 不读取其他 endpoint fallback |
| 未知 detail field/value | 显式安全投影错误 | 不 dump、不兼容 |
| period/page change | 读取新 exact key | 不 invalidate 其他 Runtime/history |
| channel delete | 离开 Workspace | remove 当前 channel runtime roots |

API Key、Header value、Provider request/response body 不在三个 read model 中。Fixture 仍以 sentinel 检查 response/DOM/console/snapshot，并且不保存 mutation secret body 字符串。

## 11. Responsive 与 accessibility

- 375：Usage 单列或双列不挤压；Logs primary cell 包含全部事实，TableShell 只局部滚动；Pagination 可换行；Sheet 全宽且可滚动。
- 768：Usage 两列；Logs 隐藏 metadata 列但保留 mobile summary和详情入口。
- 1024/1440：指标密度受页面最大宽度约束；Logs 显示完整主要列，操作列稳定。
- 四档共同断言根无横向溢出、tab/region/table/Sheet 有可访问名称、状态不只靠颜色、Tab/Enter/Escape/focus return 可用。

## 12. Compatibility、文档与回滚

- 无 API compatibility 或迁移；V1 Usage/Logs 保持不变，V2 直接复用 generated contracts。
- 更新 Frontend Workspace state spec 与 Frontend V2 02/03/05/07/08/09；backend spec 只纠正 page_size 文档漂移。
- `contracts/database.md` 不改：Runtime 只读现有 `generation_jobs` 和 `audit_logs` 投影，无持久化变化。
- 回滚点限于 search/action、API keys/queries、Runtime section、fixture/docs；若合同验证出现真实字段缺口，停止并返回 planning，不新增 fallback。

## 13. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 条件式 search 破坏 Core/Models URL | model tests + 三份 production-artifact specs；非 Runtime tab 精确剔除附加参数 |
| 动态审计对象诱发 JSON dump | display allowlist + primitive/list shape parser + unknown explicit failure |
| Logs 误查 Users 或客户端分页 | API request assertions、未声明 endpoint 501、响应 actor/total 唯一 owner |
| 次级 query 失败遮蔽 Workspace | Runtime surface 内局部状态；Detail query 与 Channel identity 分离 |
| 页面继续膨胀 | 只增加一个有真实 Runtime ownership 的 section 文件，不抽 framework |

## 14. Ponytail 约束

- 复用三个现有 GET、generated types、AI API owner、TableShell/TablePagination/Sheet/DetailSection 和既有局部指标布局。
- 只新增一个 cohesive Runtime section 和一份 Runtime E2E；不新增 dependency、MetricTile、Audit domain、registry、factory、store、轮询或客户端统计层。
- 不实现趋势、搜索、导出、复制、成本、模型级 Runtime 或 Configuration real-stack 编排；真实需求出现后另行规划。
