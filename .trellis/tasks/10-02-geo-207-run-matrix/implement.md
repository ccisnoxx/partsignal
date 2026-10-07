# GEO-207 实施与验收证据

GEO-207 / R1 已完成本地实现、指定门禁与独立只读复核；manifest 与 Trellis 均为 review，等待人工验收，不自行 done/completed。开始前确认 GEO-206、GEO-204 均 done、Trellis completed 且有 2026-10-02 人工接受记录。沿用已有 geo/GEO-207 分支，没有提交、PR、推送、发布或归档。Task Brief 与12项preflight在编码前完成。

## 实现与业务不变量

RunMatrixBuilder 唯一计算 prompt×profile×repeat；Subject 不乘入，同 Surface 的不同 Profile 不合并。10×3×3准确产生90个稳定 UUID/1-based repeat_index 单元，三模式各30。缺失/停用保留请求数量并定位 blocker；找不到Profile的数量计unresolved，三模式加unresolved等于run_count。惰性单元不创建回答级Batch/Run。

资格直接复用GEO-204 evaluate_profile/current facts。环境混合、问题/Profile语言地区差异、缺少模型版本观测能力给固定warning。没有第二套批准、开关、测试、模型绑定或能力状态机。GEO-206配置显式转换不可变选择，内部集合/重复次数/预算也遵守输入合同。

估价是内部无I/O回调，一格返回明确Decimal/币种或None；当前没有生产估价实现，默认全部unknown，包括manual，cost能力不能代替价格。明确零才是已知零；known/unknown按重复运行数累计，覆盖NONE/PARTIAL/COMPLETE，二者相加为run_count。唯一币种的value为已知部分小计；全未知value/currency=null。混币保留分币小计，总value/currency=null，不相加或换汇，有预算时阻断比较。已知小计>预算阻断，等于允许；未知格给BUDGET_UNVERIFIED，不能保证最终未超预算。当前budget未保存币种，按唯一估价币种比较数额，不假设默认币种。

单格金额有限非负、8位整数/6位小数；聚合扩大Decimal上下文，JSON输出十进制字符串，总额可超过单格上限。估价异常明确传播；只对活动问题且合资格Profile估价，Subject停用阻断计划但不改变问题/Profile估价事实。没有客户端估价或run_count输入。

## 修改文件

维护源码共14份；基于任务起点而非HEAD的最终增量见evidence/increment.patch与changed-files.json，保留前序大量dirty工作。

- 新增backend/app/services/geo_plans.py：矩阵领域事实、Builder与一致读preview_plan。
- 新增backend/app/schemas/geo_plan_preview.py：闭合issue/费用覆盖/公开预览组件。
- 新增backend/tests/unit/test_geo_run_matrix.py、test_geo_plan_preview_contract.py及backend/tests/integration/test_geo_plan_preview.py。
- contracts/openapi.yaml仅追加预览数据组件；frontend/src/shared/api/generated/schema.d.ts由make contract-generate重生成。
- docs/geo-monitoring领域模型、API设计、需求追踪、README、CHANGELOG、task-manifest、SHA256SUMS同步。
- 本任务prd/design/implement/task.json及evidence保存任务与审计记录；没有修改前序任务或无关文件。

## 契约、数据库和迁移

OpenAPI新增GeoMonitoringPlanPreview、固定issue枚举和金额覆盖组件，复用ProfileBlockerCode；不新增Plan HTTP operation、错误映射或输入状态。Pydantic serialization schema逐项对应根组件，generated与根合同一致。

contracts/database.md、ORM和Alembic没有GEO-207变化；无新revision，既有head为0047_geo_monitoring_plans。定向/完整PG集成在临时数据库前滚到既有head；基线还验证前序0046→0047数据保留和metadata。没有GEO-207数据迁移、历史回填/重写、生产前滚或有损降级需求。

## 事务、锁、revision、幂等、并发和错误

纯Builder无Session。preview_plan固定三次批量应用SELECT读取当前列，每次禁autoflush，避开脏identity map，不锁行、不写、不commit/rollback。调用方拥有同一RR/SERIALIZABLE事务，service检查实际连接隔离级别；RC明确拒绝且保留调用方事务。没有Router、锁顺序、revision、状态机或写幂等变化。

预览只说明当前快照，未来命令/Worker仍需锁内/发送前复核；预算不预留或消费。没有新写冲突/数据库错误映射；资源/资格失败为闭合blocker，内部无效估价或隔离级别明确失败，异常不吞。

## 安全和前端

不读取凭据正文、模型request_parameters/base_url或登录会话。问题正文只供内部估价，repr隐藏且不进入公开结果。响应只有数量、金额、固定code/field及UUID，无问题、名字、settings或秘密。没有HTTP/provider/浏览器/真实AI调用；权限、CSRF、SSRF、TLS、合规、不可变及审计边界未放宽。PG仍为唯一业务源，没有Redis消息/后台任务。

前端仅同步generated OpenAPI类型；没有route/query key/URL/页面状态、指标公式或第二套状态机变化。没有新可访问Plan API，GEO-208负责接线。

## 实际验证

以下命令全部实际运行且exit 0；精确命令、结果及日志引用另见evidence/validation-results.json。

| 命令 | 实际结果 | evidence日志 |
|---|---|---|
| env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_surface_contract.py | 编码前180 passed | baseline-unit.log |
| env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55447/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_profile_eligibility.py backend/tests/integration/test_geo_monitoring_plans.py | 编码前32 passed；2条既有metadata warning | baseline-postgresql.log |
| env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_matrix.py backend/tests/unit/test_geo_plan_preview_contract.py | 37 passed | targeted-unit.log |
| env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55447/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_plan_preview.py | 5 passed | targeted-postgresql.log |
| make contract-generate | 生成成功 | contract-generate.log |
| make contract-check | 运行时/根合同/generated一致 | make-contract-check.log |
| make lint | Ruff/ESLint通过 | make-lint.log |
| make typecheck | Mypy 111源文件/tsc通过 | make-typecheck.log |
| make test-unit | 后端1222 passed；前端106文件/993 passed | make-test-unit.log |
| make test-integration COMPOSE='/opt/homebrew/bin/docker compose -p partsignal-geo207-validation -f .trellis/tasks/10-02-geo-207-run-matrix/evidence/validation-compose.yaml' | 605 passed；8条既有metadata warning | make-test-integration.log |
| git diff --check | 通过；新增人工文件/实际增量空白另检查 | git-diff-check.log、final-validation.log |

定向覆盖：90金标、Subject不乘、同Surface不同Profile、稳定唯一、1..10及3000单元；缺失/停用、能力、批准/开关/合规；全未知、显式零、部分/全部覆盖、精度/大金额、预算相等/超过/未知、混币、环境warning、估价异常。五项PG验证当前列/脏identity map、三SELECT无写/锁/秘密、资源定位、RC拒绝、同一RR旧快照及新事务停用、默认Registry拒绝自动Profile。

完整PG中的8条警告来自前序catalog/plans/prompt/surface metadata对照：循环FK排序与dialect_options；基线已复现两类，207未修改对应代码。没有清理无关历史代码。初期Pydantic货币pattern使用了Rust regex不支持的lookaround，已按安装版本改为严格类型/长度/简单锚点；金额序列化JSON schema保留精确末尾约束，修正后的定向和指定门禁通过。

## 独立复核及审计

fresh critical_reviewer只读复核5份新增文件、共享资格、Plan配置、根合同/generated的实际增量，未确认actionable finding。主代理接受复核交付，不将运行状态等同验收。审查仅读取主代理验证证据，没有重复检查。源码/测试/根合同/generated在审查期间未变，见review-source-stability.json；报告见independent-review.md。

WorkPlan plan/dispatch/execution/summary/digest已校验，Bundle finalize/verify通过，audit_id=20261002T190400Z-geo-207-independent-review-cf1370d0。有效SUBAGENT_EXECUTION_DIGEST原文副本留evidence：1次执行、1次复核交付验收、1次独立复核，无未执行ready task、残留活跃Worker或未知写入证据。模型/档位为Agent TOML配置证据，非单独运行时确认。

## 未运行、覆盖边界和已知限制

- 未运行E2E、浏览器矩阵、production build、make verify、部署/负载测试：本任务没有页面/API旅程、部署或外部执行变化；指定门禁与纯Builder/PG检查直接验证207，没有声称其他检查通过。
- SERIALIZABLE未单独运行，真实PG验证RR；并发写发生在两次完整预览之间，未插入三次SELECT间隙，跨SELECT一致性由同一RR事务及PG快照语义支撑。
- 非空估价/混币由纯Builder测试；PG应用路径为默认unknown。生产默认Registry仅manual且无生产估价器，API/BROWSER仍受204资格；测试fake Registry不进入生产。
- budget无独立币种；唯一币种比较数额，混币不能比较且有预算时阻断。未知预算只提示未验证，真正执行预算预留、消费和发送前检查尚未实现。
- 预览不授予写入/执行权，不持久化Plan/Batch/Run；无真实Collector、指标或机会能力。

## 环境、任务与后续

起点Colima停止/Docker default context。启动专用partsignal-geo207-validation，PG55447/Redis56387/fake-oss19007及独立volumes，全为本地合成开发凭据。验证后清理本任务容器/volumes/network/专用test image，恢复Colima停止/default context；environment-cleanup.log保存结果。未操作其他项目或生产数据。

manifest从planned→in_progress→review；仅增加本任务trellis_task/validation_record/review_note。task.json status=review、completedAt=null；没有人工接受、done、提交或归档。SHA只更新本任务改变文档的条目。最终实际增量及工作树检查保留前序工作，没有范围外源码、生成漂移、隐藏fallback或秘密暴露。

后续：GEO-208 Plan命令/API、GEO-209页面、GEO-303批次工厂/快照；真实Collector定价与执行预算由相应后续任务拥有。本次没有实施这些能力。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-207 的实现与测试证据。”据此仅将 manifest 的 GEO-207 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

上述实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果与已知限制，不将未运行检查改写为通过。本次只记录 GEO-207 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
