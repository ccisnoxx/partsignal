# GEO-105 实施与验证证据

## 交付与依赖

唯一任务 GEO-105 / R1；现有分支 `geo/GEO-105`，未新建分支、提交或 PR，未归档。唯一依赖 GEO-104 在 manifest 为 done，Trellis 为 completed，accepted_at=2026-10-02，并有本会话用户接受依据。本次不改变 GEO-104 的任务记录或其他任务状态。Task Brief 在 [prd.md](./prd.md)。

实现入口 `/configuration/geo-entities`，管理员业务配置导航。五类身份的工作台、服务端搜索/类型/启用状态/产品/父级筛选、排序/分页、完整聚合详情、父级配置、别名创建/编辑/启停/删除、域名创建/删除、Subject启停/删除确认及引用阻断全部接入已存在的 Catalog API。ENGINEER 可直接 URL 阅读，但无创建/编辑/字典/命令入口；配置导航仅 ADMIN 可见。

## 修改文件

- [catalog-commands.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-commands.test.tsx)
- [catalog-controls.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-controls.tsx)
- [catalog-detail.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-detail.tsx)
- [catalog-dictionary-form.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-dictionary-form.tsx)
- [catalog-form-command.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-form-command.tsx)
- [catalog-form.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-form.model.ts)
- [catalog-list.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-list.tsx)
- [catalog-options.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-options.tsx)
- [catalog-page.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-page.test.tsx)
- [catalog-page.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-page.tsx)
- [catalog-route.test.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-route.test.tsx)
- [catalog-subject-form.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog-subject-form.tsx)
- [catalog.api.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog.api.test.ts)
- [catalog.api.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog.api.ts)
- [catalog.model.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog.model.test.ts)
- [catalog.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog.model.ts)
- [catalog.test-support.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/catalog.test-support.tsx)
- [geo-entities.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/routes/_app/configuration/geo-entities.tsx)
- [navigation.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.ts)
- [navigation.test.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/app/navigation.test.ts)
- [routeTree.gen.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/routeTree.gen.ts)
- [catalog-ui.spec.ts](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/catalog-ui.spec.ts)
- [database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)
- [04-frontend-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/04-frontend-architecture.md)
- [task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)
- [README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md)
- [CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md)
- [SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)

另新增本任务 `prd.md/implement.md/task.json` 及 evidence 下的基线、验证日志、指纹、截图和 SUBAGENT_EXECUTION_DIGEST；当前任务指针由 Trellis CLI start 激活。没有修改 backend 业务源码、OpenAPI 或 generated API schema。

## 公共合同与迁移

- OpenAPI：操作、Schema、DTO、动作、错误码和协议语义均无变更；`make contract-check` 同时核对 FastAPI 与 generated 类型。Catalog 仅消费 generated 类型。
- 数据库：DDL/FK/唯一约束/删除语义、事务及审计无变更；仅校正 database.md 开头的过时 GEO-104 实施状态及标准 OpenAPI paths 指向。
- Alembic：本任务没有新 revision，当前源码仍为 `0044_geo_catalog`；本任务未执行迁移前滚、生产迁移、数据回填或 downgrade。GEO-102/104 的历史迁移证据不计作 GEO-105 新验证。
- 不引入新依赖、服务、存储、身份系统或能力开关。

## 状态所有权、锁与并发

PostgreSQL/既有 Application Service 保持写业务唯一权威；UI 不拥有事务或行锁。服务锁序仍是 OWN_PRODUCT Product→旧/新品牌去重 UUID 升序→目标 Subject→子 Alias/Domain；锁后检查父 revision/身份，唯一约束和直接引用仲裁，业务与成功审计同事务。前端不改变此合同，也不推导删除资格或状态转换。

表单采用 RHF 本地输入和加载时父 Subject revision，Query cache 刷新不重置基线；成功写使用完整 canonical 聚合后重置。子命令一律携带父 expected_revision。revision 409 保留草稿，显式读取最新版本后由用户再次提交；其他唯一性 409 同样保留输入，显示服务器消息、字段错误和 request ID。写命令 retry=false，无幂等 key 或自动重放；inFlight/pending 阻止重复提交。删除/启停 intent 固定打开时 revision，409 后读取再确认，并重新消费当前服务端 available_actions。

写前和成功结果采用前取消在途详情 GET。principal epoch 与挂载守卫抑制旧主体/旧对象 continuation；主体切换屏障期间显示明确错误而不发送新命令。成功导航只变更 new/subject_id，保留等待期间更新的 q/sort/page。Catalog 及现有 Product 列表/详情失效由 route composition 接线，失败刷新不伪装成写命令失败或再发命令。

## 前端页面与安全

URL q/subject_type/is_active/product_id/parent_subject_id/sort/page/page_size/subject_id/new 规范化；默认值省略，保留 false、UUID 小写；new 优先于选中对象。筛选更新回第一页且不卸载同一编辑身份，切换对象/路由受 DirtyGuard。详情加载、列表初始/筛选空、读取失败重试、已有详情后台失败、权限、保存冲突、pending、完成及取消确认均有反馈。Table Kit/现有浅色视觉系统；移动端堆叠；产品身份只读。

资源动作与删除 blockers 仅穷尽映射 server DTO；ENGINEER 的 server actions=[]/deletion=null，页面隐藏入口不代替服务端授权。CSRF 全部沿用 X-CSRF-Token；缺失令牌不发出写请求。OWN_PRODUCT 不编辑绑定、名字/类别或事实正文，不调用 Fact API。域名以文本展示，服务端做 IDNA 规范化，前端不执行 DNS/HTTP/所有权验证。React 文本节点展示名称、说明和错误，没有 raw HTML、外部链接自动打开、凭据、Cookie、API Key 或事实正文保存/回显；不添加浏览器持久化。

openapi-fetch 0.17 / openapi-typescript-helpers 的 Readable 对纯 null 属性错误删键，已核对本地 index.d.ts 158–159；API 成功 data 在边界显式断言 generated GeoSubjectOut/ListPage，运行时 JSON 未改写，不补默认值，不能把该断言记为 runtime schema 校验。原因只在 API owner 注释与本任务记录保留，不修改第三方依赖。

## 基线（编辑前）

| 实际命令 | 结果 | 日志 |
|---|---|---|
| `npm --prefix frontend run test -- src/domains/configuration/prompt-workspace-page.test.tsx src/domains/geo/geo.api.test.ts src/app/navigation.test.ts src/app/router.test.ts` | 退出 0；3 文件36项通过；最后一个筛选路径当时不存在，不能称其为已运行路由测试 | evidence/baseline-frontend.log |
| `make contract-check` | 退出 0；运行时与 generated 均一致 | evidence/baseline-contract.log |
| `npm --prefix frontend run typecheck` | 退出 0 | evidence/baseline-typecheck.log |
| `uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_geo_catalog_projection.py backend/tests/unit/test_geo_catalog_schema.py` | 退出 0；85项通过 | evidence/baseline-catalog.log |

## 最终验证

| 实际命令 | 结果 | 日志 |
|---|---|---|
| `git diff --check` | 退出 0，无输出；包含现有 tracked 工作树 | evidence/diff-check.log |
| `make lint` | 首次因本任务 useMemo 多余依赖 warning 失败；修正后退出 0，Ruff/ESLint 全部通过 | evidence/lint.log、lint-final.log |
| `make typecheck` | 退出 0；mypy 89 源文件与 frontend tsc 通过 | evidence/typecheck.log |
| `npm --prefix frontend run test` | 退出 0；97文件926项通过（含最终新增路由测试） | evidence/frontend-test.log、frontend-test-final.log |
| `npm --prefix frontend run typecheck` | 退出 0，包括新增组件/路由测试 | evidence/frontend-typecheck-final.log |
| `make contract-check` | 退出 0；运行时176操作与 generated 类型一致 | evidence/contract-check.log |
| `make test-unit` | 退出 0；后端967项，前端96文件924项通过（随后仅新增2项定向路由测试，业务源码不变） | evidence/test-unit.log |
| `npm --prefix frontend run test -- src/domains/geo-catalog` | 退出 0；5文件63项通过，其中38项API/URL模型、25项组件/真实文件路由 | evidence/catalog-tests.log |
| `npm --prefix frontend run e2e -- tests/e2e/catalog-ui.spec.ts --project foundation-desktop` | 最后退出 0；两个 Chromium production artifact 检查通过；SECRET_SCAN clean | evidence/catalog-browser.log |

浏览器验证实际自建 production artifact，覆盖1440px/375px页面根无横向溢出、局部Table区域、URL刷新、键盘菜单→确认框→Escape→焦点返回，以及ENGINEER直接详情/new只读。所有API是明确 page.route fixture，只证明浏览器行为，不是真实业务/后端授权验证。[桌面截图](./evidence/catalog-1440.png)、[移动端截图](./evidence/catalog-375.png)。构建保留既有 Markdown Editor 大 chunk 与 NO_COLOR/FORCE_COLOR 提示，未升级依赖或扩展性能任务。

首次集成 typecheck 揭示纯null字段类型问题及一个 Zod issues[0]索引约束，均已修正并重新验证；首次创建 fixture 的 Product enum 拼写及 byRole exact 类型问题已按本地 generated 类型修正。延迟删除测试首次使用错误列表形状，修正 fixture 后 create/delete 反例通过。首次 browser 的 toHaveText 把装饰箭头也算入，改为语义包含断言，随后定向与最终两个检查通过、敏感扫描clean。这些首次失败不是未知环境阻断或被掩盖的业务失败。

## 独立复核与收敛

完成 fresh critical_reviewer 只读复核；P1缓存详情后台GET失败卸载草稿和P2命令成功恢复旧URL均修正。P1修正后代理静态复核；P2由主代理明确 latestSearch owner 修正和create/delete延迟响应反例验证，未再发第二轮独立复核。当前无确认的未解决验收阻断。具体可行动发现及验证边界在 [independent-review.md](./evidence/independent-review.md)。

API/model 子代理实际修改四个指定文件，主代理随后修正 API 的安装类型问题；独立代理无写入。本任务多代理审计已经通过 summary/digest/finalize/verify，closed、2执行尝试/2交付验收、1独立复核、0异常/残留活跃worker。audit_id：`20261002T090703Z-geo-105-catalog-ui-2bbe129e`；固定Profile配置证据不是运行时模型遥测。完整摘要在 evidence/SUBAGENT_EXECUTION_DIGEST.json 与 .md。

## 差异与证据边界

起始已有大量GEO-001～104未提交修改；以evidence/start-files.json和最终scope-check.json区分本任务。没有覆盖backend源码、OpenAPI、generated Schema、旧任务、既有前端auth/product/audit/content改动。起始指纹遗漏5份tracked中文文档；已用Git diff补查无差异，它们不是本任务新增文件，也未操作或删除。coverage限制单独记录在evidence/fingerprint-coverage.json。

没有执行 `make verify`、`make test-integration`、Docker发布构建/生产部署、真实Catalog API E2E、PG迁移或跨浏览器矩阵：本任务没有改变后端、数据库、部署或浏览器兼容边界，GEO-106的真实API纵向验收及R1后续门禁不属于GEO-105交付。不能据UI fixture和单元结果声称这些检查通过。

文档收尾实际执行 `shasum -a 256 -c SHA256SUMS`（工作目录 docs/geo-monitoring）退出0、全部条目OK；本任务 Markdown 相对/绝对链接检查通过。最终 `git diff --check` 退出0，scope检查为9个既有文件修改、19个新增前端文件、0删除；manifest除GEO-105状态外与起始指纹完全一致。

## 状态与后续

最终manifest仅GEO-105变为review，GEO-104保持done、GEO-106保持planned；Trellis status=review、completedAt=null，未done/完成归档。README/前端架构/CHANGELOG/对应SHA同步；数据库文档只校正实施状态。GEO-106的真实API创建OWN_PRODUCT/竞品/alias/domain纵向验收与产品引导尚未实现；其他任务、Batch/Run、采集、指标和机会均未实现。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-105 的实现与测试证据。”据此仅将 manifest 的 GEO-105 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围和依据；Task Brief 的当前状态同步更新。

以上实施章节和原始 evidence 保留提交人工验收时的历史状态、测试结果及边界，不把未运行检查改写为通过。本次仅记录 GEO-105 验收，不改变其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾执行 git diff --check，并核对五个收尾文件的未跟踪文件空白及其他文件保持不变；实际结果见本轮最终报告。
