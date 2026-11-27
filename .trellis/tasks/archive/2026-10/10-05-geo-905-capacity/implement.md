# GEO-905 实施与证据

## 1. 交付状态与依赖

2026-10-05，入场已有分支 `geo/GEO-905`；没有创建分支、提交、推送、发布或生产写入。
GEO-607、GEO-902在manifest均为done且有人工接受，允许GEO-905执行；GEO-906仍planned。
已读取用户要求的文档、适用AGENTS/spec、当前合同、迁移、调用者及测试，先输出12项preflight再编码。
Task Brief按模板创建为[prd.md](./prd.md)，设计见[design.md](./design.md)。

本轮代码及本地检查完成，但目标环境规格、授权测试入口及冻结阈值的异步问题未得到答复。
manifest与task.json均planned→in_progress→blocked，命中用户限定的“完成本任务必需的外部输入或人工授权缺失”。
没有review/done或人工接受声明。此阻断不来自已分类并补验证的本地setup错误。
恢复需要明确目标环境/授权/阈值及代表性负载；也可明确接受本地环境及负载作为目标，再补齐该定义下的证据。

## 2. 实现摘要和文件归因

- Run列表在同一RR快照按既有全过滤条件COUNT与选键，排序/offset/limit后仅加载一页完整投影；分页前不再排序宽JSON行。
- `_order`复用既有ASC/DESC与同时间UUID次序；current/latest、total、空页、答案/分析/复核资格、as_of不变。
- Settings校验现有CELERY_CONCURRENCY默认1、范围1..10，Celery启动读取该值，三套Compose移除固定CLI并发1。
- 新增100k真实HTTP/EXPLAIN/实际ASGI流、1000唯一根批次及幂等重放、10路threads/prefork重复消息容量测试；复用当前PG/fake provider。
- 新增`make test-geo-capacity`，同时固定GEO_PERF_PHASE与GEO_CAPACITY_PHASE=candidate，防旧seed baseline分支移除0057索引。
- 更新配置/测试/运维文档和容量记录；未把未冻结硬件阈值加入默认CI或verify。

根工作树入场即有大量前序已修改/未跟踪文件。只以evidence/before与本任务新文件归因，
实际列表见[changed-files.md](./evidence/changed-files.md)，增量见[candidate-source.patch](./evidence/candidate-source.patch)。
未为905改动的contracts、seed、lifecycle、ORM/data-architecture保留原状；无无关清理或生成文件重写。

## 3. OpenAPI、数据库、Alembic及恢复

OpenAPI/generated与数据库合同/ORM无变化，无新表列、索引、物化视图或revision。
当前head仍`0065_geo_observability`，性能与集成临时数据库实际前滚至head成功，日志保留。
没有历史回填、不可变例外、破坏性迁移或生产迁移；不存在本任务新增DDL的回退步骤。
性能计划证明瓶颈是分页前行宽，复用0057日期、Run PK、successor、答案与当前复核索引足够本地负载。
未引入Redis业务缓存。现有Batch缓存从完整Run历史可重建，查询和写授权仍实时依赖PG权威事实。
撤回本任务查询/启动配置源码不会删除业务数据；配置变化须受控recreate，不能据env文件断言当前进程已重载。

## 4. 不变量、事务、锁、revision和错误

Router无事务/行锁/ORM写入；Application Service仍拥有原子1000-run创建、去重及完整性。
RR只读快照/as_of、全过滤、latest/current与总数均由同一权威读取路径保证，固定查询数回归通过。
预算/Profile准入、既有锁顺序、lease/SENT发送裁决、revision、幂等键、不可变和审计边界未改。
prefetch=1、acks_late、reject_on_worker_lost保持，外部I/O仍在业务事务外，不新增重试/吞错/默认成功。
20稳定UUID消息对应10Run只产生10本地provider请求与10Answer；lease释放、SENT账本完成，唯一队列清理。
未知/越界启动并发由Settings显式失败，已有HTTP错误与CSV错误映射不变。

## 5. 安全、隐私及前端

未放宽权限、认证/CSRF、SSRF/TLS、凭据、不可变或审计。CSV仍使用低敏白名单与防公式注入。
实际ASGI发送逐块丢弃输出，不持有全量CSV；固定as_of与created_at DESC/id ASC校验100000无遗漏重复行。
正常消费和1000行后CancelledError均关闭专属RR会话、连接回池。
全部平台/输入/回答/对象为本地虚构资料，无真实外部AI调用。
threads观测显式绑定fixture数据库并断言真实collect_task计数20/0，避免默认开发库污染；
修复前开发库实测无geo_operation_health表，未观察到虚构运维计数落库。
prefork日志丢弃且任务证据不含连接凭据；恢复补验证脚本输出前脱敏。
前端路由、query key、URL状态、页面、generated类型与指标公式无变化，无需新增UI旅程。

## 6. 环境、基准方法与结果

本地Docker 2CPU/4095643648字节内存，PG16.15/Python3.12.14；不代表目标VPS。
真实PG开启全部约束/触发器，100021存量、100000目标runs、17500待复核；每HTTP场景2预热/20样本nearest-rank P95。
原始基线见[baseline-capacity](./evidence/baseline-capacity/)，最终样本见[final-capacity](./evidence/final-capacity/)。
最终门禁独立运行，之前完整integration已退出；首次争用负载失败仍保留，非盲重试。

| 场景 | 初始基线 | 最终本地候选 |
|---|---:|---:|
| Run首屏P95 | 0.177s | 0.067s |
| Run第4000页P95 | 1.008s | 0.169s |
| Run复核筛选P95 | 0.157s | 0.069s |
| Batch列表P95 | 0.014s | 0.013s |
| Batch状态筛选P95 | 0.159s | 0.165s |
| Run详情P95 | 0.008s | 0.008s |
| 1000根创建（单次） | 0.737s | 0.662s |
| 锁内Batch投影P95 | 0.059s | 0.065s |

深分页HTTP P95下降83.3%。实际EXPLAIN ANALYZE BUFFERS JSON：宽行external merge临时35120块约274MiB，
候选先分页24字节键、LIMIT20、20次Run PK完整投影，临时419块约3.3MiB，SQL执行88.742ms。
查询计划检查见[query-plan-check.json](./evidence/query-plan-check.json)。
CSV最终100000行/块、93015708字节、51.182s、首块46.7ms、5000行后RSS采样增长1273856字节。
没有宣称CSV耗时改善；基线36.109s、首块44.2ms，新增验证证明流式和释放边界。
threads及prefork各20消息/10Run/10请求；threads总20.082s包含worker退出等待。
prefork实际独立启动10子进程，采集1.696s，主加子11进程采样PSS=840221696字节（801.3MiB）；这是采样观测，非持续运行高水位。
既有R5洞察门禁全局P95=2.875s、总览1.546s，满足既有PRD3s；没有达到/宣称技术建议2s。
本轮未改洞察查询/公式，复用同环境成功证据，未重复无相关改动的昂贵seed。

## 7. 实际命令与逐项结果

下列命令从仓库根目录执行。没有把未运行的检查记为通过；原日志都在evidence。

| 实际命令 | 结果与证据 |
|---|---|
| `git diff --check` | 实施/收尾exit0；git-diff-check*.log；未跟踪905增量另保存patch并核对 |
| `make lint` | 基线/候选/最终exit0；最终日志make-lint-final.log，Ruff与前端ESLint通过 |
| `make typecheck` | 基线/候选exit0；make-typecheck-candidate.log，后端249源码/前端TS通过；后续仅测试/文档更改 |
| `make test-integration` | **exit2，1170 passed / 6 setup errors / 43 warnings / 644.23s**；make-test-integration.log |
| `PYTHONPATH=backend uv run --project backend python .trellis/tasks/10-05-geo-905-capacity/evidence/run-recovery-tests.py` | **6 passed / 16.43s**；recovery-corrected-environment.log；显式GEO_RECOVERY_PG_CONTAINER=partsignal-dev-postgres-1、localhost PG/Redis，脚本不记录私密身份 |
| `make test-geo-performance` | 1 passed / 563.98s；baseline-performance.log，原始benchmarks/plans保存 |
| `make test-geo-capacity` | 最终**exit0，4 passed / 540.12s**；candidate-capacity-isolated.log与final-capacity；实际EXPLAIN在该入口捕获 |
| `python3 .trellis/tasks/10-05-geo-905-capacity/evidence/check-query-plan.py` | exit0，24字节/20行/20次PK/419块全部通过，读取实际捕获计划，不伪造计划 |
| `uv run --project backend pytest backend/tests/unit/test_geo_worker_configuration.py` | 7 passed / 1.75s；worker-config-host.log，实际Celery consumer env1/10与Compose覆盖检查 |
| `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_geo_read_models.py tests/integration/test_geo_runs.py tests/integration/test_geo_review_reads.py tests/integration/test_geo_read_consistency.py` | 46 passed / 12.20s；query-regression-corrected.log |
| `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm -e GEO_CAPACITY_OUTPUT=/app/tests/performance/.results/geo905/isolated-worker backend-test pytest -s tests/performance/test_geo_worker_capacity.py` | 3 passed / 32.06s；isolated-worker-capacity.log，修复fixture观测绑定后验证 |
| `docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet` | exit0，当前开发Compose可解析 |

精确基线与失败修正：

- `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_geo_batch_creation.py tests/integration/test_geo_reports.py tests/integration/test_geo_worker.py tests/integration/test_geo_analysis_worker.py tests/integration/test_geo_read_models.py`：63 passed/3 failed；fake-oss DNS未运行。仅启动该本地fake后read_models 12 passed / 4.99s。
- `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm -e GEO_CAPACITY_PHASE=baseline -e GEO_CAPACITY_OUTPUT=/app/tests/performance/.results/geo905/baseline-query backend-test pytest -s tests/performance/test_geo_capacity.py`：1 passed / 522.70s，baseline只观察耗时，不以候选阈值掩盖深页超标。
- 最初Worker容量fixture改变settings却未通过既有qualification更新，0052守卫正确拒绝；改用现有profile_limits helper后2 passed，未放宽生产守卫。
- Docker运行Worker配置单测时2项因镜像不含仓库根.env.example/Compose路径FileNotFound；5 passed。改在有根文件的host运行后7 passed。
- 最初读取回归命令误写不存在的test_geo_run_reviews.py，未运行任何测试；使用上表正确路径后46 passed。
- 首次`make test-geo-capacity`与完整integration同时争用2CPU：1 failed/3 passed，Batch状态P95=0.590s超本地500ms，深页已0.263s。保存initial-candidate-under-integration-load；生产Batch查询未改，等integration结束并修正两phase后独立执行最终4 passed。
- 完整integration六项全部在test_geo_recovery.py fixture setup缺显式RECOVERY_PG_BIN/GEO_RECOVERY_PG_CONTAINER，未到业务断言。使用已存在PG16容器工具及独立来源/目标补验证6 passed；**原完整命令仍是失败，未改称全绿**，不重复已通过且相关输入未变的1170项。

## 8. 未运行、覆盖缺口与资源限制

目标环境/VPS验收未运行：未提供规格、入口/授权、冻结阈值；不访问未授权服务器。
技术建议列表500ms、详情800ms、洞察2s、1000创建5s未在目标环境冻结；PRD列表/详情2s与洞察3s仍为既有合同。
fixture仅20冻结输入、短回答、单引用、365天100k存量，30天当前8400候选；
未证明30天100k密度、高输入多样性、长回答、多引用、采集与分析持续并发或生产容量上限。
prefork采样801MiB超过staging512MiB，production1GiB余量未验证，**不能直接配置并发10**；默认1未动。
没有生产迁移/发布、远端CI、真实第三方平台、浏览器矩阵或完整E2E：905未改UI/用户旅程，真实平台被任务禁止，部署属于906。
没有新增索引DDL roundtrip：本任务没有DDL；已在临时库实际前滚现有head并取得查询计划。

## 9. 独立复核与审计

fresh critical_reviewer只读复核确认两项P2：threads观测默认DB风险、旧baseline phase可能移除0057索引，均由主代理修正并复核。
最终生产源码未确认剩余问题；复核没有运行测试/DB/Git，也没有替代最终性能或目标环境验证。
详见[independent-review.md](./evidence/independent-review.md)及[review-write-evidence.md](./evidence/review-write-evidence.md)。
审计Bundle `20261005T185854Z-geo-905-e325d51f` 已digest/render/finalize/verify通过。
两次派发验收通过，一次独立复核，无残留活跃Worker；分析代理写入证据未知（与主代理写入并行，无法独立归因），复核代理无额外源码写入证据。
该异常如实保留，不以自报只读等同独立证明；Agent TOML模型/推理配置不是运行时确认。
聚合见[SUBAGENT_EXECUTION_DIGEST.md](./evidence/SUBAGENT_EXECUTION_DIGEST.md)。

## 10. 收尾与后续

manifest仅变更905，依赖607/902仍done、906仍planned；Trellis记录blocked及恢复条件，未归档或自行接受。
SHA256SUMS只刷新本任务实际变更文档；根私有.env没有写入或记录。实际diff/工作树及增量检查保留。
`python3 .trellis/scripts/task.py validate .trellis/tasks/10-05-geo-905-capacity`通过；
既有database-guidelines.md为85731字节，超过32768字节自动上下文注入上限，产生截断警告。
本轮相关权威单元已主动读取，未用自动注入代替必读；恢复会话时仍须主动读取相关合同。
仅收回本任务启动的本地fake-oss，不停止原有PG/Redis；临时数据库与UUID队列由测试fixture清理。
后续先补齐GEO-905目标定义并完成容量验收；GEO-906为独立生产上线/最终验收任务，本轮没有实现。

## 11. 人工验收 — 2026-10-05

用户明确表示：“我已经人工审查并接受 GEO-905 的实现与测试证据。”
依据本次明确接受指示，将manifest实际blocked状态更新为done，Trellis标记completed，完成日期为2026-10-05；不虚构review过渡。

本次仅记录人工验收完成，保留上述实施时的阻断历史、原验证结果、目标环境未验证和其他覆盖限制。
原完整integration命令失败不改写为通过，本地容量证据不改写为目标环境验收或新增实测。
不修改其他任务状态，不实施后续任务，不提交、推送、归档或部署。
收尾仅更新manifest、对应SHA256、Task Brief、任务元数据与本验收记录；运行git diff --check，结果在本次交付回复中报告。
