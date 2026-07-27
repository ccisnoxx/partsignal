# 设计：预发布删除与账号治理缺陷修复

## 最小可行设计

不新增表、字段、共享删除框架或前端基础组件。新增一条最小数据库迁移，只收窄审计追加式触发器对用户删除外键动作的例外；两个删除命令分别留在现有业务服务所有者中，PostgreSQL 外键继续承担数据完整性的最终保护，OpenAPI 是前后端唯一 HTTP 契约。

## 内容任务删除

数据流：

`ContentTasksPage` → `DELETE /api/v1/content-tasks/{id}` → planning router → publication service → `content_tasks`

- `ContentTaskOut.available_actions` 扩展为 `CANCEL | DELETE`。投影批量检查生成作业和内容版本，仅在任务为 `CANCELLED` 且没有生产历史时提供 `DELETE`；删除服务再次锁行并校验，不信任前端或旧投影。
- `delete_content_task` 与现有创建、取消服务同属 `backend/app/services/publication.py`。服务使用 `FOR UPDATE` 锁定任务，要求 `CANCELLED`，显式统计两个直接 `RESTRICT` 引用：`generation_jobs` 和 `content_versions`。
- 任一引用存在时复用现有 `in_use(...)` 返回 `CONTENT_TASK_IN_USE` 和真实非零引用；成功时追加 `content_task.deleted` 审计后物理删除。
- 前端详情页复用现有 Ant Modal 确认、`DeletionError`、React Query 失效和导航，不增加第二套操作组件。

## 用户删除

数据流：

`UserManagementPage` → `DELETE /api/v1/users/{id}` → identity router → identity service → `users`

- `delete_user` 留在 `backend/app/services/identity.py`，使用现有用户表写锁和目标行 `FOR UPDATE`，先要求 `is_active=false`。
- 不复制所有业务模块的引用清单。删除时由现有外键策略统一处理：
  - `sessions.user_id ON DELETE CASCADE` 清理会话；
  - `audit_logs.actor_id ON DELETE SET NULL` 保留历史审计；
  - 其余业务外键 `ON DELETE RESTRICT` 阻断删除。
- 新迁移把 `audit_logs_append_only` 切换到专用门禁函数。专用函数只允许以下唯一变化：
  - `TG_OP = UPDATE`；
  - `pg_trigger_depth() > 1`，确认更新来自用户删除触发的外键级联而非手工 UPDATE；
  - `OLD.actor_id` 非空、`NEW.actor_id` 为空；
  - 事务本地 `partsignal.user_delete_id` 等于 `OLD.actor_id`；
  - `to_jsonb(NEW) - 'actor_id'` 与 `to_jsonb(OLD) - 'actor_id'` 完全相等。
- 身份服务在锁行并确认停用后，通过 `set_config(..., true)` 设置事务本地目标 UUID，再删除用户。直接 SQL 删除未声明目标、伪造另一 UUID、修改审计其他字段或删除审计行仍由数据库以 `55000` 拒绝。
- 服务只把 PostgreSQL 外键冲突 `SQLSTATE 23503` 映射为 `409 USER_IN_USE`；其他 `IntegrityError` 原样抛出，避免吞掉未知数据库问题。
- 先设置事务目标并执行删除 `flush`，确认没有业务引用后再追加 `user.deleted` 成功审计并提交。删除审计的 actor 是当前管理员，target 是被删用户 UUID，facts 只保存 `account_type` 与 `status=DISABLED`。
- 前端只在停用用户的既有“更多操作”中增加删除项，不提供批量删除或第二个直出危险按钮。

## 管理员统计与 E2E

- `_user_summary` 不修改；`admin_total` 继续统计全部实际存在的 `ADMIN`。
- `mvp-flow.spec.ts` 的账号测试改用删除 API 清理本轮账号，并在开始时清理同时满足测试用户名正则、显示名称规则和停用状态的旧账号。
- 不把 E2E 账号做成特殊业务类型、测试标记、隐藏过滤或兼容分支。

## 临时密码

- 只修改 `ResetPasswordRequest.temporary_password` 的 OpenAPI/Pydantic/Ant Form 最小长度为 8。
- 新建账号临时密码和自助正式密码保留 12，避免把用户只针对“重置”提出的范围扩大成全局密码策略变更。

## 平台 Logo

- 只把 `PlatformsPage` 的 `PlatformAvatar size={26}` 改为 `24`。固定容器继续统一行内几何，图片服务的 `sz` 参数只影响源图清晰度。

## 兼容、发布与回滚

- 新增 DELETE operation 是向后兼容能力；迁移只替换 `audit_logs` 的触发器函数，不改表、列、历史审计正文或既有外键。
- downgrade 恢复原通用追加式触发器并删除专用函数；已合法置空的历史 `actor_id` 保持为空，不伪造已删除身份。
- 删除属于不可逆业务写入，部署后只通过 UI 人工确认，不自动清理预发布数据。
- 回滚代码不会恢复已经删除的无引用任务或账号；发布前必须依靠测试证明阻断规则，线上操作继续由人工确认。
