# 完善观测记录与证据管理

## Goal

让人工观测和更正以独立、可理解的真实事实登记，不强制重复上传截图，并为记录处置与证据文件清理建立一致、可验证的服务端契约。

## Confirmed Facts

- `GeoArticleResultCreate` 当前要求逐篇提交 `discovered`、`mentioned`、`recommendation_status`、`cited`、`accuracy`，并校验 `mentioned -> discovered`、`RECOMMENDED -> mentioned`、`cited -> RECOMMENDED`、`ACCURATE -> cited`（`backend/app/schemas/geo_files.py:76-95`）。
- 创建服务要求覆盖产品当前全部可观测发布内容，并把每篇事实写入 `geo_observation_publications`（`backend/app/services/geo_observation.py:1473-1547`）。
- `attachment_file_ids` 当前最少一项，且服务只接受已验证的 `OPERATION_SCREENSHOT`（`backend/app/schemas/geo_files.py:122-140`、`backend/app/services/geo_observation.py:1490-1492`）。
- 更正通过新建 `supersedes_id` 记录实现，不修改原记录；因此当前请求模型再次强制提交附件（`contracts/database.md:137-141`）。
- 当前没有观测 DELETE API；观测、逐篇事实和附件关系受追加式触发器与 `RESTRICT` 外键保护（`contracts/openapi.yaml:1775-1850`、`backend/app/routers/observation.py:144-180`、`backend/alembic/versions/0007_geo_observation.py:13-40`）。
- 现有文件清理服务会实时检查 `geo_observation_attachments` 引用以阻止误删，但没有“处置观测后解除附件并清理对象”的路径（`backend/app/services/platform_logo_files.py:307-365`）。

## Requirements

- 逐篇人工观测只保留三个相互独立的事实：
  - `discovered: boolean`：该发布内容是否被目标 AI 平台的搜索或来源结果发现。
  - `mentioned: boolean`：AI 回答是否提及该内容相关的产品或品牌。
  - `accuracy: ACCURATE | PARTIAL | INCORRECT | UNJUDGEABLE | null`：可选的准确性判断，沿用现有协议枚举。
- `recommendation_status` 与 `cited` 从新人工观测的数据库列、API、表单、筛选和洞察口径中删除，不保留兼容写入。
- `discovered` 与 `mentioned` 采用独立复选项；未选中表示明确的 `false`，提交时仍发送布尔值。`accuracy` 可以不选择并发送 `null`。
- 新建观测的证据截图为可选项；没有截图时仍可创建有效观测。
- 更正不得要求重复上传原截图；详情按更正链聚合截至当前版本的已有证据，表单只提交本次新增附件。
- 表单、Schema、服务、数据库约束、OpenAPI、生成类型和洞察聚合必须使用同一事实模型，不保留兼容字段或双重口径。
- 人工洞察取消推荐率、引用率、未推荐内容和阶段漏斗；改为分别计算发现率、提及率和可判断样本的准确率，三项之间不互为前置条件。
- 列表为当前观测提供经服务端授权的“删除”操作；服务端把任一链内 ID 解析到完整更正链并原子删除整条链。
- 如果记录处置会使证据文件失去全部引用，文件记录与对象存储必须通过现有生命周期所有者安全清理；仍被其他记录引用时不得删除。

## Acceptance Criteria

- [x] 新建观测可以只填写最终确认的独立事实字段，并且不上传截图也能成功。
- [x] 任一独立事实可以单独选择或取消，不再被其他事实的先后关系禁用或拒绝。
- [x] `recommendation_status/cited` 不再出现在新人工逐篇数据库模型、API、表单、洞察指标或生成类型中；旧模型只读字段不受影响。
- [x] 更正页面展示更正链已有证据且允许不新增附件提交；补充附件时只为当前更正新增真实引用。
- [x] 总览、观测列表和 GEO 洞察不再显示人工推荐/引用指标，改为独立的发现、提及和准确性口径；分母为零时返回 `null` 而不是补零。
- [x] 删除任一观测不会让被它取代的旧版本重新出现在默认列表或指标；整条更正链、逐篇结果和附件关系在同一事务中删除。
- [x] 删除操作经过明确确认、服务端权限和并发校验，并留下不包含查询正文、备注或截图内容的安全审计摘要。
- [x] 证据对象仅在没有任何真实外键引用时进入清理，删除失败可重试，不出现数据库仍引用但对象已消失的状态。
- [x] 后端集成测试覆盖无截图创建、独立字段组合、更正复用证据、处置门禁与附件清理；前端测试和 Playwright 覆盖对应表单与列表操作。

## Out of Scope

- 不自动解析截图或调用外部平台复查观测真实性。
- 不把历史旧模型观测猜测或迁移为新的逐篇事实。
- 不为附件新建第二套清理器或引用计数。

## Key Decisions

- 人工观测允许物理删除，但删除单位是完整更正链，不是单个链节点。
- 删除聚合内的逐篇结果和附件关系属于同一原子事务；附件对象仅在提交后确认无任何真实引用时清理。
- 审计日志不随观测删除，且不复制已删除观测的敏感正文。
- 历史 `LEGACY_MODEL_RESULT` 继续只读保留原推荐、引用和准确性字段；本任务只推翻新人工逐篇观测模型，不猜测改写旧记录。

## Constraints

- 不得通过删除当前链尾让旧版本重新成为有效观测。
- 不得静默继承或复制附件形成第二份文件；证据归属必须有明确契约。
- 未知事实必须保持未知，不得补零或用默认值通过校验。
