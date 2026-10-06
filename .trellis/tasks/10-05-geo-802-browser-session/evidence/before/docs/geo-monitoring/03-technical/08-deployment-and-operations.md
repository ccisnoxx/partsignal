# PartSignal GEO 部署与运维设计

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 基线 | 复用现有 Compose、Nginx、PostgreSQL、Redis、Worker、Scheduler 和 OSS |

## 1. 环境

| 环境 | 用途 | 外部调用 |
|---|---|---|
| development | 本地开发 | 默认 fake provider / development storage |
| test/CI | 自动测试 | 仅本地 fake provider 和本地 browser site |
| staging/preview | 内部验收 | 可选受控真实 API smoke；浏览器试点需批准 |
| production | 公司正式使用 | 仅批准 profile 和真实 OSS |

## 2. 服务拓扑

### 2.1 R1–R6

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

### 2.2 R7 Browser Pilot

新增 profile 服务：

```text
browser-collector
```

要求：

- 独立 Compose profile：`geo-browser`；
- 默认不开启；
- 独立 volume 保存加密会话；
- 独立 tmpfs；
- 独立 egress；
- 不连接 frontend edge；
- 最小数据库账号/应用 API；
- 资源限制；
- 健康检查包含 browser runtime 和 session probe 摘要。

## 3. 配置项

GEO-004 / R0 已实现四项开关、启动校验及默认关闭（review）；其余数值项仍是后续任务的目标配置，不在 R0 加入 Settings：

```dotenv
GEO_MONITORING_ENABLED=false
GEO_API_COLLECTION_ENABLED=false
GEO_BROWSER_COLLECTION_ENABLED=false
GEO_OPPORTUNITY_EVALUATION_ENABLED=false
```

旧生产 runtime 可省略四项，Settings 默认关闭；显式空值/非法布尔值拒绝。任一子开关 true 要求总开关 true，API/BROWSER/OPPORTUNITY 互相独立。API、Worker、Beat 共享配置源，需统一重建才生效；配置不授予平台或外发资格。详见 [Production 配置说明](../../production-configuration.md)。R0 无 Collector、GEO 调度或机会任务，以下参数尚未实现：

```dotenv
GEO_PENDING_REDISPATCH_SECONDS=120
GEO_COLLECTION_FINALIZE_GRACE_SECONDS=120
GEO_ANALYSIS_FINALIZE_GRACE_SECONDS=120
GEO_RECOVERY_SCAN_SECONDS=60
GEO_RECOVERY_BATCH_SIZE=100
GEO_MAX_RUNS_PER_BATCH=1000
GEO_MAX_RESPONSE_BYTES=2097152
GEO_MAX_ANSWER_CHARS=200000
GEO_DEFAULT_REPEAT_COUNT=3
GEO_DAILY_BUDGET_LIMIT=
```

Browser 后续配置：

```dotenv
GEO_BROWSER_SESSION_ROOT=
GEO_BROWSER_ARTIFACT_TMP=
GEO_BROWSER_PROXY_URL=
GEO_BROWSER_MAX_CONCURRENCY=1
```

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
- browser concurrency 默认 1；
- 每 profile 支持独立 rate limit；
- provider 429 后不自动重试同 attempt。

### 6.2 停止顺序

需要停止外部调用时：

1. 关闭 API/BROWSER 功能开关并部署或停止相应 queue；
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
- browser session health；
- object storage evidence write check（不应每次 readiness 实际写对象）。

### Worker

PID 不足以证明健康。应提供：

- Redis/Celery ping；
- PostgreSQL query；
- 最近任务 heartbeat；
- queue backlog；
- collector registry load；
- browser runtime/version（试点）。

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
| `geo_browser_session_unhealthy` | >0 |
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
partsignal.geo.browser
```

字段：request/run/batch/profile、stage、status、error code、duration、byte count、citation count、reported usage/cost。禁止正文和 secret。

日志轮转沿用 json-file 限制；Browser video/trace 默认关闭，只有受控排障会话开启并进行敏感审查。

## 10. 备份

### 10.1 范围

- PostgreSQL；
- OSS 中 GEO screenshot/raw payload；
- AI encryption key；
- Browser session key/material（若启用）；
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

## 12. Browser Pilot Runbook 门禁

上线一个真实平台前：

```text
[ ] ADR-005 已接受
[ ] 合规批准
[ ] 专用账号和负责人
[ ] 登录/撤销流程演练
[ ] 本地 DOM contract tests
[ ] kill switch
[ ] 每日/每小时频率上限
[ ] 代理和地区确认
[ ] 敏感截图测试
[ ] 失败不保存空成功
[ ] 会话过期告警
[ ] 不在 CI 使用真实平台
[ ] 小样本人工交叉核验
```

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
- 真实 API smoke 使用专用低权限 Key，通过后不保存 secret；
- 每 attempt 至多一次调用；
- 预算门禁有效；
- 指标可下钻；
- 导出不泄露敏感字段；
- 备份恢复演练通过；
- 监控和停止流程可用；
- Browser 功能默认关闭，除非试点全部门禁通过。


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
诊断只记录 Run/Batch ID、固定 code 与异常类型，禁止记录原 prompt/回答/凭据或异常正文。
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
现有安全日志保持固定错误码/ID/类型，不输出 prompt、回答、凭据或供应商错误正文。

### GEO-408 运行中心与 R3 验收

运行中心显示真实 usage、费用、外发状态和安全错误；显式 retry 追加新 attempt，未知命令
回执先读取尝试链，不盲目重发。开关是进程启动配置，关闭验证必须使用采用新配置的 API/Worker。
操作步骤、两个关闭阶段的真实待消费零调用证据与 test-only 装配边界集中在
[R3 API 使用与验收指南](../04-delivery/08-r3-api-acceptance.md)。
无新环境业务参数、公共合同、数据回填或 Alembic revision；head 仍为 0053。
本地 fake 验收不授予生产 adapter 批准或 INTERNAL 外发授权，不代表生产发布完成。


## 当前 R7：GEO-801 独立 Browser 骨架

`browser-collector/` 拥有独立 package、lockfile 与 Dockerfile，固定 Playwright 1.61.1；
API/Worker/Scheduler 继续使用原 backend 镜像。dev/staging/prod Compose 通过
`compose.geo-browser.yaml` include 共享 `geo-browser` profile，默认服务集合不包含该服务。
GEO-801 不接 Broker/数据库、不注册可用 Browser adapter；普通 API Worker 对非 API Run
在资格、锁和写入前返回，不把误投 Browser UUID 改成 API 失败。

仅启动本地骨架（保留两个业务开关关闭和默认 STOP）：

```bash
docker compose -f deploy/compose.geo-browser.yaml --profile geo-browser up --build -d --wait
docker compose -f deploy/compose.geo-browser.yaml --profile geo-browser exec -T browser-collector node src/healthcheck.mjs
docker compose -f deploy/compose.geo-browser.yaml --profile geo-browser down
```

已有环境使用对应 Compose 加 `--profile geo-browser`；服务不依赖核心服务。
默认镜像 `partsignal-browser-collector:geo801`，可分别覆盖
`PARTSIGNAL_BROWSER_COLLECTOR_IMAGE` / `PARTSIGNAL_BROWSER_COLLECTOR_VERSION`。
这是独立构建交付，尚未纳入生产发布镜像推送或批准真实平台运行。

两个采集开关由 Compose shell / `--env-file` 插值读取，默认 false；不加载后端的
`PARTSIGNAL_RUNTIME_ENV_FILE` 或通用 `env_file`，避免数据库、AI、会话凭据进入浏览器容器。
不要以“后端 runtime 文件已开启”推断 Browser 当前进程配置。显式空值/非法值、
Browser 开启但 monitoring 关闭均启动失败。开关变化需 recreate；profile 只是启动选择。

只读控制目录默认 `deploy/geo-browser-control`，其中默认存在 `STOP`。
需要临时控制目录时设置 `PARTSIGNAL_GEO_BROWSER_CONTROL_DIR` 为已存在目录的绝对路径；
缺目录不自动创建。安全热停止是在宿主控制目录创建 `STOP`，每次内部入口与健康探测
重新检查；任意类型的 STOP（含断开的 symlink）、目录缺失或访问错误均拒绝。
移除 STOP 也仅得到 `BROWSER_ADAPTER_NOT_IMPLEMENTED`，不获得会话/平台/采集授权。
容器只读挂载该目录；没有业务凭据、会话卷或 socket。紧急进程停止用上述 `down`
（需带 profile），SIGTERM 关闭上下文/浏览器，10秒容器停止期限，无自动重启。

资源：1 CPU、1 GiB 内存、128 PID、128 MiB `/tmp` tmpfs 与128 MiB shm；
非 root `pwuser`、init、只读根、cap_drop ALL、no-new-privileges，
`network_mode: none`，无端口、业务网络、外部 DNS/代理/egress。
健康只访问容器回环，真实 Chromium 在 offline context 内完成内存 DOM 探测；
采集关闭仍可健康，会话探测明确 `NOT_IMPLEMENTED`。日志仅固定 code，无 SDK异常、正文、secret。

`deploy/geo-browser-seccomp.json` 来源是
[官方 Playwright v1.61.1 seccomp](https://github.com/microsoft/playwright/blob/v1.61.1/utils/docker/seccomp_profile.json)，
默认 syscall 拒绝。保留官方 user namespace 的 clone/setns/unshare 放行，并允许 chroot
进入 syscall 的内核权限检查：cap_drop ALL 时官方基于初始 CAP_SYS_CHROOT 的条件规则
会阻止 Chromium 子命名空间的 sandbox chroot。服务不获得宿主 CAP_SYS_CHROOT/SYS_ADMIN，
内核仍要求调用者在所属 user namespace 拥有对应能力；Chromium sandbox 显式开启。
该规则已在本地 Docker Linux runtime 验证；不以 privileged、unconfined 或关闭 sandbox
替代。这里只渲染可信内存页，后续真实平台需要其任务建立批准网络、会话和安全验收。

`make test-geo-browser` 运行三环境 Compose、默认 up 零容器、实际健康/隔离、
开关/热 STOP/未实现拒绝和停止清理。GEO-802 的加密会话/撤销、GEO-803 的模拟站和
adapter suite、真实平台/截图/管理 UI 均未实施。无新 OpenAPI/DDL/Alembic/历史回填。
