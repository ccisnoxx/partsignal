# Publication 事件时间顺序 Authority 修复设计

## 1. 决策摘要

保留 `PublicationWorkEvent.created_at` 作为既有唯一持久化顺序字段，修正它的候选时间来源：

```text
Work 行锁内
  -> 查询该 Work 的 max(created_at)
  -> PostgreSQL clock_timestamp() 取得数据库实时时间
  -> max(database_clock, latest_created_at + 1µs)
  -> 追加 PublicationWorkEvent
  -> 原事务 flush / commit
```

`clock_timestamp()` 解决两个已证实的问题：它不像 `now()`/`transaction_timestamp()` 那样冻结在事务起点，也不会与应用进程或另一主机的墙钟混用。已有 `+1µs` 下限继续处理时钟回拨和精度碰撞。

## 2. Authority 与不变量

### 2.1 写入 authority

`backend/app/services/publication.py::_work_event` 是唯一生产 writer。实施只替换该函数内的候选时钟来源，不移动锁、不改变调用者、不把逻辑复制到 route、model hook 或数据库 trigger。

所有既有调用路径继续遵守相同顺序：

- 新建 Work 后追加 `CREATED`；
- `_lock_work` 后追加准备、平台审核、结果登记、核验、换版、关闭事件；
- 每个命令仍由 `_finish_work_command` 在同一事务 flush、投影并 commit。

创建路径没有既有事件，数据库实时时间直接成为首事件时间；更新路径在 Work 行锁序列内查询最大时间，因此可见前序已提交事件。

### 2.2 读取 authority

不修改任何 reader：

- latest event：`created_at DESC, id DESC`；
- timeline：`created_at ASC, id ASC`；
- verification command 与 workbench：同样从该排序读取 latest action；
- Product/ContentTask activity：继续把事件 `created_at` 作为跨域展示时间。

UUID `id` 只保留既有稳定 tie-breaker，不升级为顺序 owner。

## 3. 实现细节

在 `latest_created_at` 查询之后，通过 SQLAlchemy 在当前 Session 执行 PostgreSQL `clock_timestamp()`。使用返回单值的查询接口，保持“数据库未返回行”不是可静默回退的分支；不得在异常时改用 Python 时间或 `now()`。

候选时间的比较保持当前语义：

```python
if latest_created_at is not None and created_at <= latest_created_at:
    created_at = latest_created_at + timedelta(microseconds=1)
```

`datetime`/`UTC` 在同一 service 其他生命周期字段仍被使用，不能因本局部变更删除；`timedelta` 继续用于单调下限。模型 `server_default=func.now()` 保持不动，它不是业务 writer 的顺序 authority，也不需要 migration。

实施前先用只读 probe 确认当前 SQLAlchemy/psycopg 返回 timezone-aware `datetime`；已观察到本地驱动确实如此。若类型检查要求注解，只在该局部表达返回类型，不新增 helper 或 fallback。

## 4. 测试设计

### 4.1 现有双 Session sentinel 是主回归

保留 `test_publication_verification_final_authority_rejects_awaiting_switch_over_http` 的完整业务建立、两个真实 Session、事务起点、结果再登记、换版、latest-event 投影、HTTP + CSRF 409 与零副作用检查。

在现有断言基础上保存 `RESULT_REGISTERED.created_at`，换版完成后显式断言：

```text
switch transaction start
  < RESULT_REGISTERED.created_at
  < CONTENT_VERSION_CHANGED.created_at
```

前半段冻结“不能使用长事务 `now()` 或跨主机应用时钟”；后半段直接冻结同一 Work 锁内命令顺序。测试不通过 sleep 值判断正确性，`pg_sleep(0.001)` 只确保事务起点早于另一 Session 的命令。

### 4.2 共享 writer 回归

目标 sentinel 通过后，正式运行完整 `test_publication_workflow.py`，覆盖 `_work_event` 的所有业务动作以及核验/换版、append-only、终态、删除保护等关联行为。另运行 Workbench 的 current tails/attention 定向测试，验证 latest action 投影未漂移。

## 5. 行为保持与合同边界

本变更只改变事件时间值的来源，不改变事件数量、action、actor、from/to status、版本 lineage 或 commit 原子性。历史已写事件不回填，新事件继续使用 UTC timestamptz。

不修改 route 与 HTTP metadata、ErrorEnvelope、错误 code/message/status、Work/Task 状态、revision、权限依赖、事务边界、OpenAPI、`contracts/database.md`、generated TypeScript、ORM model 或 Alembic。

因此文档维护仅限稳定开发规范对时钟 authority 的一句澄清，不产生公共合同或 generated client 更新。

## 6. 替代方案与排除理由

- 仅删除/放宽测试：会丢失历史任务明确要求的双 Session 回归，并保留跨主机时钟缺陷。
- `statement_timestamp()`：属于数据库时钟域，但表达语句收到时间，不如 `clock_timestamp()` 准确表达锁后事件写入时刻。
- 应用 `datetime.now()` + NTP：把业务顺序正确性交给部署拓扑，无法保证多 worker/容器。
- 新 sequence/command-order：需要 schema、migration 和 reader 改造，超出最小修复且形成第二排序系统。

## 7. 风险、停止条件与回滚

主要风险是共享 writer 改动影响全部 publication event。通过完整 Publication workflow、Workbench latest action、ruff/mypy 和独立只读 Review控制。

遇到以下任一情况立即停止并退回规划：

- 发现生产路径绕过 `_work_event` 或未持有 Work 锁写入后续事件；
- 驱动不能稳定返回 timezone-aware PostgreSQL timestamp，且解决需要跨模块 adapter；
- 严格顺序必须依赖新列、migration、数据回填或修改 reader 排序；
- 目标修复改变权限、状态机、事务/error mapping 或公共 HTTP 合同；
- 同一 formal gate 经两轮 targeted repair 后仍失败，或独立 re-review 仍发现 `MEDIUM+`。

回滚仅撤销 `_work_event` 的局部时间源、必要测试断言与稳定规范说明；无 migration 和数据回填。不得以删除并发 sentinel 或恢复跨时钟混用作为可接受回滚结果。

## 8. 与 Wave 3 的关系

本 Task 独立于 Wave 3，不成为其 child，不修改其代码或文档。Wave 3 保持 `in_progress`。本 Task 修复、验证、独立 Review、提交与归档完成后，才重新激活 Wave 3 上下文并重跑它的 4 个 PostgreSQL sentinels；随后再完成 Wave 3 的 response-report、scope 与提交门禁。
