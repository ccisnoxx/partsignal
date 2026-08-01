# 全局资源动作投影收敛：技术设计

## 1. 设计结论

不建立通用动作引擎。每个领域在现有 service 模块内保留自己的动作 token 和资格谓词，列表/详情投影与命令守卫共同调用这些谓词；OpenAPI 只把各资源的 typed `available_actions` 暴露给前端。前端删除本地业务资格推断，只负责按投影渲染和在命令竞态失败后刷新。

## 2. 权威不变量

```text
PostgreSQL 当前资源/引用状态 + 当前操作者
  -> 领域资格谓词（单一所有者）
       -> available_actions 投影
       -> 命令入口最终守卫
  -> OpenAPI typed response
  -> 前端呈现/启用
```

1. PostgreSQL 是业务状态唯一来源，服务端命令是最终权限和状态边界。
2. `available_actions` 是“当前响应时刻可尝试的命令”投影，不是授权凭证；写请求到达时必须重新校验。
3. 同一资源的列表、详情和非删除命令响应使用同一投影器，不各自拼装动作。
4. 各资源动作 token 保持领域类型，不统一大小写、不翻译、不建立跨资源 enum。
5. 集合级创建与纯 UI/传输动作没有资源实例，不纳入本合同。

## 3. 资源与动作合同

动作名优先复用现有路由/前端术语；实施前通过 OpenAPI operation 和服务命令逐项确认。下表是批准范围，不授权新增命令。

| 响应资源 | 计划动作 token | 权威实现位置 |
| --- | --- | --- |
| `UserOut` | `UPDATE`, `RESET_PASSWORD`, `ENABLE`, `DISABLE`, `DELETE` | `services/identity.py`；现有本人、最后管理员、状态和历史引用守卫 |
| `ProductOut` | `UPDATE`, `DELETE` | `services/product_facts.py` |
| `ProductFactsDraft` | `SAVE`, `CREATE_VERSION` | `services/product_facts.py` |
| `FactVersionOut` | 现有审核 token + `DELETE` | `services/review.py`, `services/product_facts.py` |
| `QueryTopicOut` | `UPDATE` | 查询主题所属 service/router 的现有更新守卫 |
| `PlatformProfileOut` | `UPDATE`, `ENABLE`, `DISABLE`, `DELETE` | 平台配置 service 与 `services/projections.py` |
| `PlatformTypeOut` | `UPDATE`, `DELETE` | 平台配置 service |
| `PlatformPrompt*` | `UPDATE`, `DELETE` | 平台配置 service |
| `ContentHumanizationPromptOut` | `UPDATE` | 平台配置 service |
| `AIChannel*` | `UPDATE`, `REPLACE_API_KEY`, `ENABLE`, `DISABLE`, `DELETE`, `DISCOVER_MODELS`, `CREATE_HEADER`, `CREATE_MODEL` | `services/ai_configuration.py` |
| `AIChannelHeaderOut` | `UPDATE`, `DELETE` | `services/ai_configuration.py` |
| `AIModelOut` | `UPDATE`, `TEST`, `ENABLE`, `DISABLE`, `DELETE` | `services/ai_configuration.py` |
| `PlatformAccountOut` | `UPDATE`, `ENABLE`, `DISABLE`, `DELETE` | `services/publication.py` |
| `ContentTaskOut` | 保留 `CANCEL`, `DELETE`；补充 `CREATE_GENERATION_JOB`, `CREATE_MANUAL_VERSION` | `services/projections.py`, `services/content_production.py`, `services/publication.py` |
| `GenerationJobOut` | `RETRY` | `services/content_production.py` |
| `ContentVersionOut` | `CREATE_REVISION`, `CREATE_HUMANIZATION_JOB` 及现有审核 token | `services/content_production.py`, `services/review.py` |
| `PublicationCandidate` | `REGISTER` | `services/publication.py`, `services/publication_queries.py` |
| 发布记录/关注事项 | 保留现有 token | `services/publication_queries.py`, `services/publication.py` |
| GEO 观察 | 保留 `CORRECT`, `DELETE` | `services/geo_observation.py` |

如果现有接口的正式命令名与计划 token 不同，使用既有正式名并同步本任务资料；不得为了表格而重命名 API 或增加别名。

## 4. 后端设计

### 4.1 资格谓词与投影器

- 在各现有领域 service 中提取最小的纯判定函数或复用已有 `_fact_actions`、`_content_actions`、`publication_actions`、`attention_actions`、GEO 当前性投影等实现。
- 简单的角色/状态条件可直接由领域投影器返回 typed list；需要数据库引用或父子状态的条件先由服务批量取得事实，再传入同一谓词。
- 命令函数调用同一谓词或其底层 `can_*` 判断后返回既有错误，不能用“动作不在数组”替代具体业务错误合同。
- 不新增跨领域 base class、registry、策略模式或反射式 action framework。

### 4.2 Actor 与响应上下文

- 投影入口显式接收 `actor` 或已经判定的权限事实，不使用可空 actor、默认管理员或静默空数组。
- `UserOut` 等同时出现在认证自服务和管理接口的 Schema，调用者显式传入动作列表：认证自服务为 `[]`，管理接口为 actor-aware 投影；不复制一个只为动作字段存在的平行 DTO。
- 嵌套资源拥有自己的动作数组，父资源动作不得替代 Header、模型、版本或作业的资格。

### 4.3 列表性能

- 删除/编辑资格涉及引用时，列表查询一次性聚合目标 id 集合或复用已有计数/关联加载，随后内存投影。
- 禁止在 Pydantic serializer、React 映射或逐行 presenter 内发起数据库查询。
- 对产品、用户、平台配置和平台账号等新增引用资格的列表，增加查询计数或 SQL 形状回归，证明行数增长不会线性增加资格查询。

### 4.4 响应一致性

- 统一由现有 presenter/projection 函数构造资源响应；router 中散落的 `model_validate` 改为调用对应领域 presenter。
- 更新、启停、测试、重试、审核等返回资源的命令在提交/刷新后重算动作。
- DELETE 保留 `204`；批量命令保留既有结果合同，但前端只允许所有选中资源均具备目标动作时发起。

## 5. OpenAPI 与前端设计

### 5.1 合同

- 在 `contracts/openapi.yaml` 为表中资源增加各自的 action enum/Literal 与必填 `available_actions`。
- 用项目既有合同生成命令更新 `frontend/src/shared/api/schema.d.ts`，禁止直接编辑生成文件。
- 现有内容任务、审核、发布、GEO action 定义原样保留；仅在同一资源确有批准命令时扩展。

### 5.2 消费规则

- 页面从资源类型推导 action union，直接 `includes`/遍历渲染；不建第二份手写映射。动作到中文按钮文案可保留在所属 feature 内。
- 权限 hook 仍可控制页面/路由访问，但不能再次决定某个资源命令是否可用。
- mutation 成功后优先使用响应数据；现有 query 架构更适合失效时调用已有 invalidate/refetch，不增加全局状态。

### 5.3 原缺陷的最小闭环

- `ContentTasksPage.tsx`：生成作业行改为检查 `row.available_actions.includes("RETRY")`；终态任务限制由 `GenerationJobOut` 投影承载。
- `PublicationRepairPage.tsx`：仅在关注事项包含 `CREATE_REPAIR_TASK` 时显示可提交表单，否则显示只读状态。
- `GeoObservationForm.tsx`：建立一个来自 `correctionRecord.available_actions` 的 `canCorrect`，传给表单控件、附件上传/移除和提交按钮；已有错误提示复用该值。

## 6. 权威文件边界

| 层 | 计划位置 |
| --- | --- |
| API 合同 | `contracts/openapi.yaml`；生成的 `frontend/src/shared/api/schema.d.ts` |
| 后端 Schema | `backend/app/schemas/common.py`, `configuration.py`, `product_facts.py`, `content.py`, `publication.py`；GEO 只验证既有字段 |
| 后端动作所有者 | `backend/app/services/identity.py`, `product_facts.py`, 平台配置 service, `ai_configuration.py`, `content_production.py`, `review.py`, `publication.py`, `publication_queries.py`, `geo_observation.py`, `projections.py` |
| Router/presenter 收敛 | `backend/app/api/v1/identity.py`, `planning.py`, `configuration.py`, `product_facts.py`, `production.py`, `publication.py` 中受影响响应构造点 |
| 前端消费者 | `frontend/src/features/{users,products,product-facts,configuration,content-tasks,content-editor,publications,geo-observations}/` 的现有命令页面与测试 |
| 稳定规范 | 新增 `.trellis/spec/backend/available-actions-contract.md`，并从后端、前端索引挂入；记录可执行跨层合同，不复制完整资源 token 表 |

实施时以完整调用链为准，只修改实际承载范围内命令的文件；不因目录表而机械触碰无变更文件。

## 7. 测试设计

### 7.1 后端

- 在现有领域单元/集成测试中，以参数化方式覆盖每类资源的允许与禁止动作，并调用对应命令证明共同资格谓词没有漂移。
- 三个缺陷分别覆盖：终态任务失败作业无 `RETRY`、已解决关注事项无创建修复动作、非尾部 GEO 无 `CORRECT`。
- 保留现有发布、审核、内容任务与 GEO action 测试，作为旧合同不回归证据。
- 只为需要数据库引用的关键列表加查询数量证据，不建立全仓 SQL 监控框架。

### 7.2 前端

- 在现有 feature 测试内用相同状态但不同 `available_actions` 的响应验证入口随投影变化，防止测试继续绑定本地 status/role。
- 对危险/凭据/保存/子资源命令至少各覆盖一个代表路径；同模板的简单按钮不逐个复制完全相同用例。
- 对 `PS-QA2-FUNC-001`～`003` 各保留一条可失败的定向回归。

## 8. 风险与回滚

- 最大风险是字段覆盖面大而遗漏某个响应构造点；通过 OpenAPI required 字段、生成类型、全仓 `model_validate`/构造调用搜索和合同检查共同封闭。
- 最大性能风险是引用资格导致 N+1；批量事实与关键列表查询计数是完成门禁。
- 竞态窗口不会消失，命令守卫必须保留；前端收到冲突/禁止错误后刷新资源即可，不加乐观兼容分支。
- 无迁移和数据转换；回滚时整体回退同一原子工作提交，避免合同与消费者不同步。
