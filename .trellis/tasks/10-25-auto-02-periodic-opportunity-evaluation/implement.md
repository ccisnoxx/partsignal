# AUTO-02 本地实现与定向证据

状态：本地实现、必要定向验证及独立只读复核完成，保留review、completedAt=null，不归档；未记录用户接受或部署。不创建平台、不操作线上、不暂存/提交/推送、不新增Codex自动跟进。浏览器上传仍为NOT_RUN_NO_EXISTING_PLATFORM；OSS自然清理PASS、自动跟进NOT_FOUND和原外部等待记录均保留，不追查。

## 交付行为

- 机会工作台新增管理员按需展开的周期面板，维护一份内部共享配置。复用原ALL/FILTERED、Subject/Surface/Profile/Mode选择和规则revision，每1～168小时、回看1～31天。首次保存DISABLED，显式启用、暂停、恢复；ACTIVE修改重设未来周期，同人同配置无op。展示下一次尝试、授权阻断、最近COMPLETED/FAILED/MISSED与原冻结统计及机会导航。
- 后台沿现有Beat和geo_recovery_scan_seconds扫描，不创建独立调度基础设施。UTC窗口为[到期时点-回看天数,到期时点)，停机只评估最近一个到期窗口，较早窗口记MISSED半开区间，不集中补跑。暂停/修订已到期游标记录SUPERSEDED；恢复及修订使用历史时点/区间终点下限，回拨不重选旧窗口。
- 手动与周期复用原机会评估共享核、规则/资格/RR捕获/去重/统计，原手动HTTP/幂等/提交语义及Schema不变。后台独立请求SHA命名空间，不能被手动key占用；周期仅flush，由调度事务统一提交机会、来源、评估、回执、窗口、审计和next。
- 每次执行重验授权管理员当前启用、ADMIN和改密状态；后台不依赖原HTTP会话仍有效。HTTP配置要求ADMIN+CSRF、锁内重验和CAS。失败先整笔rollback，再重锁CAS，仅原revision/授权/next仍待处理才写FAILED及推进；暂停、修订、另一成功或commit确认丢失先赢时不覆盖。总开关关闭不执行/推进。未知错误仅记录安全类型/EVALUATION_FAILED，不保存原异常或正文；不自动重试失败窗口。
- 0068仅加两表及守卫，无旧数据回填或默认启用；窗口不可变，COMPLETED必须匹配实际ACTIVE配置、规则、授权人、日期和真实冻结回执。新authorizer FK接入原用户引用计数。审计登记四个配置动作，周期评估显示真实SCHEDULED来源。
- 前端编辑基线冻结，409/背景修订须显式GET后确认；未知提交冻结、只GET核对、不重放。接受后读取失败保留接受事实；主体切换/卸载忽略迟到响应，重复提交受控。ACTIVE展开时前台15秒读取，后台或错误停止；首见已完成回执即失效机会/洞察/报告读模型，同回执不重复失效。
- 根OpenAPI增4条路径/5个操作及5个Schema，无既有路径/Schema AST变化；generated、数据库/API合同和单项文档SHA同步。当前head测试和升级演练测试源码期望更新为0068；没有修改生产配置或运行部署演练。

## 实际命令与结果

仅本地PG17：127.0.0.1:17139、auto02、PGTZ=UTC；测试自建/删除随机库。没有真实Provider/OSS调用、线上数据库或平台。下面PG命令统一前缀 `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://auto02@127.0.0.1:17139/postgres`，cwd=backend；未另注明均使用 `.venv/bin/python -m pytest`。

| 命令 / 范围 | 结果 |
| --- | --- |
| `uv run pytest tests/integration/test_geo_opportunity_schedule.py tests/integration/test_geo_manual_opportunity_evaluation.py -q --maxfail=2` | AUTO-02的14项通过；原手动回归出现2项失败后停止。一个测试硬编码/ contracts容器路径，改为仓库相对路径；另一个旧提交故障注入依赖db.new，提前flush改变其观测点，修正为仅周期flush，手动仍直接commit |
| `uv run pytest tests/integration/test_geo_opportunity_schedule_concurrency.py -q --maxfail=2` | 退出0；双-q输出被RTK压缩为No tests collected，不以该压缩文本认定无测试，后续显式覆盖并取得计数 |
| `tests/integration/test_geo_opportunity_schedule_concurrency.py tests/integration/test_geo_manual_opportunity_evaluation.py -o addopts='' -q --tb=line` | 36 passed：7项新并发/授权/回拨，29项原手动回归。前述AUTO-02主体14项输入未变，复用有效通过证据，不机械重复 |
| `tests/integration/test_geo_opportunity_schedule_migration.py tests/integration/test_migrations.py -k 'additive_tables_match_metadata or fresh_postgresql_migrates_to_head_and_seed_is_idempotent' -o addopts='' -q --tb=line` | 2 passed、38 deselected；新DDL/ORM元数据一致、0068安全降级停止、fresh head及seed幂等 |
| `tests/integration/test_geo_manual_evaluation_migration.py -o addopts='' -q --tb=line` | 首轮TRUNCATE回执被新增窗口FK提前以0A000拒绝；将测试改为TRUNCATE CASCADE以实际到达不可变历史触发器，并把当前CLI降级期望更新为0068，复验1 passed、55000。与新迁移用例均有既有全metadata循环FK及dialect_options的SAWarning，未扩大为无关Schema改造 |
| `.venv/bin/python -m pytest tests/unit/test_geo_opportunity_schedule_wiring.py -o addopts='' -q --tb=short` | 1 passed，Beat任务调用实际数据库扫描入口，mock只替代入口观察，无Redis或外发 |
| `npm run test -- src/domains/geo-opportunities/opportunity-schedule.test.tsx src/domains/geo-opportunities/opportunity-evaluation.test.tsx src/domains/geo-opportunities/opportunity-evaluation.model.test.ts --reporter=dot`（cwd frontend） | 24 passed：新面板8项及原手动页面/范围校验16项；保存/显式状态CAS、409/背景revision、未知只GET、双击/主体切换、首见COMPLETED失效、401/403、周期边界 |
| `npm run test -- src/domains/audit/audit.model.test.ts --reporter=dot`（cwd frontend） | 24 passed；SCHEDULED安全事实和新动作标签可投影，旧权限/敏感字段边界保留 |
| `npm run e2e -- tests/e2e/geo-opportunity-schedule.spec.ts`（cwd frontend） | 首轮webServer build失败，`npm run build`定位到新测试误用Playwright的exact选项于Testing Library；移除后目标E2E复验production build通过、mobile/desktop 2 passed、E2E_SECRET_SCAN clean。键盘、保存初始DISABLED/启用/暂停/恢复准确CAS、完成回执/原因/机会导航，375/768/1024/1440无溢出 |
| `.venv/bin/mypy app/schemas/geo_opportunity_evaluation.py app/schemas/geo_opportunity_schedule.py app/models/geo_opportunity_schedule.py app/services/geo_opportunity_evaluation.py app/services/geo_opportunity_schedule_state.py app/services/geo_opportunity_schedule_commands.py app/services/geo_opportunity_scheduler.py app/routers/geo_opportunity_schedule.py app/services/identity.py` | 9文件通过；初始Router operation从str收窄为既有ScheduleOperation闭合类型后通过，最终复查通过 |
| `npm run typecheck`（cwd frontend） | 新页面主体通过；后续测试加入后production build覆盖最终类型检查，移除上述错误exact选项后通过 |
| `.venv/bin/ruff format` / `ruff check` 本轮后端/迁移/测试（relatedFiles精确列表） | 新导入排序修正，最终通过；撤销identity文件本轮格式化造成的无关差异，只保留两行引用接入 |
| `./node_modules/.bin/eslint src/domains/geo-opportunities/opportunity-schedule.tsx src/domains/geo-opportunities/opportunity-schedule.api.ts src/domains/geo-opportunities/opportunity-schedule-fields.tsx src/domains/geo-opportunities/opportunity-schedule-runtime.tsx src/domains/geo-opportunities/opportunity-schedule.test.tsx src/domains/geo-opportunities/opportunity-evaluation.model.ts src/domains/geo-opportunities/opportunities-page.tsx src/domains/audit/audit.model.ts src/domains/audit/audit.model.test.ts tests/e2e/geo-opportunity-schedule.spec.ts --max-warnings 0`（cwd frontend） | 通过 |
| Python调用 `app.tools.contract_check.check(Path('../contracts/openapi.yaml'))` 并断言failures为空；`npm run api:generate` / `api:check`（cwd frontend） | 运行时0 failures、generated与根合同一致。对本轮基线AST断言旧operation/Schema无改动，原手动Request运行时Schema逐字段相同 |
| Python ast.parse受影响测试/演练源码、核对单项文档SHA；`git diff --check` / `git status --short` / index与HEAD二进制比对 | 最终收尾核对，无本轮之外的非预期修改；原74项暂存删除和HEAD/index保留 |

合计53项不同PG/HTTP用例、1项后台接线单元、48项前端用例及2项浏览器用例通过。定向验证不代表全量门禁或线上验收。

## 独立只读复核

core01_review按本轮基线审查持久化、锁序、失败重锁CAS、权限撤销和前端未知结果/缓存边界。初审确认一项P2：窗口只匹配回执的scope/rule，未绑定实际配置。已加ACTIVE、完整configuration及rule字段匹配，真实PG scope/rule两类伪造回执均23514。续审确认修复、未发现新的确认阻断。审阅者不运行测试，以上执行结果由主代理取得。

## 未执行与恢复边界

没有完整make verify、全量E2E、真实Celery/Redis完整栈、Provider/OSS、线上迁移/自动启用或Docker升级恢复演练；升级演练脚本仅当前head期望/语法更新。浏览器使用显式API/窗口夹具与真实production页面，后端持久化/并发由独立真实PG证明，不宣称完整栈或生产验收。构建仍有既有chunk体积提示，未作无关bundle调整。

未来上线需迁移0068并交付相应API/Worker/Beat，之后由管理员显式配置及启用。停止新评估可暂停配置；回退前停新增扫描、保留两表和历史，以前向修复/成套备份恢复处理，0068拒绝破坏性downgrade。本轮不执行这些线上动作。

父规划更新为CORE-01～06及AUTO-01～02共8项本地review，AUTO-03～06共4项继续规划。下一顺位AUTO-03需先明确平台与许可采集范围；未恢复GEO-804、未创建平台或任务自动跟进。浏览器上传NOT_RUN_NO_EXISTING_PLATFORM和原外部等待记录不变。

## 收尾

本轮专用PG及随机测试库、构建/Playwright输出已精确清理；本轮基线副本经最终核对后删除，共享依赖/编译缓存保留。无需要持续运行的服务或保留临时环境。任务保留review，不归档，不提交推送。
