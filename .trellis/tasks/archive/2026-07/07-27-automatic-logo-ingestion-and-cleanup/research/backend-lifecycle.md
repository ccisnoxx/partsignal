# 后端文件生命周期研究

## 当前事实

- `FileRecord` 保存不可变对象元数据、`PENDING | VERIFIED | FAILED | ABORTED` 状态、上传过期时间与校验时间；没有清理截止时间和删除状态（`backend/app/models/geo_files.py:93`）。
- revision `0008_files` 的数据库触发器只允许 `PENDING` 转为 `VERIFIED | FAILED | ABORTED`，并阻止对象元数据原地修改（`backend/alembic/versions/0008_files.py:20`）。
- `create_upload_intent` 生成唯一对象键并先提交 `PENDING` 记录；`complete_file_upload` 通过对象存储 `HEAD` 校验元数据后改为 `VERIFIED`（`backend/app/services/file_records.py:44`、`backend/app/services/file_records.py:114`）。
- 平台创建和更新都调用 `platform_logo_storage_values`。上传文件必须是 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`，但读取文件时没有行锁；更新会无条件覆盖两类 Logo 字段（`backend/app/services/file_records.py:223`、`backend/app/services/content_planning.py:88`、`backend/app/services/platform_configuration.py:559`）。
- 平台删除只检查任务与发布账号引用，然后直接删除平台；不会处理旧 `logo_file_id`（`backend/app/services/platform_configuration.py:640`）。
- `platform_profiles.logo_file_id` 使用 `ON DELETE RESTRICT`。数据库没有为该列增加“只能引用 VERIFIED/PUBLIC/PLATFORM_LOGO”的触发器（`backend/alembic/versions/0020_platform_branding_task_list.py:11`）。
- `FileRecord` 还可能被 `evidences.file_record_id`、`publication_attachments.file_id` 和 `geo_observation_attachments.file_id` 引用。应用服务会校验附件类别，但垃圾回收仍需检查全部实际外键，不能先删对象再依赖数据库外键报错。

## 最小生命周期扩展

新增两个内部字段：

- `cleanup_after TIMESTAMPTZ NULL`：文件进入未引用候选状态后的最早清理时间；它不是引用权威，清理前仍以外键实时重查。
- `deleted_at TIMESTAMPTZ NULL`：对象确认删除后的时间，用于明确 `DELETED` 状态。

扩展状态为：

```text
PENDING -> VERIFIED | FAILED | ABORTED | DELETING
VERIFIED | FAILED | ABORTED -> DELETING
DELETING -> DELETED
```

- 手工 Logo 完成校验或 Icon Horse 候选完成导入时设置 `cleanup_after = verified_at + 24h`。
- 任一平台绑定该文件时，在持有文件行锁后清空 `cleanup_after`。
- 平台替换、清空或删除 Logo 后，事务内刷新外键；若旧文件已无任何引用，设置 `cleanup_after = now + 7d`。
- 其他文件类别不使用 `cleanup_after`，本任务不扩展成通用文件清理框架。

## 并发边界

- 平台绑定和清理都必须 `SELECT ... FOR UPDATE` 锁定同一 `FileRecord`。
- 涉及旧、新两个文件时按 UUID 稳定顺序加锁，避免两个平台交换 Logo 时形成反向锁。
- 清理器使用有限批次与 `FOR UPDATE SKIP LOCKED` 声明到期文件；锁内重新查询全部外键引用。
- 无引用的候选先改成 `DELETING` 并提交，随后调用对象存储。绑定服务只接受 `VERIFIED`，因此清理声明成功后不会产生新引用。
- 对象删除成功后把行改为 `DELETED` 并设置 `deleted_at`；删除失败保留 `DELETING`，下轮执行幂等重试。
- 即使 `cleanup_after` 漂移，只要清理前重查外键，引用仍是唯一删除权威；不增加 `reference_count`。

## Icon Horse 候选落库

候选下载完成并通过格式、尺寸、大小校验后：

1. 用已知哈希、大小和类型创建并提交 `PENDING` 的 `PLATFORM_LOGO` 文件记录。
2. 服务端把同一份字节写入对象存储。
3. 重新锁定文件并执行既有等价的 `HEAD` 完整性校验。
4. 成功后转为 `VERIFIED`、设置 `verified_at` 与 24 小时 `cleanup_after`，返回 `file_id` 和签名预览地址。

先持久化 `PENDING` 再写对象，确保“对象写入成功但数据库最终提交失败”时仍有可扫描记录。取消预览不需要额外 API，未绑定文件自然在 24 小时后到期。

## 数据库迁移

- 新 revision 应以 `0027_audit_user_delete_guard` 为前驱，增加生命周期字段、索引/检查约束，并替换 `partsignal_guard_file_record` 状态机。
- 为 `platform_profiles.logo_file_id` 增加数据库触发器，最终保护 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO` 约束。
- 既有、未引用的 `VERIFIED PLATFORM_LOGO` 无法证明解绑时间，迁移时统一给出迁移时点后 7 天的安全窗口；已引用文件保持 `cleanup_after=NULL`。
- downgrade 遇到 `DELETING` 或 `DELETED` 必须拒绝，因为已执行的对象删除不可逆；不得把删除状态伪装回 `VERIFIED`。

## 最小测试

- PostgreSQL 集成测试覆盖状态触发器、到期选择、`SKIP LOCKED`、绑定与清理竞态、共享引用、最后解绑计时、平台删除计时及 downgrade 门禁。
- 服务测试覆盖候选对象写入前后的故障、对象删除缺失视为成功、暂时失败保持 `DELETING`、下一轮重试完成。
- 现有平台品牌测试改为写入只接受上传文件，并覆盖 PATCH 的“省略保持、null 清空、UPLOAD 替换”三态。
