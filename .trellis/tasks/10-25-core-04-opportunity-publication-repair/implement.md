# CORE-04 实施、验证与恢复记录

2026-10-25。本地实现及必要定向验证完成，等待用户审阅，未部署或记录用户接受。没有暂存、提交、推送或线上操作。

## 实际交付

- 机会详情按服务端PUBLICATION_REPAIR提供入口。OPEN_ISSUE显式选择成果及问题类型、填写非空描述；LINK_ISSUE选择开放问题并绑定问题revision；CREATE_REPAIR读取原发布修复上下文，显式选择同产品批准事实。三个原POST协议及发布领域写流程未改动。
- 新增分页GET `/api/v1/geo/opportunities/{opportunity_id}/publication-repair-options`，mode/page/page_size/selected_issue_id有界。全部保存来源的自有产品范围复用CORE-03共享规则；发布领域列表只增加内部product_ids筛选，默认语义不变。候选服务端available/原因不由浏览器重算。
- ADMIN/ENGINEER、RR/no-autoflush、no-store；选择修复问题后，同一GET快照复用原repair-context并核对产品保存范围。不客户端join独立Issue/Article/Product/Facts快照，不从当前证据分页或当前产品关联猜目标，不手输UUID。
- 机会与问题revision分别冻结。409保留选择/描述/事实版本并暂停，显式刷新后才采用新基线；后台新revision不能自动解锁。422映射可编辑字段，401/403/404隐藏私有表单。pending同步锁、卸载AbortController、主体continuation保持；unknown冻结原完整submission/body/键，仅显式确认原结果。
- 回执核对机会/revision、article/issue/fact及目标相对导航。成功先保留回执，再取消旧读取并失效机会、发布、内容和CORE-02摘要缓存；刷新失败保留导航，不重发成功命令。首次无缓存旧列表迟到不能回填旧阶段。
- 进入原发布问题工作区或内容任务详情，可刷新并返回来源机会。来源参数仅用于导航，不进入领域命令/授权。问题hash canonical跳转与章节切换均保留source。没有改写已发布成果、批准事实，没有自动批准、发布、解决问题或完成修复任务。
- 根OpenAPI逐项比较仅新增一个GET及Mode/Candidate/Options三个组件，全部旧路径/POST/组件未变，generated同步。更新API文档与其单项SHA-256。没有迁移、依赖、调度或生产配置变化。

## 实际命令与有效证据

专用本地PostgreSQL 17在127.0.0.1:16739；PGTZ=UTC，测试自行创建/删除随机数据库。没有生产连接、真实OSS/AI/Provider调用；虚构平台/账号仅存在于自动删除的测试数据库，未创建可用线上平台。

| 命令 / 范围 | 结果 |
| --- | --- |
| `PGTZ=UTC PARTSIGNAL_TEST_DATABASE_URL=postgresql://core04@127.0.0.1:16739/postgres backend/.venv/bin/python -m pytest backend/tests/integration/test_geo_publication_repair_options.py backend/tests/integration/test_geo_opportunity_actions.py -k 'options or publication_open_link_repair or permissions_csrf_scope' -o addopts='' -q --tb=short` | 5 passed、7 deselected；新增3项及原发布行动/权限CSRF范围2项 |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunity-publication-repair.test.tsx src/domains/geo-opportunities/opportunities-page.test.tsx src/domains/geo-opportunities/opportunity-business.model.test.ts --reporter=dot` | 首轮28 passed、3 failed；既有19项有效通过，新增3项失败为测试夹具把client误写为queryClient |
| `npm --prefix frontend run test -- src/domains/geo-opportunities/opportunity-publication-repair.test.tsx --reporter=dot` | 夹具修正后12 passed；增加迟到列表反例后最终13 passed；合计32项不同前端用例有效通过 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-publication-repair.spec.ts` | 首轮1 passed、3 failed；失败为测试夹具遗漏ContentTaskDetail的/detail路径，以及桌面同名导航定位不唯一 |
| `npm --prefix frontend run e2e -- tests/e2e/geo-publication-repair.spec.ts --last-failed` | wrapper实际执行4项，最终production build与mobile/desktop共4 passed，E2E_SECRET_SCAN clean |
| `npm --prefix frontend run typecheck` | 修正协议类型引用及测试client字段后通过；最终ARIA属性/路由缩进/新增测试后再次通过 |
| `.venv/bin/mypy app/services/geo_opportunity_publication_options.py app/services/publication_queries.py app/routers/geo_opportunities.py app/schemas/geo_opportunity_actions.py`（cwd backend） | 4文件通过 |
| `backend/.venv/bin/ruff check backend/app/schemas/geo_opportunity_actions.py backend/app/routers/geo_opportunities.py backend/app/services/geo_opportunity_publication_options.py backend/app/services/publication_queries.py backend/tests/integration/test_geo_publication_repair_options.py` | 通过 |
| Python调用 `app.tools.contract_check.check(Path('contracts/openapi.yaml'))` 并断言无failures | 完整运行时OpenAPI 0 failures |
| `npm --prefix frontend run api:check` | generated与根合同一致 |
| `./node_modules/.bin/eslint src/domains/geo-opportunities/opportunity-business.model.ts src/domains/geo-opportunities/opportunity-detail.tsx src/domains/geo-opportunities/opportunity-publication-repair.model.ts src/domains/geo-opportunities/opportunity-publication-repair.api.ts src/domains/geo-opportunities/opportunity-publication-repair.tsx src/domains/geo-opportunities/opportunity-publication-repair.test.tsx 'src/routes/_app/publishing/issues/$issueId.tsx' 'src/routes/_app/content/tasks/$taskId.tsx' tests/e2e/geo-publication-repair.spec.ts tests/e2e/fixtures/publication.fixture.ts --max-warnings 0`（cwd frontend） | 通过；最终增补竞态用例、required ARIA转发、路由与浏览器定位修改后，定向复查controls、组件/测试、两route及E2E通过 |

PG/HTTP证明：同快照只读、保存范围与分页、默认发布列表不受限制、其他产品的Issue读取/命令拒绝、401/404/422、闭合Schema；三个原命令及各自原请求重放，行动来源、产品/平台/事实/问题继承、唯一修复任务、退役/已有开放问题资格；创建后任务无正文、问题仍OPEN，原Article source_content/verification/hash/title/url/events未改写，FactVersion数量不变。没有扩大到未改变的并发/迁移完整套件。

前端13项涵盖三mode精确载荷与CSRF/key、动作token、分页/不可用候选、unknown原请求、机会和问题revision冲突/显式刷新、422/403、错误目标回执、确认后刷新失败、主体撤销及旧列表迟到。初始错误均定位后修正，没有定时sleep、自动POST重试或放宽身份检查。原POST是inline判别联合，前端改从生成paths.requestBody引用，不新增重复协议组件。

浏览器覆盖OPEN_ISSUE和CREATE_REPAIR两种不同目标页面，各mobile/desktop；LINK_ISSUE的独立载荷由PG/组件覆盖。375/768/1024/1440无横向溢出、键盘入口/确认、实际Issue/ContentTask页面、刷新、Issue章节切换及返回机会通过；原发布命令和上传请求均为0。构建保留已有大chunk提示，未扩大到拆包优化。最后只补required的ARIA转发及route缩进，复用业务/路由证据，最终类型/ESLint通过。

## 独立只读复核

core01_review按本轮基线增量核对读取权限/RR/no-store、保存产品范围、发布领域资格、选定Issue上下文/revision、原POST、unknown/CAS/主体/迟到缓存、回执导航和来源参数。确认一项P2：Issue原navigate({hash:section})会清除来源参数；已改为search:true。其在安装版TanStack Router中作内存复现并复核修复，真实浏览器亦验证章节切换和刷新后来源保留。其余当前候选无确认缺陷；独立审查不是上述PG/交互测试通过的替代。

## 保留边界

未运行完整make verify、全量E2E、Celery/Provider/OSS完整业务栈、部署或线上验收。浏览器使用显式typed API夹具验证真实production页面及目标工作区，返回机会后的详情故意503，只证明返回目标与详情入口；不宣称真实外部全流程完成。持久化/领域资格由本轮真实PG测试分别证明。

OSS浏览器上传仍NOT_RUN_NO_EXISTING_PLATFORM；自然清理PASS、自动跟进NOT_FOUND保留且不追查。不创建平台、不改线上配置、不新增自动跟进、不提交推送。CORE-01～03维持原review；CORE-05/06及6项自动化共8项仍规划，不自动启动。

## 收尾与状态

本轮专用PG仅剩postgres数据库后安全停止并精确清理，16739/4174无监听；production build、Playwright结果/失败trace、临时日志及基线副本均在核对后清理，无本轮遗留服务或对象。删除本轮task自动生成、仅含_example的两个可选资料索引，不保留占位证据。

最终按本轮基线逐文件比对，增量仅为CORE-04源码/合同/测试/API文档单项哈希、子任务及父清单；既有CORE-01～03和其他修改保留。暂存补丁、74项暂存删除及HEAD不变，git diff --check和最终git status --short已核对。任务保留review，清除本会话活动指针，不归档。父清单记录CORE-01～04本地实现待审阅，另8项规划；下一建议CORE-05但未启动。
