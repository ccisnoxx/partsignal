# Frontend V2 Products Contract Readiness

## Goal

补齐 Products List 已证实的最小 API/read model 契约，使单次 `GET /api/v1/products` 能完整绘制一行，并由服务端 typed token 决定唯一主操作；不实现 Frontend V2 页面，也不提前建设其他 domain 或 Workspace 聚合。

## Confirmed Facts

- 当前 list 已返回型号、品牌、类别、Product 生命周期状态、`workflow_stage`、唯一 `primary_task`、`available_actions`、revision 和 Product 行 `updated_at`，投影无逐行查询。
- 当前缺少事实显示状态和当前事实版本摘要；Product 行 `updated_at` 也不会完整反映事实提交与审核活动。
- 当前查询支持 `search/page/page_size`，缺少 `sort/fact_status/workflow_stage`；V2 URL 参数可显式映射，不要求后端改名。
- Product PATCH、事实保存/提交/审核已有 revision、服务端重新校验、稳定错误码和 canonical response。
- Product DELETE 会锁内重新统计引用并返回 `PRODUCT_IN_USE`，但缺少 `expected_revision`；成功删除没有 canonical object，使用 `204` 和精准 query invalidation。
- 错误信封已有 `code/message/request_id/details`。Products List 不需要扩展全局 `field_errors`。

## In Scope

- OpenAPI 增加 list 专用 `ProductListItem`、事实摘要类型、事实状态与排序 enum。
- `/api/v1/products` 增加 `sort/fact_status/workflow_stage`，保留 `search/page/page_size`。
- 服务端批量投影事实摘要、聚合最近活动时间、typed workflow、唯一 primary task 和 available actions；派生筛选在计数与分页前生效。
- Product DELETE 增加必填 `expected_revision`，锁内先校验 revision，再复核全部引用。
- 补充直接证明 read model、筛选/排序/分页、固定查询次数、revision 和稳定错误码的测试。
- 更新直接相关 V2 蓝图；机械重生成 V1 OpenAPI types，并同步用户明确批准的一个合同 fixture 和一个 DELETE 参数调用。

## Out of Scope

- 不初始化或修改 `frontend-v2/`，不实现 Products 页面、Action Registry 或 Foundation Bootstrap。
- 不新增 Product Detail、Fact Workspace、Workspace context 或其他 domain 聚合 endpoint。
- 不修改数据库、Alembic 或持久化结构。
- 不重命名现有后端参数，不增加兼容别名、可选旧路径、客户端 join、静默默认值或手写 API DTO。
- 不扩展全局 ErrorEnvelope，不处理 `/products/new` 的字段级表单错误。
- 除获批的生成文件、单条 fixture 和单个 DELETE 调用外，不修改 V1 UI、路由、状态或测试行为。
- 不 push、合并、归档或自动进入下一 Task。

## Requirements

- `ProductListItem` 保留现有 Product list 字段，并必填 `fact_status`、`current_fact` 和聚合 `updated_at`。
- `current_fact` 表示版本号最大的不可变事实版本；无版本时为 `null`，同时 `fact_status=NOT_ENTERED`。
- `fact_status` 支持 `NOT_ENTERED/PENDING_REVIEW/CHANGES_REQUESTED/APPROVED/RETIRED`。
- `primary_task` 保留真实服务端六个 token；导航主入口不重复加入 `available_actions`。
- Search 只匹配型号与品牌，并将 SQL 通配符按普通字符处理。
- Sort 支持 `UPDATED_DESC/UPDATED_ASC/MODEL_ASC/MODEL_DESC`，默认 `UPDATED_DESC`，用 Product id 稳定打破并列。
- V2 后续映射固定为 `q -> search`、`pageSize -> page_size`、`factStatus -> fact_status`、`workflowStage -> workflow_stage`。
- DELETE 的过期 revision 返回 `REVISION_CONFLICT`；当前引用阻断返回结构化 `PRODUCT_IN_USE`；失败不得删除目标或引用。

## Acceptance Criteria

- [ ] 单次 Products list 响应可绘制型号、品牌、类别、事实状态、当前事实版本/状态摘要、最近活动时间、typed workflow、唯一主任务和可尝试动作。
- [ ] 无事实、编辑中、待审核、待修订、已批准和已停用场景返回互相一致的 `fact_status/current_fact/workflow_stage/primary_task`。
- [ ] 已批准事实存在但工作区已修改时，fact summary 保持已批准版本，workflow stage 为 `FACTS_EDITING`。
- [ ] `fact_status/workflow_stage` 在 `total` 和分页前生效；四种 sort 稳定，search 不把 `%/_/\\` 当通配符。
- [ ] 增加产品行数不会造成 projection 查询次数线性增长。
- [ ] Product DELETE 覆盖 missing/invalid/stale/current revision 与读后新增引用竞态，并返回稳定错误 code/details。
- [ ] OpenAPI、FastAPI runtime、生成类型、最小 V1 同步、测试和直接相关 V2 文档一致。
- [ ] Required Validation 全部通过，全量 diff 无越界修改。
