# 精简初始账号与管理员改密入口设计

## 1. Design Summary

采用一个不可逆数据迁移、现有初始化命令扩展和两个局部前端交互完成需求，不新增通用用户删除 API，也不引入账号清理服务层：

1. `0010_user_cleanup` 只识别四个冻结用户名，在同一事务中预检引用并物理删除。
2. `seed-demo` 幂等确保 `admin` 与 `content_editor`，分别读取独立初始密码；既有密码永不覆盖。
3. 工作台顶部增加自助改密入口，用户管理在前端默认过滤停用账号。

PostgreSQL 继续拥有用户、会话和所有历史归属。管理员后续新增的用户不参与旧账号清理。

## 2. Migration Boundary

新增 `backend/alembic/versions/0010_user_cleanup.py`，下游为 `0009_config_center`。

冻结清理集合：

- `product_editor`
- `product_reviewer`
- `content_reviewer`
- `analyst`

迁移步骤：

1. 锁定命中的 `users` 行。
2. 对当前 Schema 中所有非会话用户外键进行显式引用预检，包括 `RESTRICT` 业务归属和审计演员引用。
3. 若任一目标账号存在引用，抛出包含用户名和引用位置的异常；Alembic 事务整体回滚。
4. 删除目标账号的 `sessions`，再删除四个用户；不存在的目标账号视为已清理，不创建兼容用户。
5. 若 `content_editor` 存在，只把 `must_change_password` 设置为 `true` 并递增 `revision`，不修改密码哈希。

迁移不删除或改写任何业务历史，不把归属转移给 `admin` 或 `content_editor`。降级无法恢复密码哈希和用户身份，因此明确不可逆，只能从迁移前数据库备份恢复。

## 3. Initialization Contract

保留现有 `seed-demo --password` 作为管理员初始密码输入，并新增：

- CLI：`--engineer-password`
- 环境变量：`PARTSIGNAL_SEED_ENGINEER_PASSWORD`

`seed_demo(admin_password, engineer_password)` 对两个密码分别执行最小长度校验：

- `admin` 不存在时创建 `ADMIN`，`must_change_password=false`。
- `content_editor` 不存在时创建 `ENGINEER`，`must_change_password=true`。
- 任一账号已存在时不覆盖密码、账号类型、启停状态或用户主动修改的资料。

部署配置必须提供两个独立随机密码。空数据库迁移阶段没有用户，随后初始化恰好创建这两个账号；升级数据库先清理旧账号，再由初始化命令补齐缺失账号。

## 4. Password UX

后端继续复用 `POST /api/v1/auth/change-password`，不新增接口：

- 验证当前密码。
- 更新当前账号密码哈希并清除 `must_change_password`。
- 撤销当前会话之外的全部会话。
- 追加不含密码的审计记录。

`AppLayout` 顶部账号区增加“修改密码”按钮，跳转到既有 `/change-password`。该入口对 `ADMIN` 和 `ENGINEER` 一致可见；强制改密用户仍由 `ProtectedRoute` 自动跳转。

用户管理页面仅在展示层默认过滤 `is_active=false`，增加“显示停用账号”开关。API 继续返回完整用户集合，管理员仍能查看、启用或停用长期账号。

## 5. Contracts And Documentation

- `contracts/database.md` 记录初始化账号、一次性旧账号清理和不可逆失败边界。
- OpenAPI 不变：不增加删除用户接口，自助改密和用户启停契约继续复用。
- `.env.example`、Compose 测试环境、测试脚本和部署 Runbook 增加 `PARTSIGNAL_SEED_ENGINEER_PASSWORD`。
- 运维文档明确重复部署不重置密码，迁移失败时应检查引用或恢复/清理开发数据，不能绕过外键。

## 6. Validation And Rollback

迁移测试至少覆盖：

- 空库升级后初始化得到两个账号及正确强制改密状态。
- 旧版六账号无业务引用时只删除四个指定账号。
- 任一目标账号有业务或审计引用时升级失败且四个账号均未部分删除。
- 重复执行初始化不覆盖已修改密码。

前端测试覆盖顶部改密入口和停用账号默认过滤；E2E 继续覆盖管理员自助改密、普通用户强制改密、用户新增与停用。

回滚只能恢复 `0010` 前数据库备份。应用回滚前不得在旧代码中重新运行会创建六账号的历史初始化逻辑。

## 7. Trade-offs

- 使用冻结用户名的数据迁移只解决已确认的开发遗留，不演变成通用删除框架。
- 引用预检比依赖原始外键错误更明确，但必须与 `0010` 时点的 Schema 同步；迁移文件一经提交不再随未来表结构修改。
- 前端过滤停用账号不减少服务端数据；这是为了默认界面简洁，同时保留长期账号治理能力。
