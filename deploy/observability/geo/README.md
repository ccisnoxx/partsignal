# GEO-902 运维观测

本目录提供受保护 CLI 的采集方式、Grafana 导入文件、Prometheus 告警和阈值模拟。业务低表现由 Opportunity/Insights 裁决，系统告警不读取品牌提及率、推荐率或统一 GEO 分数。

## 入口与发布

先将数据库从 `0064_geo_retention` 前滚到 `0065_geo_observability`，再统一部署 API、Worker、Beat。迁移只新增有限 `geo_operation_health` 表，无历史回填、业务行更新或新功能开关。表保留故障事实，故障时停止采集、修复并前滚，不降级删除记录。这里只交付资产和本地验证，没有部署生产监控。

在已授权运行容器内执行：

```bash
python -m app.geo_observability snapshot
python -m app.geo_observability metrics
python -m app.geo_observability health worker
python -m app.geo_observability health scheduler
```

`snapshot` 是包含有限 Run/Analysis/Batch UUID 的 JSON 诊断，仅限具有容器/数据库运维权限的人；不新增公开 HTTP 端点或放宽 `/api/health/*`。`metrics` 无业务 UUID 标签。快照使用全新 Session 的只读 REPEATABLE READ，固定 15 个聚合 SELECT 与 3 个 SET，SQL 最多等待 5 秒、锁最多 1 秒。连接有 2 秒超时；读取失败 exit 1，固定错误码，不输出 SQL、URL 或异常正文。

运维写入独立短事务，使用独立 NullPool、2 秒连接/SQL和1秒锁超时，只锁有限 operation 的自身行，不提交调用方事务。写入失败产生 `OBSERVABILITY_WRITE_FAILED`，不撤销已提交业务、重试外部调用或改变原有错误映射。

## 采集与资产导入

复用已有 Node Exporter 的 textfile collector，每个数据库/环境只配置一个权威采集源。目录由运维与 exporter 共享权限，文件为 `0600`；不要把 JSON 定位信息写入 textfile，也不要通过公网发布该目录。

每 30 秒由已有主机调度设施执行下列命令，路径和 Compose 参数按环境设置：

```bash
python deploy/scripts/export-geo-metrics.py \
  --output /protected/textfile/geo.prom --timeout 30 -- \
  docker compose --env-file /protected/runtime.env \
  -f deploy/compose.prod.yaml --profile production-async \
  exec -T api python -m app.geo_observability metrics
```

脚本捕获 CLI 输出，成功时原子替换 `.prom`；失败、超时、缺少成功信号时也原子替换为 `geo_observability_up 0`，不会继续展示旧成功。脚本不输出命令、stderr 或环境值。目录不可写时 exit 1，旧文件的新鲜度告警仍能发现问题。文件中的快照时间保证“采集程序没有执行”也能被发现。

在已有 Prometheus 中将该 Node Exporter 的采集 job 设为 `partsignal-geo`，加载 [alerts.yaml](./alerts.yaml)。规则按 `job,instance` 保留环境归属，不把多个数据库相加。导入 [dashboard.json](./dashboard.json)，选择受保护 Prometheus datasource。运维访问控制由现有监控设施拥有。

规则使用 [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) 与 [promtool rule tests](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)，dashboard 使用 [Grafana JSON model](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/)。验证工具为 Prometheus 3.5.0；这不是新增应用运行依赖。

## 统计口径与未知值

| 观察边界 | 实际口径 |
|---|---|
| Run / Batch | 所有 attempt 的当前状态，MANUAL/API/BROWSER 分开 |
| oldest pending | 当前阶段开始时间（采集为Run.created_at、未装配分析为Run.collected_at、已装配分析为revision.created_at）；MANUAL 待录入独立 `MANUAL_ENTRY`，不触发自动采集积压告警 |
| dispatch due | 自动采集或分析，`coalesce(last_dispatch_attempt_at, created_at)` 超过现有补投递间隔 |
| 分析积压 / expired lease | 未装配的 COLLECTED、未 claim 的 PENDING revision；过期包含终态 Run 的重分析 |
| 复核积压 | current 成功 analysis 有 review_required_reasons 且没有同 revision 有效 review；不只看 Run.status |
| 技术失败 | 24 小时 PG 固定 mode/stage/error_code 分布；与 Opportunity 低表现分开 |
| API 日调用 / 成本 | Reservation UTC budget_day 的所有 sent attempt；重试独立计数，reported amount 分币种 |
| 成本覆盖率 | 已报告费用的 sent attempt / 全部 sent attempt；本运维日调用比例不替代 Insights 的已验收业务公式 |
| 日/批预算 | 沿既有 admission：RESERVED/SENT 用估价，SETTLED 用实际费用；UNKNOWN 不补零，不跨币种相加 |
| 会话 | 现有 PG 材料健康与 expires_at；AVAILABLE 不证明真实登录，login_probe 为 NOT_IMPLEMENTED |
| operation | 实际函数/循环执行边界完成与异常；正常返回不证明 Run 采集成功或业务计划已调度 |

未观察 operation、没有费用覆盖率分母、无法计算预算利用率时，JSON 是 `null`、指标是 `NaN`；`observed=0` 明确区别于成功计数零。没有费用币种时没有对应金额 series。已报告为 0 的费用仍是明确报告，不能和 UNKNOWN 混淆。

币种标签仅三位大写字母，其他标签来自固定枚举。Run/Profile UUID、provider/model 名、问题、回答、引用 URL、文件路径和 request/provider ID 均不进入标签。快照只选择必要标量或聚合，不加载完整业务 snapshot、正文和密文。

## 健康与日志

Worker 每 30 秒观察 Celery 主进程真实 Heart，Beat 每 30 秒观察实际 tick；调度发布成功/失败另计。每个容器原子写本机 PID/monotonic 心跳，PG 时间用于跨进程展示。Compose 采用 CLI 健康命令：30 秒周期、15 秒超时、90 秒启动余量、3 次失败重试。

健康同时要求本机 PID 与小于等于 90 秒本机心跳、PG 最近成功心跳、PG query、Redis ping、Collector registry；Worker 还要求目标 `celery@hostname` control ping。其他副本的 PG 心跳不能掩盖本机失联。当前 Compose 使用默认 Celery 节点名；自定义 nodename 时需同步调整健康目标。

`scheduler_tick` 是 Beat 活跃循环，`scheduler_publish` 是任务消息发布。四种 collection/analysis dispatch/recovery operation 是实际扫描执行。`batch_build` 和 `opportunity_evaluate` 是现有应用服务调用。当前生产计划 cron 扫描和自动 evaluator 未接线，无对应执行时应保持未观察，不能以 tick/ping 冒充完成。Browser 真实登录探针也未实现。

GEO 日志统一 JSON：`schema_version,component,event,stage,status,error_code`，以及明确 UUID、非负数值 `duration_ms,byte_count,citation_count,prompt_tokens,completion_tokens,total_tokens,selected_count,purged_count,retry_count` 和明确报告的 `cost_amount,cost_currency`。错误码只来自固定目录，不接受任意额外 context。

不记录客户端 request_id、provider_request_id、任意异常类名/正文/traceback、SQL 参数、URL、prompt、answer、凭据或会话内容。Celery GEO task 异常对外保留失败，以固定 RuntimeError 去掉原始异常链；已验收应用服务的业务错误映射保持原状。普通 4xx 拒绝独立标记 REJECTED，不计为系统异常。日志sink失败发出固定stderr LOGGING_UNAVAILABLE；两个诊断通道同时不可用时仍保留业务回执，由现有进程日志设施排障。日志轮转沿用现有 json-file 限制。

## 起始阈值与排障

下列是可测试的运维起点，适用于默认 60 秒 recovery 扫描；生产采用不同扫描间隔时应按实际周期调整扫描阈值。没有修改业务公式或引入新的产品 SLO。

| 告警 | 条件 / 持续时间 | 首个检查 |
|---|---|---|
| ObservabilityUnavailable | up=0/缺失/快照超过180秒，3分钟 | exporter任务、PG/schema、目录权限 |
| ProcessHeartbeatStale | Worker/Beat未观察、从未成功或成功心跳超过90秒，3分钟 | 对应本机health、PG、Broker |
| RecoverySweepStale | 4种扫描未观察、从未成功或成功时间超过180秒，5分钟 | Beat发布与Worker任务；tick不能代替扫描 |
| AutomaticPendingOld | COLLECTION/ANALYSIS 最老年龄>600秒，5分钟 | snapshot的pending与dispatch_due，核对对应开关 |
| ExpiredLease | 任一采集/分析过期lease>0，5分钟 | snapshot.expired的stage/oldest_id/oldest_run_id |
| TechnicalRunFailures / AnalysisFailures | 同分布24小时失败>5次，10分钟 | error_code、具体Run；预算拒绝不计技术故障 |
| ReportedCostUnknown | UTC日未知费用>0，15分钟 | 发送事实、未知金额；不重发调用、不按零清账 |
| BudgetAnomaly | 超限/未知/币种不匹配/低估>0，1分钟 | 分币金额与有限异常Run/Batch UUID |
| OperationFailures | 15分钟累计异常增长>0，5分钟 | scheduler publish、storage或扫描稳定事件 |
| BrowserSessionMetadataUnhealthy | Browser开关开启且现有材料异常>0，5分钟 | PG材料健康；不能把它解释为真实登录结果 |

MANUAL 待录入不告警。相关采集开关关闭时不以未运行自动采集或会话探针告警。品牌低推荐率或低提及率不影响容器健康。复核 backlog 展示供业务负责人处理，不默认把人工工作量分页给系统值班。

排障先读取受保护 snapshot，再用稳定 UUID 查询已有 Run/Analysis/Batch 详情。遵守现有权限和不可变历史，不用 SQL 改终态、清发送账本、撤旧错误或重发 SENT/UNKNOWN attempt。恢复/重试只沿已验收应用命令。

## 本地验证

```bash
docker run --rm -v "$PWD/deploy/observability/geo:/work:ro" -w /work \
  --entrypoint /bin/promtool prom/prometheus:v3.5.0 check rules alerts.yaml
docker run --rm -v "$PWD/deploy/observability/geo:/work:ro" -w /work \
  --entrypoint /bin/promtool prom/prometheus:v3.5.0 test rules alerts.test.yaml
```

指标、PG、日志 canary、health故障和原子textfile测试见 `backend/tests/*/test_geo_ops_*.py`。真实 provider、真实 Browser 登录、生产监控接入/阈值校准、备份恢复和容量调优分别由既有批准流程或 GEO-903/905 等任务负责。
