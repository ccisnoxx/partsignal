# 数据库开发规范

## 概览

PostgreSQL 是业务状态唯一来源，Alembic 是唯一迁移入口。历史迁移必须冻结执行时的 Schema 契约，不得通过修改 `migration_schema_v1.py` 或运行时 ORM 模型追赶旧 revision。

## 场景：一次性用户数据迁移与初始化账号

### 1. 范围与触发条件

- 适用于按已确认身份清理历史初始化数据、同时必须保留业务归属和审计历史的迁移。
- 账号日常生命周期仍使用启用和停用；一次性迁移不得演变为通用删除 API 或管理界面删除入口。

### 2. 签名

- 数据库 revision：`0010_user_cleanup`，`down_revision = "0009_config_center"`。
- 初始化函数：`seed_demo(admin_password: str, engineer_password: str) -> None`。
- CLI：`python -m app.cli seed-demo --password <admin> --engineer-password <engineer>`。

### 3. 契约

- `PARTSIGNAL_SEED_ADMIN_PASSWORD` 与 `PARTSIGNAL_SEED_ENGINEER_PASSWORD` 均为必需且相互独立，最少 12 个字符。
- 初始化只补充不存在的 `admin` 和 `content_editor`，不得覆盖既有密码、账号类型、启停状态、姓名或其他资料。
- 数据清理必须先锁定目标 `users` 行，再显式预检迁移时点全部非会话用户外键；引用清单写入迁移文件，不能运行时猜测未来 Schema。
- `sessions` 可随已确认的目标账号删除；业务表和审计表不得级联删除、清空演员或迁移归属。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 任一初始密码短于 12 字符 | 初始化事务开始前抛出明确的中文 `ValueError` |
| 缺少任一 CLI 密码或环境变量 | 输出对应变量名并以状态码 `2` 退出 |
| 目标旧账号存在业务或审计引用 | 汇总“用户名 -> 表.列”并使整个 Alembic revision 回滚 |
| 目标旧账号不存在 | 视为已清理，不创建兼容账号 |
| `content_editor` 已存在 | 迁移只设置 `must_change_password=true` 并增加 `revision`，初始化不再覆盖状态 |
| revision 降级 | 明确失败，要求恢复迁移前 PostgreSQL 备份 |

### 5. 正常、基础与失败案例

- 正常：旧六账号均无业务引用，迁移删除四个冻结用户名及其会话，只保留 `admin` 和 `content_editor`。
- 基础：空库先迁移再初始化，创建 `ADMIN` 管理员和必须改密的 `ENGINEER`；重复运行保持两个账号不变。
- 失败：一个目标账号存在 `RESTRICT` 引用或 `audit_logs.actor_id` 引用，四个目标账号、会话和 `content_editor` 状态全部保持迁移前值。

### 6. 必需测试

- PostgreSQL 集成测试验证空库迁移、独立密码、初始化幂等和旧权限表移除。
- 从旧角色 Schema 构造六账号及会话，验证准确清理集合、密码哈希保留和 `revision` 变化。
- 同时构造业务与审计引用，断言失败输出包含全部引用位置，`alembic_version` 未前进且无部分删除。
- E2E 验证自助改密、其他会话撤销、自身管理重置被拒绝，以及审计响应不包含任何密码。

### 7. 错误与正确示例

错误做法：直接删除用户并依赖首个外键错误，或把历史归属转移给管理员。这会产生不完整诊断，甚至破坏历史责任链。

正确做法：在同一事务中锁定全部目标用户，按冻结引用清单收集所有阻断位置；只有预检结果为空时才删除会话和用户，任何异常由 Alembic 事务整体回滚。

## 场景：用户工作台实时查询与批量状态

- 本场景复用现有 `users`、`sessions` 和 `audit_logs`，不增加表、字段、派生汇总或迁移。用户状态、账号类型、强制改密和修订号均由 `users` 单一持有，Redis 不缓存或推断身份状态。
- 列表筛选、`created_at, id` 稳定排序、分页、导出和五项全局汇总都从 PostgreSQL 实时读取。列表 `total` 受筛选影响，汇总不受筛选影响；没有历史快照时不得补造趋势值。
- 新用户默认启用并只保存临时密码哈希，`must_change_password=true`；重置临时密码和停用用户都撤销目标用户全部会话。明文密码不得进入响应、日志或审计。
- 单个和批量状态命令共享同一锁、revision、最后有效管理员和会话撤销规则。批量按 UUID 稳定锁行，预期的用户不存在、revision 冲突和最后管理员保护逐项失败；非预期数据库、审计或程序错误回滚整批。
- 停用、重新启用、改名或调整账号类型始终更新同一用户 UUID。只有停用且没有业务历史引用的账号可按下节契约物理删除；CSV 导出只记录非敏感筛选与行数审计，不保存正文。

## 场景：身份密码长度边界

### 1. 范围与触发条件

- 修改用户创建、管理员重置临时密码、用户自助改密或首次登录强制改密时适用。

### 2. 签名

- `UserCreate.temporary_password`：最少 12 位。
- `ResetPasswordRequest.temporary_password`：最少 8 位。
- `ChangePasswordRequest.old_password` 与 `new_password`：均最少 8 位。
- 自助改密接口：`POST /api/v1/auth/change-password`，成功返回 `204`。

### 3. 契约

- 新建账号和管理员重置密码都写入临时密码哈希并设置 `must_change_password=true`；首次登录除身份、CSRF、改密和退出接口外统一返回 `PASSWORD_CHANGE_REQUIRED`。
- 用户提交正确旧密码和至少 8 位正式新密码后，服务端更新哈希、清除 `must_change_password`、递增 revision，并撤销当前会话以外的活动会话。
- 前端表单、Pydantic 请求模型和 OpenAPI `minLength` 必须使用同一边界；不得把新建账号的 12 位临时密码边界误改为 8 位。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 新建账号临时密码为 11 位 / 12 位 | `422 VALIDATION_ERROR` / 创建成功 |
| 重置临时密码为 7 位 / 8 位 | `422 VALIDATION_ERROR` / `204` |
| 正式新密码为 7 位 / 8 位 | `422 VALIDATION_ERROR` / `204` |
| 自助改密时旧密码错误 | `401 AUTH_REQUIRED` |
| `must_change_password=true` 时访问其他业务接口 | `403 PASSWORD_CHANGE_REQUIRED` |

### 5. 正常、基础与失败案例

- 正常：用户以临时密码登录，使用正确旧密码设置 8 位正式密码，随后进入工作台，其他会话失效。
- 基础：管理员创建用户仍要求 12 位临时密码；管理员重置已有用户时接受 8 位临时密码。
- 失败：前端允许 8 位正式密码而 OpenAPI 或服务端仍要求 12 位，导致表单可提交但请求被拒绝。

### 6. 必需测试

- Schema 单元测试分别冻结 12/11 位新建临时密码、8/7 位重置临时密码和 8/7 位正式新密码边界。
- 前端测试断言 7 位正式新密码不发请求，8 位提交准确载荷。
- 身份集成测试断言首次登录强制改密、改密后清除标志、旧临时密码失效和其他会话撤销。
- 契约测试断言运行时 OpenAPI、冻结 OpenAPI 与生成的 TypeScript 类型一致。

### 7. 错误与正确示例

错误：把所有密码入口统一改为同一个长度，或只改前端提示。

正确：按三个请求模型保留已批准边界，并同步服务端、OpenAPI、前端表单与测试：`UserCreate=12`、`ResetPasswordRequest=8`、`ChangePasswordRequest=8`。

## 场景：开发阶段删除、归档与配置解耦

### 1. 范围与触发条件

- 修改用户、内容任务、平台、平台账号、平台 Prompt 删除，任务归档/恢复、发布/GEO 聚合删除、审计保留或 revision `0037_simplify_deletion_lifecycle` 时适用。
- 该场景只为开发阶段提供简单清理能力；不建立通用级联框架、归档表、审计保留期任务、外部页面删除验证或兼容状态机。

### 2. 签名

- 普通删除：`DELETE /api/v1/content-tasks/{content_task_id}`，`ENGINEER | ADMIN`，成功返回 `204`。
- 归档/恢复：`POST /api/v1/content-tasks/{id}/archive|restore`，请求 `{expected_revision}`，返回重新投影的任务。
- 永久删除：`GET /api/v1/content-tasks/{id}/permanent-deletion-preview` 与 `POST /api/v1/content-tasks/{id}/permanent-delete`；后者仅 `ADMIN`，请求 `{expected_revision, confirmation_text: "永久删除"}`，成功返回 `204`。
- 配置删除：既有 Prompt、平台和平台账号 DELETE 路径；Prompt 继续校验 `expected_revision`，平台必须先停用。
- 用户：`DELETE /api/v1/users/{user_id}`，管理员权限和 CSRF，成功返回 `204`。
- 数据库 revision：`0037_simplify_deletion_lifecycle`，`down_revision = "0036_remove_section_url"`，不可安全降级。

### 3. 契约

- `ContentTask.archived_at` 是与业务状态正交的可空标记。归档只接受未归档 `COMPLETED`，恢复只接受已归档任务；两者只更新 `archived_at` 与 revision，不写审计、不改状态或下游历史。
- 普通删除接受未归档 `OPEN | CANCELLED`，拒绝 `PENDING | RUNNING` 生成作业以及任一成功文章或 GEO 文章关系；它删除任务拥有的生成、内容、审核与未成功发布工作，并清理这些目标的旧审计。
- 永久删除只接受已归档任务、管理员权限、匹配 revision 与固定确认文本。服务在锁内重算范围，删除任务拥有的内容与发布聚合；人工 GEO 更正链仅在删除后失去全部文章关系时整链删除，共享 GEO 和共享文件保留，最后只写空 `details` 的最小墓碑。
- 任务和发布工作都冻结平台名称；任务还冻结网站 URL，发布工作还冻结账号标签与账号标识。平台删除必须先停用，仅由 `OPEN` 任务或非终态发布工作阻断，账号随平台删除，但任务绝不级联删除；终态历史实时配置外键置空后从快照展示。
- 单独账号删除仅由非终态发布工作阻断。Prompt 删除与平台绑定修改复用一个事务 advisory lock；删除时锁定全部绑定平台，置空绑定、递增各平台 revision，再删除 Prompt。历史生成作业继续只读不可变快照。
- 审计只接受 `RETAINED_AUDIT_ACTIONS` 白名单内的 `SUCCESS`。迁移一次性删除所有失败/拒绝和白名单外历史；运行时没有审计删除 API，只有任务聚合删除按精确目标清理旧审计。
- 用户删除规则保持独立：只接受停用且无业务引用的用户，会话级联清理；匹配历史审计的 `actor_id` 仍可受约束置空，其他字段 UPDATE 继续拒绝。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 普通删除遇到运行中作业 | `409 CONTENT_TASK_BUSY`，聚合不变 |
| 普通删除遇到成功文章或 GEO 文章关系 | `409 CONTENT_TASK_REQUIRES_ARCHIVE` |
| 归档非 `COMPLETED` / 恢复未归档任务 | `409 INVALID_STATE_TRANSITION` |
| 永久删除未归档任务 / revision 过期 / 确认文本错误 | `409 CONTENT_TASK_NOT_ARCHIVED` / `409 REVISION_CONFLICT` / `422 PERMANENT_DELETE_CONFIRMATION_MISMATCH` |
| 平台仍启用 / 存在 `OPEN` 任务或非终态工作 | `409 INVALID_STATE_TRANSITION` / 结构化 `PLATFORM_PROFILE_IN_USE` |
| 账号存在非终态工作 | 结构化 `409 PLATFORM_ACCOUNT_IN_USE`；仅有终态工作时可删 |
| Prompt 删除与平台换绑并发 | advisory lock 串行化；结果是完整解绑删除或完整换绑，不允许部分状态 |
| 用户仍启用 / 仍有业务引用 | `409 USER_ACTIVE` / `409 USER_IN_USE` |
| 手工修改批准、发布、GEO 历史或审计 | PostgreSQL `55000`；显式聚合 DELETE 不等于允许原地 UPDATE |

### 5. 正常、基础与失败案例

- 正常：已成功发布任务先归档，管理员查看实时计数和外部 URL，输入 `永久删除` 后一次删除内部任务、发布和独占 GEO 聚合；外部文章不校验也不删除，共享观测保留。
- 基础：未成功发布的 `OPEN | CANCELLED` 测试任务一键删除；平台停用后删除，内部账号随平台清理，终态任务/工作仍可通过快照读取。
- 失败：平台仍有 `OPEN` 任务，或永久删除时 revision 已变化，整个事务拒绝且不产生墓碑；不得用前端隐藏按钮或强制级联绕过。

### 6. 必需测试

- PostgreSQL 迁移测试断言快照确定性回填、可空实时外键、平台不级联任务、终态账号解绑、历史 UPDATE 继续拒绝、审计白名单清理和 downgrade `55000`。
- 集成测试覆盖普通删除、归档、恢复、管理员永久删除、共享/独占 GEO、文件调度、最小墓碑、工程师权限和锁内竞态复核。
- 配置集成测试覆盖绑定 Prompt 原子解绑、活动任务阻止平台删除、终态历史允许平台/账号删除以及快照读模型。
- 身份测试继续覆盖停用用户、业务引用、会话清理与受约束审计操作者置空。
- OpenAPI/生成类型、前端组件和 Playwright 回归必须覆盖危险确认文案、固定确认输入、默认排除归档和删除后的缓存刷新。

### 7. 错误与正确示例

错误：平台删除直接级联任务，或用“存在任何历史”永久阻断所有清理。

```python
db.delete(platform)  # content_tasks 也随外键级联删除
```

正确：把当前配置与终态历史解耦，只在平台仍承担活动业务时阻断；任务聚合必须从任务自己的显式命令删除。

```python
if open_task_count or in_flight_work_count:
    raise in_use("PLATFORM_PROFILE_IN_USE", ...)
db.delete(platform)  # 账号清理；任务保留，终态历史改读冻结快照
```

## 场景：生成作业补投递与租约恢复

- 数据库 revision：`0011_generation_reliability`，`down_revision = "0010_user_cleanup"`。
- `generation_jobs.status` 是执行权威；Redis 消息、投递次数和时间只负责唤醒与诊断，不能形成第二状态机。
- 超龄 `PENDING` 扫描必须使用有限批次与 `FOR UPDATE SKIP LOCKED`；只有原子声明为 `RUNNING` 的 Worker 可以发起供应商调用。
- 租约取不可变快照中的供应商超时再加正数收尾裕量。过期 `RUNNING` 只能显式失败，自动补投递不得覆盖到该状态。
- 迁移只增加可向后读取的列、检查约束和部分索引；历史迁移与 `migration_schema_v1.py` 保持冻结。
- PostgreSQL 集成测试必须覆盖多恢复器、重复消息、租约竞态、迟到响应和迁移前后旧列读取，不能用 SQLite 替代行锁语义。

## 场景：平台 Logo 文件生命周期

### 1. 范围与触发条件

- 修改平台 Logo 导入、绑定、解绑、对象存储删除、FileRecord 状态机或 revision `0028_platform_logo_lifecycle` 时适用。
- `logo_external_url` 只读保留既有值；不得由迁移、Worker 或后台批处理联网转换。

### 2. 签名

- 候选接口：`POST /api/v1/platform-logo-candidates`，请求 `{website_url}`，成功返回 `{file_id, preview: {url, expires_at}}`。
- 平台 PATCH：省略 `logo` 表示保持，`logo=null` 表示清空，`logo={source:"UPLOAD", file_id}` 表示替换；不接受 `EXTERNAL` 写入。
- 数据库 revision：`0028_platform_logo_lifecycle`，`down_revision = "0027_audit_user_delete_guard"`。
- 生命周期命令：平台绑定仍使用 `lock_platform_logo_change(...)`；通用引用检查、解除关联调度和清理分别由 `file_is_referenced(...)`、`schedule_unreferenced_file(...)`、`cleanup_file_records(...)` 负责。

### 3. 契约

- 候选请求只访问固定 `https://icon.horse/icon/{规范化 hostname}`，禁止重定向；校验实际 PNG、JPEG、WebP 或 ICO、2 MiB 字节上限和像素上限后才写入自有对象存储。
- 新写入只允许 `platform_profiles.logo_file_id` 绑定 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`。候选和手工上传完成后保留 24 小时；绑定时锁行并清空 `cleanup_after`，解除最后引用后保留七天。
- `cleanup_after` 只负责调度。删除权威必须实时检查当前 head 的 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id`，不得恢复已删除的 `evidences` 查询或增加引用计数。通用清理器处理所有文件分类，平台服务只保留 Logo 发现、校验和绑定职责。
- 同时涉及旧、新文件时按 UUID 稳定顺序锁定。清理使用有限批次和 `FOR UPDATE SKIP LOCKED`，先提交 `DELETING`，再幂等删除对象；成功写 `DELETED/deleted_at`，暂时失败保持 `DELETING`。
- 迁移时已引用 Logo 不设置截止时间，既有未引用 `VERIFIED PLATFORM_LOGO` 从迁移时点保留七天。历史 revision 和 `migration_schema_v1.py` 保持冻结。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| Icon Horse 超时、网络失败或 5xx | `503 LOGO_DISCOVERY_UNAVAILABLE`，平台不变 |
| 上游 3xx/4xx、超限、SVG/HTML、伪造类型或损坏图片 | `422 LOGO_CANDIDATE_INVALID`，引导手工上传 |
| 候选对象写入或 HEAD 失败 | `503 DEPENDENCY_UNAVAILABLE`，文件保留为可清理状态 |
| 绑定文件不是 `VERIFIED/PUBLIC/PLATFORM_LOGO` | `422`，应用服务拒绝且数据库触发器最终阻断 |
| 到期文件仍有任一真实外键引用 | 跳过删除；`VERIFIED` 的错误截止时间清空 |
| 对象删除暂时失败 / 对象已不存在 | 保持 `DELETING` 待下轮重试 / 视为成功并写 `DELETED` |
| 存在任一 `DELETING` 或 `DELETED` 后降级 | PostgreSQL `55000`，要求前滚或恢复一致备份 |

### 5. 正常、基础与失败案例

- 正常：管理员发现一张候选、预览确认并保存平台，候选文件绑定后不再进入 24 小时清理。
- 基础：管理员取消预览，平台不变；候选在 24 小时后由小时级任务清理。
- 失败：旧 Logo 被多个平台或附件共享，解除一个引用不能启动七天倒计时；最后引用解除后才调度。

### 6. 必需测试

- 单元测试断言固定上游、禁止重定向、超时/5xx、声明与流式超限、格式/解码、对象写入失败和 24 小时截止。
- 服务测试断言 PATCH 三态、稳定 UUID 锁顺序、共享引用、最后解绑七天、`DELETING` 重试、对象缺失幂等和 Beat 小时级注册。
- PostgreSQL 测试断言三类真实外键、状态触发器、`FOR UPDATE SKIP LOCKED` 竞态、迁移初始化及 downgrade 门禁；SQLite 不能替代。
- 契约与前端测试断言旧 `EXTERNAL` 只读、确认后才绑定，以及平台列表、详情、Prompt 列表和内容任务缓存刷新。

### 7. 错误与正确示例

错误：仅按 `cleanup_after` 删除对象，或先删对象再依赖外键报错。

```python
if file.cleanup_after <= now:
    storage.delete(file.object_key)
```

正确：统一调用生命周期所有者；它在事务内锁定候选行、实时复核全部当前外键并提交 `DELETING`，随后幂等删除对象并写墓碑。

```python
result = cleanup_platform_logo_files(storage=storage)
```

## 场景：发布工作、只读成果与发布后问题

- 当前发布结构由 `0034_publication_redesign` 建立，并由 `0035_business_workflow`、`0036_remove_section_url` 前向收敛；历史 revision 与 `migration_schema_v1.py` 保持冻结。
- `PublicationWork` 唯一拥有发布过程当前状态；`PublicationWorkEvent` 与 `PublicationVerification` 是追加式历史，`PublishedArticle` 是首次成功核验形成的只读公开成果，`PublishedContentIssue` 只描述成功发布后的页面问题。
- `COMPLETED` 表示工作曾通过首次核验。成功核验、同 ID `PublishedArticle` 创建和来源 `ContentTask.COMPLETED` 必须同事务提交；失败核验只追加快照并进入 `ACTION_REQUIRED`，不得完成或取消任务。
- 非终态工作只能通过带原因和说明的关闭命令进入 `CLOSED`，并原子取消来源任务；这些对象不能单项物理删除，唯一聚合例外是管理员永久删除其已归档来源任务。
- 平台、账号、内容版本和内容哈希绑定由应用服务给出结构化错误，并由 PostgreSQL 约束或触发器最终保护。测试必须同时覆盖 API 与直接数据库写入。
- `PublishedContentIssue` 只能从 revision 0 的 `OPEN` 开始，文章绑定与打开事实不可变；唯一状态变化是带处理结果、非空说明和单次 revision 递增的 `OPEN -> RESOLVED`。
- 修复任务来源 `source_published_content_issue_id` 一旦写入不可改绑且唯一。创建修复任务与解决问题是独立命令，任何一方不得从另一方状态推断完成。
- `0034` 只允许在旧发布与 GEO 依赖表全部为空时替换结构；发现数据必须汇总阻断表并以 PostgreSQL `55000` 失败。迁移和 downgrade 不猜测新旧业务语义。
- `0036` 删除没有稳定业务含义的 `publication_works.section_url`。开始发布只绑定内容版本和账号，准备更新只变更账号；真实公开位置仍由结果登记的 `final_url` 持有并校验允许域名。被删值不迁移到替代列，downgrade 以 `55000` 拒绝并要求恢复升级前备份。

## 场景：具体平台启停与管理实时投影

- `platform_profiles.is_active` 是平台启停的唯一持久状态；配置完整性只表示存在当前 `PlatformPrompt`，不再依赖规则版本。
- 停用后仍允许查看、编辑、维护 Prompt 及重新启用，但新建普通/修复 `ContentTask`、`PlatformAccount` 或 `PublicationWork` 必须先以 `FOR UPDATE` 锁定平台并返回 `PLATFORM_DISABLED`；不得停用既有账号或改写 Prompt、任务、发布及观测历史。
- 平台管理汇总、配置完整性、账号数量和引用数量只做 PostgreSQL 实时投影，不保存快照或派生列。引用数直接按 `ContentTask.platform_profile_id` 统计唯一任务；最近 30 天使用同一 UTC `as_of` 的半开区间 `[as_of - 30 days, as_of)`。
- 平台列表筛选、稳定排序、分页和 CSV 导出复用同一查询条件；无分页参数时保留完整参考集合语义，`page` 与 `page_size` 只能成对出现。更新时间只读取真实平台审计，缺失时返回 `NULL`，不得用迁移时间补造。

## 场景：Markdown 产品事实与双首稿内容生产

### 1. 范围与触发条件

- 修改产品事实工作区、事实版本、内容任务、平台 Prompt、生成快照、人工首稿、发布修复或 revision `0025_markdown_facts_direct_platform` 时适用。
- 产品数据手册由系统外 AI 总结；本系统只接收和维护用户提交的 Markdown 总结，不保存参考型号、参数、Evidence 或可独立编辑的结构化事实副本。

### 2. 签名

- 工作区：`products.facts_body_markdown TEXT NOT NULL`、`products.facts_classification PUBLIC|INTERNAL|RESTRICTED`、`products.facts_revision`。
- 冻结版本：`fact_versions.body_markdown`、`fact_versions.classification`；不得恢复 `snapshot_json`。
- 任务：`ContentTaskCreate(product_id, fact_version_id, platform_profile_id)`；`content_tasks` 直接外键到 `platform_profiles`。
- 普通任务创建要求 8–128 字符 `Idempotency-Key`；同键同三字段返回原任务，同键异载荷返回 `409 IDEMPOTENCY_CONFLICT`，不同键允许相同业务输入。
- 系统首稿：`POST /api/v1/content-tasks/{id}/generation-jobs`，请求体为 `{ai_model_id, platform_prompt_id, platform_prompt_revision}`。
- 人工首稿：`POST /api/v1/content-tasks/{id}/manual-versions`，请求体复用 `ContentRevisionCreate`。
- 生成快照：新原始作业只写 `content-markdown-v3`，自然化只写 `humanization-markdown-v2`；`content-markdown-v2` 可按原快照读取和重试，旧 v1 只读。

### 3. 契约

- 保存事实时去除空白后的 Markdown 必须非空，原文和分级原样保存；创建事实版本只冻结当前工作区两个字段。已批准或已被内容引用的版本不得原地修改。
- `PlatformProfileVersion` 表、API、前端路由及任务中的受众、内容角度、转化目标、格式、长度、用户 Prompt、平台类型快照和 canonical URL 已物理删除；不得建立兼容字段或第二来源。
- 创建任务只校验产品、该产品的 `APPROVED` 非空事实版本和启用平台。平台通过可空外键绑定零或一份可复用 Prompt；缺少绑定不阻止任务或人工首稿，只阻止系统 AI 作业。
- 普通任务创建先按命名请求键获取 PostgreSQL 事务 advisory lock，再读取唯一的 `content_tasks.idempotency_key`。重放不产生额外副作用；历史任务和发布修复任务保持空值，Redis 不保存幂等状态。
- `content_tasks.idempotency_key` 只属于服务端创建幂等控制；任务列表与详情必须复用同一响应基础投影排除该字段，并继续由禁止额外字段的响应模型检查合同漂移。
- 原始 AI 请求必须恰好发送两条消息：`system.content == PlatformPrompt.template_markdown`，`user.content == FactVersion.body_markdown`；不得增加前缀、拼接任务要求、补默认安全规则或重写空白。
- 人工首稿创建 `source_type=HUMAN`、`status=DRAFT`、`source_job_id=NULL`、`based_on_id=NULL`，随后与 AI 草稿共用修订、审核和人工发布链。
- `ContentRevisionCreate.tags` 必须至少包含一个标签，且每个标签至少包含一个非空白字符；人工首稿与人工修订前端复用同一必填规则，服务端请求模型仍是最终校验权威。标签不自动 trim、去重、补默认值或增加未批准的数量/长度限制。
- 发布工作、平台账号和修复任务沿用 `ContentTask.platform_profile_id`；修复任务只允许重新选择同产品的批准事实版本，并继承原文章任务的平台。
- Prompt 可按 revision 删除；服务在同一事务自动解绑全部当前平台并递增平台 revision。删除后新 AI 生成因缺少绑定显式失败，历史作业继续从不可变快照读取，v2 可按原快照重试，v1 禁止重试。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 事实 Markdown 为空白 | 请求校验失败，不递增 `facts_revision` |
| 事实版本不属于产品、非 `APPROVED` 或正文为空 | `409 INVALID_STATE_TRANSITION`，不创建任务/首稿 |
| 平台不存在或已停用 | `404` 或 `409 PLATFORM_DISABLED` |
| 缺少或长度非法的任务请求键 | `422 VALIDATION_ERROR`，不创建任务 |
| 同键异载荷 | `409 IDEMPOTENCY_CONFLICT`，原任务不变 |
| 系统 AI 使用非 `PUBLIC` 事实 | `409 AI_DATA_CLASSIFICATION_FORBIDDEN` |
| 当前平台 Prompt 不存在 | `409 PLATFORM_PROMPT_MISSING`，不得回退 |
| 人工首稿提交到终态任务 | `409 INVALID_STATE_TRANSITION` |
| 重试 legacy 生成快照 | `409 LEGACY_GENERATION_RETRY_FORBIDDEN` |
| 删除被任务或内容版本引用的事实版本 | `409 FACT_VERSION_IN_USE`，返回真实非零引用 |

### 5. 正常、基础与失败案例

- 正常：管理员保存公开 Markdown、批准版本、选择平台建任务，再选择模型生成 AI 草稿；供应商收到的平台 Prompt 与事实正文逐字相同。
- 基础：同样的任务不配置模型也能直接粘贴网页版豆包、DeepSeek 或其他工具输出，创建人工 `DRAFT` 并进入审核。
- 失败：Prompt 被删后继续生成时显式失败；不得把安全规则、受众、角度或长度从已删除任务字段拼回请求。

### 6. 必需测试

- 契约测试断言任务创建仅三个字段、人工首稿接口存在、平台规则 Schema/路径和旧任务字段不存在。
- PostgreSQL 迁移测试断言确定性 Markdown 回填、最严格分级、任务平台唯一回填、旧表/列删除、活动旧作业阻断和有损 downgrade 拒绝。
- 单元/集成测试断言生成请求恰好两条原始消息、人工 lineage 四字段、非公开事实/缺 Prompt/legacy retry 明确失败。
- 前端测试断言 Markdown 是唯一事实编辑器，任务仅选择产品/事实/平台，AI 与人工入口并列，规则页面和旧字段不可达。
- 契约、请求边界和前端组件测试共同断言空数组、全空白标签与删除最后一个标签均不创建内容版本；恢复有效标签后提交原 payload，直接绕过前端仍返回结构化 `422 VALIDATION_ERROR`。
- E2E 使用真实 HTTP 替身断言 system/user 内容逐字相同，并覆盖人工首稿到审核、发布的共用链路。

### 7. 错误与正确示例

错误：为兼容旧任务继续拼接受众、角度或固定安全前缀。

```python
messages = [
    {"role": "system", "content": DEFAULT_SAFETY + prompt},
    {"role": "user", "content": task.user_prompt_markdown + fact.body_markdown},
]
```

正确：平台 Prompt 和冻结事实正文各自只有一个权威来源。

```python
messages = [
    {"role": "system", "content": prompt.template_markdown},
    {"role": "user", "content": fact.body_markdown},
]
```

## 场景：事实版本审核历史精确归属

### 1. 范围与触发条件

- 修改事实版本状态命令、`fact_review_records`、事实审核上下文或产品事实页审核历史时适用。
- 该边界防止把同产品兄弟版本的审核记录混作当前版本历史。

### 2. 签名

- 读取接口：`GET /api/v1/fact-versions/{fact_version_id}/review-context`。
- 审核记录 owner：`fact_review_records.fact_version_id -> fact_versions.id`。
- 业务审计 owner：`audit_logs.target_type="FactVersion"` 且 `target_id=<fact_version_id>`。

### 3. 契约

- `FactReviewContext.fact_version.id` 必须等于路径 `fact_version_id`。
- `review_history` 每项 `target_id` 必须等于同一路径 ID，只返回该版本自身的追加式审核记录。
- 前端按选中版本 ID 请求并原样展示服务端投影，不增加产品级拼接、兼容过滤或第二 owner。
- 内容审核仍可按同一任务累计到目标内容版本；不得因事实版本修复改动 `_content_history`。
- 若未来需要产品级时间线，必须新增明确命名和分区的独立契约，不能复用版本详情冒充。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| `fact_version_id` 不存在 | `404`，不返回其他版本历史 |
| 同产品 V1、V2 都有审核记录 | V1、V2 上下文各自只返回自己的记录 |
| 审核命令成功 | 同事务追加精确版本的 `FactReviewRecord` 与 `FactVersion` 审计 |
| 产品级时间线不存在 | 不回退到 `product_id` 聚合 |

### 5. 正常、基础与失败案例

- 正常：V1 退役、V2 提交审核；打开 V2 只显示 V2 提交事件。
- 基础：目标版本没有审核记录，返回空 `review_history`。
- 失败：按 `product_id` 和 `version <= 当前版本` 查询，使 V2 详情混入 V1 事件。

### 6. 必需测试

- PostgreSQL 集成测试创建同产品 V1、V2，分别执行不同状态命令，断言两个上下文的 `target_id/action/comment` 不交叉。
- 同一测试断言对应审计的 `target_type/target_id` 精确指向各自版本。
- 前端组件测试点击 V2 行，断言请求 V2 `review-context` 且不展示 V1-only 事件。
- 契约测试与生成类型检查必须通过；响应字段结构保持不变。

### 7. 错误与正确示例

错误：按产品聚合兄弟版本。

```python
.where(
    FactVersion.product_id == fact.product_id,
    FactVersion.version <= fact.version,
)
```

正确：按审核记录的权威父版本过滤。

```python
.where(FactReviewRecord.fact_version_id == fact.id)
```

## 场景：产品级人工 GEO 文章观测

### 1. 范围与触发条件

- 新建、读取、更正或删除 GEO 人工搜索记录，以及修改产品文章候选和独立事实指标时适用。
- 用户在外部搜索网站人工核对结果；本系统只保存可复核证据，不调用模型、搜索供应商或截图解析服务。

### 2. 签名

- 当前发布文章身份由 `0034_publication_redesign` 替换为 `PublishedArticle`；`0029`、`0018` 与 `0022` 只描述历史演进。
- 候选接口：`GET /api/v1/geo-observation-publications?product_id=<uuid>`。
- 创建接口：`POST /api/v1/geo-observations`，接收 `product_id`、`search_platform`、`search_query`、`tested_at`、`article_results[]`、`attachment_file_ids[]`、可选 `notes/supersedes_id`。
- 删除接口：`DELETE /api/v1/geo-observations/{observation_id}`，只允许管理员删除人工观测完整更正链。
- 明细结果：`geo_observation_publications.discovered/mentioned/accuracy`；前两项为独立必填布尔值，`accuracy` 为可空的既有枚举。

### 3. 契约

- `PublishedArticle` 是公开文章的唯一身份，标题、平台和 `final_url` 均由只读发布成果投影；GEO 不复制文章或链接字段。
- 一次人工观测必须覆盖该产品在提交事务中全部合格 `PublishedArticle`；存在 `OPEN PublishedContentIssue` 或曾以 `RETIRED` 解决问题的文章不合格，服务端锁定候选后比较精确 ID 集合。
- 每篇候选必须显式提交独立的 `discovered`、`mentioned` 和可空 `accuracy`；不得保留推荐、引用或累计阶段校验。
- 截图可为空；非空附件必须去重且为已验证的 `OPERATION_SCREENSHOT`。每个更正版本只关联本次新增文件，读取时沿祖先链聚合截至当前版本的证据。
- `LEGACY_MODEL_RESULT` 继续保存旧目标问题、模型结果、推荐和引用；其逐篇独立事实保持 `NULL`，不得从旧观测级结论推断。
- `MANUAL_ARTICLE_SEARCH` 的旧模型字段必须全空；更正只能追加同产品、同类型且尚无后继的完整新记录。
- 人工文章指标只统计没有后继更正的人工观测，并由明细实时派生；发现率和提及率以全部逐篇结果为分母，准确率只以非空且非 `UNJUDGEABLE` 为分母，零分母返回 `NULL`。
- 删除任一链内 ID 都必须解析并锁定完整人工更正链，从链尾到链根显式删除关系和节点；数据库事务变量逐节点放行 DELETE，UPDATE 和旧模型 DELETE 始终拒绝。
- 删除后只有失去全部实际外键引用的附件设置 `cleanup_after=now`，由通用文件清理器进入可重试的 `DELETING -> DELETED`；审计只记录稳定 ID 与数量。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 产品不存在 | `404 PRODUCT_NOT_FOUND` |
| 请求文章集合与当前候选不完全相等 | `409 GEO_PUBLICATIONS_CHANGED`，不得部分写入 |
| 文章跨产品、状态不可观测或缺少 `final_url` | 服务端拒绝；数据库触发器最终拒绝直接写入 |
| 结果重复、缺少 `discovered/mentioned` 或准确性枚举非法 | 请求校验失败 |
| 截图重复、未验证或类别不是 `OPERATION_SCREENSHOT` | 请求校验或服务端校验失败；空数组合法 |
| 更正来源不是同产品人工观测，或已有后继 | `409`，来源历史保持不变 |
| 删除旧模型观测、单节点或不完整/分支链 | `409` 或数据库 `55000`，不得让旧版本重新成为当前记录 |
| 证据仍被平台 Logo、发布附件或其他 GEO 观测引用 | 只删除当前观测关系，不调度文件清理 |

### 5. 正常、基础与失败案例

- 正常：产品有两篇已发布文章，人工在 DeepSeek 搜索后分别登记发现、提及和可选准确性；不上传截图也能原子追加全部明细。
- 基础：历史模型观测迁移后只增加 `LEGACY_MODEL_RESULT` 判别值，旧字段、引用和发布关联保持原义。
- 失败：用户填写期间新增一篇符合条件的发布成果，提交集合已过期，返回 `GEO_PUBLICATIONS_CHANGED`，不自动补成“未发现”。

### 6. 必需测试

- PostgreSQL 迁移测试验证空库升级到 head、独立事实约束、文章归属触发器、四张追加式表的删除门禁和可恢复 downgrade 结构。
- 集成测试至少覆盖两篇当前文章的完整集合、事实任意组合、无截图创建、更正聚合旧证据、整链删除、安全审计及独占/共享附件清理。
- 契约测试验证 OpenAPI、Pydantic 与前端生成类型一致；前端测试验证独立复选项、可空准确性、可选截图、已有证据展示和服务端动作授权。
- E2E 验证人工观测主流程、无截图更正、整链删除与历史模型只读展示；不得把固定成功的搜索或模型替身作为人工结果证据。

### 7. 错误与正确示例

错误做法：信任前端只提交命中的文章，或按提交时缺少的 ID 自动补“未发现”。这会把遗漏和并发变化伪装成真实搜索结论。

正确做法：在同一事务锁定产品及权威候选，精确比较集合后再追加明细：

```python
candidate_ids = {article.id for article in locked_candidates}
submitted_ids = {result.published_article_id for result in request.article_results}
if submitted_ids != candidate_ids:
    raise ConflictError("GEO_PUBLICATIONS_CHANGED")
```

文章 URL 始终从 `PublishedArticle` 对应的冻结发布工作读取，前端不得提交或覆盖该值。

## 场景：成功动作白名单审计

### 1. 范围与签名

- 当前边界由 `0037_simplify_deletion_lifecycle` 和 `backend/app/audit_types.py::RETAINED_AUDIT_ACTIONS` 共同固定。
- `audit_logs` 是唯一业务审计来源；新写入必须包含 `business_module`、白名单 `action`、`outcome=SUCCESS`、非敏感 `result_message` 和可定位目标。
- 请求 ID 允许重复，但只接受 1–100 个可打印 ASCII 字符。

### 2. 事务与覆盖边界

- 成功审计使用 `append_audit`，与业务写入同一事务提交或回滚。
- 失败、拒绝、读取、普通工作流推进以及其他白名单外动作不写业务审计；真实错误继续由 API 响应和服务日志暴露，不使用 no-op 或独立事务伪造审计。
- 任务普通/永久删除会精确删除被移除目标的旧审计；永久删除只保留一条 `content_task.permanently_deleted` 空详情墓碑。没有通用审计删除 API。

### 3. 数据安全与查询

- `details` 只保存结构化 `changes` 与 `facts`；写入前递归拒绝敏感键，读取时再按业务模块正向白名单投影字段。
- 关键词只匹配操作者、业务模块、动作、对象类型、对象标识、请求 ID、结果说明与错误码等已批准字段，不执行 `details::text` 搜索。
- 列表按 `(created_at DESC, id DESC)` 稳定排序。操作者信息使用当前用户投影；用户删除后保留的事件仍可读，投影为空。
- `0037` 迁移使用自身冻结白名单，一次性删除全部非成功及白名单外历史，不导入运行时常量。

### 4. 降级与必需测试

- 审计历史清理不可逆；`0037` downgrade 必须以 PostgreSQL `55000` 失败并要求恢复迁移前备份。
- 迁移测试覆盖白名单保留、非成功/白名单外清理、业务表不变、UPDATE 门禁和不可安全降级。
- 单元与集成测试覆盖非白名单写入显式失败、保留动作 `SUCCESS`、敏感键拒绝、字段白名单、稳定分页和管理员权限。
- 前端测试覆盖默认北京时间近三天、URL 可分享筛选、手动与 30 秒可见页刷新、空态/错误态、右侧详情以及敏感字段不展示。
