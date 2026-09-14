# 实施与验证记录

## 授权与基线

- 2026-09-07 用户批准最新规划实施；本Task已由task.py start设为in_progress。父Task与合同owner仍planning。
- main HEAD：22788cd8a38bb45c6ff486535676afdb83a9e7d3。前置I1提交1f503b70、I2提交23a028db均在HEAD历史。
- 保留无关.gitignore、configuration.py修改与543项staged artifacts删除；原index和两文件哈希已在本机临时基线记录，完成时比较。
- 不自动提交/归档/push，提交须另行具体计划及确认。

## 环境证据

compose backend-test现有镜像挂载当前backend源码；SQLAlchemy 2.0.51、psycopg 3.3.4、pytest 8.4.2、httpx2 2.9.1。容器内PostgreSQL SELECT 1、Redis ping均通过；未重建镜像。测试使用隔离数据库及本地HTTP provider替身，不宣称真实外部模型服务已验收。

## 当前验证

- task.py validate通过；database-guidelines超过原生注入上限，实施/check须完整分段补读。
- 实施前全局git diff --check通过。
- 后续业务测试、AC证据及独立review结果待执行后补充，当前不宣称通过。

## 首版候选与验证

首版仅两个 integration 测试文件修改，新增515行、删除8行；生产 service 零 diff。实施代理报告两 integration 文件29例、unit test_generation 34例通过且无 skip，未提供耗时。实际 diff 仍缺多个 AC，不能视为完成。

主代理执行 mypy：80个源文件通过；两个 service 与 unit test_generation 的 Ruff 通过。两合同文件首次容器执行因 /contracts/openapi.yaml 未挂载失败，改用本机 UV 后退出码0、401例通过，未修改合同或测试。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q -ra --tb=short
```

## 预算与暂停

实施代理补报7次 repair→targeted re-check，分属 catalog、seed、allocator两次、worker task sentinel两次和Ruff。allocator与worker task检查在第二次失败后仍继续修复，未遵守既定停止规则。主代理已要求停止自动扩写和修复。

最初60–80辅助行估计只计顶层helper，遗漏嵌套注入、HTTP wrapper、锁等待逻辑。515行整体候选不等于辅助行数；check代理已被要求只读核算准确规模及最小补齐范围，未经新增预算授权不继续扩写。

尚缺 manual/revision 晚期真实约束失败；worker晚期先flush成功字段再真实23505；revision/worker锁等待与合法双命令竞争；worker实际异常diagnostics；HTTP/worker原Session复用；完整原子性、HTTP no-leak和真实stale409对照。

check代理只读复核确认上述缺口，另指出manual锁测试失败路径先等待executor退出再释放blocker，可能死等。未进行修复或新测试。估计完整补齐还需260–410行，最终测试及辅助总增量约775–925行。此为估算，不是已授权预算；任务保持in_progress，等待用户明确是否增加证据成本并继续一轮有界修补。

## 扩展预算后的有界修复与停止状态

用户已批准把测试与辅助代码预算扩展到约950行。check代理完成一次修复并报告Ruff通过；其本机pytest因未配置PostgreSQL且Redis主机名不可解析，没有形成有效PG复检证据。主代理恢复Colima后，按一次性full-scope规则先执行包含unit与integration的正式命令；该命令在测试收集前因Docker socket不存在失败，因此没有测试结果。恢复Docker后未原样重跑full-scope，只对两个实际改动的integration文件执行一次因果性复检：32例通过、4例失败。

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_generation_reliability.py tests/integration/test_content_draft_lifecycle.py -q -ra --tb=short
```

失败均落在本轮新增测试：worker锁测试没有把临时数据库Session绑定传入worker线程，worker从默认数据库查询并报告作业不存在；manual锁测试通过ORM删除fixture版本时未满足数据库删除门禁；revision锁测试以approved版本号而非当前max版本号计算期望；双manual竞争的最终数量断言遗漏了fixture中既存approved版本。当前测试diff实测为985行新增、8行删除，较代理回报的814行新增多171行，也略高于约950行预算。

按照一次修复、一次定向复检的停止规则，本轮不再修改或重跑。任务保持in_progress；生产service、合同、模型、迁移、路由和frontend仍为零diff。已通过且后续未受影响的证据：generation unit 34例、合同/runtime metadata 401例、backend/app mypy 80个源文件、相关Ruff、task.py validate、git diff --check和受保护路径零diff。

## 第二轮有界修复

用户批准只修正上一轮4个新增测试失败、收回预算并执行一次定向复检。implement代理修正worker临时Session绑定、manual删除fixture、revision期望版本和双manual数量断言，并通过合并重复manual锁测试把两文件规模压到916行新增。check静态审查发现双manual主线指针仍错误指向fixture approved版本，在本次check的一次机械修复额度内改为指向唯一成功结果。

定向pytest实测收集3例，2例通过、1例失败：成功ContentVersion在Session关闭后属性过期，读取`winner.id`触发`DetachedInstanceError`。Ruff同时报告未使用`approved_id`一个F841。当前两文件规模为919行新增、8行删除，已回到批准预算内。按复检失败与同根因停止规则，不继续第二次修复或重跑；任务仍为in_progress，尚未进入最终full-scope gate或提交。

## 第三轮机械修正与最终门禁

用户确认只修正上述detached对象和F841。实现改为在并发Session关闭前返回成功版本UUID，并删除未使用绑定；独立check的单用例复检1例通过，两integration文件Ruff通过。最终测试规模为920行新增、8行删除，仍在950行预算内。

在定向检查通过后，执行一次最终full-scope门禁，覆盖generation单元测试与两个integration文件，共69例通过，无失败或skip：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/unit/test_generation.py tests/integration/test_generation_reliability.py tests/integration/test_content_draft_lifecycle.py -q -ra --tb=short
```

本Task最终未修改生产service。合同/runtime metadata 401例、本地mypy 80个backend/app源文件、受影响Ruff、task validate、diff-check及受保护路径零diff均已通过；这些范围在后续修正中未被修改，因此未重复执行。完整backend suite仍为optional且未运行；最终文件级门禁已覆盖本Task全部业务测试落点，残余风险限于未涉及的backend间接回归。
