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

建议新增：

```dotenv
GEO_MONITORING_ENABLED=false
GEO_API_COLLECTION_ENABLED=false
GEO_BROWSER_COLLECTION_ENABLED=false
GEO_OPPORTUNITY_EVALUATION_ENABLED=false

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
