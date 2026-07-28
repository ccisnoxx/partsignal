# 人工观测模型与受约束删除取证

## 当前事实模型

- `GeoArticleResultCreate` 强制逐篇提交发现、提及、推荐、引用和准确性，并用模型校验器建立累计阶段关系：`backend/app/schemas/geo_files.py:76-95`。
- 创建服务锁定产品和当前全部可观测发布记录，要求请求覆盖同一集合，并强制至少一张已验证操作截图：`backend/app/services/geo_observation.py:1470-1547`。
- 更正通过新建 `supersedes_id` 行实现，原行不修改：`backend/app/services/geo_observation.py:1493-1520`。
- 人工洞察在多个聚合和阶段谓词中消费推荐、引用及累计关系：`backend/app/services/geo_observation.py:637-868,1101-1152,1390-1425`。

## 删除聚合

- `GeoObservation.supersedes_id` 是 `RESTRICT` 自引用；引用、逐篇结果和附件均以 `RESTRICT` 指向观测：`backend/app/models/geo_files.py:24-90,118-127`。
- `geo_observations`、`geo_observation_citations`、`geo_observation_publications` 和 `geo_observation_attachments` 都受追加式 UPDATE/DELETE 触发器保护：`backend/alembic/versions/0007_geo_observation.py:37-44`、`backend/alembic/versions/0008_files.py:81-90`。
- 删除必须先锁产品，再按稳定顺序锁完整更正链；逐节点设置事务级目标 UUID，显式删除附件、逐篇结果、引用和链节点。删除单位必须是整链，避免旧版本重新成为当前记录。
- 删除审计只记录根 ID、链节点数、逐篇结果数和附件候选数，不记录 `search_query`、`notes`、回答或文件内容。

## 文件生命周期

- 当前统一引用检查已覆盖平台 Logo、发布附件和 GEO 附件，但清理器只扫描 `PLATFORM_LOGO`：`backend/app/services/platform_logo_files.py:306-384`。
- 本任务应把引用检查和到期清理收敛为通用 FileRecord 生命周期所有者；平台 Logo 保留七天，删除观测或未发布记录产生的独占附件立即进入 `cleanup_after`。
- 对象存储删除必须发生在数据库提交后；删除暂时失败时保留 `DELETING`，由现有定时清理重试。

## 必测风险

- 删除与追加更正并发时只有一方成功，另一方返回冲突。
- 事务级删除门禁以外的直接 DELETE 继续由 PostgreSQL 拒绝。
- 共享附件仍有任一真实引用时不得清理；独占附件最终进入 `DELETED`。
- 数据库提交失败不能触发对象删除，存储删除失败不能伪装成已完成。
