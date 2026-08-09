# 真实业务 Flow、产品缺口与 Phase 2 Gate

## 1. Flow A：批准事实与 Content handoff

所有可变业务步骤通过 V2 UI；测试 API 只建立会话和读取最终投影。

1. 测试 API 以 seed admin 登录；打开 V2 `/products/new`，确认 AppShell 已加载真实 session。
2. UI 创建唯一产品 `PF-A-<uuid>`；断言 canonical navigation 到 `/products/{productId}`。
3. 点击服务端 primary action“录入事实”进入 Fact Workspace。
4. UI 写入唯一 Markdown，选择 `PUBLIC`，点击“保存事实”；断言保存状态 revision 前进、dirty 清除。
5. UI 点击“提交事实审核”，填写唯一 change summary；断言仍停留 workspace、提交动作消失。
6. 返回 Products List，以唯一型号搜索；断言该行 primary 为“审核”，点击进入 Fact Review。
7. 断言不可变 snapshot、版本号、change summary 与提交历史；UI 批准并确认，断言审核动作消失。
8. 返回 Products List 搜索产品，点击产品名称进入 Product Detail。
9. 断言唯一 primary“创建内容”的 href 精确为 `/content/tasks/new?productId=<encoded productId>`，但不点击不存在的页面。
10. 点击“当前批准事实”的版本链接，进入 `/products/{productId}/facts/versions/{versionId}`；断言 `APPROVED`、只读标记、原 Markdown、无 textbox/保存/审核命令。
11. 通过真实 API `GET /api/v1/products/{productId}` 或 detail read model 断言 `primary_task=CREATE_CONTENT_TASK`；并断言 FactVersion `product_id`、version 与状态正确。

不在本 Flow 创建 ContentTask。已有 V1 真实栈 `mvp-flow.spec.ts:458-459` 已通过真实 API 证明批准事实可创建内容任务；完整 V2 UI 创建属于 Phase 3。

## 2. Flow B：退回、修订、重提与历史归属

1. UI 创建唯一产品 `PF-B-<uuid>`，进入 Fact Workspace。
2. UI 写入并保存 `PUBLIC` Markdown v1，填写唯一 summary `flow-b-v1-<uuid>` 并提交。
3. 经 Products List 的“审核” primary 打开 Fact Review；断言目标为 `FactVersion v1`，历史只含 v1 submit。
4. UI“退回修改”，填写唯一意见 `flow-b-return-v1-<uuid>`；断言 canonical 状态 `CHANGES_REQUESTED`、动作消失。
5. 经 Products List 的“修订” primary 返回 Fact Workspace；修改 Markdown，保存后 revision 前进。
6. UI 以 summary `flow-b-v2-<uuid>` 重新提交；经 Products List 的“审核”进入新目标版本。
7. 断言目标为 v2；UI 历史包含 v2 submit summary，不包含 v1 summary 或 v1 request-changes comment。
8. UI 批准 v2；刷新后的审核历史包含 v2 `submit-review` + `approve`，仍不包含 v1 记录。
9. 最终通过测试 API 读取 `GET /api/v1/products/{productId}/fact-review-context`，断言目标版本为 v2，且每条 `review_history.target_id` 都等于该 v2 ID。

这些断言与 `backend/tests/integration/test_product_detail.py:429-612` 的 PostgreSQL integration coverage 互补：integration test证明服务层边界，V2 E2E证明真实页面没有串错目标或在本地模拟状态。

## 3. `/content/tasks/new` 缺口结论

- `frontend-v2/src/routeTree.gen.ts` 只有 Product、Fact Workspace、Fact Review 与 Fact Version Detail；不存在 `/content/tasks/new`。
- `frontend-v2/src/domains/product/product.model.ts:65-66` 已将 `CREATE_CONTENT_TASK` 映射为正确 handoff URL。
- 本 Task 只验证服务端 token 与 href，不点击、不创建占位页面、不用 fixture 伪造成功。
- 后端允许绑定批准事实的证据来自真实 API E2E 与 `content_planning.create_content_task` 的服务端门禁；明确标注为后端能力，不表述成 V2 UI 完成。
- 完整 UI 创建步骤保留 Phase 3 `New Content Task`，不创建额外 Phase 2 task。

## 4. Fact History 缺口结论

- OpenAPI 已有 `GET /api/v1/products/{product_id}/fact-versions` 与 `FactVersionList`，但 V2 `product.api.ts` 没有 history query，routes 没有列表 route，Product Detail 只显示 approved/pending 两个摘要。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md:108-112` 明确历史列表的 URL、数据入口和 owner 未决，并要求后续独立 Task。
- `VIEW_FACT_HISTORY` 当前在 `product.model.ts:67-68` 进入 Product Detail；详情能到当前 approved/pending version detail，但不能扫描全部历史，因此不满足蓝图的历史列表能力。
- 结论：这是明确 Product Facts gap。建议后续独立 Task `frontend-v2-fact-history`，先决定 URL/owner/read model，再实现无操作列的 history list；本 Task 不创建该 Task、不实现路由或页面。

## 5. Phase 2 Exit Gate 判断

当前判断：**NOT_MET**。

- 真实栈 Flow A/B 已通过，关闭了“真实 Product Facts 状态转换”验证缺口。
- `/content/tasks/new` 完整 UI 明确属于 Phase 3；Phase 2.8 只能证明后端 `CREATE_CONTENT_TASK` 与正确 handoff URL，不能把 Content UI 计为完成。
- Fact History 列表属于未解决的 Product Facts 产品能力，且蓝图明确要求独立 Task；在该 gap 关闭前不能宣称 Product Facts 的全部 Phase 2 退出条件满足。
- `docs/frontend-v2/07-migration-plan.md:351` 的“create content task 主流程通过”需要在本 Task 文档更新中澄清为 Phase 2 的 handoff gate，完整 UI creation 归 Phase 3；否则路线文档与已批准边界冲突。

本 Task 自身可以在真实 Flow A/B、harness、最小去重和文档一致性验证通过后完成，但完成本 Task不等于宣布 Phase 2 全部退出。
