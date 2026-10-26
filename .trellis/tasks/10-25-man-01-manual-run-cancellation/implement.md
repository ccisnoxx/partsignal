# MAN-01 本地实现与定向证据

状态：实现、必要定向验证和独立只读复核完成，保留review、completedAt=null，不归档。未记录用户接受或部署。不接入Browser自动化、不创建真实平台、不操作线上、不暂存/提交/推送；浏览器上传NOT_RUN_NO_EXISTING_PLATFORM及原外部等待记录保留。

## 最终行为与边界

- ADMIN/ENGINEER可从Run详情按服务端CANCEL动作，读取一致的运行/已保存草稿双版本并填写原因，显式取消尚未提交的MANUAL运行。原因trim非空、最多2000字符、禁止NUL。Profile停用或监测开关关闭不妨碍结束待办；API/BROWSER及整批取消未开放。
- 服务端current_actor_command重新锁定当前身份/HTTP Session，随后Batch→Run→Draft，锁内检查Run/草稿双CAS并复用cancellable/run_transition。取消与保存/提交串行：提交先赢则取消409，取消先赢则旧保存/提交409。不可变原因记录、Run CANCELLED/revision/finished_at、Batch完整统计和安全审计同事务；失败整笔回滚。
- 取消不删除草稿、不改文件引用、不安排GC，不改写已提交Answer/Citation/文件及其他Run历史。临时草稿继续原0064终态保留/墓碑规则；不复制草稿/证据，不延长保留期。原因及操作者/时间/版本单独存入不可变业务表，审计仅status/revision/draft_revision，无原始理由。
- 0069加法建geo_manual_run_cancellations，Run PK与User FK RESTRICT、User引用计数接入；记录插入核对实际MANUAL取消状态、无回答、版本/时间及草稿版本。延迟约束拒绝只改人工取消状态不写原因记录；记录UPDATE/DELETE/TRUNCATE拒绝，旧历史不回填。downgrade55000安全停止，前向修复或迁移前备份恢复。
- 新POST /observation-runs/{run_id}/manual-cancel、两个Schema及Run Detail nullable cancellation；原通用状态机不重写，普通投影只为MANUAL接通CANCEL，Batch取消仍关闭。详情固定增加一次取消记录读取，列表无逐行查询。根OpenAPI、generated、数据库/API合同、人工SOP和两项文档SHA同步。
- 页面409/版本变化保留原因并显式重读；未知结果仅GET核对，不自动重发，显式结束核对后须重新准备新的请求。成功先保留接受事实再刷新；主体切换/卸载丢弃迟到响应，重复确认同步受控。父详情401/403/404与本地拒绝均先隐藏取消记录/原因，避免显示缓存私有数据。

## 实际命令及结果

所有PG检查仅连接本轮PG17 127.0.0.1:17239、man01用户；临时库由fixture创建/删除，PGTZ=UTC。人工提交证据使用本轮127.0.0.1:19219的真实开发对象存储服务与虚构数据，无真实Provider/OSS或业务平台。以下PG命令cwd=backend，统一前缀 `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://man01@127.0.0.1:17239/postgres OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:19219`。

| 实际命令 / 范围 | 结果 |
| --- | --- |
| `.venv/bin/python -m pytest tests/integration/test_geo_manual_cancellation.py -o addopts='' -q --tb=line --maxfail=2` | 首轮9 passed、2 failed后停止；测试CSRF过短触发422而非预期403，改为32字符错误token；ASGI ExceptionGroup含通用异常context，改为断言完整traceback不含原异常canary。生产路由没有泄漏原原因/SQL |
| `.venv/bin/python -m pytest tests/integration/test_geo_manual_cancellation.py tests/integration/test_geo_manual_collection.py tests/integration/test_geo_manual_races.py -o addopts='' -q --tb=line --maxfail=2` | 38 passed、1 failed；原“停用配置动作必须为空”断言与新增CANCEL合同冲突，更新为CANCEL且录入/保存仍被拒绝。新取消14项全部通过，旧录入/竞态其余结果复用 |
| `.venv/bin/python -m pytest tests/integration/test_geo_manual_collection.py -k disabled_configuration tests/integration/test_geo_manual_cancellation_migration.py tests/integration/test_geo_retention.py -k 'disabled_configuration or metadata_and_unsafe or terminal_draft_cleanup or tombstone_cannot or locked_run_is_skipped' -o addopts='' -q --tb=line --maxfail=2` | 5 passed、28 deselected；修正断言通过，新表ORM元数据/安全降级以及原终态草稿清理/墓碑/锁/文件引用3项通过。compare_metadata有既有循环FK/dialect_options两项SAWarning，不扩展无关Schema |
| `.venv/bin/python -m pytest tests/integration/test_geo_manual_collection_boundaries.py -k nonmanual tests/integration/test_migrations.py -k 'nonmanual or fresh_postgresql_migrates_to_head_and_seed_is_idempotent' -o addopts='' -q --tb=line --maxfail=2` | 3 passed、54 deselected；API/BROWSER取消拒绝、fresh0069和seed幂等。旧存储竞态/终态草稿fixture补齐现行必要取消记录；其他历史迁移不改 |
| `.venv/bin/python -m pytest tests/unit/test_geo_run_policy.py tests/unit/test_geo_batch_policy.py -k 'cancel or partial_cancellation' -o addopts='' -q --tb=line` | 152 passed、1199 deselected；原状态/外发/回答组合与批次取消统计策略保持，未跑无关参数用例 |
| `npm run test -- src/domains/geo-runs/run-cancel.test.tsx src/domains/geo-runs/manual-editor.test.tsx src/domains/geo-runs/runs-page.test.tsx --reporter=dot`（cwd frontend） | 首轮33 passed、1 failed；新用例误用failure helper参数，生成了畸形错误信封，页面正确按unknown处理；改传字符串code和数字status。两份旧页面/录入26项已通过 |
| `npm run test -- src/domains/geo-runs/run-cancel.test.tsx --reporter=dot`（cwd frontend） | 修正helper后8 passed；新增父详情拒绝读取隐藏缓存原因后9 passed。包含双版本提交、草稿409、未知只GET、双击、主体切换/卸载、接受后刷新失败、权限隐藏及无动作无准备请求 |
| `npm run test -- src/domains/audit/audit.model.test.ts --reporter=dot`；随后 `npm run test -- src/domains/audit/audit.model.test.ts -t 人工取消 --reporter=dot`（cwd frontend） | 首轮24 passed、1 failed；补齐本次新增draft_revision的前端安全事实白名单/标签，定向复验1 passed、24 skipped。原因仍禁止进入审计；旧24项输入不变复用 |
| `npm run build`（cwd frontend） | 初始新测试mock泛型options被推断never，改为对完整调用断言及显式测试signal投影；随后TypeScript与production build通过。末尾readError权限分支追加后 `npm run typecheck` 和 `npm exec -- vite build --config vite.config.ts --logLevel error` 通过；有既有chunk体积提示 |
| 临时本地真实HTTP浏览器检查（下述接线） | 1项完整取消流程通过：键盘打开/确认、真实POST、刷新读取不可变原因、375/768/1024/1440无页面溢出、仅1次取消POST、无pageerror。没有page.route业务替身，没有截图/trace或平台访问 |
| `.venv/bin/mypy app/schemas/geo_manual_cancellation.py app/models/geo_manual_cancellation.py app/schemas/geo_read_models.py app/services/geo_manual_cancellation.py app/services/geo_read_queries.py app/services/geo_read_projections.py app/services/geo_manual_collection.py app/services/identity.py app/routers/geo_manual_collection.py` | 9文件通过 |
| `.venv/bin/ruff check` 本轮后端/迁移/测试精确文件（task.relatedFiles） | 新文件格式和导入排序修正，最终通过。共享identity/read源只保留必要增量，不格式化他人修改 |
| `./node_modules/.bin/eslint src/domains/geo-runs/run-cancel.api.ts src/domains/geo-runs/run-cancel.tsx src/domains/geo-runs/run-cancel.test.tsx src/domains/geo-runs/run-detail.tsx src/domains/geo-runs/runs-page.tsx src/domains/audit/audit.model.ts --max-warnings 0`；末尾权限变更重查对应三文件及两份audit文件 | 通过 |
| Python调用 `app.tools.contract_check.check(Path('../contracts/openapi.yaml'))` 断言空；`npm run api:generate` / `npm run api:check`（cwd frontend） | 运行时0 failures、generated一致；根AST仅新增1操作/2Schema及变更GeoRunDetail cancellation，其余operation/Schema保持本轮基线 |
| Python ast.parse受影响迁移head测试/部署演练测试、两项文档SHA、增量哈希；`git diff --check`、`git status --short`、HEAD/index二进制比对 | 最终收尾核对，既有74项暂存删除、HEAD和本轮之外文件保留；未运行Docker升级恢复演练 |

合计46项不同PG/HTTP用例、152项原策略参数用例、60项不同前端用例、1项本地真实HTTP浏览器流程有效通过，不表示完整门禁或生产验收。

浏览器接线：一次性脚本在本轮临时目录，复用现有questions_engine/questions_api/plans_api fixture创建随机PG库及虚构身份/人工计划Run，通过app真实依赖和Uvicorn监听127.0.0.1:18219；不启动Worker或外部采集。`VITE_API_PROXY_TARGET=http://127.0.0.1:18219 ./node_modules/.bin/vite preview --host 127.0.0.1 --port 4174 --strictPort` 服务已构建页面；`node --input-type=module` 使用已安装Playwright无头Chromium访问真实路由。临时0600上下文仅虚构session信息，未输出或保留秘密。最后新增readError只影响拒绝访问分支，正常成功流程输入不变，复用浏览器证据；拒绝分支由9项前端用例及续审覆盖，最终构建同步。

## 独立只读复核

core01_review复核了Run/草稿双CAS、User/Session及Batch→Run→Draft锁序、取消/提交互斥、数据库双向留痕、不可变与历史/文件引用保留、HTTP权限及前端恢复；未发现确认阻断。末尾readError隐藏缓存原因再独立续审，确认无新增阻断。审阅者只读、不运行测试，执行结果由主代理取得。

## 未执行与恢复边界

未跑完整make verify、全量E2E、真实Celery/Redis/外部Provider/OSS或Docker升级恢复演练。真实浏览器仅验证本地取消流程，不代表其他业务或线上验收。升级演练脚本只更新当前head断言并做语法检查。0069无历史回填，未来交付需先迁移后应用；回退保留新表/取消历史，采用前向修复或迁移前备份，不执行破坏性降级。本轮不执行任何线上步骤。

父规划同步MAN-01本地review及MAN-02～06建议顺序；仅MAN-01获实施授权，其余未建实施任务/未启动。保留原CORE/AUTO本地review、Browser范围外及NOT_RUN_NO_EXISTING_PLATFORM上传缺口，不重复检查OSS自然清理或其自动跟进。

## 清理与交付

本轮真实HTTP浏览器服务/preview已停止，随机浏览器库已由fixture退出清理；专用PG、开发存储及其对象树和production build已精确清理；临时基线/上下文经最终哈希核对后删除。共享依赖/编译缓存保留，不清理用户原文件。任务review、不归档；无暂存、提交或推送。
