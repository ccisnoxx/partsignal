# PartSignal GEO 前端架构

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 前端 | canonical `frontend/` |
| 核心规则 | 生成类型、URL 驱动、服务端状态机、复杂页面单一读模型 |

## 0. 当前 Catalog 实施边界

GEO-105 本地实现入口为 `routes/_app/configuration/geo-entities.tsx`，领域源码由 `domains/geo-catalog/` 拥有，状态与证据见 [任务记录](../../../.trellis/tasks/10-02-geo-105-catalog-ui/implement.md)。其他未来目录仍为目标设计；GEO-202 问题库当前边界见下节。

Catalog 唯一 query key 注册处是 `catalog.api.ts` 的 `catalogKeys`。URL 保存 `q/subject_type/is_active/product_id/parent_subject_id/sort/page/page_size/subject_id/new`，默认值省略、UUID 规范化；仅 `new` 或选中 Subject 改变编辑身份，筛选更新保留草稿。

详情使用完整 Subject 聚合，OWN_PRODUCT 仅显示当前 Product 身份，不读取或编辑事实正文。表单基线 revision 与本地输入独立于 Query cache；后台成功/失败读取均不重置草稿。revision 冲突后显式读取最新版本，保留输入并由用户再次提交；唯一性等其他 409 同样保留输入，不自动重放。子命令使用父 Subject revision。命令完成只修改选中对象参数，保留等待期间更新的筛选；主体 epoch 与编辑器挂载守卫丢弃旧 continuation。

管理员配置入口可见；ENGINEER 直接 URL 只读；资源动作与删除阻断仅消费服务端投影。所有写操作沿用 CSRF；域名配置不发起 DNS/HTTP 请求。GEO-105 的 production artifact fixture 检查证明布局、URL、键盘和焦点；GEO-106 的 `catalog-real-stack.spec.ts` 补真实 API 创建/唯一冲突/持久化/只读验收，结果见 [验证记录](../../../.trellis/tasks/10-02-geo-106-catalog-acceptance/implement.md)。当前域名搜索缺口和操作说明见 [Catalog 使用指南](../01-product/04-catalog-user-guide.md)。

### 0.1 当前问题库（GEO-202）

入口为 `/geo/questions`，源码由 `domains/geo-questions/` 拥有，保留旧 `/geo/topics` 主题页。ADMIN/ENGINEER 都可管理变体；创建/复制表单逐项选择点名属性、语言、地区和优先级，不按文本猜测。列表/详情直接消费 generated OpenAPI 读模型，动作、历史删除阻断和运行不可用原因以服务端投影为准，无前端状态机或指标计算。

`questions.api.ts` 的 `questionKeys` 是列表/详情缓存唯一注册处；URL 保存 `q/query_topic_id/intent_type/mention_mode/language_code/region_code/priority/is_active/sort/page/page_size/selected/new/copy`，省略默认值并规范 UUID。主题选项复用现有 QueryTopic API；不导入旧 variants 数组。草稿和提交 revision 独立于 Query cache，后台读取失败及409保留输入；显式读取最新版本后由用户核对并再次提交，不自动重放写命令。DirtyGuard、principal continuation 与卸载守卫约束离开和异步返回。

页面涵盖加载、空/筛选空、详情消失或不可访问、读取失败、提交错误、冲突核对和完成反馈；运行按钮禁用并显示 NOT_IMPLEMENTED，不创建 Batch/Run。`questions-real-stack.spec.ts` 使用真实 API 与业务 UI 验收；实际证据见 [GEO-202 实施记录](../../../.trellis/tasks/10-02-geo-202-question-workspace/implement.md)。

### 0.2 当前观测面与采集配置（GEO-205）

入口为 `/configuration/geo-surfaces`，源码由 `domains/geo-catalog/` 的 Surface/Profile 模块拥有，导航仅 ADMIN 可见。ENGINEER 直接访问同一 URL 时消费服务端摘要，管理配置和写入口由权限投影控制。页面不推导启用资格、状态机或测试结果；新 Profile 的 UNTESTED 及阻断信息来自 generated OpenAPI 读模型。

`surfaces.api.ts` 的 `surfacesKeys` 是两类列表/详情缓存的唯一注册处；URL 保存 `tab/q/is_active/surface_kind/collection_mode/sort/page/page_size/surface_id/profile_id/new/editor`，默认值省略，UUID 规范化。Profile 页的 surface_id 是筛选条件；Surface 页的 surface_id 是选中详情。草稿基线与 Query cache 分离，后台刷新/409 保留输入，显式读最新后需用户再次提交；写命令不自动重放。DirtyGuard、principal continuation 与卸载守卫覆盖离开和异步返回。

管理员表单仅提供闭合非敏感配置，不能提交任意 JSON、密钥、Cookie 或浏览器会话。编辑 Profile 后以服务端返回的停用/UNTESTED 投影为准；启停和删除使用当前 revision 与 typed actions，并在确认时再次检查当前详情。页面覆盖加载、空/筛选空、错误/403/404、启用/删除阻断、冲突与完成反馈。真实 API、刷新持久化、工程师摘要及桌面/窄屏证据见 [GEO-205 实施记录](../../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。

提交成功后先取消关联列表及受影响 Profile 详情的在途读取，再核验主体/挂载并刷新；无缓存的首次 GET 不能复用提交前快照。删除消费完整 204 空响应后关闭详情，忽略取消的迟到 GET 不能恢复已删除行。

### 0.3 当前监测计划（GEO-209）

入口 `/geo/plans` 与 `domains/geo-plans/` 提供列表、详情、八步向导和状态确认，ADMIN/ENGINEER 共用服务端授权。URL 保存 `q/status/schedule_kind/sort/page/page_size/selected/new/edit`；默认值省略，UUID 规范化，`new` 与选中编辑身份互斥。`plans.api.ts` 的 `planKeys` 统一列表、详情和资源选择缓存；查询携带 AbortSignal。筛选和分页不改变正在编辑的身份。

向导本地持有完整草稿与提交 revision；选项复用 Subject、PromptVariant、CollectionProfile 的分页搜索及非敏感摘要，跨页选择保留，角色必须明确指定。完整配置后显式请求服务端 preview，最终矩阵、三种模式数量、未解析数量、费用和 blocker 全部消费 generated 类型。输入变化使 preview 失效，取消与迟到响应不能授权保存；不在前端计算最终 run_count 或费用。每个 blocker 显示字段、资源及关联资源，定位到对应步骤，并为管理员配置问题提供资源链接。

最终只调用一次 create/PATCH；新建保存后为 DISABLED，启用须在详情再次确认。后台刷新与所有409保留输入，编辑冲突显式读取仅更新 CAS 基线并展示最新配置供比较，再重新预览和手动提交。动作、stage、primary_task、删除阻断和 run_entry 仅消费服务端投影，归档只读可复制。dirty、beforeunload、principal epoch、卸载和写后取消在途读取共同保护输入及缓存。R1 没有运行、批次、调度执行或外部采集；实际验证见 [GEO-209 实施证据](../../../.trellis/tasks/10-02-geo-209-plan-ui/implement.md)。

## 1. 目录建议

```text
frontend/src/
├─ domains/
│  ├─ geo-catalog/
│  ├─ geo-questions/
│  ├─ geo-plans/
│  ├─ geo-runs/
│  ├─ geo-insights/
│  ├─ geo-opportunities/
│  └─ geo-reports/
├─ routes/
│  ├─ geo/
│  │  ├─ overview.tsx
│  │  ├─ questions...
│  │  ├─ plans...
│  │  ├─ runs...
│  │  ├─ observations...
│  │  ├─ insights.tsx
│  │  ├─ opportunities...
│  │  └─ reports.tsx
│  └─ configuration/
│     ├─ geo-surfaces...
│     ├─ geo-entities.tsx
│     └─ geo-rules...
└─ shared/api/
   ├─ generated/schema.d.ts
   ├─ client.ts
   └─ queryKeys.ts
```

具体拆分遵循“职责稳定后拆分”，不为每个简单表单机械建立大量 wrapper。

## 2. 数据来源

### 2.1 OpenAPI 类型

- 所有 API 类型来自 `src/shared/api/generated/schema.d.ts`；
- 不在 domain 内复制接口类型；
- 可以创建纯 UI 派生类型，但必须明确不代表 wire contract；
- API contract 变化后运行 `api:generate` 和 `api:check`。

### 2.2 Query Key

Catalog 当前注册见第 0 节；其余未来域的 query key 仍由唯一注册处维护，建议结构：

```ts
geo: {
  catalog: {
    root: ['geo', 'catalog'],
    list: (search) => [...],
    detail: (id) => [...],
  },
  plans: {...},
  batches: {...},
  runs: {...},
  overview: (filters) => [...],
  insights: (filters) => [...],
  opportunities: {...},
}
```

禁止在页面中临时拼接第二套 key。

## 3. 路由和 URL 状态

### 3.1 筛选 Schema

每个路由使用显式 search schema（Zod 或 TanStack Router 校验），包括：

- 日期；
- ID 数组；
- enum 数组；
- page/page_size；
- sort；
- selected resource ID。

无效 URL 参数应规范化到默认值，不把未知 enum 直接发给 API。

### 3.2 选中对象

高密度工作台使用 URL 选中：

```text
/geo/runs?run_id=<uuid>
/geo/opportunities?opportunity_id=<uuid>
```

详情可使用独立 route 或 Drawer；必须保证刷新、复制链接和浏览器返回可恢复。

### 3.3 本地状态

仅以下内容保存在组件状态：

- 未提交表单；
- Drawer 临时 tab；
- 编辑器 dirty；
- 确认对话框；
- 不适合共享的视觉状态。

## 4. 服务端状态机消费

资源响应应返回：

- `workflow_stage`
- `primary_task`
- `available_actions`
- `deletion` blockers（适用时）

前端在 feature 内穷尽映射文案和按钮，不根据 status、用户角色和关联数量重新推断动作。

前端不得：

- 自己决定运行是否可重试；
- 自己决定计划是否可启用；
- 自己决定机会是否可解决；
- 自己根据时间和状态计算当前分析 revision；
- 自己计算指标或样本等级。

## 5. 页面数据策略

### 5.1 列表

服务端负责：

- 搜索；
- 筛选；
- 排序；
- 分页；
- summary/counts；
- filter options。

前端不下载全部数据后本地筛选。

### 5.2 详情

使用单一详情 read model。Run Detail 不应分别请求答案、引用、分析、复核、机会和时间线再自行 join。

### 5.3 洞察

一次 `GeoInsights` 请求返回当前筛选下全部主要区块，确保公式、`as_of` 和排除规则一致。若响应过大，可按服务端共享 filter token 拆分，但不能在前端重新计算。

## 6. 运行状态刷新

### 6.1 轮询

- 排队/采集中/实际分析执行阶段：可见页面每 5 秒读取；R3 COLLECTED 对应 ANALYSIS_PENDING，没有分析执行器，停止空轮询；
- NEEDS_REVIEW/终态：停止自动轮询；
- 页面不可见时降低或暂停；
- 后台刷新保留上一份成功数据；
- 不因刷新重置表单、焦点或滚动；
- 读取失败保留成功数据并暂停自动轮询，适用时显式恢复；
- `Retry-After` 显示服务端事实，不触发自动重发。Batch 使用完整服务端计数决定读取频率，不按当前页计算状态。

### 6.2 批次进度

批次详情使用服务端 summary：

```text
requested / pending / running / collected / analyzing /
needs_review / completed / failed / cancelled
```

不由前端遍历当前页运行推算全局进度。

## 7. 表单与并发

### 7.1 Revision

编辑表单保留加载时 revision，提交时发送 `expected_revision`。409 时：

- 不覆盖用户本地输入；
- 显示资源已变化；
- 提供重新加载和比较；
- 不自动重试写请求。

### 7.2 未保存提示

以下表单需要 dirty 保护：

- Catalog Subject、Alias 与 Domain；

- Prompt variant 编辑；
- Plan wizard；
- Manual observation draft；
- Run review corrections；
- GEO rules。

切换路由、关闭 Drawer、刷新前提示。

## 8. 页面组件

建议共用：

- `MetricCard`：value、numerator、denominator、sample level、change；
- `DataQualityBanner`；
- `RunStatusBadge`；
- `CollectionModeBadge`；
- `SampleLevelBadge`；
- `MetricUnavailable`；
- `EvidenceViewer`；
- `CitationTable`；
- `ClaimAssessmentTable`；
- `WorkflowPrimaryTask`；
- `FilterSummary`；
- `ReportPrintHeader`。

组件接收服务端数据，不嵌入公式或业务状态机。

## 9. 图表

### 9.1 要求

- 每个图表有标题、时间范围、口径和样本说明；
- Tooltip 显示分子、分母和 value；
- 无分母断点，不画成 0；
- 样本不足用视觉标记并可筛选；
- 提供同数据表格；
- 支持键盘和屏幕阅读器；
- 打印路由有静态替代。

### 9.2 依赖

是否引入图表库由单独技术任务/ADR 决定。不得为了一个页面临时引入多个图表库。优先封装在 design system 内。

## 10. 原始证据展示

### 10.1 回答正文

- 使用安全的纯文本/Markdown 边界；
- 不执行原始 HTML；
- 搜索高亮以文本节点实现；
- 显示回答哈希和采集时间；
- 长文本支持折叠和复制；
- 复制不包含隐藏凭据或 raw payload。

### 10.2 截图和文件

- 通过现有限时下载接口；
- 加载失败明确显示；
- 不把签名 URL持久化到缓存；
- 对敏感页面截图显示访问提示；
- 浏览器登录页或 Cookie 绝不能作为业务截图。

### 10.3 引用

链接打开前显示规范域名和来源类别；服务端已完成 URL 安全校验。前端仍使用 `noopener/noreferrer`。

## 11. 人工复核 UI

复核页按三个区域：

1. 原始回答和证据；
2. 当前分析结果；
3. 修正表单。

修正操作必须：

- 明确指向 analysis revision；
- 保留原值和修正值；
- 要求评论；
- 显示影响的指标类别；
- 提交后只读展示；
- 新 analysis revision 后提示旧复核已被 supersede。

## 12. 计划向导

计划向导不在每一步立即写数据库。建议：

- 创建时本地完成草稿；
- 选择步骤读取已有资源的服务端分页选项；完整配置后显式请求一次 preview，修改后重新预览；
- 最终一次 create；
- 编辑现有计划按 revision 一次更新；
- 大集合选择支持服务端搜索；
- 预览结果是保存/启用前唯一运行矩阵权威。

## 13. 错误处理

统一 ErrorEnvelope 映射：

- 字段错误定位表单；
- 409 保留本地输入；
- 401 交给 AuthProvider；
- 403 显示权限原因；
- 429 显示重试建议；
- 5xx 显示 request ID；
- 后台刷新失败保留上次成功数据；
- 不把 Collector 失败转换成“暂无数据”。

## 14. 权限与导航

- ADMIN 显示配置中心 GEO 页面；
- ENGINEER 不显示配置入口，但可查看 profile 的非敏感摘要；
- 页面加载仍必须依赖服务端权限；
- 不因隐藏按钮而假设安全；
- 首次强制改密期间继续受现有 AuthProvider 门禁。

## 15. 测试边界

前端组件测试覆盖：

- search params 规范化；
- revision conflict；
- available_actions；
- 指标 null/样本不足；
- 批次轮询；
- 人工草稿 dirty；
- 复核 correction；
- 敏感字段不进入 cache/storage/screenshot；
- 旧主体请求不会污染新登录主体缓存。

Playwright 覆盖完整 UI 流，不用 `page.route` 固定业务响应代替真实 API。

## GEO-307 / R2 运行中心实施边界

`/geo/runs` 的批次/运行双层视图由 `domains/geo-runs` 拥有，读取 GEO-306 的完整摘要与详情，不按当前页重新计算汇总。view、筛选、稳定排序、分页、batch_id、run_id、edit/create 进入规范 URL；RHF 草稿及命令恢复身份仅留组件内存，保存后以 PostgreSQL canonical 草稿恢复。计划配置页面提供运行中心入口，计划内原生 run_entry 与定时执行仍遵循现有合同。

manual editor 以 generated DTO 和服务端 available_actions 裁决入口。后台读取不替换输入或推进草稿 CAS 基线；409 或资格失败保留输入，显式重载提供最新草稿供比较。写操作不自动重试；不确定提交和批次回执保留原 payload、同一幂等键及主体身份。截图经上传意图、真实字节传输和完成校验才可关联；恢复读取文件 canonical 状态，避免把非幂等 complete/abort 当作可重复命令。

详情只消费单一 GeoRunDetail，按原文展示 HTML_TEXT，提供原始引用位置、冻结上下文、受控签名证据、尝试链和实际时间线。签名不进入 URL 或浏览器持久存储；访问失败可显式刷新。ANALYSIS/REVIEW/METRICS/OPPORTUNITIES/RETEST 继续显示 NOT_IMPLEMENTED，不将采集成功解释为分析完成。轮询只依据展示 workflow stage，后台暂停，人工等待与终态停止。

## GEO-408 / R3 自动采集页面

详情独立显示 prompt/completion/total tokens、外部调用状态、供应商 HTTP/Retry-After 与实际费用，null 不补零或推算。retry 由服务端 `RETRY` 动作裁决；显式确认绑定 expected_revision，旧 attempt 保留。无幂等键 POST 的未知回执只读取直接后继，不重放；确定拒绝后读取 canonical，再重新确认。命令阻断属于 QueryClient 会话，跨详情关闭/切换/路由卸载保留，仅保存命令身份与阶段。命令继承发起 principal continuation；卸载或导航选择变化后迟到回执不覆盖当前意图。路由和 query key 不新增，详情/列表/完整 Batch 投影在真实成功回执后失效重读。使用与验收边界见 [R3 指南](../04-delivery/08-r3-api-acceptance.md)。


## GEO-508 / R4 当前分析与人工复核页面

运行中心沿用 `/geo/runs` 与既有run_id/筛选URL、query keys，单个GeoRunDetail在同一服务端快照中返回原文、机器结果、effective_results和revision/review历史。页面只用selection和is_current识别当前，历史readonly；无额外API join、指标公式或前端状态机。

CONFIRMED是人工确认机器判断，CORRECTED提交本次完整四栏修正。最新Review整体替换，连续修正仅从当前Review的明确payload继承希望保留的修正，不从effective机器字段猜人工修改。HIGH/CRITICAL INCORRECT机器声明必须逐条主动核对并填写非空说明；无默认decision或默认核对。确认风险不意味着原错误已纠正。无FactVersion只能UNJUDGEABLE。

表单绑定编辑起点analysis ID与Run revision；后台刷新不改写草稿。409保留输入且旧上下文禁提交，显式重读后重新核对；unknown写结果只允许读取历史确认，不自动重发。Principal epoch隔离账号切换后的迟到回执，dirty与pending使用现有共享导航保护。成功取消旧读取并失效既有运行/批次root，从服务端重读有效结果。

分析待处理和执行中持续轮询，终态及待复核按既有server workflow调度读取。机器首次位置为Unicode字符位置，浏览器按code points定位。原文按文本、引用只允许既有安全http(s)链接展示，复核草稿不保存到URL或浏览器storage。

R4质量和实际门禁结果见 [R4验收报告](../04-delivery/09-r4-analysis-acceptance.md) 与 [GEO-508实施证据](../../../.trellis/tasks/10-03-geo-508-analysis-review-ui/implement.md)。GEO-601完整指标、Opportunity、Browser及公共重分析入口仍在本任务范围外。
