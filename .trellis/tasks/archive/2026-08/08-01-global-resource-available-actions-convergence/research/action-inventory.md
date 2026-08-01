# 全局资源动作投影：现状清单

## 1. 权威来源

- 第二轮最终报告：`.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/report.md`
- 技术 findings：`.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/findings.md`
- 用户批准：实施 `PS-QA2-DEC-002` 全局合同收敛，覆盖现有资源绑定的状态、危险、编辑、保存、凭据与子资源命令；明确排除集合级创建、纯导航/查看/复制/筛选/导出/打印、认证自服务和文件传输内部动作。

## 2. 已有正确模式

| 领域 | 服务端权威 | 前端消费者 | 结论 |
| --- | --- | --- | --- |
| 内容任务取消/删除 | `backend/app/services/projections.py` | `ContentTasksPage.tsx`, `PublicationWorkspace.tsx` | 保留 token 和投影器，扩展任务子资源命令时复用 |
| 事实/内容审核 | `backend/app/services/review.py` | `ProductFactsPage.tsx`, `ContentEditorPage.tsx` | 已有 `_fact_actions`/`_content_actions`，不得另建审核状态表 |
| 发布记录/关注事项 | `backend/app/services/publication_queries.py` | 发布工作台/详情/关注页 | token 大小写与其他领域不同但已是合同，不统一重命名 |
| GEO 观察 | `backend/app/services/geo_observation.py` | 列表和抽屉 | 后端投影已正确；只补全更正表单消费路径 |

## 3. 三个直接缺陷

| 缺陷 | 已核对实现 | 正确修复边界 |
| --- | --- | --- |
| `PS-QA2-FUNC-001` | `frontend/src/features/content-tasks/ContentTasksPage.tsx` 用 `row.status === "FAILED"` 显示重试；`backend/app/services/content_production.py::retry_generation_job` 另有任务状态守卫 | 给 `GenerationJobOut` 投影 `RETRY`，页面只消费该字段，命令继续最终校验 |
| `PS-QA2-FUNC-002` | `publication_queries.py::attention_actions` 对已解决事项返回 `[]`；`PublicationRepairPage.tsx` 没有消费 | 修复页以 `CREATE_REPAIR_TASK` 为唯一可编辑门禁 |
| `PS-QA2-FUNC-003` | GEO 非尾部记录已无 `CORRECT`；`GeoObservationForm.tsx` 只形成错误而没有封闭附件/提交交互 | 单一 `canCorrect` 约束整张更正表单 |

## 4. 当前缺少投影的响应 Schema

- `backend/app/schemas/common.py`：`UserOut`。
- `backend/app/schemas/configuration.py`：`QueryTopicOut`、平台档案/类型/Prompt、内容自然化 Prompt、AI 渠道/Header/模型。
- `backend/app/schemas/product_facts.py`：`ProductOut`、`ProductFactsDraft`、`FactVersionOut`。
- `backend/app/schemas/content.py`：`GenerationJobOut`、`ContentVersionOut`；`ContentTaskOut` 只有取消/删除。
- `backend/app/schemas/publication.py`：`PlatformAccountOut`、`PublicationCandidate`；发布记录与关注事项已有。
- `backend/app/schemas/geo_files.py`：GEO 已有，无 Schema 新增。

## 5. 当前散落的响应构造点

- `backend/app/services/projections.py` 已集中内容任务、内容版本、事实版本和部分平台投影，可作为既有 presenter 模式。
- `backend/app/api/v1/identity.py`, `planning.py`, `configuration.py`, `product_facts.py`, `production.py`, `publication.py` 仍有局部 `model_validate`/直接 Schema 构造；实施时改为对应领域投影器，避免列表、详情、命令响应各自漏字段。
- 资格权威分布在 `identity.py`, `product_facts.py`, 平台配置 service, `ai_configuration.py`, `content_production.py`, `review.py`, `publication.py`, `publication_queries.py`, `geo_observation.py` 的现有命令守卫中。

## 6. 前端命令面

- 用户管理：编辑、重置密码、启停、批量启停、删除。
- 产品与事实：产品删除；事实工作区保存/创建版本；版本审核和删除。
- 平台配置：档案、类型、Prompt、自然化 Prompt 的编辑/保存、启停、删除。
- AI 配置：渠道编辑/凭据/启停/测试/删除，Header 与模型的创建、编辑、测试、启停、删除。
- 平台账号：编辑、启停、删除。
- 内容生产：任务取消/删除、生成、人工版本、作业重试、自然化、修订、审核。
- 发布：候选登记、现有记录命令、关注事项创建修复/解决。
- GEO：更正和已批准的记录删除。

这些入口目前混用 `available_actions`、`status`、认证角色和局部引用数据。完成状态要求范围内入口全部指向服务端投影；页面访问权限不属于资源动作资格，可继续由既有路由/权限边界处理。

## 7. 排除项核对

- 页面上的“新建”按钮不新增集合动作字段。
- 查询、筛选、复制链接/内容、导出、打印、打开抽屉/详情不纳入。
- 登录、退出、修改本人密码不纳入；管理员对其他用户的凭据重置纳入。
- 文件上传/下载/分片/终止、Logo 候选发现与预览不纳入；与已存在资源绑定的业务“自然化/生成/登记”不是文件传输，仍纳入。

## 8. 实施核对问题

- 每个动作是否已有真实命令路由和服务守卫；没有则不为它创造 token。
- 同一资格能否由命令和投影调用同一谓词；若需要数据库事实，批量取得而不是逐行查询。
- 列表、详情、嵌套资源和命令响应是否都经过同一 presenter。
- 前端是否仍有同类别命令通过 `status`/角色绕开投影。
- mutation 后是否获得或重取新的动作，而不是本地拼装。
