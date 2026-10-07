# GEO-705 实施证据

## 基线
分支geo/GEO-705；起点工作树大量既有变更，evidence/initial-status.txt及baseline保存实际起点。独占Compose geo705-validation，PG16端口55475，Redis56475，本地fake OSS。
- baseline-unit.json：56 passed，exit0，相关规则基线/批次合同/矩阵/行动。
- baseline-integration.json：20 passed，exit0，真实PG行动/首次机会基线/批次创建；容器挂载当前backend和只读contracts。
精确argv/elapsed/log均见对应json/log；无真实provider调用。

## 实现与当前候选

- 新增RetestPlanner和只读预览；原trigger、显式来源批次、整批根矩阵、原plan/rule/input与最新attempt Answer身份/版本由服务端构建，客户端不能提供snapshot。
- 0061新增不可变baseline/request两表、来源/实际Answer核对及deferred逐cell守卫。实现子代理22项真实PG验证的直接工具记录见evidence/persistence-validation.json；SHA和实际写路径已核对。后续完整集成还覆盖这些用例。
- Profile/Variant/Surface/Topic/Subject语义/revision、当前资格和已观测版本均按冻结条件比较；未知来源版本也阻断。当前Plan演进不改复测矩阵。新请求仅IN_PROGRESS且推进revision；不比较恢复指标/关闭机会。
- actor+key+完整请求SHA幂等，replay先于新CAS/资格检查；一批全矩阵/关系/回执/安全审计原子提交，提交后复用UUID派发。
- 既有路由/数据库行为保持；新API与7个组件同步generated类型，未改前端路由、query key、URL状态或页面。evidence/contract-scope.json证明既有OpenAPI全部machine shape保持。

## 独立复核与锁修正

fresh critical_reviewer确认一项P1：Planner原资源FOR UPDATE与来源Batch隐式FK KEY SHARE，在另一个actor的review_run持Batch并第二次UPDATE Run重新检查Variant/Profile FK时形成锁环。已新增no_key_update=False参数到既有资源锁owner，仅Planner传True，所有配置资源改为FOR NO KEY UPDATE，仍阻止修改/删除且允许FK身份读取；其他调用默认行为保持。

独立复核已静态检查此修正；其最终读取的测试日志仍为前置Plan夹具KeyError，主代理随后获得最终证据：targeted-review-race-v3为15 passed，包含初次/复用基线的真实review_run双会话交错，先观察Planner在来源Batch锁等待再放行Review，两个actor避免账号锁掩盖。legacy-lock-negative在独立测试进程强制旧锁策略，exit1并实际DeadlockDetected于baseline INSERT的Batch FK，证明回归能发现原问题。未修改候选运行时代码或共享dev数据库。

Bundle 20261005T001350Z-geo-705-bf842f6a已生成有效SUBAGENT_EXECUTION_DIGEST，audit-finalize/audit-verify通过；2/2执行验收、1次独立只读复核、无活跃worker/未知写入/异常。模型/effort只代表Agent TOML配置。

## 已运行验证与初期失败

- lint-candidate：make lint通过；typecheck-candidate：make typecheck通过（225后端源码/前端tsc）。本次后来测试夹具修改仅Ruff复验。
- contract-final：make contract-check通过，runtime与generated均一致。初始差异是安装FastAPI省略nullable reason默认，随后只校准新增705组件；旧合同未变。
- unit-final：make test-unit通过，后端3649/前端1244；首轮旧端点数量/响应签名/702阶段边界断言未同步，已保留精确签名校验并更新为246 operations、1590 responses。
- targeted-review-race-v3：15 passed，覆盖strict freeze、配置/模型不可比、HTTP身份/CSRF、同/异key并发、audit/commit rollback、RR纯读、重复新请求和来源复核锁交错。
- integration首次：5 failed/1091 passed。三处旧head/降级文案断言，及运行进程已加载的旧head/短CSRF夹具；均无业务门禁放宽。0060自身迁移测试固定升级至0060以保持其原revision合同，其余当前head断言更新0061。integration-failed-targeted-v2四项真实PG通过；CSRF及新并发由最终705定向通过。
- diff-check：git diff --check通过。

精确argv、elapsed、exit code与日志均保存对应evidence JSON/log。初期夹具问题包括Answer/Run采集时间不相同、缺started_at、短CSRF字段、误用Plan方法/响应形状/过期revision；均修正夹具，不修改既有守卫。一个定向命令选了不存在的测试node，exit4/no tests ran，已按实际node重跑。命令失败记录保留。

## 最终验证与交付状态

- integration-final：`make test-integration 'COMPOSE=docker compose -f .trellis/tasks/10-04-geo-705-retest-planner/evidence/compose.yaml'`，exit0，1099 passed / 33 warnings，pytest耗时551.47秒，完整命令耗时554.473秒。覆盖0061迁移、22项持久化反例和15项复测业务/并发用例，首次完整集成失败已全部修正。
- 0060非空数据库前滚至0061通过，既有历史未改写，新两表为空；ORM metadata无漂移。未知旧RETEST记录安全阻断迁移并保留0060；降级明确安全停止，恢复迁移前备份或前向修复，无破坏性历史回填。未执行生产迁移。
- 本任务manifest、Task Brief与task.json由in_progress进入review，completedAt保持null，等待人工接受；GEO-704/GEO-303保持done，GEO-706保持planned。
- 未运行完整E2E、浏览器矩阵、生产迁移、容量性能测试或make verify：本次没有前端交互/外部provider/部署行为变化；指定最低门禁及根合同一致性、真实PG边界验证已完成。没有宣称这些未运行项通过。
- 当前创建门禁只依据已保存版本事实，不探测外部provider；版本未知阻断。创建后实际provider版本漂移的比较与恢复裁决属于GEO-706。大矩阵提交守卫性能未量测，不作性能提升承诺。

本任务完整修改清单见files.md；工作树起点与最终状态分别保存证据，既有非本任务变更保留。独占测试环境清理与文档SHA校验结果在对应evidence记录。

- cleanup：专用geo705-validation Compose down -v exit0，三个容器与专用网络均移除；未操作共享开发环境。
- 文档SHA只更新本次修改的六份文档，六份均匹配；全包校验116项匹配、1项不匹配（未修改的01-product/02-geo-core-prd.md，原SHA条目保持）。因此全包shasum退出1，不报告为通过。首次从仓库根运行错误地解析了相对路径，已改为文档根运行；两次原始输出及精确命令均保留。未擅自重算未涉及文件来隐藏不一致。
- 当前会话task.py current --json确认review且stale=false；会话指针存于.trellis/.runtime/sessions/，不使用旧版全局.current-task。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-705 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次只记录人工验收，不重新实现或重复运行功能门禁。

本次仅收尾GEO-705，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
