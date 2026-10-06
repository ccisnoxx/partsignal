# GEO-902 实施与本地验证

日期 2026-10-05；分支 geo/GEO-902；manifest planned → in_progress → review，Trellis task review；未标记 done、提交、推送、归档或部署。开始前 GEO-408/607/707 done 和人工接受已核对；Task Brief 在 prd.md，设计在 design.md，读取/差异证据在 research.md。task.py current --json确认会话级active-task为902且stale=false；context验证通过，3个大文件有注入截断警告，不能把自动注入当完整阅读。十二项 preflight 已在编码前输出并继续执行。

## 1. 实现摘要与验收边界

新增受保护 `python -m app.geo_observability snapshot|metrics|health worker|health scheduler`。JSON 提供有限稳定 ID 定位 oldest pending、dispatch due、collection / analysis expired lease 和预算异常；Prometheus 输出 50 个指标族，有限 mode/stage/status/error_code/currency/operation 标签。失败分布从 PG 技术状态读取，业务低推荐/提及/准确性不影响健康或系统告警。

API 日账覆盖所有 sent attempt 和 UTC budget_day，重试分别计数，金额按币种分开；UNKNOWN/null 不按零计，无覆盖率分母和未观察 operation 输出 null/NaN。MANUAL 待录入独立展示，不当自动采集故障；分析 age 从本阶段开始时刻算，包含终态 Run 的过期重分析；复核 backlog 使用 current revision 的有效 review。

13 个 operation 的 PG 元数据记录真实 Worker Heart、Beat tick/publish、四种 dispatch/recovery 扫描、retention、现有批次/机会调用和文件写入。三环境 Compose health 联合本机 PID/monotonic 心跳、PG 近期成功、查询、Redis ping、registry 和本机 targeted Celery ping。尚未接线的生产计划 cron/evaluator 不伪造完成。

新增 19 面板 Grafana JSON、11 条系统告警和 14 组 Prometheus 阈值 fixtures；原子 textfile 在失败/超时时写 up=0，快照时间暴露停止采集。运维接线、导入、起始阈值、故障恢复指引见 deploy/observability/geo/README.md。

## 2. 文件和范围证据

完整维护源码清单见 evidence/changed-files.md / changed-files.json；相对于进入任务时已有内容的补丁见 evidence/source-increment.patch。before/ 和 before-hashes.json 保留已修改既有文件的原版本；candidate.diff 保留初始独立复核候选。工作树进入任务已有约 553 条修改/未跟踪记录，不能用整个 git diff 归因 GEO-902。

新文件包含 observability model / runtime / logging / queries / metrics / CLI / health、0065、textfile 脚本、ops 资产和六个目标测试文件。既有服务只接观测装饰器/稳定日志；Worker 保持原消息/业务任务；Compose 只更新 Worker/Beat health。七个既有 migration/head 测试仅同步现有 head 断言到 0065，保留历史显式 revision 目标。稳定文档更新 database、运维/测试、README/CHANGELOG、manifest、对应五个 SHA 条目。

## 3. OpenAPI、数据库与 Alembic

无本任务 OpenAPI / generated 类型 / 产品前端修改，contract-check 通过。0065_geo_observability 下接 0064_geo_retention，只 CREATE geo_operation_health；13 个固定 PK operation、最近 attempt/success/failure UTC、原子计数和耗时；CHECK 限定枚举、非负与时间一致性。无业务 FK、JSON、正文、资源 ID、revision/CAS 或历史回填。

隔离测试库从 0064 前滚 0065、空库至 head 和 ORM 比较通过；不会把测试前滚描述为共享开发库/生产迁移。downgrade 使用 SQLSTATE 55000 拒绝删除故障事实；安全停止采集、保留 schema、前向修复。未执行生产前滚或破坏性回滚。

## 4. 事务、锁、幂等、并发和错误

读取使用新 Session 只读 REPEATABLE READ，固定 15 SELECT + 3 SET；SQL/锁/连接有时限，不载入正文或完整 snapshot。独立 NullPool 与短 Session 只 UPSERT operation 自身行，不提交业务 transaction、不获取业务 row lock；GREATEST 合并时间、累计加法不丢并发计数。真实 PG 的 12 并发记录验证 6 成功/6 失败和总耗时，调用方业务回滚仍回滚。

既有业务 transaction、锁顺序、revision、状态机、租约、权限、幂等和发送账本保持；Redis 消息稳定 ID。业务 4xx 拒绝标 REJECTED，不计为系统 operation failure。任务正常返回与业务 Run 成功分开。异常只输出固定码，GEO Celery task 保持失败且删除原始异常链；观测写入/日志 sink/连接释放失败不覆盖已接受回执、不自动重发外部请求。

## 5. 隐私、安全、外部调用与前端

白名单 JSON 仅固定事件/阶段/状态/错误码、明确 UUID 和非负数量/明确费用，不接 request/provider ID、任意 context、URL、异常名/正文/traceback、prompt、answer、cookie、credential 或会话。metric 标签无业务 UUID 和 provider/model 自由名称。个体 ID 只留既有容器/数据库运维访问边界；无公开路由/新身份系统，不降低 CSRF/SSRF/TLS 或不可变审计约束。

所有 provider/storage/进程验证均 fake/回环/隔离；真实外部 AI 调用为零。Browser 仅现有材料元数据，不实现真实登录探针。产品前端路由/query key/URL/页面状态均不变；Grafana 属运维资产。

## 6. 基线与环境诊断

以下命令在仓库根执行，UV_CACHE_DIR=.cache/uv。PG 测试指定 PARTSIGNAL_TEST_DATABASE_URL 为本机 127.0.0.1:55432 的测试入口，测试自身创建/删除随机隔离库；Redis 指定 `REDIS_URL=redis://127.0.0.1:56379/14`。不重复记录 DSN 口令。命令中的环境 DSN 值在此省略，实际命令除该敏感部分外逐项记录。

- 两次初始选错路径：`uv run --project backend pytest backend/tests/unit/test_geo_collection_admission_policy.py` 与 `... backend/tests/unit/test_geo_collection_admission.py`，exit 4，没有执行测试。
- `uv run --project backend pytest backend/tests/unit/test_geo_worker_configuration.py backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_retention.py backend/tests/unit/test_geo_batch_policy.py`：888 passed。
- `uv run --project backend pytest backend/tests/integration/test_geo_worker.py backend/tests/integration/test_geo_analysis_worker.py backend/tests/integration/test_geo_collection_admission.py`：先 55 passed / 3 failed，因为宿主无法解析 .env 的 Redis 容器名；显式本地 REDIS_URL 后 58 passed，23.62s，baseline-pg.log。

## 7. 必须门禁的实际结果

| 实际命令 | 结果 | 证据 |
|---|---|---|
| git diff --check | exit 0 | git-diff-check.log / 最终 scope-check.json |
| make lint | exit 0，browser/backend/frontend | lint.log |
| make typecheck | exit 0，backend 248 sources + frontend/browser | typecheck.log |
| make test-deploy-scripts | **exit 2，未通过** | deploy-scripts.log |
| make contract-check | exit 0，OpenAPI/generated 一致 | contract-check.log |

部署 gate 在 test-geo-configuration.py 的 dev/omitted 入口失败。STARTUP_PROBE 断言所有 task 名不能以 partsignal.geo_ 开头；GEO-901 已有 partsignal.geo_cleanup_artifacts。用 before/worker.py 在内存装配确认该谓词在902之前已成立，因此是旧断言，不修改它来放宽真实配置门禁。前面的 frontend 容器、Browser 配置、194 个 collector contract/secret scan 与 fixtures 成功。其后六个脚本各自运行通过，但不能将原 make gate 写成通过：

```bash
deploy/scripts/test-e2e-run-lifecycle.sh
deploy/scripts/test-e2e-database-lifecycle.sh
frontend/tests/helpers/test-secret-artifact-post-run.sh
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production-cleanup.sh
deploy/scripts/test-deploy-production.sh
```

逐项 exit 0 见 deploy-tail-0.log 至 deploy-tail-5.log；旧行为证据见 deploy-preexisting-failure.txt。初期 lint/type 错误已定向修正再通过，保留 first 日志而不改写结果。

## 8. 指标、日志、健康与迁移定向验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_ops_runtime.py backend/tests/unit/test_geo_ops_health.py backend/tests/unit/test_geo_ops_metrics.py backend/tests/unit/test_geo_ops_export.py
```

最终 24 passed，1.53s（ops-unit-final.log），涵盖日志 canary/白名单/sink 故障/worker 原始异常链、实际 Celery 建连与 publish 边界、本机 stale/依赖故障、未知/多币和指标注入拒绝、textfile 原子失败/超时撤旧成功。

指标子代理执行 `uv run --project backend pytest backend/tests/unit/test_geo_ops_metrics.py backend/tests/integration/test_geo_ops_queries.py` 的初始 16 项通过（7 unit + 9 PG），局部 ruff/mypy 通过。复核修正后 `uv run --project backend pytest backend/tests/unit/test_geo_ops_runtime.py backend/tests/unit/test_geo_ops_health.py backend/tests/integration/test_geo_ops_queries.py`：22 passed / 1 fixture failed。fixture 的 prompt/collection 时间不一致已修，新增用例 `... test_geo_ops_queries.py::test_new_manual_answer_does_not_inherit_days_waiting_for_manual_entry` 1 passed，3.03s；旧算法内存替换，同一用例按预期失败为 259200 秒，见 analysis-age-before.log。原 9 个 PG 用例的成功证据在 review-fixes.log，新增成功在 analysis-age-fix.log；没有把失败的组合命令改称全通过。

```bash
uv run --project backend pytest backend/tests/integration/test_geo_ops_runtime.py backend/tests/integration/test_geo_admission_migration.py backend/tests/integration/test_geo_answer_migration.py backend/tests/integration/test_geo_browser_session_migration.py backend/tests/integration/test_geo_decision_migration.py backend/tests/integration/test_geo_manual_migration.py backend/tests/integration/test_geo_retention.py
```

指定本地 PG/Redis 环境后 19 passed，26.54s；16 个既有 SQLAlchemy cycle/dialect warnings，不是隐藏失败（migration-regression.log）。含0064→0065、空库 head、ORM、并发计数与业务回滚。初次 runtime PG 1 passed 的日志 runtime-pg.log 保留。

```bash
uv run --project backend pytest backend/tests/integration/test_geo_worker.py::test_duplicate_and_concurrent_messages_call_provider_once backend/tests/integration/test_geo_worker.py::test_after_send_failure_never_redispatches
```

最新 collection 日志数量修改后 4 passed，3.22s（collection-log-regression.log）；重复并发仅发一次，发送后失败不重发。

## 9. 现有业务回归与环境失败分类

组合 worker/analysis/admission/manual/migrations 候选回归原为61 passed/19 failed，失败的 manual fixtures 无法访问 fake OSS host（candidate-regression.log）。启动本地回环 fake OSS 后，manual 为15 passed/6 failed，原因是宿主时间较容器 PG 约快64ms，违反既有人工采集时间保护（manual-regression.log），未放宽校验。

在与 PG 同一 Docker 时钟、现有 `partsignal-dev-backend-test:latest` 和隔离 fake OSS 中运行：

```bash
docker run --rm --network partsignal-internal -v "$PWD/backend:/app" -w /app [本地测试PG及fake OSS环境] partsignal-dev-backend-test:latest pytest tests/integration/test_geo_manual_collection.py
```

21 passed，2.84s（manual-container-regression.log）。环境占位只为删除 DSN 口令，实际全部参数沿测试配置提供。初次选用不含 pytest 的 partsignal-backend:test 返回127，改用已有 test image 后执行通过；不是盲重跑。原 worker/analysis/admission 58 passed 和候选相关61项成功证据保留，不求和充当不重复测试总数。

## 10. 真实进程与离线运维验证

已运行验证入口 `evidence/verify-health.py`，用临时库、独立 Redis 网络和源码绑定的现有镜像观察真实 Celery/Beat。exit 0：正常健康；SIGSTOP Worker 的PID仍活但 targeted ping失败；SIGCONT恢复；暂停Beat95秒使实际本机/PG心跳stale，恢复后健康；停止Broker两者unhealthy；snapshot与metrics CLI可运行；external_calls=0。见 live-health.log。测试创建的容器/网络/库均清理，共享开发PG/Redis保留。

```bash
docker run --rm -v "$PWD/deploy/observability/geo:/work:ro" -w /work --entrypoint /bin/promtool prom/prometheus:v3.5.0 check rules alerts.yaml
docker run --rm -v "$PWD/deploy/observability/geo:/work:ro" -w /work --entrypoint /bin/promtool prom/prometheus:v3.5.0 test rules alerts.test.yaml
python3 -m json.tool deploy/observability/geo/dashboard.json
```

三条exit 0；实际11条rules/14组阈值与持续时间 fixtures通过（alert-check.log / alert-test.log）。Prometheus官方镜像固定v3.5.0，本地验证工具非应用依赖。dashboard解析与字段检查通过，不等于真实Grafana服务器导入/渲染。GEO已改五篇文档 SHA256SUMS 定向校验通过，其余hash条目保留。

## 11. 独立复核与审计

一次 critical_reviewer 只读复核发现4项具体问题，主代理修正并验证；详见 independent-review.md。没有第二次独立复核。

Bundle 20261005T151007Z-geo-902-7d2c097d 的3阶段 plan/summary/digest/audit-finalize/audit-verify 均 passed，已关闭；实际身份/完成/所有权证据和验收理由见 subagent-acceptance.json。执行/验收/独立复核数字由 validated Digest 给出，模型档位只说明Agent TOML配置。

## 12. 未运行检查与已知限制

- 完整 make verify / 全仓测试 / 浏览器矩阵 / 产品 E2E 未运行：没有前端/公开协议/业务状态流程变化；对应风险由 PG/真实进程/原发送合同定向覆盖，用户指定四门禁已运行。
- 未部署生产监控、导入真实Grafana或校准生产阈值：本地资产交付，已有受保护 Prometheus/Node Exporter/Grafana 接线由部署授权和目标环境负责。
- 未访问真实 provider、Browser登录或生产OSS：普通测试不得访问外部平台，使用 fake；Browser实际探针NOT_IMPLEMENTED，保持ADR-006。
- 生产计划cron/自动evaluator无既有接线，不在902中补业务，operation保持未观察。运维计数正常返回不能当成业务成功；全局PG心跳不能区分每个副本，容器本机health补足。
- 90/180/600秒为可模拟起始阈值，恢复扫描180秒假设默认60秒周期；生产非默认周期需按实际配置调整。自定义Celery nodename需同步health目标；当前Compose采用默认名。
- 双日志通道同时不可用时不能保证日志落盘，但业务回执保留，由现有进程日志设施处理；没有为假想设施引入新监控服务。
- 未执行备份恢复/性能容量/索引调优/生产发布门禁；属于903/905/904/906独立范围。

## 13. 状态与后续

task-manifest 和 Trellis 均为 review，等待人工审查接受；completedAt为空。GEO-903、905仍planned，其他任务状态保持原状；不实施直接后续任务，不提交、推送或生产启用。指定部署 gate 的既有失败和实际验证缺口已明确记录；没有用户定义的 blocked 条件。


## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-902 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果、首次失败和覆盖限制保留为验收前历史；make test-deploy-scripts的既有断言失败不改写为通过，不重复运行功能门禁。

本次只收尾GEO-902，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令与结果保存于evidence/acceptance-diff-check.json/log。
