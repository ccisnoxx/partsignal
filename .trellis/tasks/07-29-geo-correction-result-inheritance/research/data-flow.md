# DEF-04 数据流与根因

## 验收证据

- 验收报告将 DEF-04 定为严重数据正确性风险：原观测逐篇结果为“发现=true、提及=true、准确”，更正表单却显示“未发现、未提及、未判断”。
- `G-correction-defaults.png` 显示产品、问题主题、人工搜索平台、观测时间、搜索词和历史证据已进入表单，但逐篇结果被清空。

## 现有数据流

1. 路由 `/observations/:observationId/correct` 复用 `GeoObservationsPage`，把路径参数作为 `correctionId` 传给 `GeoObservationForm`。
2. 表单通过 `geoObservationQueryOptions(correctionId)` 请求 `GET /api/v1/geo-observations/{observation_id}`；详情响应中的 `ManualGeoObservation.article_results[]` 已包含原记录的 `publication_record_id/discovered/mentioned/accuracy`。
3. `GeoObservationForm` 的第一个 effect 只继承产品、问题主题、搜索平台和搜索词，却把时间改成当前时间、逐篇结果设为空数组、备注设为空字符串（`frontend/src/features/geo-observations/GeoObservationForm.tsx:65`）。
4. 第二个 effect 读取当前候选文章列表；更正模式下主动把 `priorResults` 设为空数组，再用 `false/false/null` 初始化全部逐篇结果（`frontend/src/features/geo-observations/GeoObservationForm.tsx:84`）。这是 DEF-04 的直接根因。
5. 提交时表单值原样进入 `POST /api/v1/geo-observations`，并附上本次新增附件和 `supersedes_id`（`frontend/src/features/geo-observations/GeoObservationForm.tsx:105`）。
6. 服务端锁定产品和当前候选文章，精确比较提交 ID 集合；更正时锁定原记录，校验同产品、人工类型、问题主题、搜索平台、搜索词和链尾，再插入新的观测及完整逐篇关系（`backend/app/services/geo_observation.py:1464`）。服务端不更新原记录。
7. 详情投影按指定观测读取其逐篇关系；附件沿祖先链聚合展示，但每个更正版本只保存本次新增附件（`backend/app/services/geo_observation.py:254`、`contracts/database.md:253`）。

## 已确认不变量

- 更正表单的业务字段基线只能来自待更正详情响应，不得从候选文章列表重新推断逐篇事实。
- 用户未修改的产品、问题主题、搜索平台、搜索词、观测时间、备注和逐篇结果保持原值。
- `id`、`supersedes_id`、记录人、创建时间由服务端生成或控制，不从原记录伪造。
- 历史附件只聚合展示；提交只携带本次新增附件，避免复制历史关系。
- 补采前 `discovered/mentioned = null` 是未知事实，不能转换成 `false`；更正前必须由用户显式选择。
- 提交时若当前候选文章集合已经变化，继续使用现有服务端 `GEO_PUBLICATIONS_CHANGED` 原子拒绝，不在前端补造结论。
- 新记录通过 `supersedes_id` 指向原记录；原记录及其逐篇关系保持不变，默认读取只把新链尾作为当前记录。

## 现有测试缺口

- 前端测试 `补采前历史追加更正允许选择真实问题主题` 当前断言 `null/null/null` 被提交为 `false/false/null`（`frontend/src/features/geo-observations/GeoObservationsPage.test.tsx:263`），实际固化了猜测性默认值。
- 后端集成测试已有两篇文章、追加式更正和证据聚合覆盖，但更正载荷没有只修改一个逐篇字段，也没有同时断言原逐篇关系不变与新链尾保留其他字段（`backend/tests/integration/test_publication_review_closure.py:2178`）。

## 结论

无需新增 API、数据库字段、迁移、状态容器或兼容层。最小根因修复位于 `GeoObservationForm`：更正模式直接以详情响应初始化全部可更正字段和逐篇事实；新建模式才使用候选文章的空白初值。针对历史未知布尔值保留未知并要求显式选择，服务端继续作为候选集合、链尾和不可变性的最终权威。
