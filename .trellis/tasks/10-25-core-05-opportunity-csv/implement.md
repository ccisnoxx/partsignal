# CORE-05 实施、验证与恢复记录

2026-10-25。本地实现及必要定向验证完成，等待用户审阅；未部署或记录用户接受。没有暂存、提交、推送或线上操作。

## 实际交付

- 原报告 `/api/v1/geo/reports/opportunities.csv` 接入真实导出。保留GeoOverviewFilters输入，映射source_scope + open_only=true，与CORE-02报告待处理摘要同口径；无合格运行指标仍可导出已保存的匹配机会。exports capability=true，下载新快照无数据时409。
- 工作台新增 `/api/v1/geo/opportunities/export.csv` 与“导出机会CSV”原生链接。复用GeoOpportunityFilters的全部筛选/排序，覆盖全部匹配机会（可包含关闭状态），忽略UI分页；来源范围保持微秒和原时区，URL排除分页/详情/自由字段。页面明确流式发送与错误/传输边界。
- 机会查询owner抽取原排序列，列表和keyset迭代共用。PRIORITY_DESC/CREATED_DESC/LAST_SEEN_DESC均按原稳定降序及唯一ID比较；每批100条，无任意截断，不按来源/行动重复，复用原selector与ListItem状态/标题投影。
- geo_opportunity_csv.COLUMNS为26个固定低敏列，包含机会身份/规则/状态、对象/产品/主题与配置身份/名称、时间窗口及来源/行动计数。排除说明、关闭备注、回答/事实正文、来源/行动快照、URL和凭据；名称为读取时当前元数据，来源过滤仍用冻结输入/历史review，不称为归档回放。
- 原CsvStream/GeoCsvResponse继续拥有BOM、安全单元格、固定列编码、文件名/响应头、锁和取消/断开/失败释放。prepare层仅通过row_factory装配两种实际过滤输入，共用专有RR/no-autoflush、首条预取、独立重新授权与开始审计；原三种CSV仍调用原行生成器。
- 空集409且无成功审计；审计失败阻断交付并释放会话。审计仅种类/as_of/筛选SHA；工作台先归一化分页，报告仍摘要原GeoOverviewFilters。不会改机会、来源、行动、评估或revision。
- 根OpenAPI仅新增工作台GET；原报告机会CSV仅移除501并修正200描述，保留原参数、错误ref及summary；其他路径和全部组件未变。generated、API说明和数据库行为合同更新，无DDL/迁移、归档模型、依赖、调度或配置变化。

## 实际命令与有效证据

本轮专用本地PostgreSQL 17：127.0.0.1:16839，PGTZ=UTC；测试自行建立/删除随机数据库。没有生产连接或真实OSS/AI/Provider调用。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://core05@127.0.0.1:16839/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_opportunity_csv.py backend/tests/integration/test_geo_reports.py -k 'opportunity_csv or empty_report or independent_audit or later_batch_failure or audit_failure or fresh_audit' -o addopts='' -q --tb=short` | 首轮7 passed、4 failed、4 deselected；失败在新增测试夹具，5项既有CSV/审计回归及新RR/失败路径2项有效通过 |
| 同一环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_opportunity_csv.py --lf -o addopts='' -q --tb=short` | 首次修正后3 passed、1 failed、2 deselected；最终1 passed、5 deselected。合计11项不同PG/HTTP用例有效通过，未重复累计重跑 |
| `backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_reports.py -o addopts='' -q --tb=short` | 34 passed，含Unicode/控制/公式前缀、固定列编码、100k合成行恒定缓冲、取消/断开/迭代失败释放等现有合同 |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunities.model.test.ts src/domains/geo-opportunities/opportunities-page.test.tsx src/domains/geo-reports/reports.test.tsx --reporter=dot` | 3文件26 passed |
| `npm --prefix frontend run e2e -- tests/e2e/geo-opportunity-csv.spec.ts` | 前两轮各2 failed，定位修正夹具/断言后最终production build、mobile/desktop共2 passed，E2E_SECRET_SCAN clean |
| `.venv/bin/mypy app/services/geo_opportunity_csv.py app/services/geo_opportunity_queries.py app/services/geo_reports.py app/services/geo_report_csv.py app/routers/geo_reports.py app/routers/geo_opportunities.py`（cwd backend） | 6文件通过 |
| `npm --prefix frontend run typecheck` | 首轮、最终production build及收窄根OpenAPI生成后均通过 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` 并断言无failures | 运行时合同0 failures，收窄原报告参数/错误ref后复查通过 |
| `npm --prefix frontend run api:check` | generated与根合同一致，最终生成后复查通过 |
| `backend/.venv/bin/ruff check backend/app/services/geo_opportunity_csv.py backend/app/services/geo_opportunity_queries.py backend/app/services/geo_report_csv.py backend/app/services/geo_reports.py backend/app/routers/geo_reports.py backend/app/routers/geo_opportunities.py backend/tests/integration/test_geo_opportunity_csv.py backend/tests/integration/test_geo_reports.py backend/tests/unit/test_geo_reports.py` | 单处新增排序列表超长修正后，受影响query/测试复查通过，其余首轮结果复用 |
| `./node_modules/.bin/eslint src/domains/geo-opportunities/opportunities.model.ts src/domains/geo-opportunities/opportunities.model.test.ts src/domains/geo-opportunities/opportunities-page.tsx src/domains/geo-opportunities/opportunities-page.test.tsx src/domains/geo-reports/report-page.tsx src/domains/geo-reports/reports.test.tsx tests/e2e/geo-opportunity-csv.spec.ts --max-warnings 0`（cwd frontend） | 通过；最终E2E断言修改后定向复查通过 |

PG证明：三种排序同值游标跨批与列表一致、page=999仍导出全部、保存来源重复不重复行、状态/优先级/关键字/模式/产品筛选、报告待处理集合与摘要等量、工作台可导出关闭状态、关闭备注及自由输入不外带、无业务写入；RR后续批次不见后来关闭/新增的机会，会话关闭；原三CSV的空集、独立开始审计先于发送、权限重新裁决、审计失败及后续批次失败释放回归通过。

首轮新增夹具错误未修改任何业务防线：机会created_at事后变更被不可变guard拒绝，改为在测试before_insert阶段设置平局时间；OWN_PRODUCT名称必须来自Product，不能直接写Subject.display_name；已批准事实又要求稳定产品身份，因此没有继续修改已批准Product来注入异常值。移除不合法的身份修改场景，实际CSV安全性由26列白名单、所有单元格经过原编码路径的独立复核及34项现有公式/控制字符等单元证据承担；PG仍核对关闭备注不外带和业务状态不变。未禁用触发器或放宽约束。

原单元Clock替身缺少CORE-02后新增的机会摘要依赖，本轮给该报告时点测试补明确零摘要替身，真实摘要/CSV集合由PG验证；原“机会必须501”的过期测试删除，空集行为改为409，不保留固定失败兼容。

浏览器首轮trace确认CSV GET为502：新标签首次导航不由Page.route拥有，改在BrowserContext层拦截显式CSV夹具，未改产品下载实现。第二轮已实际下载两种CSV，失败仅因原报告日期canonical规范为.000Z，断言改用既有报告规范形式；工作台source_scope的1微秒与原时区仍逐字保留。最终手机/桌面各完成工作台和报告下载，验证安全文件名、BOM、工作台21行超出当前页、全部筛选/来源参数、无JS翻页请求及无合格指标仍可下载；375/768/1024/1440无溢出，键盘Enter触发下载。

## 独立复核

core01_review仅按本轮基线只读复核公共合同、共享selector/排序/游标/RR、有界迭代、固定低敏字段与原safe_cell、首条/审计/生命周期、原三种CSV及前端URL过滤，未发现确认缺陷。该静态复核没有代替上述执行结果。

## 保留边界

浏览器为显式CSV/API夹具，证明真实production页面与原生下载；服务器编码/集合/审计由真实本地PG及现有单元用例分别证明。未执行完整make verify、全量E2E、Celery/Provider/OSS完整业务栈或线上验收，不承诺客户端中断后的完整文件。

浏览器上传仍NOT_RUN_NO_EXISTING_PLATFORM；OSS自然清理PASS、自动跟进NOT_FOUND保留且不追查。不创建平台、不改线上配置、不新增自动跟进、不提交推送。CORE-01～04保留review，CORE-06和6项自动化共7项仍规划，未启动。

## 收尾与任务状态

本轮专用PG仅剩postgres后安全停止并精确清理；16839/4174无监听。production build、Playwright结果/失败trace、临时日志及基线副本均在核对后清理，无本轮遗留服务或临时对象。task自动生成的仅_example资料索引删除，不留占位证据。

按本轮逐文件基线核对，增量仅为CORE-05源码/合同/测试/API文档及单项哈希、子任务与父清单；既有CORE-01～04及其他修改保留。暂存二进制补丁、74项暂存删除和HEAD不变，最终git diff --check及git status --short已核对。任务保留review，清除本会话活动指针，不归档。父清单记录5项本地实现待审阅、另7项规划；下一建议CORE-06但未启动。
