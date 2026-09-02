# Validation Results

## 实施与 targeted 证据

- 修复前双 Session sentinel：按预期在 PostgreSQL transaction time 与应用进程事件时间比较处失败。
- `_work_event` 改用锁后的 PostgreSQL `clock_timestamp()`，保留 `max + 1µs`。
- 修复后原双 Session + HTTP sentinel：`1 passed`。
- 首轮独立 Review 指出该 sentinel 对“禁止应用时钟”不够确定，并缺少 `+1µs` 分支覆盖。
- 唯一一次定向 repair：增加局部 `ForbiddenApplicationClock` guard；增加真实 PostgreSQL future-history lower-bound sentinel。
- 两个受影响 sentinels：`2 passed`。

## 正式 gate

- Publication integration 全文件：`19 passed in 22.38s`。该 formal gate 在新增 lower-bound sentinel 前完成；按一次性 formal gate约束没有在后续测试改动后重复运行。
- Workbench latest-action：`1 passed in 1.76s`。
- Ruff：通过。
- Mypy：`backend/app/services/publication.py` 通过；测试文件单独 mypy 仍只有仓库既有未类型化导入/旧错误，新增代码没有新增错误。
- `git diff --check`：通过。
- OpenAPI、database contract、generated client、Alembic：无 diff。
- `task.py validate`：通过，两个 manifests 各 5 entries。

## 独立 Review 与额外批准轮次

首轮 Review 的 `MEDIUM`（应用时钟回归不确定）与 `LOW`（`+1µs` 分支无覆盖）已在一次定向 repair 中处理。唯一一次 affected-path re-review 确认原问题关闭，但新发现：lower-bound sentinel 只把历史事件设置为数据库当前时间之后 1 秒；慢 CI 若超过该窗口，测试不会进入 lower-bound 分支却仍精确断言 `+1µs`，可能偶发失败。

Reviewer 建议把临时数据库中的隔离窗口改为 `timedelta(days=1)`。按停止条件先暂停并向用户报告；用户随后明确批准一次额外修复/复审轮次。

额外轮次只修改这一行，并保留所有既有断言。两个受影响 PostgreSQL sentinels 为 `2 passed in 3.04s`，Ruff 与 `git diff --check` 通过。Targeted Trellis check 确认 `+1 day` 能稳定进入 lower-bound 分支；最终 affected-path 独立只读 re-review 未发现新的 `MEDIUM` 或更高问题，Review gate 通过。

Publication 全文件 formal gate没有重复：先前 `19 passed` 覆盖当时全部测试，后续唯一修改的原 sentinel 与新增 sentinel 又通过定向 `2 passed`，因此最终文件全部 20 条路径由不重复的组合证据覆盖。

## Scope 证据

- 过滤本 Task 三个目标文件与 Task 目录后：550 行，SHA-256 `cd37e4877751f6cf3a73f5c963ec6ee50d8c9378af5447e928463fba03cebe66`。
- Wave 3 四文件 diff SHA-256：`0f3b6a7f7aa4d5e850731afb0dd9d28b91ab9f2b25cd4c0f6c2707185c940ddc`。
- Wave 3 Task 目录 SHA-256：`310e52b166eaec360414922e5729ed154369adcb09d7704726c25ae56cc01bb3`。
- staged artifacts：543；staged 非 artifacts：0。
- Wave 3 status：`in_progress`。
