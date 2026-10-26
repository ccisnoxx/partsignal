# CORE-02 实施、验证与恢复记录

2026-10-25。本地实现及定向验证完成，任务 `review` 等待用户审阅。没有暂存、提交、推送、生产操作或部署。

## 实际交付

- 总览 open_opportunities 替换 NOT_IMPLEMENTED 占位；实时报告新增同一 GeoOpportunitySummary。展示待处理总数、三种状态、四档优先级、同一 RR 统计时点及分组 drilldown。
- opportunity_query 为机会列表和汇总唯一 selector。open_only 复用 OPEN_STATUSES；SQL EXISTS 按机会去重，不因多个来源/历史分析/复测来源重复计数。
- source_scope JSON 查询参数复用 GeoOverviewFilters：来源运行创建时间半开窗口、冻结输入、历史尝试；REVIEWED_ONLY 读取保存的 source.review_id。对象/产品及主维度继续按机会自身归属收窄，机会创建日期与来源日期独立。
- 汇总复用调用方 as_of，仅增加一次固定聚合查询；总览空集与密集场景查询均从15增为16，无N+1。没有调用评估器、来源追加、行动写入或新调度。
- 共享只读摘要用于总览和报告。工作台保留来源范围、分组、分页与现有操作，可显式清除来源范围；报告无合格业务指标仍显示真实机会与质量摘要，原打印可用性和审计不变。
- OpenAPI 六个新/变更组件与一个旧占位删除，列表新增2个参数，generated同步。根API文档和过期方法说明已更新；机会CSV仍501，属于CORE-05。无迁移、生产配置、Key或平台开通。

## 精度与路由修复

独立复核确认 JS Date 会把合法微秒窗口截为毫秒，已改为保留合法 ISO 原文及时区，服务端裁决时间先后。测试覆盖1微秒窗口经URL到API原样传递。

真实浏览器进一步发现 Router 的 JSON query 自动解析，以及结构共享保留原对象键序。来源值在URL边界统一为严格校验对象，API边界只编码一次JSON；canonical按各字段值比较，不以对象键序判断范围变化。反转键序仍canonical，改变region_codes仍拒绝canonical；真实浏览器跳转、Back均通过。未引入通用日期算法或宽松降级。

## 实际验证命令与有效证据

PGTZ=UTC，使用本轮专用本地PostgreSQL 17（127.0.0.1:16539）及测试自动创建/删除的随机数据库。无生产连接或真实Provider/Bucket调用。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PARTSIGNAL_TEST_DATABASE_URL=postgresql://core02@127.0.0.1:16539/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_opportunity_summary.py backend/tests/integration/test_geo_overview.py backend/tests/integration/test_geo_reports.py -o addopts='' -q --tb=line`（并设PGTZ=UTC） | 首轮19通过、5失败；修正后复用19项有效证据 |
| 同上增加 `--lf` | 最终5 passed、10 deselected；未包含失败的报告文件由pytest自动跳过，复用其首轮结果。合计24项不同用例有效通过 |
| `npm --prefix frontend run test -- src/shared/geo/opportunity-summary.test.tsx src/domains/geo-insights/insights-page.test.tsx src/domains/geo-reports/reports.test.tsx src/domains/geo-opportunities/opportunities.model.test.ts src/domains/geo-opportunities/opportunities-page.test.tsx src/domains/geo-opportunities/opportunities.api.test.ts` | 6文件、45 passed |
| Router JSON修复后重跑上述 shared摘要、opportunities.model/page/api 4文件 | 4文件、28 passed，属于上述45项的受影响子集 |
| 最后键序修复后 `npm --prefix frontend run test -- src/shared/geo/opportunity-summary.test.tsx` | 4 passed，包含日期精度、实际Router serializer及键序反例 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-opportunity-summary.spec.ts` | 最终production build通过，2 projects/2 passed；375/768/1024/1440、键盘、Back、来源说明/API参数、print media、无合格指标仍显示摘要；secret scan clean |
| `.venv/bin/mypy app/schemas/geo_insights.py app/schemas/geo_reports.py app/schemas/geo_opportunity_workbench.py app/services/geo_opportunity_summary.py app/services/geo_opportunity_queries.py app/services/geo_overview.py app/services/geo_overview_queries.py app/services/geo_reports.py`（cwd backend） | 8文件通过 |
| `npm --prefix frontend run typecheck`，最终E2E production build的 `tsc -b` | 通过 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` 并断言无failures | 完整运行时合同0失败 |
| `npm --prefix frontend run api:check` | generated与根合同一致 |
| Ruff检查本轮后端Schema/服务/测试，ESLint检查本轮TS/TSX与E2E | 通过；最终URL helper及测试已重查 |

真实PG覆盖：来源去重、当前待处理/关闭状态、状态与优先级分组、分组跳转list数量相等、报告与总览同口径/时点、读取无业务写入、Run日期与机会创建日期分离、冻结语言/地区/模式/登录/点名筛选、current重分析不抹掉历史复核、非法JSON拒绝。既有总览/报告测试覆盖通用指标与CSV口径、current review、权限/审计、分页与固定查询次数。

首轮PG失败原因：测试夹具原机会优先级实际HIGH而非CRITICAL；已有机会列表没有no-store响应头，测试改为只断言已有总览/报告合同；已有总览测试硬编码容器 `/contracts` 路径，改为仓库相对路径；新增聚合使固定查询次数合同由15变16。首次汇总实现另查as_of已改为复用调用方时点。没有修改机会列表缓存行为或放宽固定查询上界。

浏览器先后失败均先定位再修复：首先JSON对象类型不匹配，随后trace确认对象键序引起canonical重定向循环。最终均通过，未过滤运行时错误或把超时当成功。构建仅有已有大chunk提示，没有扩大到拆包优化。

## 独立复核

core01_review按本轮基线增量只读复核了公共合同、筛选/来源归属、历史review、去重、RR、分组/list一致性与路由精度；确认并复核已修复微秒、JSON表示和键序问题。最后局部复核无确认阻断。该复核的内存/SQL编译证据不替代上述真实PG/HTTP与浏览器执行。

## 未执行与保留边界

未运行完整make verify、全量E2E、完整Celery/Provider/OSS业务栈或线上验收。浏览器为显式typed API fixture，目标机会页故意503，只证明实际router→API映射与来源说明；数量和业务读取由真实PG/HTTP用例核对，不宣称外部全流程成功。

OSS浏览器Logo上传仍NOT_RUN_NO_EXISTING_PLATFORM。自然清理PASS、自动跟进NOT_FOUND保留且不追查；不创建平台、不改线上配置、不新建自动跟进、不提交推送。CORE-01仍原review状态，其余10项功能未启动。

## 收尾

本轮临时 PostgreSQL、随机测试数据库、production build、Playwright 结果及失败trace、临时基线副本均已停止/精确清理。16539/4174端口关闭，无本轮遗留服务或对象。既有修改、CORE-01实现、暂存补丁和HEAD均按本轮基线逐项核对保留；git diff --check通过。公共合同增量仅为预期6个新/变更组件、旧placeholder删除和机会列表2个参数。任务保留review，清除本会话活动指针，没有归档或用户接受记录。
