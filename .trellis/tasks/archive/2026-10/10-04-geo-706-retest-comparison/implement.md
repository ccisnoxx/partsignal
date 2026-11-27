# GEO-706 执行证据

## 基线
- 后端定向：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_opportunity_rules.py backend/tests/unit/test_geo_opportunity_workbench.py backend/tests/unit/test_geo_opportunity_baseline.py；exit0，140 passed。
- 前端定向：npm --prefix frontend run test -- src/domains/geo-opportunities；exit0，20 passed。
- PG定向：docker compose -f .trellis/tasks/10-04-geo-706-retest-comparison/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_retests.py tests/integration/test_geo_opportunity_workbench.py；exit0，22 passed。

日志位于evidence/baseline-*.log。隔离compose复用已安装依赖的测试镜像，挂载当前backend和根contracts；55476 PG、56476 Redis、本地fake OSS，无真实外部服务。

## 实现结果与状态

GEO-706 / R6，分支 `geo/GEO-706`。开始前已逐项读取用户要求的文档与当前合同、适用AGENTS/spec、705/605任务记录，确认两项依赖均done且已有人工接受记录，并输出12项preflight。manifest从planned进入in_progress；完成实现、本地验证及独立复核后仅进入review，未自行done、提交、归档或实施707。

完整修改文件见 `changes.md`；初始hash用于识别本任务变化，保留此前其他GEO任务的脏修改。`candidate-changed-files.json`保存最终维护文件hash；Trellis记录与命令证据单列，不把其他任务的已有代码归为706交付。

## 公共合同与持久化

- 新增比较GET、resolve POST、continue POST，路径均为 `/api/v1/geo/opportunities/{opportunity_id}/…`。新增14个闭合DTO及RESOLVE/CONTINUE动作，根OpenAPI是唯一公共权威，generated类型按根合同生成。
- 比较提供冻结baseline与所选/latest retest、窗口、指标分子分母、候选/合格/排除样本及原因、冻结恢复政策、实际环境/模型/采集方式/分析版本差异。`causal_claim=NOT_ESTABLISHED`；缺失历史配置/事实保持UNAVAILABLE，不猜测或补零。
- Alembic `0062_geo_opportunity_decisions`，down_revision=`0061_geo_retests`，仅新增不可变处理记录和一致性守卫，无历史数据回填。表包含人工/复测解决或继续、非空code/comment、操作者、时刻、前后revision及可选比较快照/指纹。
- 四个FK采用RESTRICT；机会/revision唯一，revision严格加一。比较身份、来源和SHA256指纹由PG守卫验证；延迟约束保证IN_PROGRESS→RESOLVED与处理记录同事务。UPDATE/DELETE/TRUNCATE拒绝修改历史。ORM `JSONB(none_as_null=True)`保证无比较的人工处理为SQL NULL而非JSON null。
- 测试验证空PostgreSQL前滚到0062、既有0061真实RETEST历史前滚后内容hash保持、ORM与迁移一致；downgrade明确拒绝删除历史。迁移设置5秒锁超时与120秒语句超时。恢复路径为事务失败回滚、备份恢复或前向修复。未执行生产迁移。

## 业务裁决、事务与并发

- 基线以首次trigger来源Run/Answer/analysis/Review身份读取，不受current分析或latest审核指针漂移影响；复测使用当前有效证据。共享读取显式区分冻结选择，既有总览公式与默认行为保持。
- 复用601/603指标、701冻结恢复配置及702规则。下降/竞争激增按原健康参考窗口判断，不把异常baseline当恢复参考；引用按规范化唯一URL、错误事实按一致的规范化签名判断。质量门槛全部满足，未知判断不变为零。
- 恢复最低样本取 `max(recovery.minimum_runs, metric_minimum, sample_gate.current_minimum)`，保留UNSTABLE_RESULT独立的unstable_minimum_repeats。样本不足/不可比/未恢复均不能RETEST解决；达标也不会自动解决。
- 仅IN_PROGRESS允许resolve/continue。MANUAL需非空处理依据，不依赖自动比较可用；RETEST需严格可比、RECOVERED、匹配比较指纹；continue保持IN_PROGRESS并追加处理记录、revision加一。终态不可逆。
- Router仅认证/参数映射，Application Service持有事务和不变量。身份User `FOR NO KEY UPDATE`重新检查可用性/权限；相关Batch按UUID稳定顺序，再Run同序 `FOR NO KEY UPDATE`，Opportunity最后 `FOR UPDATE`。与705/复核已有FK KEY SHARE兼容；真实交错测试验证等待后过期证据409，未引入新锁环。
- 锁内重读比较并验证expected_revision与SHA指纹；机会、decision、审计原子提交，任一步失败全部回滚。重复命令通过CAS拒绝，无新幂等键或自动重放。401/403/404/422及409 REVISION_CONFLICT、INVALID_STATE_TRANSITION、GEO_COMPARISON_STALE、GEO_RETEST_NOT_RECOVERED保持明确错误。

## 安全与前端

保持engineer/admin权限、CSRF、身份状态、审计及不可变边界；所有比较/写入no-store，401/403/404清除或隐藏旧敏感界面。处理原因仅保存在受权限保护的decision；审计只存decision_id/decision/revision/status四个闭合事实，不含原因、正文或凭据。decision-only操作者仍计入用户业务引用，删除返回USER_IN_USE。无真实外部AI调用、新Redis载荷或依赖升级。

机会抽屉消费generated DTO，前端只格式化展示、不计算指标/恢复政策。URL复测选择与query key包含机会/批次；切换机会清理旧选择，读写支持AbortSignal。页面展示各类加载、无复测、未完成、不可用、样本不足、不可比、未恢复、达标和已关闭状态，始终有非因果说明和实际环境/模型/采集方式差异。

显式人工解决/复测确认/继续均需处理依据；in-flight防重、取消与卸载清理。409保留草稿，后台刷新不偷偷更换提交基线；用户显式重读后绑定新revision/指纹。canonical结果更新缓存且防旧查询覆盖，终态无动作。dirty navigation、键盘/焦点和组件语义沿用项目规范。

## 最终验证

命令通过 `evidence/run_check.py`执行，JSON保存原始argv、退出码和耗时，同名log保存完整输出。以下最终结果均exit 0；最终diff与Trellis校验另见diff-final/task-validate记录。

| 实际命令 | 结果 | 证据 |
|---|---|---|
| `git diff --check` | 通过；维护文件包含未跟踪项，另逐文件检查无尾部空白 | diff-final.json/log、final-scope.json |
| `make lint` | Ruff与ESLint通过 | lint-final.json/log |
| `make typecheck` | 后端233文件、前端tsc通过 | typecheck-final3.json/log |
| `make test-unit` | 后端3658；前端134文件1265项通过 | unit-final2.json/log |
| `make test-integration 'COMPOSE=docker compose -f .trellis/tasks/10-04-geo-706-retest-comparison/evidence/compose.yaml'` | 隔离PG完整1123项通过，35项warning | integration-final.json/log |
| `npm --prefix frontend run test` | 134文件1265项通过；最终make test-unit亦再次执行同一命令 | frontend-test.json/log、unit-final2.json/log |
| `npm --prefix frontend run typecheck` | 通过；最终make typecheck亦再次执行同一命令 | frontend-typecheck.json/log、typecheck-final3.json/log |
| `make contract-check` | runtime、根OpenAPI和generated一致 | contract-final2.json/log |
| `python3 .trellis/scripts/task.py validate .trellis/tasks/10-04-geo-706-retest-comparison` | implement/check各4项context校验通过，无警告 | task-validate.json/log |

定向PostgreSQL实际命令：

```sh
docker compose -f .trellis/tasks/10-04-geo-706-retest-comparison/evidence/compose.yaml run --rm backend-test pytest tests/integration/test_geo_retest_comparisons.py tests/integration/test_geo_retest_history.py tests/integration/test_geo_decision_migration.py tests/integration/test_geo_admission_migration.py tests/integration/test_geo_answer_migration.py tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent --tb=short
```

27项通过，6项既有元数据warning，见integration-affected.json/log。覆盖前后窗口、样本不足、未恢复、人工与复测解决、continue、历史身份、权限/CSRF、CAS、比较漂移、并发、审计回滚、SQL守卫/不可变、0061存量前滚和新库前滚。

真实API目标E2E实际命令（仅隔离本地测试凭据）：

```sh
env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55476/partsignal REDIS_URL=redis://127.0.0.1:56476/14 PARTSIGNAL_E2E_SPEC=tests/e2e/geo-comparison-real-stack.spec.ts deploy/scripts/e2e-local.sh
```

1项通过，见e2e-comparison-final2.json/log。验证真实API/Worker下继续→人工解决→刷新处理历史、revision请求、终态动作、非因果说明、375/768/1024/1440宽度及200%缩放；E2E_SECRET_SCAN clean，临时DB/Redis14/端口/存储清理确认。截图geo706-history.png已视觉检查。测试使用真实上传证据与本地fake，无放松截图/原始证据、网络或权限边界。完成后独占geo706-validation的PG/Redis/fake-OSS容器与网络已通过compose down清理（exit0，validation-cleanup.json/log），未操作其他测试栈。

## 失败记录与纠正证据

- 首轮单元测试旧契约清单、动作与路径期待需要精确补充；类型检查的tuple及生成类型约束已修正，最终全量通过。新operation错误响应统一引用既有ErrorResponse，未改变无关operation。
- 首轮完整集成在后端候选冻结前启动，载入了未完成的模块版本，13项失败：10项对应已修正的审计事实注册、JSON null/SQL NULL及测试分析输入；3项旧迁移测试仍期待0061 head。已更新为精确0062期待，定向27项和最终1123项全通过。旧日志integration.json/log保留，不把首轮失败计作通过。
- 首轮E2E缺少强制截图/原始证据而422；加入实际证据上传，未降低准入。第二轮业务已通过，runtimeAudit捕获合法查询取消；只在geo706阶段精确允许三个已知GET路径的net::ERR_ABORTED，其他错误/写入不放宽。最终目标E2E与敏感扫描通过，前两轮失败日志仍保留。
- PG warning来自既有SQLAlchemy FK循环与dialect_options元数据，未放宽检查；0062元数据/迁移一致验证通过。

## 独立复核与审计

critical_reviewer独立只读检查公共合同、历史读取、状态/CAS、锁与不可变保证及前端证据。发现1项P1：UNSTABLE_RESULT独立样本门槛可能被较低stable_minimum覆盖。新增最小行为回归：unstable=10、stable=5、recovery=5，五样本必须INSUFFICIENT_SAMPLE(required=10)。pre-fix正确失败，修复后三项样本下限取最大值，9项恢复单元通过；复核另用内存执行确认5样本不足/10样本恢复，问题关闭，无剩余确认阻断。

持久审计ID `20261005T013631Z-geo-706-f49717c9`：3个计划/3个执行均校验验收通过，1个独立复核；审计finalize/verify成功、20项artifact，无异常或活跃worker。生成的SUBAGENT_EXECUTION_DIGEST.json/md已复制到evidence；配置模型档位与实际运行回报明确区分。

## 文档、范围检查与限制

同步根API/数据库及本任务触及的页面、指标、数据/API/前端架构、需求追踪、README/CHANGELOG/manifest。SHA256SUMS仅重算这些9项GEO文档，保留其他条目；scope证据见documentation-sha-scope.json。核心PRD的既有校验和与本任务初始实际hash不一致，未改该文件/索引项，不宣称整个文档树SHA检查通过。

新增/实质重写源码均按真实职责边界划分，未超过500行（新维护源码最大383行）。最终hash与实际差异检查确认62项维护文件变更、无删除/意外范围/尾部空白；与开始前根API语义比较仅新增3路径、14组件及GeoOpportunityAction扩展，既有operation和其他组件保持。未覆盖其他任务、无额外依赖/部署/Collector变更，见final-scope.json。manifest与Trellis仅review；705/605仍done、707仍planned，completedAt/commit/pr_url为空。

复测确认解决的实际后端路径由PG集成和前端组件覆盖，本次目标浏览器旅程覆盖continue/人工解决/历史；未另跑完整浏览器RETEST解决纵向链、全E2E、make verify或浏览器矩阵。这些不作为706已通过证据，完整R6纵向验收由707负责。未执行生产迁移、真实AI调用、Browser Adapter、保留策略或最终上线。后续仅提示707，未提前实现。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-706 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次只记录人工验收，不重新实现或重复运行功能门禁。

本次仅收尾GEO-706，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
