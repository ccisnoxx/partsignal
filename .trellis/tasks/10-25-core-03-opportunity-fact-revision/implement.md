# CORE-03 实施、验证与恢复记录

2026-10-25。本地实现及必要定向验证完成，等待用户审阅；未部署或记录用户接受，没有暂存、提交、推送或线上操作。

## 实际交付

- 机会详情按服务端 `available_action_types` 显示“发起事实修订”，展开时读取合法产品，显式选择及确认后调用原 fact-revision POST。展示确认回执、已有行动记录及产品事实工作区入口。
- 新增只读 `GET /api/v1/geo/opportunities/{opportunity_id}/fact-revision-options`，返回同一 RR 快照的机会 ID/revision、FACT_REVISION 动作、产品 ID/品牌/型号及 as_of；沿用 ADMIN/ENGINEER、no-autoflush、no-store，不写业务记录、不取得行锁。
- 保存来源产品范围提为 `saved_own_product_ids`，命令和选项共用原规则：优先匹配机会 subject_id 的冻结 OWN_PRODUCT，否则读取全部保存来源中的 OWN_PRODUCT。选项只返回当前 ACTIVE 产品，不要求批准事实，不依赖当前来源分页或当前 Catalog 关联。原 POST 的权限、锁、CAS、幂等重放及错误合同保留。
- 表单复用现有 Form Kit、DirtyGuard、主体生命周期、CSRF、请求签名与错误分类。409 保留选择并暂停，显式刷新机会与选项后重确认；422 关联产品字段；未知结果冻结原载荷/键供显式核对，不自动重发；401/403/404 隐藏私有内容。
- 成功先保存回执，再取消旧请求并精准失效机会、产品事实及 CORE-02 总览/报告缓存；旧列表请求不能迟到回填。刷新失败保留已确认导航，不重发命令。主体撤销后的迟到响应不能显示或失效新主体数据。
- 产品事实路由校验 `source_opportunity_id` 并提供返回机会入口，刷新仍保留。该参数只用于导航，不进入事实保存/提交/审核载荷，不授予权限。原 FactWorkspacePage 未改动，登记行动不新增 FactVersion、不修改事实正文或批准版本。
- 根 OpenAPI 只新增一个 GET 和两个闭合响应组件，generated 同步；原 fact-revision POST 协议逐项比较未变。更新 API 说明及其单项 SHA-256。无数据库迁移、依赖、生产配置或调度变化。

## 实际验证命令与有效证据

本轮专用本地 PostgreSQL 17：127.0.0.1:16639，测试自行创建并删除随机数据库；PGTZ=UTC。没有生产连接或真实 OSS/AI/Provider 调用。以下命令默认 cwd 为仓库根；表内为互补证据，不重复累计重跑次数。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://core03@127.0.0.1:16639/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_fact_revision_options.py backend/tests/integration/test_geo_opportunity_actions.py -k 'options or fact_navigation or permissions_csrf_scope' -o addopts='' -q --tb=line` | 首轮4 passed、1 failed、7 deselected；失败仅为新增无批准事实夹具，原2项行动测试通过 |
| 同一环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_fact_revision_options.py --lf -o addopts='' -q --tb=line` | 夹具修正后1 passed、2 deselected |
| 同一环境 `backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_fact_revision_options.py -k 'options' -o addopts='' -q --tb=line` | 增补已保存行动记录断言后，3 passed；合计5项不同后端用例有效通过 |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunity-fact-revision.test.tsx src/domains/geo-opportunities/opportunity-business.model.test.ts src/domains/geo-opportunities/opportunities-page.test.tsx src/domains/geo-opportunities/opportunity-business.test.tsx` | 首轮43 passed、2 failed；新表单中2项等待异步选项的测试失败，既有38项有效通过 |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunity-fact-revision.test.tsx` | 等待方式修正后7 passed |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunity-fact-revision.test.tsx --reporter=dot` | 增补422/403、目标不可用、提交后刷新失败、迟到列表反例后11 passed；合计49项不同前端用例有效通过 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-fact-revision.spec.ts` | URL测试断言修正后，production build通过，mobile/desktop共2 passed；375/768/1024/1440无横向溢出，键盘登记、实际工作区路由/刷新/返回及无事实自动写入；E2E_SECRET_SCAN clean |
| `.venv/bin/mypy app/services/geo_opportunity_product_scope.py app/services/geo_opportunity_fact_options.py app/services/geo_opportunity_actions.py app/routers/geo_opportunities.py app/schemas/geo_opportunity_actions.py`（cwd backend） | 5文件通过 |
| `backend/.venv/bin/ruff check backend/app/services/geo_opportunity_product_scope.py backend/app/services/geo_opportunity_fact_options.py backend/app/services/geo_opportunity_actions.py backend/app/routers/geo_opportunities.py backend/app/schemas/geo_opportunity_actions.py backend/tests/integration/test_geo_fact_revision_options.py` | 通过 |
| `npm --prefix frontend run typecheck`，最终E2E build的 `tsc -b` | 通过 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` | 完整运行时合同0 failures |
| `npm --prefix frontend run api:check` | generated 与根合同一致 |
| `./node_modules/.bin/eslint src/domains/geo-opportunities/opportunity-fact-revision.api.ts src/domains/geo-opportunities/opportunity-fact-revision.tsx src/domains/geo-opportunities/opportunity-fact-revision.test.tsx src/domains/geo-opportunities/opportunity-business.model.ts src/domains/geo-opportunities/opportunity-controls.tsx src/domains/geo-opportunities/opportunity-detail.tsx src/shared/lib/geo-opportunity-labels.ts 'src/routes/_app/products/$productId_.facts.tsx' tests/e2e/geo-fact-revision.spec.ts --max-warnings 0`（cwd frontend） | 通过 |

PG/HTTP证明：同一快照仅 SELECT、无行锁/事实或行动写入；状态token、分页外的保存范围、无批准事实仍可修订、不相关产品拒绝、产品停用后新命令重验、401/404、闭合Schema、原POST幂等及行动来源/导航、登记不改正文或版本。复用本轮原行动测试的权限、CSRF、来源、审计、重放与内容创建证据，不重跑未改变的完整业务套件。

首轮问题均先定位再修复：无批准事实测试误用了要求批准版本齐全的分析夹具，改用既有真实采集夹具保存无版本来源；表单测试等待异步选项后再点击，未用定时sleep或点击重试；路由search类型改为可选字段以保留既有调用者；mock泛型按实际spy类型修正。浏览器实际目标正确，失败来自测试RegExp未正确转义问号，改按URL pathname/searchParams断言。Ruff仅作格式/导入修正。构建保留已有大chunk提示，未扩大到拆包优化。

## 独立复核

复用 core01_review 对本轮增量作独立只读复核，覆盖公共只读合同、身份/RR/no-store、共享scope与原谓词等价（匹配、回退、重复及空集）、原POST锁/CAS/幂等、前端主体撤销/未知与冲突恢复、取消旧读取后失效缓存、来源参数只用于导航。未发现确认缺陷。其内存验证不替代上面的真实PG/HTTP与浏览器证据。

## 证据边界与保留事项

浏览器使用显式typed API夹具，验证真实production页面、目标工作区及路由；返回机会后的详情故意503，只证明返回目标和打开详情，不宣称外部完整业务栈成功。产品保存/提交/批准均为0请求；命令持久化、不变历史及资格由真实PG用例分别证明。

未运行完整 make verify、全量E2E、Celery/外部Provider/OSS完整业务栈或线上验收。OSS浏览器Logo上传仍 `NOT_RUN_NO_EXISTING_PLATFORM`；自然清理PASS、自动跟进NOT_FOUND保留且不追查。不创建平台、不改线上配置、不新增自动跟进、不提交推送。CORE-01/02保留review，CORE-04～06与6项自动化仍为规划，不自动启动。

## 收尾与任务状态

本轮专用PG只剩postgres数据库后安全停止并精确清理；16639/4174无监听。production build、Playwright结果及失败trace、临时日志和基线副本均在完成核对后清理，无本轮遗留服务或临时对象。

相对本轮开始的逐文件指纹，变更仅为CORE-03源码/合同/测试/API说明与单项哈希、子任务及父清单；既有CORE-01/02及其他文件均保留。暂存二进制补丁与HEAD一致，git diff --check通过，最终git status --short已核对。任务保留review，清除本会话活动指针，不归档；父清单记录CORE-01～03本地实现待审阅，余9项规划，下一建议CORE-04但未启动。
