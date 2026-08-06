# 删除 GEO 问题

## Goal

允许用户从 GEO 问题库删除尚未进入任何业务历史的问题主题，清理测试或误建数据；一旦问题已被内容任务、GEO 优化来源或观测记录引用，系统必须保留问题并明确展示每类直接引用数量。

## Background and Confirmed Facts

- 当前 OpenAPI 只定义问题主题的列表、新增和编辑，未定义删除接口：`contracts/openapi.yaml:481-527`。
- 当前响应只投影 `available_actions=["UPDATE"]` 和 `primary_task="USE_FOR_OBSERVATION"`，没有删除资格或阻断投影：`backend/app/services/content_planning.py:27-36`。
- 当前页面只有“使用此问题观测”和“编辑”，没有删除入口：`frontend/src/features/geo-observations/GeoTopicsPage.tsx:103-116`。
- `content_tasks.query_topic_id`、`content_task_geo_sources.query_topic_id` 与 `geo_observations.query_topic_id` 都以 `ON DELETE RESTRICT` 引用 `query_topics`：`backend/app/models/content.py:46-48`、`backend/app/models/content.py:194-196`、`backend/app/models/geo_files.py:30-32`。
- 项目已有 typed `available_actions`、required nullable `deletion`、`DeletionProjection`、结构化引用错误和 `DeletionGuidanceModal`，无需建立第二套删除模型：`.trellis/spec/backend/available-actions-contract.md`、`backend/app/schemas/common.py:26-50`、`frontend/src/shared/components/DeletionError.tsx`。
- `CONTENT_TASK`、`GEO_OPTIMIZATION_SOURCE` 和 `GEO_OBSERVATION` 已是稳定的删除阻断类型，无需新增枚举。
- 2026-08-06 只读核对线上环境时，现有三个问题主题在上述三类关系中的引用计数均为零；这只说明当前数据可删，不替代通用服务端校验。

## Requirements

### 1. 删除资格与阻断

- 仅当目标问题不存在任何 `content_tasks`、`content_task_geo_sources` 或 `geo_observations` 直接引用时允许删除。
- 任一引用存在时，不返回 `DELETE`，并通过 `deletion.blockers` 分别投影 `CONTENT_TASK`、`GEO_OPTIMIZATION_SOURCE`、`GEO_OBSERVATION` 的正整数数量；不得合并、猜测或只依赖数据库外键文本。
- 删除命令必须锁定目标问题并在同一事务内重新统计三类引用。读投影不是授权凭证；并发新增引用时必须保留目标并返回结构化 `409 QUERY_TOPIC_IN_USE`。
- 数据库现有 `ON DELETE RESTRICT` 继续作为最终完整性门禁，不改成级联或 `SET NULL`，不得删除、清空或改写任何引用历史。
- 未知问题返回 `404`；成功返回 `204`；重复删除返回 `404`。

### 2. API 与读模型

- 为 `QueryTopic` 增加 required nullable `deletion`，并把 `DELETE` 加入该资源自己的 typed `available_actions`。
- 新增 `DELETE /api/v1/query-topics/{query_topic_id}`，仅允许 `ADMIN`，并要求登录与合法 CSRF；`ENGINEER` 的问题响应必须返回 `deletion: null`，且不得包含 `DELETE`。
- 删除与并发编辑必须使用现有 `revision` 合同避免基于过期页面误删已变化的问题；具体传输形态在 `design.md` 固化，不增加兼容分支。
- 删除成功写入保留型成功审计 `query_topic.deleted`，只记录稳定目标 ID 和必要的非敏感摘要，不保存额外业务正文或引用快照。

### 3. 前端行为

- GEO 问题库按服务端 `available_actions` 与 `deletion.blockers` 显示“删除”或“查看删除条件”，不得在前端重复统计引用或推导权限。
- 可删除问题使用危险操作二次确认，明确说明删除不可恢复且不会删除任何任务、优化来源或观测历史；确认后调用 DELETE 并刷新问题列表与所有消费问题选项的既有查询。
- 被引用问题展示三类服务端阻断及数量，并允许重新检查；不为当前没有稳定筛选入口的引用类型伪造跳转链接。
- 删除失败保留页面数据并展示服务端结构化错误；并发冲突后刷新权威列表，不添加静默 fallback。

### 4. 一致性与文档

- `contracts/openapi.yaml` 是 API 权威来源，后端 Pydantic 与生成的前端类型必须保持一致。
- 更新 GEO 系统设计文档中问题库的维护能力和引用保护规则；不重复维护数据库关系定义。
- 不新增数据库迁移、依赖、通用删除框架、回收站、软删除字段或批量删除接口。

## Out of Scope

- 删除已经被任一业务历史引用的问题，或提供 force delete、级联删除、解绑、合并、归档和恢复能力。
- 批量删除、自动清理测试数据、按名称识别测试问题或生产清理后门。
- 修改内容任务、优化来源、GEO 观测的创建、查询、删除或历史不可变规则。
- 为阻断项新增缺乏权威筛选合同的下钻页面。

## Acceptance Criteria

- [x] 无三类引用的问题返回 `DELETE` 与空阻断投影；有任一引用的问题不返回 `DELETE`，并返回精确的类型与数量。
- [x] `ADMIN` 携带合法 CSRF 和当前 revision 删除无引用问题时收到 `204`，列表刷新后该问题不再出现，重复删除或后续编辑返回 `404`。
- [x] 内容任务、GEO 优化来源、观测记录分别以及组合引用时，删除返回 `409 QUERY_TOPIC_IN_USE` 和精确 `details.references`，问题与全部引用保持不变。
- [x] 读投影后并发新增引用或编辑 revision 变化时，删除拒绝且不产生部分状态或成功审计。
- [x] `ENGINEER`、匿名用户、缺失或错误 CSRF 分别由现有认证/权限/CSRF 合同拒绝，目标保持不变。
- [x] 前端对可删除问题提供危险确认；对被引用问题提供“查看删除条件”，显示三类中文标签和数量，不发送删除请求。
- [x] 删除成功刷新 GEO 问题库和既有问题选项查询；删除失败保留列表并展示结构化错误。
- [x] OpenAPI、Pydantic、生成 TypeScript 类型与前后端行为一致；新增成功审计符合保留白名单。
- [x] 相关设计文档与最终合同、权限、阻断和用户可见行为一致。

## Notes

- 本任务修改公开 API、动作投影、权限与跨层交互，属于复杂任务；实施前必须具备可审阅的 `design.md` 与 `implement.md`。
