# 精确失败复现与合同证据

## 基线

```text
branch: main
commit: d6d17296395204907b0662e17a4fd1ef449253bc
working tree: clean（创建本 Task 前）
origin/main...main: 0 82
```

`git fetch origin` 后确认本地 `main` 没有落后远端提交。

## 精确 targeted reproduction

本机直接执行 `uv run ... pytest` 因未设置 PostgreSQL 测试 URL 而得到一个 skip，因此不作为复现证据。使用仓库 `backend-test` Docker PostgreSQL 环境执行：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_content_task_detail.py::test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count -q
```

结果：`1 failed`，退出码 `1`。失败位置：

```text
backend/tests/integration/test_content_task_detail.py:384
task.platform_profile_id = None
db.commit()

psycopg.errors.ObjectNotInPrerequisiteState:
内容任务平台不可原地修改
CONTEXT: PL/pgSQL function partsignal_guard_content_task_platform() line 12 at RAISE

SQL:
UPDATE content_tasks
SET platform_profile_id=%(platform_profile_id)s::UUID, updated_at=now()
WHERE content_tasks.id = %(content_tasks_id)s::UUID
```

## 根因与权威合同

1. `backend/alembic/versions/0025_markdown_facts_direct_platform.py:445-455` 首次建立 `partsignal_guard_content_task_platform()`，任何普通平台外键变化均返回 SQLSTATE `55000`。
2. `backend/alembic/versions/0037_simplify_deletion_lifecycle.py:145-231` 把 `content_tasks.platform_profile_id` 改为 nullable `ON DELETE SET NULL`，但任务本身绝不随平台级联删除。
3. 同 migration `:242-259` 仅允许 PostgreSQL 嵌套触发器把非 `OPEN` 任务从真实平台外键受控置空；普通 ORM UPDATE 的 trigger depth 不满足条件，必须失败。
4. `contracts/database.md:329-331` 与 `.trellis/spec/backend/database-guidelines.md` 的 0037 场景规定：平台先停用，仅 `OPEN` 任务或非终态工作阻断；终态任务在平台删除后从冻结 snapshot 展示。
5. `backend/app/services/platform_configuration.py:795-870` 的 `delete_platform_profile` 是生产命令所有者，负责锁定平台、检查停用与活动引用、审计、删除平台和 Logo 清理调度；真正的任务解绑由数据库外键/触发器完成。
6. `backend/app/services/projections.py:935-950` 在实时平台缺失时使用任务的名称/网站 snapshot，并返回 `id=null`、`logo=null`；`content_task_detail_out` 直接复用该平台投影。

## 既有测试与当前测试的职责差异

- `test_platform_prompt_platform_profile_and_platform_account_deletion_lifecycle` 已证明：平台停用后仍会被活动任务/工作阻断；工作关闭并使来源任务终止后，账号和平台可通过服务删除，终态任务/工作外键为 null 且 snapshot 保留。启用平台拒绝删除则由 `delete_platform_profile` 的显式门禁负责。
- 当前 Detail test 仍需证明：相同真实生命周期形成的数据进入 Content Task Detail 后，平台摘要使用 snapshot 且不返回失效 ID/Logo；并同时保留 current pointer、来源、Activity、fixed query count、HTTP 读取与 `REPEATABLE READ` 覆盖。

## 最小合法构造结论

复用生产服务，不直接 DELETE 或 UPDATE：

1. repair source 断言后调用 `cancel_content_task`，使该测试新建的 `OPEN` repair task 合法终止；
2. 调用 `set_platform_profile_enabled(..., enabled=False)`；
3. 调用 `delete_platform_profile(...)`；
4. 重新读取任务，断言数据库外键为 null，再执行原 snapshot fallback 断言。

直接 `db.delete(profile)` 虽比服务调用少一行，但会绕过生产服务拥有的停用、活动引用、审计和 Logo 生命周期边界，不选用。
