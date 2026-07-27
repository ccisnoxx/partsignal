# 根因与现状证据

## 内容任务

- `frontend/src/features/content-tasks/ContentTasksPage.tsx:181-203` 的列表只有查看详情；`349-361` 只有取消 mutation。
- `backend/app/routers/planning.py:145-212` 只有列表、创建、详情和取消路由。
- `contracts/openapi.yaml:1217-1254` 的任务资源只有 GET 和单独 cancel POST。
- `backend/app/models/ai_generation.py:180-184` 与 `backend/app/models/content.py:79` 是两个直接 `ON DELETE RESTRICT` 引用。

## 用户与管理员统计

- `backend/app/services/identity.py:75-89` 的 `admin_total` 直接统计全部 `users.account_type='ADMIN'`；`frontend/src/features/users/UserManagementPage.tsx:303` 原样显示。
- 预发布只读查询确认两个额外管理员均为停用 E2E 账号；对应两个停用工程师也存在。
- 当前 PostgreSQL 用户外键中，sessions 为 CASCADE，audit_logs 为 SET NULL，其余业务引用均为 RESTRICT。
- 四个 E2E 遗留账号各自只有一条 audit actor 引用和 1–2 条 session 引用，无业务表引用。
- `frontend/tests/e2e/mvp-flow.spec.ts:39-180` 每次创建工程师和管理员，结尾只停用，导致预发布曾运行该用例后永久累积。
- `backend/alembic/versions/0001_identity_audit.py:31-40` 创建的 `audit_logs_append_only` 对全部 UPDATE/DELETE 调用 `partsignal_prevent_change()` 并抛出 `55000`。PostgreSQL 外键 `SET NULL` 同样执行 UPDATE，因此仅依赖现有 FK 会阻断带审计操作者引用的用户删除。
- `backend/alembic/versions/0016_fact_review_cleanup.py:11-30` 已证明项目使用“事务本地目标 UUID + 专用触发器函数”只放行父对象受约束删除的既有模式，可复用该数据库边界而不禁用触发器。

## 密码

- `backend/app/schemas/common.py:81-87` 将重置临时密码与自助新密码都设为 12；新建账号临时密码在 `67-71` 另有独立字段。
- `frontend/src/features/users/UserManagementPage.tsx:415-422` 的重置表单固定 `min: 12`；新建表单在 `390-398` 独立固定 12。
- 用户明确只要求重置临时密码最小 8 位。

## Logo

- `frontend/src/features/configuration/PlatformsPage.tsx:363` 固定 `PlatformAvatar size={26}`。
- `frontend/src/shared/components/PlatformAvatar.tsx:5-9` 用内联宽高固定容器，图片填满并由 CSS `object-fit: contain`；外链 URL 的源图片像素不决定展示尺寸。
