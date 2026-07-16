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

## 场景：生成作业补投递与租约恢复

- 数据库 revision：`0011_generation_reliability`，`down_revision = "0010_user_cleanup"`。
- `generation_jobs.status` 是执行权威；Redis 消息、投递次数和时间只负责唤醒与诊断，不能形成第二状态机。
- 超龄 `PENDING` 扫描必须使用有限批次与 `FOR UPDATE SKIP LOCKED`；只有原子声明为 `RUNNING` 的 Worker 可以发起供应商调用。
- 租约取不可变快照中的供应商超时再加正数收尾裕量。过期 `RUNNING` 只能显式失败，自动补投递不得覆盖到该状态。
- 迁移只增加可向后读取的列、检查约束和部分索引；历史迁移与 `migration_schema_v1.py` 保持冻结。
- PostgreSQL 集成测试必须覆盖多恢复器、重复消息、租约竞态、迟到响应和迁移前后旧列读取，不能用 SQLite 替代行锁语义。

## 场景：第三方模型数据分级

- 数据库 revision：`0012_ai_data_classification`，`down_revision = "0011_generation_reliability"`。
- `content_tasks` 的分级、分类人和分类时间必须全空或全有；历史任务保持全空，不得迁移猜测为 `PUBLIC`。
- Prompt 与整份生成输入分级在同一个任务修订事务中更新，PostgreSQL 是当前分类唯一来源。
- 第三方作业快照冻结分类结论和事实 Evidence 分级；Redis 不保存或推断分类。
- 降级只移除分级元数据。回滚到不识别 0012 的应用前必须先停用全部 AI 渠道，避免旧应用绕过新门禁。

## 场景：发布闭环历史门禁与异常状态

- 数据库 revision：`0013_publication_closure`，`down_revision = "0012_ai_data_classification"`。
- `COMPLETED` 表示任务曾完成发布闭环。完整性门禁必须读取追加式 `publication_status_events` 中的 `VERIFIED` 事实，不能只看发布记录当前状态；后来 `REMOVED` 或 `VERIFICATION_FAILED` 不得把合法完成历史误报为脏数据。
- 跨平台错绑只在尚未进入 `REJECTED`、`REMOVED` 或 `VERIFICATION_FAILED` 时阻断。已显式终态处置的旧记录继续保留，不通过改绑、删除或隐藏 allowlist 清理历史。
- 新发布的平台等值由应用服务给出业务错误，并由 PostgreSQL 插入触发器最终保护。测试必须同时覆盖 API 与直接数据库写入。
- `PublicationAttention` 只能以 revision 0 的 `OPEN` 初态插入，绑定与打开时间不可变，历史不可删除；唯一允许的状态变化是带非空说明和单次 revision 递增的 `OPEN -> RESOLVED`。
- 修复任务来源字段一旦写入不可改绑。异常或修复来源产生后，迁移只允许前滚，downgrade 不得删除业务历史。

## 场景：平台级 Prompt 与受约束物理删除

### 1. 范围与触发条件

- 修改平台 Prompt 所有权、平台可用性、产品或平台配置删除时适用。
- 当前配置可以物理删除；不可变事实、任务、内容、发布和观测历史不得级联、改绑或自动清理。

### 2. 签名

- 数据库 revision：`0014_platform_prompt_ownership`，`down_revision = "0013_publication_closure"`。
- Prompt 主键：`platform_prompts.platform_profile_id -> platform_profiles.id ON DELETE CASCADE`。
- 删除接口：`DELETE /products/{id}`、`/platform-profile-versions/{id}`、`/platform-profiles/{id}`、`/platform-accounts/{id}`、`/platform-types/{id}`。

### 3. 契约

- 一个具体平台拥有零或一个当前 Prompt；类型级 Prompt 字段、接口、双读和默认值全部禁止。
- 平台可没有 `ACTIVE` 规则。管理员仍可配置；工程师只有在 `ACTIVE` 规则和当前 Prompt 同时存在时才能创建任务。
- 删除服务在同一事务锁定目标并统计直接引用。冲突响应使用 `details.references[{type,count}]`，只报告真实直接引用。

### 4. 校验与错误矩阵

| 删除对象 | 直接阻断引用 | 成功结果 |
|---|---|---|
| `Product` | `FactVersion`、`ContentTask`、`GeoObservation` | 删除产品和当前事实工作区 |
| `PlatformProfileVersion` | `ContentTask` | 删除版本；若为 `ACTIVE`，平台进入无有效规则状态 |
| `PlatformProfile` | 规则版本、平台账号 | 删除平台及其当前 Prompt |
| `PlatformAccount` | `PublicationRecord` | 删除公开账号标识 |
| `PlatformType` | 具体平台 | 删除分类 |

### 5. 正常、基础与失败案例

- 正常：删除未引用的 `ACTIVE` 规则后，平台保留，`active_version=null`，工程师不可选。
- 基础：管理员为该平台激活新版本且当前 Prompt 存在后，平台重新进入可选集合。
- 失败：任一直接引用存在时返回结构化 `409`，所有目标和历史记录保持不变。

### 6. 必需测试

- PostgreSQL 迁移测试覆盖类型 Prompt 一对多复制、孤立 Prompt 丢弃、平台主键唯一约束和不可降级策略。
- API 集成测试覆盖每类直接引用、管理员权限、无引用成功删除，以及删除 `ACTIVE` 规则后的可用性变化。
- E2E 验证冲突引用中文展示、Prompt 缺失/无有效规则禁选和重新激活后的恢复。

### 7. 错误与正确示例

错误做法：捕获首个外键异常、级联删除历史，或删除 `ACTIVE` 版本后自动挑选旧版本。

正确做法：锁定目标，显式统计权威引用并返回稳定类型；只有引用为空才删除当前配置，平台可用性由当前 `ACTIVE` 规则与 Prompt 共同推导。
