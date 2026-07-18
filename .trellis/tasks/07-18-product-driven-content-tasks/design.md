# 内容任务产品驱动设计

## 设计结论

继续使用现有 `ContentTask`，把 `query_topic_id` 从所有新任务必填字段改为只承载历史关联的可空字段。普通任务和发布修复任务都沿用同一模型；不增加产品任务、无问题任务或第二套生成快照。

```text
创建内容任务
  -> 选择 Product
  -> 选择该产品 APPROVED FactVersion
  -> 选择具备 ACTIVE 规则与当前 Prompt 的 PlatformProfile
  -> 填写现有内容要求
  -> POST ContentTaskCreate（无 query_topic_id）
  -> ContentTask.query_topic_id = NULL
  -> 生成快照只冻结产品、事实、平台和任务要求
```

历史链路保持：

```text
历史 ContentTask.query_topic_id = UUID
  -> API 继续返回真实 UUID
  -> 新生成作业仍冻结真实 query_topic
  -> 发布修复任务仍继承真实 UUID
```

## 权威边界

- 产品身份与状态：`products`。
- 可生成事实：所选产品的 `APPROVED fact_versions`。
- 发布平台：具有当前 Prompt 的具体平台及其 `ACTIVE platform_profile_version`。
- 内容意图：`target_audience`、`content_angle`、`conversion_goal`、`desired_format`、长度、`canonical_url` 和工程师 `user_prompt_markdown`。
- 历史目标问题：`content_tasks.query_topic_id -> query_topics.id`，仅在历史行非空时参与读取和生成。
- 生成追溯：`generation_jobs.input_snapshot`；已写入的 JSON 快照永不改写。

## 数据库迁移

新增 revision `0019_product_driven_tasks`，`down_revision = "0018_manual_geo_observation"`：

1. 仅把 `content_tasks.query_topic_id` 从 `NOT NULL` 改为可空，保留原 `RESTRICT` 外键和索引行为。
2. 不更新任何现有行；历史任务继续持有原 UUID。
3. 不修改冻结的 `migration_schema_v1.py` 或历史 revision。
4. downgrade 在存在任一 `query_topic_id IS NULL` 的任务时先失败；没有新语义数据时才恢复 `NOT NULL`。

无需修改 `partsignal_validate_content_task()`：现有触发器只校验事实版本与产品一致且已批准、平台规则为 `ACTIVE`，正好覆盖产品驱动任务的数据库最终门禁。

## API 契约

### `ContentTaskCreate`

从请求中删除 `query_topic_id`，其余字段不变：

```json
{
  "product_id": "uuid",
  "fact_version_id": "uuid",
  "platform_profile_version_id": "uuid",
  "target_audience": "硬件工程师",
  "content_angle": "参数与应用边界",
  "conversion_goal": "查看产品资料",
  "desired_format": "技术文章",
  "desired_length_min": 800,
  "desired_length_max": 1600,
  "canonical_url": "https://example.com/product"
}
```

`additionalProperties: false` 保证旧客户端继续提交 `query_topic_id` 时得到明确契约错误，避免服务端表面接受但静默忽略。

### `ContentTask`

输出继续显式包含 `query_topic_id`，类型改为 `uuid | null`：

- 历史任务：真实 UUID。
- 新任务：`null`。

后端 Schema 不再让输出直接继承完整创建字段：`ContentTaskOut` 在复用创建字段的同时单独声明可空 `query_topic_id`。

### `PublicationRepairContext`

`query_topic` 保持响应必有键但值允许为 `QueryTopic | null`，使新旧任务的前端分支稳定：

- 历史来源任务：返回真实目标问题。
- 新来源任务：返回 `null`。

修复请求无需新增字段；服务端直接继承原任务的可空 `query_topic_id`。

## 服务端数据流

### 普通任务创建

`create_content_task()` 删除目标问题查询，其余事实、产品、平台类型、活动规则和当前 Prompt 校验不变。ORM 写入时不提供 `query_topic_id`，数据库保存 `NULL`。

### 原始生成

`build_generation_input()` 按任务字段分支：

- `query_topic_id is NULL`：不查询目标问题，`task_requirements` 不包含 `query_topic`。
- `query_topic_id is UUID`：读取真实目标问题；外键目标异常缺失时继续失败，不把历史损坏伪装成无问题任务。

确定性开发生成器仅在快照实际包含 `query_topic` 时输出“目标问题”段落；新任务直接从产品编号和内容角度开始。第三方模型接收的任务 JSON 同样不含空对象、占位文案或猜测问题。

自然化作业继续复用原始作业的不可变 `task_requirements`，无需转换新旧快照。

### 发布修复

- 上下文完整性检查不再要求所有任务都有目标问题。
- 历史任务若声明了 UUID 却无法读取目标问题，仍返回 `PUBLICATION_CONTEXT_INCOMPLETE`。
- 新任务修复继承 `NULL`；历史任务修复继承 UUID。
- 修复页只在 `query_topic` 非空时展示“历史目标问题”，页面说明统一为继承产品与平台。

## 前端交互

- `TaskCreateModal` 删除目标问题查询、字段和依赖错误分支。
- 弹窗打开只加载产品和平台；选定产品后再加载该产品事实版本。
- 提交体由生成 OpenAPI 类型约束，不包含 `query_topic_id`。
- 发布修复页条件展示历史目标问题；新任务修复页不出现空白标签或占位问题。
- 目标问题设置页暂时保留，为历史数据和旧 GEO 模型观测提供管理/读取能力。

## 兼容性矩阵

| 场景 | `query_topic_id` | 生成快照 | 修复任务 |
| --- | --- | --- | --- |
| 历史普通任务 | UUID | 保留真实 `query_topic` | 继承 UUID |
| 新普通任务 | `NULL` | 省略 `query_topic` | 继承 `NULL` |
| 历史修复任务 | UUID | 保留真实 `query_topic` | 后续继续继承 UUID |
| 新修复任务 | `NULL` | 省略 `query_topic` | 后续继续继承 `NULL` |
| 旧 GEO 模型观测 | 独立非空外键 | 不涉及内容生成 | 保持只读 |
| 人工 GEO 文章观测 | `NULL` | 不涉及内容生成 | 不变 |

## 文档一致性

- `contracts/database.md` 记录 0019 可空语义、历史保留和降级门禁。
- `contracts/openapi.yaml` 是 API 权威；前端类型由它重新生成。
- `docs/GEO多平台内容运营系统方案设计.md` 和 `docs/GEO系统前后端技术与部署方案.md` 改写新任务必须选择目标问题的陈述，同时保留历史目标问题用途。
- 不修改会话归档类文档中的历史讨论原文。

## 回滚

- 应用发布前备份 PostgreSQL。
- 迁移后尚未创建产品驱动任务时，可 downgrade 恢复 `NOT NULL`。
- 只要已有 `query_topic_id IS NULL` 的任务，禁止 downgrade；应前滚修复或恢复迁移前完整备份，不能补占位问题。
- 应用回滚到旧版本前必须确认数据库不存在空目标问题任务；旧应用无法正确读取或生成这类任务。

## 复杂度控制

- 不删除目标问题表，不迁移历史，不增加占位记录。
- 不引入新任务类型、判别字段或双写流程；可空外键已经能明确表达历史兼容。
- 不改变输出文章 JSON 契约版本；变化只在输入快照的可选 `query_topic`，现有 `task_requirements` 本就是冻结字典。
