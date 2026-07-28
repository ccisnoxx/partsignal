# 完善观测记录与证据管理：技术设计

## 1. 人工观测事实模型

`GeoObservationPublication` 对新人工观测只保留：

| 字段 | 新写入 | 含义 |
|---|---|---|
| `discovered` | 必填布尔值 | 目标 AI 平台是否发现该发布内容 |
| `mentioned` | 必填布尔值 | AI 回答是否提及相关产品或品牌 |
| `accuracy` | 可空枚举 | 独立准确性判断；未判断为 `null` |

- `recommendation_status` 和 `cited` 从人工逐篇数据库列及 HTTP 契约删除。
- 删除所有累计阶段校验；三个事实互不改变、禁用或清空。
- 前端复选项始终提交 `discovered/mentioned` 布尔值，未选中表示操作者确认的 `false`；准确性允许留空。
- 既有迁移前人工行若 `discovered/mentioned` 为 `NULL`，继续作为历史未采集数据读取，不回填 false。

## 2. 指标和页面投影

- 保留旧模型观测的历史推荐、引用和准确性投影。
- 人工指标删除推荐率、引用率、未推荐内容和阶段漏斗。
- 人工总览改为：人工观测数、逐篇结果数、已发现文章数、已提及文章数、发现率、提及率。
- 人工准确率只以 `accuracy` 非空且不为 `UNJUDGEABLE` 的行作为分母；零分母返回 `null`。
- GEO 洞察用独立发现率、提及率、准确率替换累计阶段谓词；内容排行和行动项只使用仍存在的真实事实。
- 列表、Drawer、筛选、打印和总览同步删除人工推荐/引用字段，不保留隐藏查询参数。

## 3. 可选证据与更正

- `GeoObservationCreate.attachment_file_ids` 默认空数组，只在非空时校验 VERIFIED `OPERATION_SCREENSHOT`。
- 每个观测版本只持有本次新增附件关系，不复制上一版本的关联。
- 读取某个人工观测版本时，沿 `supersedes_id` 向根节点聚合截至该版本的附件 ID；更正表单只读展示这些已有证据并提供可选新增上传。
- 更正仍不能改变产品、问题主题、搜索平台或搜索词。

## 4. 整链物理删除

新增 `DELETE /api/v1/geo-observations/{observation_id}`，成功返回 `204`。

服务流程：

1. 锁定产品，再按稳定顺序锁完整人工更正链。
2. 任一链内 ID 都解析到根；只允许删除 `MANUAL_ARTICLE_SEARCH`，旧模型观测拒绝。
3. 以链尾到链根顺序逐节点设置事务本地 `partsignal.geo_observation_delete_id`。
4. 显式删除该节点附件关系、逐篇结果、引用，再删除节点。
5. 追加 `geo_observation.deleted` 审计，只记录根 ID 和数量。
6. 将失去全部引用的附件设置为立即清理，提交事务。

数据库迁移替换四张表的 append-only 触发器：

- UPDATE 始终拒绝。
- DELETE 仅在事务级目标 UUID 匹配该行 `observation_id/id` 且父观测为人工类型时放行。
- 其他直接 DELETE 继续以 PostgreSQL `55000` 拒绝。

## 5. 并发和错误

- 删除与更正都先锁产品，因此同一产品链路串行；后到请求在重新读取链状态后返回 `404` 或 `REVISION_CONFLICT`。
- 只在当前链尾的 `available_actions` 返回 `DELETE`，历史节点不单独暴露删除。
- 文件共享引用由实时外键查询决定；删除一个观测不能误删发布附件或平台 Logo。
- 审计与响应不得包含 `search_query`、`notes`、旧模型回答或文件内容。

## 6. 文件生命周期所有权

- 把引用检查、解除关联调度和清理声明移到通用文件服务。
- 平台 Logo 发现/下载逻辑继续留在平台 Logo 服务，只复用通用生命周期。
- 删除观测产生的独占附件 `cleanup_after=now`；定时清理负责 `DELETING -> DELETED` 和失败重试。
