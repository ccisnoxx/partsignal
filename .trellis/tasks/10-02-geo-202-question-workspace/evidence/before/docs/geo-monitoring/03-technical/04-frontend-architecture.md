# PartSignal GEO 前端架构

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 前端 | canonical `frontend/` |
| 核心规则 | 生成类型、URL 驱动、服务端状态机、复杂页面单一读模型 |

## 0. 当前 Catalog 实施边界

GEO-105 本地实现入口为 `routes/_app/configuration/geo-entities.tsx`，领域源码由 `domains/geo-catalog/` 拥有，状态与证据见 [任务记录](../../../.trellis/tasks/10-02-geo-105-catalog-ui/implement.md)。其他目录仍为目标设计，不表示未来 GEO 能力已实现。

Catalog 唯一 query key 注册处是 `catalog.api.ts` 的 `catalogKeys`。URL 保存 `q/subject_type/is_active/product_id/parent_subject_id/sort/page/page_size/subject_id/new`，默认值省略、UUID 规范化；仅 `new` 或选中 Subject 改变编辑身份，筛选更新保留草稿。

详情使用完整 Subject 聚合，OWN_PRODUCT 仅显示当前 Product 身份，不读取或编辑事实正文。表单基线 revision 与本地输入独立于 Query cache；后台成功/失败读取均不重置草稿。revision 冲突后显式读取最新版本，保留输入并由用户再次提交；唯一性等其他 409 同样保留输入，不自动重放。子命令使用父 Subject revision。命令完成只修改选中对象参数，保留等待期间更新的筛选；主体 epoch 与编辑器挂载守卫丢弃旧 continuation。

管理员配置入口可见；ENGINEER 直接 URL 只读；资源动作与删除阻断仅消费服务端投影。所有写操作沿用 CSRF；域名配置不发起 DNS/HTTP 请求。GEO-105 的 production artifact fixture 检查证明布局、URL、键盘和焦点；GEO-106 的 `catalog-real-stack.spec.ts` 补真实 API 创建/唯一冲突/持久化/只读验收，结果见 [验证记录](../../../.trellis/tasks/10-02-geo-106-catalog-acceptance/implement.md)。当前域名搜索缺口和操作说明见 [Catalog 使用指南](../01-product/04-catalog-user-guide.md)。

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

- PENDING/RUNNING/COLLECTED/ANALYZING：短间隔轮询；
- NEEDS_REVIEW/终态：停止自动轮询；
- 页面不可见时降低或暂停；
- 后台刷新保留上一份成功数据；
- 不因刷新重置表单、焦点或滚动；
- API 提供 `Retry-After` 时遵循。

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
- 每一步调用服务端 preview/option 接口；
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
