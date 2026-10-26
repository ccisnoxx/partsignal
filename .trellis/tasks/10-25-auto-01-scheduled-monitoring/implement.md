# AUTO-01 实施、验证与恢复记录

2026-10-25。本地实现及必要定向验证完成，review等待审阅，未记录用户接受或部署。未创建平台、未操作线上、未暂存提交推送，浏览器上传NOT_RUN_NO_EXISTING_PLATFORM保留。

## 实际交付

- 新CRON计划经原计划API/向导显式保存，初始DISABLED；Cron、IANA时区、矩阵与预算继续由原Schema/权限/预览校验。原activate/pause/resume/archive管理启停；模式创建后不互转，可新建不同模式。已登记CRON复制形成独立DISABLED计划；旧CRON无登记、继续只读，旧ACTIVE不是调度授权。
- 0067加法迁移：geo_plan_schedules存登记身份/下一窗口，geo_plan_schedule_windows追加CREATED/FAILED/MISSED及窗口、配置revision、批次ID、低敏原因、错过区间。无旧数据回填或改写；窗口不可UPDATE/DELETE/TRUNCATE。Plan/cursor提交态强制已登记CRON满足ACTIVE⇔非空next；CREATED核对真实Batch Plan/UTC时间/触发类型/冻结revision。
- 新内部到期扫描注册到现有Beat，复用geo_recovery_scan_seconds（默认60秒）、geo_recovery_batch_size及geo_monitoring_enabled，无新部署/env参数。扫描有界，只选显式登记的到期游标。现有分析/租约恢复/补派发不变，没有新增Codex自动跟进。
- 原geo_batches._create改名freeze_batch作为共同冻结owner，人工和定时复用规则/矩阵/引用锁存/输入快照/批次和Run持久化；没有平行建批实现。scheduled事务入口移到geo_plan_scheduler，全部已知内部测试调用者同步迁移，无旧shim。新系统批次created_by=NULL，不冒充配置操作者，无新增HTTP系统入口。
- 配置命令User→资源→Plan→cursor；扫描资源→Plan→cursor，锁后重读配置、revision、状态、游标及既有批次。同窗口Plan串行、窗口PK与原Batch窗口/身份唯一约束共同防重复。旧窗口回执只读返回，不重新裁决、不推进游标、不dispatch。
- 成功批次、窗口和next同事务，commit后派发。已知资格失败savepoint撤销建批副作用，记FAILED、推进未来窗口，不重试同窗口；未知SQL/程序异常整笔rollback，保留游标，并记录低敏Plan ID/异常类型。commit后派发失败保留真实CREATED及游标，既有PENDING恢复继续拥有派发恢复。
- 激活/恢复/实际修订从未来窗口开始；暂停/归档清空next，尚未处理且到期的旧游标记PLAN_CHANGED错过区间。每次扫描每计划最多建一批；5分钟容许延迟内处理首个到期窗口，其余已到期未执行窗口同事务合并LATE_WINDOW半开区间，不能静默跳过；超过5分钟则整段错过并推进未来，不集中补跑。最近已处理窗口/MISSED右端点前1us作为计算下限，数据库时钟回拨不重新选中旧窗口或错过区间；no-op保存不重置游标。
- Cron词法与数值集合沿已安装Celery；按IANA日历生成严格未来UTC分钟，日/月/周同时满足。400年Gregorian周期无可达日期则422，定位cron_expression。DST不存在分钟跳过，重复墙钟仅fold=0。没有新依赖或通用调度框架。
- 计划详情/列表新增nullable schedule运行摘要及最近窗口，固定两条集合查询；配置revision不因运行推进增加。页面展示下一次当地时间、CREATED/FAILED/MISSED、真实批次/计划历史导航；ACTIVE且登记详情每15秒前台读取，错误/后台暂停。MANUAL只生成待录入Run，不自动向平台提问；API外发仍由既有独立资格裁决。
- 新时区展示边界经本机验证：Factory可被Python ZoneInfo及PostgreSQL接受，Intl构造抛RangeError。只对此明确失败显示同一时刻UTC并保留计划时区说明，不猜测其他时区；其他异常继续暴露。正常时区格式化行为保留。
- 根OpenAPI无路径变化，只新增GeoPlanScheduleRuntime/GeoPlanScheduleWindowOut，修改GeoMonitoringPlanDetail和GeoPlanRunEntry；generated、数据库/API说明及单项文档SHA同步。迁移head定向断言及真实升级演练脚本的当前head期望更新为0067，仅测试源码，无部署配置变化。

## 实际命令与证据

专用本地PG17为127.0.0.1:17039、auto01用户、PGTZ=UTC，测试自建/删除随机数据库；没有生产连接或真实Provider/OSS调用。派发以稳定批次ID记录器或明确故障替身替代外部Broker，并用独立PG连接验证窗口和批次已提交。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://auto01@127.0.0.1:17039/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_plan_scheduler.py backend/tests/integration/test_geo_cron_boundary.py -o addopts='' -q --tb=short` | 首轮1 passed、16 failed；根因是新提交触发器同一SQL CASE访问两类NEW字段，PG准备表达式时拒绝；改PL/pgSQL IF分支读取 |
| 同PG环境，对上述两文件改用 `--tb=line` 复验 | 17 passed；后续实质修正与新增反例再收窄/扩展相关用例 |
| 同环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_plan_scheduler.py backend/tests/integration/test_geo_batch_creation.py -k 'scheduler or historical_schedule_replay' -o addopts='' -q --tb=line` | 11 passed、9 deselected，包含双向提交约束、时钟回拨和原历史回执重放 |
| 同环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_plan_scheduler.py backend/tests/integration/test_geo_cron_boundary.py backend/tests/integration/test_geo_batch_creation.py -k 'scheduler or cron or historical_schedule_replay' -o addopts='' -q --tb=line` | 最终24 passed、9 deselected，含部分冻结失败整笔回滚、commit后派发失败保留窗口、元数据/安全降级等 |
| 同环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_migrations.py -k fresh_postgresql_migrates_to_head_and_seed_is_idempotent -o addopts='' -q --tb=line` | 1 passed、38 deselected；当前head、初始化幂等及降级拒绝断言更新后通过。合计27项不同PG/HTTP用例有效通过（含下方末尾窗口覆盖补验） |
| `backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_schedule_clock.py backend/tests/unit/test_geo_plan_management.py -o addopts='' -q --tb=short` | 44 passed；新增Beat接线后仅重跑clock文件11 passed。合计45项不同单元用例 |
| `npm --prefix frontend run test -- src/domains/geo-plans/plans.model.test.ts src/domains/geo-plans/plan-wizard.test.tsx src/domains/geo-plans/plans-page.test.tsx --reporter=dot` | 首轮40 passed、1 failed，为旧“只能手动”选项断言；按新合同修正后wizard14 passed，未变的model/page证据复用 |
| `npm --prefix frontend run test -- src/domains/geo-plans/plan-wizard.test.tsx src/domains/geo-plans/plans-page.test.tsx --reporter=dot` | 新增Cron创建/暂停导航后33 passed、1 failed；BaseUI portal选项需等待，改await findByRole后wizard15 passed，page19/model9结果复用 |
| `npm --prefix frontend run test -- src/domains/geo-plans/plan-schedule.test.ts --reporter=dot` | 1 passed；合法时区及ICU不支持时区展示边界。合计44项不同前端用例 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-plan-schedule.spec.ts` | production build通过，mobile/desktop共2 passed，E2E_SECRET_SCAN clean。键盘启用、暂停恢复、准确CAS、窗口/历史导航，375/768/1024/1440无溢出。最后新增Intl失败分支用专门单元证明，复用不变的正常时区浏览器流程证据 |
| `.venv/bin/mypy app/services/geo_plan_scheduler.py app/services/geo_batches.py app/services/geo_schedule_clock.py app/services/geo_schedule_management.py app/services/geo_schedule_queries.py app/services/geo_plan_commands.py app/services/geo_plan_queries.py app/services/geo_plan_policy.py app/models/geo_plan_schedules.py app/schemas/geo_plan_schedules.py app/schemas/geo_plan_management.py`（cwd backend） | 首轮局部result变量被推断为必有回执，改独立nullable receipt后11文件通过；下限修正后复查通过 |
| `npm --prefix frontend run typecheck` | 首轮refetchInterval位于queryFn前导致推断unknown，移到queryFn后修复；新增测试path.endsWith泛型never改精确路径比较。最终production build及Intl边界后均通过 |
| `backend/.venv/bin/ruff check --fix` 本轮19个后端/迁移/测试文件（relatedFiles记录精确范围） | 初始编写阶段修正格式及一次误插入delete路径的未定义action；最终只剩models __init__新导入排序，修正后0错误 |
| `./node_modules/.bin/eslint` 本轮geo-plans源码/测试及两个计划E2E文件 `--max-warnings 0`（cwd frontend） | 通过；新增Intl组件/测试后仅复查两文件通过，其余复用 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` 并断言无failures；`npm --prefix frontend run api:generate` / `api:check` | 运行时0 failures，generated与根合同一致；根AST仅指定2新增/2变更组件 |
| Python `ast.parse` 检查两处更新迁移head期望的测试源码 | 语法有效；未执行Docker真实升级演练，不把字面head更新称为演练通过 |

27项PG证据：真实API新计划登记/激活与权限复用、原矩阵/Run冻结、commit前无派发、同窗口并发唯一、暂停先提交拒绝旧扫描、恢复未来游标、资格失败无半批、超时MISSED区间、总开关关闭不推进、不可达Cron回滚、历史CRON未登记/只读、历史UTC窗口跨时区重放无派发、直接SQL双向状态拒绝、时钟回拨后继续执行、冻结后异常整笔回滚、派发异常保留已提交状态、不可变窗口、ORM列/PK与新DDL一致及55000拒绝降级。原MANUAL创建/启用/人工建批与AD_HOC路径保持通过。

末尾增量审查发现grace内多窗口静默遗漏：due09:00/now09:02:10原先只记首批并跳到09:03。已同事务追加MISSED[09:01,09:03)，CREATED与FAILED均覆盖。重新启动本轮独立PG，仅运行 `test_geo_plan_scheduler.py -k 'elapsed_windows or real_matrix' -o addopts='' -q --tb=line`，3 passed（2项新增+1项正常冻结回归）；service mypy、Ruff及展示文本ESLint通过，其余不变输入的证据复用。独立复核确认该补记区间与原窗口不重叠、窗口/批次/游标同事务且没有新增冻结调用，无新增阻断；测试由主代理执行。

45项单元包含严格未来、UTC身份、闰日、日/月/周AND、不存在与重复DST分钟、不可达日期、Beat调用实际数据库扫描入口、旧策略/历史CRON边界。前端44项覆盖原向导/冲突/主体/历史只读，加新Cron/时区实际提交、预览后保存仍DISABLED、既有模式锁定、next/最近批次链接、暂停清游标和时区展示。

## 独立只读复核

core01_review按本轮基线审查权限、锁序、保存点/提交/派发、窗口唯一、迁移/数据守卫、历史隔离和回退。确认两项P2并修复：已登记ACTIVE空游标的单向约束缺口；时钟回拨恢复选中旧已处理窗口导致永久只读重放。最终双向约束、历史下限、对应真实PG反例均通过，复核无尚未解除的确认源码阻断。子代理只读及纯内存日历核验，不替代主代理执行结果。

## 未执行、恢复与保留边界

未跑完整make verify、全量E2E、真实Celery/Redis/Provider/OSS完整栈或Docker升级恢复演练；页面浏览器使用显式计划API/窗口夹具，服务端持久化和并发由独立真实PG证明，不表述为上线验收。

上线未来需先迁移0067并交付相应应用/Worker/Beat；本轮没有执行迁移到线上或开启生产计划。回退前停新扫描，保留两表及窗口/批次并前向修复，禁止破坏性降级。数据库迁移没有旧表DML/回填，历史数据保留由加法DDL审查、历史命令/回执PG回归和安全降级共同支持；未宣称生产存量升级现场已验证。

浏览器上传仍NOT_RUN_NO_EXISTING_PLATFORM；OSS自然清理PASS、自动跟进NOT_FOUND及原外部等待任务状态保留，不追查、不新增自动跟进。CORE-01～06与AUTO-01本地review，AUTO-02～06共5项继续规划，未获本轮实施授权。

## 收尾

专用PG、构建/Playwright结果及基线副本在最终审查后精确清理，共享依赖/编译缓存保留；无本轮遗留进程/临时平台。最终核对incremental diff、根AST/文档SHA、git diff --check和git status --short，既有CORE1～6/其他修改、74项暂存删除、index二进制补丁及HEAD不变。任务review、不归档，清除本会话活动指针；未提交推送。
