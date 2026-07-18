# GEO 数据完整性与人工文章观测设计

## 最小可行设计

复用 `GeoObservation` 作为追加式观测根，复用 `Product`、`PublicationRecord` 和 `FileRecord` 的现有身份；只扩展观测类型和文章关联结果，不创建第二套文章、发布或截图模型。

```text
人工访问搜索网站
  -> 选择 Product
  -> 服务端按 Product 投影当前 PublicationRecord 候选
  -> 用户逐篇标记并上传结果截图
  -> POST GeoObservationCreate
  -> 服务端锁定并复核完整候选集合
  -> 追加 GeoObservation + ArticleResult + Attachment
  -> 列表和指标从 PostgreSQL 实时读取
```

## 权威归属

- 产品身份：`products`。
- 文章正文和标题来源：`content_versions`；展示优先使用发布时 `actual_title`，为空时使用内容版本标题。
- 公开文章链接和发布状态：`publication_records.final_url/status`。
- 单次搜索中逐篇推荐结果：`geo_observation_publications.recommendation_status`。
- 搜索结果截图：`file_records` 与 `geo_observation_attachments`。
- 汇总指标：查询时派生，不新增汇总表或缓存。

前端只提交发布记录 ID 与推荐结果，不提交文章 URL、标题、产品归属或发布状态，避免第二来源。

## 历史兼容边界

现有观测与新观测语义不同，使用显式判别字段区分：

- `LEGACY_MODEL_RESULT`：现有目标问题、模型回答、引用、准确性语义；迁移只加判别值，不改写业务字段。
- `MANUAL_ARTICLE_SEARCH`：新的产品级人工搜索语义；旧模型字段必须为空。

`geo_observation_publications.recommendation_status` 对旧关联保持 `NULL`，明确表示历史未逐篇评估；新人工观测只允许 `RECOMMENDED | NOT_RECOMMENDED`。不从旧的观测级 `recommendation`、Citation 或“可能影响”关系推断逐篇状态。

## 数据库变更

新增 revision `0018_manual_geo_observation`：

1. `geo_observations` 增加非空 `observation_kind`，历史行通过列默认值成为 `LEGACY_MODEL_RESULT`，随后移除写入默认值。
2. 增加可空 `search_platform`、`search_query`；旧模型字段改为可空。
3. 增加检查约束：旧类型必须具有完整旧字段且没有人工搜索字段；新类型必须具有非空白搜索平台/搜索词且旧字段全部为空。
4. `geo_observation_publications` 增加可空 `recommendation_status` 和二态检查约束；历史 `NULL` 只允许属于旧观测。
5. 插入触发器最终校验人工观测文章结果非空状态、文章与观测同产品、发布状态为 `PUBLISHED | VERIFIED` 且 `final_url` 非空。
6. 保留现有追加式触发器、附件关联和更正唯一索引。

若已经存在任一 `MANUAL_ARTICLE_SEARCH`，downgrade 必须在删除新语义前失败；回滚使用前滚修复或迁移前备份，不能丢弃观测历史。

## API 契约

### 发布候选

新增：

```http
GET /api/v1/geo-observation-publications?product_id=<uuid>
```

返回 `PUBLISHED | VERIFIED` 且 `final_url` 非空的全部记录：

```json
{
  "items": [{
    "publication_record_id": "uuid",
    "title": "文章标题",
    "platform_name": "平台名称",
    "final_url": "https://example.com/article",
    "status": "VERIFIED"
  }]
}
```

该投影只用于候选展示，不复制持久化文章数据。

### 创建人工观测

`POST /api/v1/geo-observations` 的新写入契约：

```json
{
  "product_id": "uuid",
  "search_platform": "DeepSeek",
  "search_query": "产品型号",
  "tested_at": "2026-07-18T10:00:00+08:00",
  "article_results": [
    {"publication_record_id": "uuid", "recommendation_status": "RECOMMENDED"}
  ],
  "attachment_file_ids": ["uuid"],
  "notes": "",
  "supersedes_id": null
}
```

请求边界拒绝空白平台/搜索词、重复文章、空结果和空截图。输出使用 `observation_kind` 判别联合类型，使旧记录仍可读且新记录没有伪造的旧字段。

### 列表与指标

- `GET /geo-observations` 返回新旧判别联合列表，默认仍按观测时间倒序。
- `GET /geo-metrics` 保留旧指标字段用于历史兼容，并增加 `manual_observation_count`、`article_result_count`、`recommended_article_count`、`not_recommended_article_count` 和可空 `article_recommendation_rate`。
- 新文章指标只统计没有后继更正的 `MANUAL_ARTICLE_SEARCH`；旧观测不进入分母。

## 创建事务

1. 锁定并确认产品存在。
2. 查询并锁定该产品全部当前可观测发布记录。
3. 比较服务端候选 ID 集合与请求结果 ID 集合；不相等时返回 `409 GEO_PUBLICATIONS_CHANGED`。
4. 校验每个结果二态、发布状态、最终链接和产品归属。
5. 校验至少一个附件，全部为 `VERIFIED OPERATION_SCREENSHOT`。
6. 更正时锁定来源观测，要求来源为人工观测、同产品且尚无后继。
7. 追加观测、逐篇结果、附件和审计后一次提交；任一步失败不产生部分记录。

## 前端交互

- 弹窗打开只加载产品；选定产品后以产品 ID 作为 TanStack Query key 加载文章候选。
- 产品变化时清空旧文章标记，避免跨产品表单残留。
- 文章以表格展示标题、平台、外链和二态 Select；所有候选默认未选择，必须逐篇明确判断。
- 截图上传沿用 `DirectUpload(category="OPERATION_SCREENSHOT")`，提交按钮在候选为空或截图为空时禁用，服务端仍是最终权威。
- 弹窗继续滚动 `.ant-modal-container`，删除全局 Header sticky 定位，使标题自然滚动。
- 列表展开区展示新观测的搜索词、逐篇结果和截图数量；旧观测继续展示原提示、回答与引用。

## 无联网边界

新流程只访问 PartSignal 的产品、候选、文件和观测 API。后端不依赖 `ai_channels`、`ai_models`、Celery 或任何搜索供应商；搜索网站操作完全由用户在站外手工完成。

## 复杂度控制

- 不新增 Article 模型：发布记录已经是可观测公开文章的稳定身份。
- 不新增搜索平台配置：当前只需保存人工输入的站点名称，固定枚举会阻碍新增网站。
- 不自动抓取、比对 URL 或解析截图：这些能力没有可靠契约，且会重新引入与用户真实搜索结果不一致的问题。
