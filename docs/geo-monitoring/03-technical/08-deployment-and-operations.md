# PartSignal GEO 部署与运维设计

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 基线 | 复用现有 Compose、Nginx、PostgreSQL、Redis、Worker、Scheduler 和 OSS |

## 1. 环境

| 环境 | 用途 | 外部调用 |
|---|---|---|
| development | 本地开发 | 默认 fake provider / development storage |
| test | 手工本地隔离测试 | 仅本地 fake provider |
| staging/preview | 内部验收 | 可选受控真实 API smoke |
| production | 公司正式使用 | 仅批准 profile 和真实 OSS |

## 2. 服务拓扑

### 2.1 R1–R6 与 R8 核心版

复用现有服务：

```text
frontend
api
worker
scheduler
postgres
redis
```

建议 Worker 按 Celery queue 路由但可运行于同一容器：

```text
default      # existing generation and maintenance
geo_collect
geo_analyze
geo_maintenance
```

如果单容器启动多个 queue，仍需分别暴露指标。负载增长后可以使用同一镜像部署多个 Worker 实例。

### 2.2 后续 Browser 能力

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

GEO-801～803 历史代码/合同和隔离非生产 Compose 保留；不被默认 Compose 引用，不提供当前部署教程。

## 3. 配置项

当前四项开关由 Settings 管理，默认关闭；当前支持人工录入和已实现 API 采集。开关不替代 Profile/平台批准、PUBLIC、预算和发送授权。Browser 延期，生产硬禁止开启。

```dotenv
GEO_MONITORING_ENABLED=false
GEO_API_COLLECTION_ENABLED=false
GEO_BROWSER_COLLECTION_ENABLED=false
GEO_OPPORTUNITY_EVALUATION_ENABLED=false
```

旧 runtime 可按输入检查合同省略可选 GEO 键，由 Settings 提供默认；显式空值/非法值拒绝。API/OPPORTUNITY 子开关 true 要求总开关 true，二者独立。API、Worker、Beat 共享配置源，必须统一重建才生效。现有人工文章观测保持原合同；当前 MANUAL 批次与 API 采集按各自业务门禁执行。

已实现的采集恢复与保留参数如下；默认值、范围、预算和可省略规则以 [Production 配置说明](../../production-configuration.md) 和 Settings 为准：

```dotenv
GEO_PENDING_REDISPATCH_SECONDS=120
GEO_COLLECTION_FINALIZE_GRACE_SECONDS=120
GEO_RECOVERY_SCAN_SECONDS=60
GEO_RECOVERY_BATCH_SIZE=100
GEO_RETENTION_DRY_RUN=true
GEO_RETENTION_BATCH_SIZE=100
GEO_DAILY_BUDGET_CURRENCY=USD
# GEO_DAILY_BUDGET_LIMIT=100.000000
```

保留期限须经数据负责人批准后显式配置，省略不启用对应新策略；预算 limit 省略表示不限额，已配置预算且报价未知时阻断。分析 lease、批次规模、响应/回答限制等由其内部合同或代码 owner 管理，不能把目标设计名称当作已支持环境变量。内部 `max_response_bytes` 是 SDK 完整接收后、严格业务解析前的检查，不保证接收内存上限；不新增公共字段或环境配置。

Browser 的会话、密钥和代理配置不属于当前环境模板。

敏感值不放 `.env.example` 实际内容，只保留空模板和说明。

## 4. 发布顺序

每个增量采用 expand → deploy → enable：

1. 备份；
2. 合约和迁移预检；
3. 增加表/可空列/索引；
4. 部署能读取新 schema、入口默认关闭的代码；
5. 运行 migration；
6. 运行 contract、integrity 和健康检查；
7. 通过管理员配置测试数据；
8. 小范围启用功能开关；
9. 观察；
10. 扩大使用。

不要在同一发布中：

- 删除旧人工 GEO；
- 强制重分析全部历史；
- 启用多个真实浏览器平台；
- 修改指标公式又发布管理报告；
- 自动开启未配置预算的计划。

## 5. 数据库迁移

### 5.1 Preflight

迁移前检查：

- Alembic current/head；
- 现有 GeoObservation 完整性；
- users/products/query_topics/fact_versions FK 资格；
- 重名 slug/identity；
- 对象存储连接；
- AI encryption key 可用；
- 目标磁盘容量；
- 无正在执行的破坏性维护。

### 5.2 索引

大表后续加索引需评估 `CREATE INDEX CONCURRENTLY`。Alembic 事务和生产窗口必须专门设计，不能在普通 revision 中盲目锁表。

### 5.3 历史数据

- 不自动把现有文章关系 GeoObservation 转换为 answer run；
- 可以创建只读统一导航；
- 如需要导入外部历史表格，使用显式 import CLI，记录 `source=IMPORTED`；
- 导入不会伪造截图、引用和复核。

## 6. Worker 运营

### 6.1 并发

初始建议：

- API collection concurrency 小步配置；
- analysis concurrency 可高于 collection；
- 每 profile 支持独立 rate limit；
- provider 429 后不自动重试同 attempt。

### 6.2 停止顺序

需要停止外部调用时：

1. 关闭 API 功能开关并部署或停止相应 queue；
2. 停 Scheduler；
3. 等待当前 RUNNING 到终态或超时；
4. 不批量把 RUNNING 改回 PENDING；
5. 检查 UNKNOWN_OUTCOME；
6. 保留数据库和日志现场。

### 6.3 恢复

- 启动 PostgreSQL/Redis；
- 启动 API 只读验证；
- 启动 Worker；
- 手动运行 recovery dry-run；
- 确认 PENDING/expired lease；
- 启动 Scheduler；
- 观察补投递和调用数。

## 7. 健康检查

### API

`/api/health/ready` 继续检查 PostgreSQL 和 Redis。GEO 可增加非阻断详情或管理端健康接口：

- active plans；
- oldest pending；
- collector config errors；
- scheduler last scan；
- object storage evidence write check（不应每次 readiness 实际写对象）。

### Worker

PID 不足以证明健康。应提供：

- Redis/Celery ping；
- PostgreSQL query；
- 最近任务 heartbeat；
- queue backlog；
- collector registry load；

## 8. 指标和告警

### 8.1 系统指标

| 指标 | 告警示例 |
|---|---|
| `geo_pending_oldest_seconds` | 超过补投递阈值多倍 |
| `geo_running_expired_count` | >0 持续存在 |
| `geo_collection_success_rate` | profile 连续下降 |
| `geo_analysis_failure_count` | 突增 |
| `geo_review_backlog` | 超过内部阈值 |
| `geo_scheduler_last_success` | 超过两次扫描周期 |
| `geo_batch_build_failure` | 任意失败 |
| `geo_reported_cost_daily` | 接近预算 |
| `geo_cost_coverage_rate` | 长期过低 |
| `geo_storage_write_failure` | 任意连续失败 |

### 8.2 业务告警与系统告警分离

- 业务机会进入 `GeoOpportunity`；
- 系统故障进入运维告警和 Run error；
- 不把 provider timeout 伪装成可见率下降；
- 不把业务低推荐率作为容器健康失败。

## 9. 日志

日志按组件：

```text
partsignal.api
partsignal.worker
partsignal.geo.collector
partsignal.geo.analysis
partsignal.geo.scheduler
```

字段：request/run/batch/profile、stage、status、error code、duration、byte count、citation count、reported usage/cost。禁止正文和 secret。

日志轮转沿用 json-file 限制；诊断产物不得包含凭据或敏感正文。

## 10. 备份

### 10.1 范围

- PostgreSQL；
- OSS 中 GEO screenshot/raw payload；
- AI encryption key；
- 生产 env 和 release manifest；
- Nginx 配置。

### 10.2 一致性

数据库和对象存储不具备单一事务，恢复时：

- 数据库记录包含文件哈希；
- 文件缺失必须明确显示；
- 不因文件缺失删除 run；
- 可运行对象一致性扫描；
- 报告中标记证据不可用。

### 10.3 恢复演练

隔离环境证明：

1. migration head 正确；
2. 任意 Run Detail 可打开；
3. screenshot 下载和哈希匹配；
4. AI 凭据可解密；
5. plan 不重复补跑旧 schedule window；
6. PENDING/RUNNING 按 runbook 处理；
7. 指标可从原始数据重算。

## 11. 数据维护

定时任务：

- expired PENDING redispatch；
- expired RUNNING fail/recovery；
- raw payload retention；
- unreferenced evidence cleanup；
- materialized view refresh（如引入）；
- profile health check；
- opportunity evaluation；
- schedule scan。

每个任务限批、可观察、幂等，并有 dry-run/测试。

## 12. 后续 Browser 验收

Browser 专属合同、登录探针、容量和恢复不属于当前默认质量门禁。后续功能需单独排期、批准和验收。

## 13. 回滚

### 13.1 应用回滚

只允许回滚到支持当前 schema 的版本。否则前滚修复。关闭功能开关优先于降级数据库。

### 13.2 Worker 回滚

- 停止新 dispatch；
- 等待或标记当前运行；
- 保留 UNKNOWN_OUTCOME；
- 部署旧兼容 Worker；
- 不重发 SENT run。

### 13.3 指标公式回滚

公式变化应版本化。回滚代码后，报告显示使用的 formula version；不能重写历史 opportunity trigger snapshot。

## 14. 上线验收

生产启用前必须证明：

- 所有 migrations 和 preflight 通过；
- 人工运行纵向闭环通过；
- fake provider API 纵向闭环通过；
- 实际启用 API 时，授权真实 API smoke 使用专用低权限 Key，通过后不保存 secret；未启用时记录批准/部署范围和 N/A，不阻断 MANUAL 核心上线；
- 每 attempt 至多一次调用；
- 预算门禁有效；
- 指标可下钻；
- 导出不泄露敏感字段；
- 备份恢复演练通过；
- 监控和停止流程可用；
- R7 延期不阻断核心上线；Browser 开关必须 false、geo-browser 服务未启用且无生产会话，并留目标环境证据。后续启用必须另按 ADR-006 恢复和生产授权门禁执行。


## 当前 R3：GEO-405 运维参数

| 参数 | 默认 / 范围 | 含义 |
|---|---|---|
| GEO_PENDING_REDISPATCH_SECONDS | 120 / 1–86400 | 距最近 dispatch 尝试（或创建）的补投递最小间隔 |
| GEO_COLLECTION_FINALIZE_GRACE_SECONDS | 120 / 1–3600 | Channel timeout 后的结果提交余量 |
| GEO_RECOVERY_SCAN_SECONDS | 60 / 5–3600 | Beat 两种 GEO 扫描周期 |
| GEO_RECOVERY_BATCH_SIZE | 100 / 1–1000 | 单轮最多候选 Run，锁定失败跳过 |

使用现有 worker/scheduler、Celery 默认队列；无需新增容器/基础设施。现有 runtime 可省略
这些键，Settings 使用默认值；进程启动时读取配置，变更需重启相关进程，文件改动不等于热加载。
Beat 注册 `partsignal.redispatch_pending_geo_runs` 和 `partsignal.recover_expired_geo_runs`。
采集任务 `partsignal.collect_geo_run` 只接收 run ID。重复消费者/扫描器由 PG 行锁与 token 仲裁。

安全停止：停 Worker/Beat 或关闭采集开关阻止新发送；已发送请求不重发，过期 lease 保留历史失败。
诊断只记录 Run/Batch ID、固定 code（GEO-902起不记录任意异常类型），禁止记录原 prompt/回答/凭据或异常正文。
当前 API 仍未生产批准、INTERNAL 工厂输入仍禁止外发、预算执行按下述 GEO-407 合同裁决，不能据此认定 R3 发布完成。

### GEO-406 恢复与人工 retry

无需新增运维参数或迁移，现有 recovery Beat task 改用持久化外发事实：过期 API RUNNING
只有 NOT_STARTED 且无答案才能撤 lease 并恢复同 attempt 的 PENDING；SENT/UNKNOWN 终止为
FAILED/COLLECTOR_UNKNOWN_OUTCOME/UNKNOWN，不自动重发。COMPLETED 不回退。
不要用批量 SQL 把已发送 Run 改回 PENDING，或覆盖/清空其错误、外发状态、输入与终态。

需要再次采集时，由已授权 ADMIN/ENGINEER 读取最新 revision 后调用显式 retry API；
每个前序至多一个后继，沿原输入追加新 attempt。当前配置变化要求新建批次。
请求/Worker 丢失响应时先读取同 cell attempts，不能假定调用未发生或反复发送命令。
Broker 故障不会撤销已提交新 attempt，PENDING 扫描补投递稳定 UUID。
迟到结果和旧 token 均不覆盖终态。安全停止、日志脱敏、开关及 registry 门禁沿用上述规则。


### GEO-407 预算配置与安全前滚

GEO_DAILY_BUDGET_LIMIT 可省略（无全局日上限），配置时为有限非负 decimal(14,6)，
GEO_DAILY_BUDGET_CURRENCY 默认 USD，必须三位大写。共享公司 GEO 采集按 UTC 日计账，
不是按操作者或计划时区分区。Batch budget_limit 取冻结值；不进行混币相加/换汇。
API Profile max_concurrency 默认1，requests_per_minute默认60；旧配置继续按默认解释。
配置修改仍失效当前 API 测试资格，需要既有重新诊断/启用流程。

先关闭新采集并停止 Worker/Beat，备份后执行 `alembic upgrade head` 到
0053_geo_collection_admission，再统一部署 API/Worker/Scheduler并重启加载一致预算配置。
本迁移只新增错误元数据/账本与守卫，旧 API 发送事实保守回填未知报价，不修改历史 Run、
答案或冻结输入。旧发送时刻未知时使用 finished_at/collected_at 的最晚可能发送上界；仍未结的旧发送
使用迁移时刻。budget_day/sent_at按该保守计账上界，避免跨UTC日漏账，不冒充精确发送事实。
不可降级抹除发送历史；故障时关闭开关并前向修复，或按数据库备份恢复程序处理。

生产 adapter 没有批准报价时受限预算明确阻断，不能为了运行而注入猜测单价或放宽外发门禁。
实际报告可能超过估价，预算预留保证准入时已知金额不超额度；后续按真实报告止损，
不能宣称 provider 最终账单硬上限。429/未知发送不自动重发，不人工批量清账本解除预算。
现有安全日志保持固定错误码/ID（GEO-902起不记录任意异常类型），不输出 prompt、回答、凭据或供应商错误正文。

### GEO-408 运行中心与 R3 验收

运行中心显示真实 usage、费用、外发状态和安全错误；显式 retry 追加新 attempt，未知命令
回执先读取尝试链，不盲目重发。开关是进程启动配置，关闭验证必须使用采用新配置的 API/Worker。
操作步骤、两个关闭阶段的真实待消费零调用证据与 test-only 装配边界集中在
[R3 API 使用与验收指南](../04-delivery/08-r3-api-acceptance.md)。
无新环境业务参数、公共合同、数据回填或 Alembic revision；head 仍为 0053。
本地 fake 验收不授予生产 adapter 批准或 INTERNAL 外发授权，不代表生产发布完成。


## R7 历史资产

GEO-801～803 已接受的历史实现与验证保留在 Trellis 任务记录中；当前版本不安装、启动、调试或部署 Browser Collector，不配置 Browser 会话材料。

## GEO-901 / R8 retention 运维

先部署 `0064_geo_retention`，再部署Worker/Beat。`partsignal.geo_cleanup_artifacts` 每小时限批扫描，无Celery消息payload；不因采集开关关闭而免除旧材料责任。配置由现有runtime env_file同时传给API/Worker/Scheduler，无新增部署服务。

| 配置 | 默认/范围 |
|---|---|
| GEO_RETENTION_DRY_RUN | true，新任务只读预览 |
| GEO_RETENTION_BATCH_SIZE | 100；1..1000，每类独立限批 |
| GEO_RAW_PAYLOAD_RETENTION_DAYS | 省略即不启动新raw期限；90..180 |
| GEO_TERMINAL_DRAFT_RETENTION_DAYS | 省略即不启动草稿清理；1..3650 |
| GEO_UNREFERENCED_FILE_RETENTION_DAYS | 省略即不启动孤立VERIFIED期限；7..3650 |

三项实际天数上线前由数据负责人批准，管理员在受保护runtime配置；示例值不是公司政策批准。先执行 `python -c 'from app.services.geo_retention import cleanup_geo_artifacts; print(cleanup_geo_artifacts())'`（运行于已配置backend环境，默认dry-run），核对数量与引用保护后显式配置GEO_RETENTION_DRY_RUN=false。只清理未引用文件及无已提交答案的终态人工临时草稿，PENDING/所有指标历史及引用raw/截图保持。相同命令用于显式单轮重试；存储失败保留DELETING，下轮扫描重试，日志只记录稳定ID/计数。旧 `cleanup_platform_logo_files` 继续既有已到期文件清理，不受新dry-run配置影响；预览不暂停旧任务。

停止：恢复新任务dry-run或停Beat/Worker；保留0064表和墓碑、前向修复，不执行破坏性downgrade。已清理临时数据恢复/备份演练属于GEO-903，本任务不实施。

本轮开发环境检查：Browser=false、无Browser运行服务、无会话root/公钥/能力配置、开发库没有会话表，因此Browser临时数据清理N/A；依据见[GEO-901证据](../../../.trellis/tasks/10-05-geo-901-retention/evidence/browser-materials.json)。不代表生产或其他环境；发现历史部署/材料时停止并交由独立授权的处置任务处理，不从默认值推断安全。904/906必须实际核实生产false和无会话，当前不执行 Browser 会话恢复验收；工具发现历史材料时明确失败。


## 当前 R8：GEO-902 可观察性（本地验证后交付 review）

受保护 `python -m app.geo_observability snapshot|metrics|health worker|health scheduler`
输出有限聚合/定位信息，无公共端点、产品页面或业务公式变化。0065只新增有限
`geo_operation_health`；独立短事务原子累计，不提交业务事务、不回填历史。
固定15个只读RR聚合SELECT覆盖全部attempt、UTC日发送费用、未知/分币、最老pending、
补投递due、collection及终态Run重分析的过期lease、当前revision有效复核和失败分布。

Worker本机心跳、目标Celery ping，Scheduler真实tick/publish、PG/Redis/registry联合检查；
三环境Compose替换PID-only检查。四种恢复扫描执行时间与tick分开；尚未接线的生产计划
cron和自动机会评估不伪造成功，不由902补功能。Browser 的历史元数据不证明当前支持会话管理或真实登录；当前版本不提供探针教程。

稳定GEO JSON字段、有限指标标签、NULL/NaN、原子textfile采集、dashboard/rules导入、
告警起始阈值与排障步骤以[运维资产说明](../../../deploy/observability/geo/README.md)为当前实现入口。
监控与业务低表现分开；生产监控接入和阈值校准尚未执行。Task Brief与实际证据见
[902任务](../../../.trellis/tasks/10-05-geo-902-observability/prd.md)及
[实施记录](../../../.trellis/tasks/10-05-geo-902-observability/implement.md)。


## 当前 R8：GEO-903 一致性集合和隔离恢复

备份清单、静默窗口、认证加密、一次性owner数据库/对象树、Run Detail/指标/凭据对账、历史调度窗口及PENDING/RUNNING处置以[恢复Runbook](./09-backup-recovery-runbook.md)为当前操作入口。OpenAPI/schema/head不变；不启动consumer，不对生产OSS写入。Browser N/A须有实际部署、配置、PG与材料依据，发现历史材料时工具明确失败，保持现场并另行授权处理。生产904/906检查和灾难切换不由本地演练代替。


## GEO-905 Worker容量配置

`CELERY_CONCURRENCY`现由Settings在进程启动时读取，默认1、范围1..10，并传给Celery worker_concurrency。三套Compose不再固定CLI单并发。该字段以前只作历史记录，升级前须核对已有值；越界显式启动失败。env文件变化需受控recreate，不代表运行进程已加载。prefetch=1、acks_late、reject_on_worker_lost保持。Profile max_concurrency/每分钟限制、预算和PG发送账本独立裁决，增加进程数不授予外发资格。

本地虚构资料的十路prefork最终观测约801MiB采样PSS（主进程加十子进程），高于staging的512MiB Worker限额；不能将该环境直接设为10。production的1GiB也不能仅凭此观测推断足够余量。默认仍为1；本任务不调整实际runtime、容器内存限额或部署。提升容量须以目标环境的长回答/多引用、持续采集和分析并发实测冻结上限。任务证据与未完成边界见[容量记录](../04-delivery/12-r8-capacity-hardening.md)。

## GEO-906 核心渐进发布

当前执行入口见[核心发布Runbook](./10-core-rollout-runbook.md)，实际状态见[最终验收记录](../04-delivery/13-r8-core-release-acceptance.md)。
沿用Production candidate/维护锁/upgrade/activation所有者；前滚与部署合并动作须同时获expand/deploy批准，enable单独批准。
总开关允许MANUAL不等于允许API/Browser；Browser持续false，三进程实际配置及服务/profile/overlay/PG全部会话/材料共同取证。
未知材料适用性NOT_DETERMINED，不用默认配置给N/A。停止保留PG/SENT/UNKNOWN，不重发、重置终态或downgrade。
本次仅本地准备，未访问生产、运行开关未改；生产监控、正式MANUAL试用、目标恢复/停止仍须实际证据。
