# 24 表、操作列与 13 删除接口矩阵

## 1. 24 张业务表

当前全站 24 表 E2E 已在 1440px 与 375px 完整运行通过；下表的 `FAIL` 表示操作或文案存在已确认缺陷，不表示表格无法挂载。

| # | 表面 | 操作设计 | 当前结论 |
|---:|---|---|---|
| 1 | 内容任务列表 | 查看详情；取消/删除更多菜单 | PASS：服务端 `available_actions`、取消/删除组件和 200% 几何通过 |
| 2 | AI 作业列表 | 失败作业重试原快照 | PASS：生成可靠性集成恢复，列表运行边界通过 |
| 3 | 内容版本列表 | 适用时自然化 | PASS：自然化 409、内容版本和运行边界通过 |
| 4 | 产品事实列表 | 管理员删除 | FAIL：删除确认使用“物理删除”，取消后焦点落到 `BODY` |
| 5 | 事实版本列表 | 查看、审核、删除 | FAIL：引用保护通过；删除确认使用“物理删除” |
| 6 | 待发布候选 | 准备人工发布、取消待发布 | PASS：工作台 E2E 与账号/状态门禁通过 |
| 7 | 发布记录 | 登记结果、状态命令、删除 | PASS：`available_actions`、删除、附件保留与并发序列化通过 |
| 8 | 发布异常待办 | 处理异常或查看 | PASS：入口、详情和修复链路通过 |
| 9 | GEO 观测记录 | 更正；删除人工观测链 | FAIL：链删除与审计通过；确认正文使用“物理删除” |
| 10 | GEO 文章观测结果 | 随外层观测更正 | PASS：只读结果表与观测合同一致 |
| 11 | GEO 问题库 | 页头新增，无行操作 | PASS：当前合同无行编辑/删除 |
| 12 | GEO 平台表现 | 无行操作 | PASS：只读聚合 |
| 13 | GEO 内容排行 | 跳转发布详情 | PASS：只读聚合与详情跳转 |
| 14 | GEO 覆盖矩阵 | 无行操作 | PASS：只读聚合 |
| 15 | AI 渠道列表 | 配置、测试、启停、删除 | PASS：管理员闭环、工程师拒绝、删除审计通过 |
| 16 | AI 请求 Header | 编辑、删除 | FAIL：删除/重复/审计通过；缺影响说明且取消后焦点丢失 |
| 17 | AI 模型列表 | 测试、启停、编辑、删除 | FAIL：删除/重复/审计与影响说明通过；取消后焦点丢失 |
| 18 | AI 渠道操作日志 | 无行操作 | PASS：审计只读 |
| 19 | 全局审计日志 | 查看详情 | PASS：筛选和详情 |
| 20 | 模型发现弹窗 | 添加；已配置项禁用 | PASS：Modal 显式关闭和表格边界通过 |
| 21 | 平台列表 | 查看、启停、编辑、删除 | FAIL：状态守卫通过；删除确认使用“物理删除” |
| 22 | 平台类型列表 | 编辑、删除 | PASS：引用保护、最小合法删除和运行边界通过 |
| 23 | 发布账号列表 | 编辑、启停、管理员删除 | FAIL：引用保护通过；删除确认使用“物理删除” |
| 24 | 用户列表 | 编辑、重置、启停、删除、批量、导出 | PASS：最后管理员、引用、停用、审计和运行边界通过 |

### 共享结论

- 所有表的源码登记和页面几何已运行通过；只读表不机械增加操作列。
- 内容任务、发布记录、GEO 观测消费服务端 `available_actions`。其他固定菜单仍由服务端在执行时最终校验；是否统一动作投影保留为产品决策项。
- 已确认的共享 UI 根因是“Dropdown 操作菜单 + `modal.confirm`”关闭后的焦点回收，不是删除服务失败。

## 2. 13 个 DELETE 接口

| DELETE | HTTP/权限/CSRF | 成功/重复/数据库/审计 | UI 结论 | 专项结论 |
|---|---|---|---|---|
| `/api/v1/users/{user_id}` | PASS | PASS | PASS：最后管理员、停用与引用提示覆盖 | PASS |
| `/api/v1/products/{product_id}` | PASS | PASS | FAIL：实现术语与焦点回收 | FAIL |
| `/api/v1/fact-versions/{fact_version_id}` | PASS | PASS | FAIL：实现术语 | FAIL |
| `/api/v1/content-tasks/{content_task_id}` | PASS | PASS | PASS：确认、取消和失败反馈覆盖 | PASS |
| `/api/v1/platform-accounts/{platform_account_id}` | PASS | PASS | FAIL：实现术语 | FAIL |
| `/api/v1/publication-records/{publication_id}` | PASS | PASS | PASS：确认、失败与缓存刷新覆盖 | PASS |
| `/api/v1/geo-observations/{observation_id}` | PASS | PASS | FAIL：正文使用实现术语 | FAIL |
| `/api/v1/platform-types/{platform_type_id}` | PASS | PASS | PASS：引用说明明确 | PASS |
| `/api/v1/platform-prompts/{platform_prompt_id}` | PASS | PASS | PASS：绑定阻断与删除确认覆盖 | PASS |
| `/api/v1/platform-profiles/{platform_profile_id}` | PASS | PASS | FAIL：实现术语 | FAIL |
| `/api/v1/ai-channels/{channel_id}` | PASS | PASS | PASS：完整管理员闭环与工程师拒绝 | PASS |
| `/api/v1/ai-channel-headers/{header_id}` | PASS | PASS | FAIL：影响说明缺失、焦点回收失败 | FAIL |
| `/api/v1/ai-models/{model_id}` | PASS | PASS | FAIL：焦点回收失败 | FAIL |

### HTTP 探针结果

- 匿名：13/13 返回 401。
- 工程师：11 条管理员专属路径返回 403；内容任务和发布记录允许工程师执行，未知目标返回 404。
- 管理员：缺 CSRF 返回 422；错误 CSRF 返回 403；合法 CSRF 的未知目标返回 404。
- 最小合法对象：13/13 首次返回 204；直接重复返回 404；数据库目标消失；对应成功审计存在。
- 只有平台 Prompt DELETE 接受 `expected_revision`；当前集成测试覆盖缺失 revision 为 422、旧 revision 为 409 且对象保留。其余 12 条 DELETE 的旧 revision 为 `NOT_APPLICABLE`，实体修订冲突由更新/命令接口覆盖。

### 残余风险

- 高风险引用与并发边界已有集成测试，但没有把每个 DELETE 都扩展为双请求并发矩阵。
- 7 条专项 `FAIL` 均来自 UI/UX，不代表服务端删除失败。

## 3. 关键证据

- OpenAPI DELETE 定义：`contracts/openapi.yaml:206,352,427,677,794,881,961,1130,1197,1308,1634,1723,1908`
- 隔离边界探针：`artifacts/full-project-acceptance/E2E-FULL-20260731-02/delete-boundary-probe.py`
- 隔离成功探针：`artifacts/full-project-acceptance/E2E-FULL-20260731-02/delete-success-repeat-probe.py`
- 24 表运行测试：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:550`
- 真实 200% 测试：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:595`
- 删除服务与数据库边界：`backend/tests/integration/test_identity_management.py`、`test_ai_channel_management.py`、`test_publication_review_closure.py`
