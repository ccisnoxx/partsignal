# G05 GEO 问题库

## Goal

验收 `/geo/topics` 的服务端 Query Topic 列表、引用与删除条件、管理命令、冲突及移动布局。

## Requirements

- 前置 G01、F05 已按本轮证据完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.5 节、`05-business-actions-state-and-api-contract.md` QueryTopicListItem、`08-testing-quality-and-acceptance.md` GEO Topics、`11-frontend-redevelopment-task-list.md` G05 与 `contracts/openapi.yaml`。
- V2 列表只读取 `GET /api/v1/query-topics/list-items`，服务端处理 `q/sort/page/page_size` 和稳定三类引用摘要；不从完整 Topic options 本地切页、过滤或逐行 join。五列显示 canonical question、intent、compact variants、引用及动作，主入口按服务端 `USE_FOR_OBSERVATION` handoff。
- 创建/更新使用短 Dialog；PATCH/DELETE 提交 `expected_revision`，DELETE 只在服务端提供 DELETE token 且 blocker 为空时可确认。409 保留输入并冻结旧 revision，只有显式完整重读成功后人工再提交，不自动 replay。删除竞态显示服务端最新引用类型、数量和 canonical resolve link。
- mutation 失效 Topic options、Topic list、GEO Insights 与实际 GEO/Content 引用消费者；URL direct/refresh/Back/Forward、空/错/加载/页外、焦点与四档宽度可用。

## Acceptance Criteria

- [x] PostgreSQL integration、API/model/page 测试证明服务端分页/引用、角色删除投影、revision、审计与删除最终守卫。
- [x] 当前 production artifact 严格 fixture 的移动/桌面列表、筛选分页、命令、409 显式恢复、引用链接、焦点及四档宽度通过。
- [x] 记录实际代码、验收证据、残余风险与 G06 下一步。

## Notes

- 优先复用既有实现和本轮验证；仅在发现具体合同缺口时做局部修复。G08 负责 GEO 完整真实栈闭环。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：本项核对后无需修改既有 Topic 页面、model、API 或 route。`query-topic-list-page.tsx` 使用服务端 list-items 的五列与三类引用摘要，`query-topic-list.model.ts` 严格映射 URL/API、服务端主任务 handoff 和 canonical 引用链接。编辑/删除对话框使用服务端 revision、动作资格与 blocker；409 保留当前输入或确认上下文，只有显式完整重读后可人工重试。失效覆盖 Topic options/list 与 GEO/Content 引用消费者。
- 本轮验证：`query-topic-list.model.test.ts` 3/3；隔离 PostgreSQL `test_query_topic_list.py` 2/2（搜索/排序/分页、三类引用、角色投影、固定批量查询、创建/更新 revision 与审计）和 `test_publication_workflow.py::test_query_topic_delete_requires_no_direct_business_references` 1/1（直接引用、投影后竞态、旧 revision、成功删除审计及重复删除）。移动/桌面 production preview `geo-topics.spec.ts` 20/20，覆盖五列、引用 Dialog、最新 blocker/revision、URL direct/refresh/Back/Forward、空/错/页外、创建/更新/删除、409 显式恢复、焦点和 375/768/1024/1440 宽度；严格 fixture 在 teardown 拒绝未声明 API。当前生产构建随浏览器 webServer 通过；G04 后 `npm run typecheck` 通过且 G05 源码未变，G05 文件定向 ESLint 与 `git diff --check` 通过。
- 覆盖边界：本项 fixture 与 PostgreSQL 测试分别证明页面接口和服务端守卫；完整 GEO new → detail → correction 真实栈仍由 G08 执行。下一步 G06 GEO Insights 的七参数 URL、聚合与优化命令。
