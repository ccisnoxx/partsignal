# DEF-04 技术设计

## 设计结论

根因修复只放在更正表单的初始化边界：`GET /api/v1/geo-observations/{id}` 返回的人工观测详情是表单唯一基线。新建模式继续从当前候选文章生成空白结果；更正模式不再用候选文章响应重建逐篇事实。

不新增 API、数据库结构、状态管理或复制服务。现有服务端追加式写入和数据库不可变门禁继续承担最终一致性。

## 边界与数据流

```text
/observations/:id/correct
  → GET /geo-observations/{id}
  → ManualGeoObservation（唯一更正基线）
  → Ant Form 全字段初始化
  → 用户只改目标字段/新增证据
  → POST /geo-observations（完整载荷 + supersedes_id）
  → 服务端锁定产品、当前候选集合和原链尾
  → INSERT 新 observation + 新 article_results
  → 原 observation/article_results 保持不变
```

### 前端加载与初始化

- 路由和 `geoObservationQueryOptions` 保持不变。
- 更正详情加载完成后一次性设置：
  - 原值继承：`product_id`、`query_topic_id`、`search_platform`、`search_query`、`tested_at`、`notes`。
  - 逐篇继承：从 `correctionRecord.article_results` 只投影请求字段 `publication_record_id/discovered/mentioned/accuracy`。
  - 链接字段：`supersedes_id = correctionRecord.id`。
- 更正表格直接展示详情响应随逐篇结果携带的标题、平台和链接，不再请求候选列表作为第二个初始化来源。
- 新建模式保持现状：选择产品后请求当前候选文章，并以 `false/false/null` 创建首次观测的显式表单值。

### 历史未知事实

读取契约允许补采前人工记录的 `discovered/mentioned` 为 `null`，创建契约要求布尔值。更正初始化保留 `null` 的未知语义；对应控件显示明确的未采集状态并要求用户选择“是/否”，未选择不能提交。不得使用 `?? false`。

该处理只覆盖真实存在的跨版本契约差异，不引入多版本猜测或兼容字段。

### 附件

- `correctionRecord.attachment_file_ids` 继续用于已有证据展示。
- 本地 `attachments` 只记录本次新上传文件。
- POST 只发送新上传 ID；服务端与详情投影继续沿祖先链聚合证据。

### 提交与并发

- POST 继续发送完整 `GeoObservationCreate`，并以 `correctionRecord.id` 覆盖 `supersedes_id`。
- 服务端继续锁定当前候选集合并精确比较 ID；若原记录的文章集合已不再等于当前候选集合，返回 `409 GEO_PUBLICATIONS_CHANGED`，不自动补值。
- 服务端继续拒绝非链尾、跨产品、改变问题主题/搜索平台/搜索词的更正。

## 不变量

1. 表单初值中的每个业务事实都能追溯到待更正详情响应。
2. 未修改字段的 POST 值与原记录相同。
3. 历史未知值只有用户显式选择后才变为布尔事实。
4. 历史附件不复制，新附件只属于新版本。
5. 更正只 INSERT；原记录及逐篇关系无 UPDATE。
6. 当前候选集合与链尾由服务端最终判定。

## 预计变更

- `frontend/src/features/geo-observations/GeoObservationForm.tsx`
  - 更正模式完整初始化；
  - 更正表格使用详情逐篇结果；
  - 历史未知布尔值显式选择并校验；
  - 删除“更正重新置空”的错误逻辑与注释。
- `frontend/src/features/geo-observations/GeoObservationsPage.test.tsx`
  - 将错误默认值断言改为显式未知处理；
  - 增加两篇结果的完整预填和单字段修改回归。
- `backend/tests/integration/test_publication_review_closure.py`
  - 在既有人工 GEO 集成场景内强化单字段更正、原记录不变和链尾断言。
- `docs/GEO多平台内容运营系统方案设计.md`
  - 明确更正表单继承规则与附件例外。
- `.trellis/spec/frontend/component-guidelines.md`
  - 记录前端更正初始化的单一来源约束。

## 兼容、发布与回滚

- API Schema、数据库 Schema 与历史数据不变，无迁移、回填或双写。
- 已有正常人工观测更正只改变初值为原值；新建观测不变。
- 补采前历史更正从静默推断“否”改为要求显式确认，这是为防止错误事实写入的预期行为。
- 回滚只需撤销本任务的前端、测试和文档差异；没有数据回滚步骤。

## 取舍

- 不新增后端“更正草稿”接口：详情响应已包含全部基线字段。
- 不在前端合并详情逐篇结果与候选列表：两来源合并会再次引入缺失值推断和竞态；候选变化由现有服务端事务校验。
- 不复制历史附件关系：现有祖先聚合读取已经满足完整查看，复制会破坏版本归属。

## 验证环境兼容

- jsdom 不实现伪元素计算样式，但 `@rc-component/util` 会读取 `::-webkit-scrollbar`。测试初始化将伪元素查询回退为同一元素的普通计算样式，与 jsdom 当前实际返回值一致，同时避免把未实现能力写入错误输出；真实伪元素视觉仍由 Playwright 覆盖。
- Starlette 1.3.1 的 TestClient 优先使用 `httpx2`，缺失时才回退至旧 `httpx` 并告警。后端开发依赖同时保留业务代码使用的 `httpx`，并加入 `httpx2` 供 TestClient 使用，不做警告过滤。
