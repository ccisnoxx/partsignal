# CORE-06 实施、验证与恢复记录

2026-10-25。本地实现与必要定向验证完成，保留review等待用户审阅；未记录用户接受或部署。未暂存、提交、推送或操作线上。

## 实际交付

- 新增管理员 `POST /api/v1/geo/observation-runs/{run_id}/reanalyze`，闭合请求 `{expected_revision, reason}`；非负严格整数和四项既有原因。当前会话ADMIN+CSRF入口校验，服务仍锁最新User验证active/改密/ADMIN，再锁Batch→Run裁决CAS、开关及终态/回答资格。工程师直接POST也拒绝。
- 路由复用原reanalyze_run的RR、当前字典/批准事实冻结、同输入PENDING/COMPLETED复用、创建/低敏审计原子提交和commit后派发；不新增另一套事务/队列/幂等存储。返回200、no-store及实际run_id/analysis_revision_id/request_id，不把接受、复用或派发伪装成计算成功。未知异常按既有安全边界处理，不泄露SQL参数或输入正文。
- 原闭合ReanalysisReason移至Schema单一声明，服务直接使用；无并行原因枚举。纯reanalyzable策略由写命令与读取共用。详情analysis.available_actions仅对当前合格管理员提供REANALYZE；不扩张采集动作、主任务或统计口径，不新增逐行查询。
- 运行详情新增显式原因表单，不自动预选原因；冻结Run revision与分析ID/状态/当前指针基线。同步inFlight与mutation约束重复点击，409/背景基线变化保留原因并暂停提交，必须显式重读后重新确认。认证主体撤销、卸载和迟到回执不回填新主体；卸载取消请求。
- 成功先保留真实回执，再取消旧读取并失效Run/洞察/报告。目标版本状态来自原详情，显示PENDING/COMPLETED/FAILED及当前标记，键盘可进入原历史锚点；回执焦点由独立ReanalysisReceipt展示组件拥有。终态Run含PENDING分析时仍5秒轮询，读取失败或后台暂停。
- 报告/洞察有30秒fresh缓存，接受时读取可能早于异步Worker完成。首次观察本次回执目标终态时，按analysis ID+诊断request ID仅再取消/失效洞察与报告一次；不失效Run、不新增计时器，也不要求曾观察到PENDING，覆盖第一次详情已完成的快速Worker交错。
- 无HTTP幂等键，request_id只作诊断。同输入复用不等于网络重放安全：字典/事实可能在重发前变化。网络/5xx/畸形4xx/错配回执都冻结本次表单，只GET重读历史人工核对，不用版本差集或旧ID证明原请求已接受，不自动重发。明确“关闭核对（不取消后台分析）”后才可独立发起另一请求。确认接受后的读取失败保留回执，可重读目标结果。
- 保留原回答、引用、旧分析/复核、采集终态和时间。FAILED重分析成功仍FAILED，指标资格沿原规则排除。无数据库schema/迁移、部署配置或依赖变化；回退本轮API/UI/投影即可，已有版本与审计保留。
- 根OpenAPI增量AST核对：只新增1条POST、3个Schema，原组件仅GeoRunAnalysisDetail的动作enum变化；无原路径变化。generated、API说明、数据库行为说明及API文档单项SHA已同步。

## 实际命令与有效证据

仅本轮本地PostgreSQL17：127.0.0.1:16939，core06用户、PGTZ=UTC；测试自动建立/删除随机数据库。HTTP为真实FastAPI会话，派发以稳定UUID记录器或明确故障替身替代Broker；没有生产连接或真实外部调用。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://core06@127.0.0.1:16939/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_reanalysis_api.py backend/tests/integration/test_geo_analysis_worker.py backend/tests/integration/test_geo_analysis_worker_guards.py backend/tests/integration/test_geo_run_quality.py -k 'reanalysis or reanalyze' -o addopts='' -q --tb=short` | 首轮13 passed、1 failed、26 deselected；失败为新增CSRF夹具长度错误 |
| 同一PG环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_reanalysis_api.py --lf -o addopts='' -q --tb=short` | 改为满足长度但不匹配会话的CSRF后1 passed、5 deselected；合计14项不同PG/HTTP用例有效通过 |
| `npm --prefix frontend run test -- src/domains/geo-runs/run-reanalysis.test.tsx src/domains/geo-runs/runs.api.test.ts src/domains/geo-runs/run-review.test.tsx src/domains/geo-runs/run-detail.test.tsx --reporter=dot` | 首轮40 passed、1 failed；失败为新增目标状态断言未等待Query异步通知，修正等待后重跑新增文件10 passed，既有31项证据复用 |
| `npm --prefix frontend run test -- src/domains/geo-runs/run-reanalysis.test.tsx --reporter=dot` | request状态所有权修正、终态缓存修正后分别复查；最终含快速完成交错11 passed，合计42项不同前端用例有效通过 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-reanalysis.spec.ts` | 两次production build和mobile/desktop各2 passed，E2E_SECRET_SCAN clean；第二次覆盖回执拆分/原PENDING终结刷新正常流。最后拓宽为首次终态的条件以新增QueryObserver交错用例及类型/lint验证，复用不变的正常浏览器流程证据 |
| `.venv/bin/mypy app/schemas/geo_reanalysis.py app/schemas/geo_reviews.py app/routers/geo_run_commands.py app/services/geo_reanalysis.py app/services/geo_reanalysis_policy.py app/services/geo_analysis_queries.py app/services/geo_read_queries.py`（cwd backend） | 7文件通过 |
| `backend/.venv/bin/ruff check backend/app/schemas/geo_reanalysis.py backend/app/schemas/geo_reviews.py backend/app/routers/geo_run_commands.py backend/app/services/geo_reanalysis.py backend/app/services/geo_reanalysis_policy.py backend/app/services/geo_analysis_queries.py backend/app/services/geo_read_queries.py backend/tests/integration/test_geo_reanalysis_api.py` | 通过；新增测试先format处理超长，不重排既有service日志 |
| `npm --prefix frontend run typecheck` | 首轮发现新组件DirtyGuard导航参数错误及新增夹具严格索引；修正后仅E2E confidence_summary缺字段，补齐后production build通过，最终缓存反例及实现后复查通过 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` 并断言无failures | 运行时合同0 failures；PG同时验证回执与详情符合根/运行时Schema |
| `npm --prefix frontend run api:generate` / `npm --prefix frontend run api:check` | generated与根合同一致 |
| `./node_modules/.bin/eslint src/domains/geo-runs/reanalysis.api.ts src/domains/geo-runs/run-reanalysis.tsx src/domains/geo-runs/run-reanalysis.test.tsx src/domains/geo-runs/runs.api.ts src/domains/geo-runs/runs.api.test.ts src/domains/geo-runs/runs-page.tsx src/domains/geo-runs/run-analysis.tsx tests/e2e/geo-reanalysis.spec.ts --max-warnings 0`（cwd frontend） | 首轮发现渲染读取request ref，改为local state。新增reanalysis-receipt.tsx及最后缓存改动后对相关4文件复查通过，其余结果复用 |

14项PG/HTTP证据包含6项新增API用例及8项原分析/资格回归：管理员/工程师/匿名/CSRF、闭合输入、Run CAS/总开关/未结束首轮拒绝、正确动作投影、实际接受UUID、同输入复用PENDING与COMPLETED、Worker追加发布及旧历史/原回答保留、FAILED不能恢复指标资格、Broker失败保留PENDING、审计失败整笔回滚及错误低敏；既有最新账号重新裁决、失败版本重试、旧current保留等继续通过。

前端证据包含服务端token入口、原因/CAS/CSRF/诊断ID、双击单POST、真实回执与焦点、PENDING到当前COMPLETED、旧历史锚点、冲突与后台变化显式重确认、未知结果仅GET核对、错配回执未知、接受后刷新失败保留ID、403隐藏、主体/卸载/迟到回执、终态分析轮询与身份边界。快速完成反例使用真实QueryObserver：先让接受后的report读取旧RR快照并fresh30秒，再释放第一次Run GET直接COMPLETED，断言report第二次读取新current、Run GET和POST仍各一次。

浏览器为真实production页面及显式API/Worker状态夹具，手机/桌面375/768/1024/1440无横向溢出，键盘打开/原因/确认/历史导航、自动5秒读取、原回答/失败采集/旧失败版本/资格说明均通过。服务端持久化、审计与版本行为由独立真实PG证据承担；未把夹具称为真实平台或完整业务栈。build输出既有大chunk提示，无阻断错误。

## 独立复核

core01_review按本轮基线只读复核权限/CSRF/最新账号、冻结/锁/事务/审计/派发、版本复用、未知结果不重放、前端主体/取消/迟到读取及公共合同。复核确认并推动修复报告缓存P2：不能依赖先观察PENDING，Worker可能在第一次详情读取前完成。最终按首次目标终态单次失效，具体反例通过；最终复核无尚未解除的确认阻断。静态复核不替代实际执行证据。

## 边界与恢复

没有执行完整make verify、全量E2E、真实Celery/Broker/Provider/OSS或线上验收，也未创建平台。后台任务原有恢复扫描保持原流程，不新增自动跟进。

浏览器上传仍NOT_RUN_NO_EXISTING_PLATFORM；OSS自然清理PASS与自动跟进NOT_FOUND均保留，不再追查。原暂停/外部等待任务保持原状态。CORE-01～06均本地实现待审阅，未记录接受/部署；6项AUTO继续规划，下一建议AUTO-01但本轮未授权实施、未启动。

## 工作区收尾

本轮专用PG、production build/Playwright结果和基线副本在最终核对后精确清理；共享依赖/uv/编译缓存保留。本轮未建立其他服务、平台或外部任务。

最终按本轮逐文件基线审查源码增量、根OpenAPI AST及文档SHA；仅CORE-06预期源码/合同/测试/说明、子任务和父清单变化。既有修改、74项暂存删除、暂存二进制补丁与HEAD保持不变。清理后核对git diff --check、git status --short及16939/4174监听。任务review、不归档，清除本会话活动指针。
