# 生成作业可靠性与可观测性设计

## 问题

当前 API 先提交 `GenerationJob` 再发送 Celery 消息。进程在两步之间退出会留下永久 `PENDING`；固定 600 秒租约又可能与合法的 600 秒供应商超时竞争。目标是在不增加业务状态第二来源的情况下恢复未认领作业，并保持同一 Job 至多一次供应商调用。

## 核心不变量

1. `generation_jobs.status` 是唯一执行权威，Redis 消息只负责唤醒。
2. 只有原子声明 `PENDING → RUNNING` 的 Worker 可以调用供应商。
3. 自动恢复只补投递 `PENDING`；`RUNNING` 租约过期后转为 `FAILED`，不得自动重放。
4. `lease_expires_at = started_at + snapshot_timeout + finalize_grace`，其中 `finalize_grace > 0`。
5. 同一 Job 的重复消息和并发认领至多产生一次供应商调用和一个 `ContentVersion`。
6. 供应商已接收但成功结果未落库时无法承诺跨系统 exactly-once；原 Job 最终失败，显式重试创建新 Job。

## 数据模型

在 `generation_jobs` 增加仅用于投递诊断的字段：

- `last_dispatch_attempt_at timestamptz null`
- `dispatch_attempt_count integer not null default 0`

增加面向 `status = 'PENDING'` 的部分索引，支持按 `created_at` / `last_dispatch_attempt_at` 扫描超龄候选。字段属于 Job 聚合，不改变状态权威。

不新增 outbox 表：Job 本身已经是待执行事实，再建投递状态表会形成重复所有权。

## 配置

- `GENERATION_PENDING_REDISPATCH_SECONDS`：PENDING 补投递阈值。
- `GENERATION_FINALIZE_GRACE_SECONDS`：供应商超时后的本地校验与落库裕量，必须为正数。
- `GENERATION_RECOVERY_BATCH_SIZE`：单轮恢复上限。
- Beat 扫描周期保持显式配置，恢复上界为：

```text
pending_redispatch_seconds + recovery_scan_interval + broker_dispatch_tolerance
```

移除固定 `generation_lease_seconds` 作为执行判断来源；租约从不可变作业快照中的 `timeout_seconds` 计算。

## 事务与数据流

### 创建与首次投递

1. API 锁定任务、冻结输入、插入 `PENDING` Job 和审计，然后提交。
2. 提交后立即发送 Job UUID。
3. 每次发送尝试用短事务更新投递时间和次数；Broker 失败记录安全日志但 Job 保持 `PENDING`。
4. API 返回已接受的 Job，不把可恢复 Broker 故障伪装成业务 `FAILED`。

Broker 已接受而投递元数据未提交只会导致后续重复消息，Worker 的声明门禁负责吸收。

### PENDING 恢复

Beat 批量选择超龄 `PENDING`，使用 `FOR UPDATE SKIP LOCKED` 防止多个恢复器处理同一批候选。发送失败保留 `PENDING`，下一轮继续；不得修改为 `RUNNING` 或 `FAILED`。

### Worker 认领与完成

1. Worker 锁 Job；只有 `PENDING` 可以转为 `RUNNING`。
2. 在同一事务设置 `started_at`、`attempt_count` 和按快照计算的租约并提交。
3. 事务外执行供应商请求。
4. 响应后再次锁 Job 和任务；只有状态仍为 `RUNNING` 才创建内容版本并转为 `SUCCEEDED`。
5. Beat 只把真正过期的 `RUNNING` 标记为 `FAILED/WORKER_LOST`；迟到响应不能覆盖终态。

## 可观测性

- 结构化日志只记录 `job_id`、状态、投递次数、队列年龄、耗时和错误码。
- Worker 与 Beat 使用容器进程状态和部署级健康检查，不把外部供应商加入 API readiness。
- 新增管理员运维 CLI，查询最老 `PENDING`/`RUNNING` 年龄、近期失败码和恢复任务最近结构化结果；详细单 Job 继续读取现有作业接口。
- 不记录 Prompt、响应正文、API Key 或敏感 Header。

本轮不新增诊断 HTTP API，也不扩展通用 `HealthResponse`。Worker/Beat 容器退出由部署平台发现，业务积压与失败通过 CLI 和结构化日志定位。

## 迁移与部署

- Alembic 只增加两列和部分索引，不修改冻结历史迁移或 `migration_schema_v1.py`。
- 既有 `PENDING` 的投递字段保持空值，部署后按超龄规则补投递，不猜测历史投递结果。
- 顺序：expand 迁移 → Beat/Worker → API。旧代码可以忽略新列。
- 代码回滚前确认恢复任务已停用；降级只丢投递诊断元数据，不删除业务 Job。

## 被否方案

- 新 outbox 表：重复 Job 的待执行权威。
- Celery 自动 retry 或 FAILED 自动重放：无法判断供应商是否已接收。
- 首次 `.delay()` 失败就标记 Job 失败：无法覆盖提交后进程退出，也把可恢复故障变成业务失败。
- 固定周期重发全部 PENDING：Worker 离线时会无界放大重复消息。

## 最终确认补充

- `0011_generation_reliability` 是 Goal 1 的首个迁移，后续迁移不得修改或重写它。
- API、Worker、Beat 和诊断 CLI 必须继续把 `generation_jobs.status` 作为唯一执行权威；投递次数和时间只用于诊断。
- Worker/Beat 进程健康与 Job 积压是两类信号：PID health 不能替代最老 PENDING/RUNNING 年龄和失败码诊断。
- Goal 1 的 PUBLIC-only 门禁在创建快照前执行；本服务只处理已经通过分类门禁且不可变的 Job 快照。
- 回滚生成恢复代码前停止 Beat；`0011` 新列通常保留。任何已经进入 RUNNING 或 FAILED 的 Job 都不得通过运维命令重放。
