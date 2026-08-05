# 移除发布栏目地址

## 目标与用户价值

完整移除发布流程中没有稳定业务含义的“栏目地址”及其 `section_url` 数据。用户开始发布时只选择发布账号；真正发布完成后仍登记并校验 `final_url`，避免要求不具备栏目概念的平台填写虚假地址。

## 已确认事实

- `publication_works.section_url` 当前是非空数据库列，ORM 也将其声明为必填（`backend/app/models/publication.py:118`）。
- 创建发布工作与更新准备信息都会接收、校验并保存 `section_url`；创建幂等比较也包含该字段（`backend/app/services/publication.py:427`、`backend/app/services/publication.py:460`、`backend/app/services/publication.py:475`、`backend/app/services/publication.py:587`）。
- 工作列表、工作详情和发布成果详情都会返回该字段（`backend/app/services/publication_queries.py:330`、`backend/app/services/publication_queries.py:562`）。
- OpenAPI 的创建、准备更新、工作列表/详情和发布成果响应均公开了该字段（`contracts/openapi.yaml:4136`、`contracts/openapi.yaml:4194`、`contracts/openapi.yaml:4525`、`contracts/openapi.yaml:4636`、`contracts/openapi.yaml:4971`）。
- 前端开始发布、更新准备信息和工作详情均使用“栏目地址”（`frontend/src/features/publications/PublicationsPage.tsx`）。
- 发布结果的 `final_url` 仍是已发布内容的权威公开地址，并在结果登记时校验平台允许域名（`backend/app/services/publication.py:662`）；本任务不改变该规则。
- `backend/app/migration_schema_v1.py` 是 0001—0008 的冻结迁移快照，0034/0035 是已发布迁移；三者都不得为本任务改写。

## 需求

### R1：删除公共接口字段

- 从 `PublicationWorkCreate` 和 `PublicationPreparationUpdate` 删除 `section_url`，不得保留可选字段或兼容别名。
- 从发布工作列表、发布工作详情和发布成果详情响应删除 `section_url`。
- 以 `contracts/openapi.yaml` 为权威来源重新生成前端 TypeScript 类型，不手工维护生成文件。

### R2：删除数据库字段

- 新增 0036 前向 Alembic 迁移，先更新 `partsignal_guard_publication_work()`，再删除 `publication_works.section_url`。
- 迁移保留现有发布工作的其他字段、状态和历史关系；现存 `section_url` 值按已确认的无效数据直接丢弃，不另建备份列或影子表。
- 因删除值无法确定性恢复，迁移的 `downgrade()` 必须以 PostgreSQL `55000` 明确拒绝，并提示从迁移前备份恢复。
- 不修改 0034、0035、`migration_schema_v1.py` 或任何更早迁移。

### R3：收敛后端发布逻辑

- 创建发布工作的身份与幂等判断只使用已有权威字段，不再读取、比较、校验或存储 `section_url`。
- 准备信息更新只允许更换同平台的有效发布账号，并继续要求 `expected_revision` 与非空说明。
- 数据库准备阶段冻结规则只约束 `platform_account_id`；其他身份、状态、结果和历史守卫保持不变。
- `final_url` 的 HTTP(S)、平台允许域名及结果登记规则保持不变。

### R4：删除前端无效交互

- 开始发布弹窗仅保留发布账号选择，不显示栏目地址。
- 更新准备信息弹窗只保留发布账号、并发 revision 和说明，不显示栏目地址。
- 请求体、表单初始值、工作详情及发布成果展示均不得残留 `section_url` 或“栏目地址”。
- 不增加替代字段、隐藏默认值、占位 URL 或前端兼容逻辑。

### R5：同步测试与权威文档

- 更新后端发布流程、迁移、前端组件和 E2E 测试数据，覆盖删除后的真实请求与响应。
- 更新 `contracts/database.md`、`.trellis/spec/backend/publication-workbench-guidelines.md` 和 `docs/GEO多平台内容运营系统方案设计.md` 中的当前设计。
- 历史归档、旧迁移及验证旧 revision 所需的历史迁移测试数据保留原貌；它们不是当前运行时契约。

## 验收标准

- [x] AC1：开始发布界面只要求选择发布账号；`POST /api/v1/publication-works` 请求体只包含 `content_version_id` 和 `platform_account_id`。
- [x] AC2：准备信息更新界面不再出现栏目地址；`PATCH /api/v1/publication-works/{work_id}/preparation` 请求体只包含 `platform_account_id`、`expected_revision` 和 `comment`。
- [x] AC3：OpenAPI、Pydantic 模型、服务层、查询投影、生成 TypeScript 类型及当前前端代码均不再公开或依赖 `section_url`。
- [x] AC4：从 0035 升级到新 revision 后，`publication_works.section_url` 不存在，既有行的其余业务数据不变；账号冻结、状态转换、终态不可变和历史不可删除守卫仍生效。
- [x] AC5：新迁移降级以 `55000` 拒绝并指向备份恢复；旧迁移与冻结迁移快照没有被修改。
- [x] AC6：发布结果仍必须提交合法 `final_url`，不匹配平台允许域名时仍明确失败。
- [x] AC7：发布工作详情和发布成果详情不显示栏目地址，现有账号、最终 URL、发布时间、核验和问题历史仍正常展示。
- [ ] AC8：定向后端集成测试、迁移测试、前端组件测试、发布 E2E、合同检查、lint、类型检查、构建和完整发布相关回归通过。
- [x] AC9：在当前生产代码、当前契约和当前设计文档中搜索不到 `section_url`/“栏目地址”；仅允许旧迁移、冻结迁移快照、历史归档、验旧迁移测试、删除迁移说明/回归断言及历史验收制品保留原始记录。

## 不在范围内

- 不改变发布状态机、权限、发布账号必选规则或 `available_actions`。
- 不改变发布结果登记、`final_url`、核验、发布成果、问题处理或 GEO 回流逻辑。
- 不引入自动发布、平台栏目模型、替代地址字段或兼容层。
- 不修改历史迁移、冻结迁移快照、已归档任务/会话和历史验收制品。
- 本任务规划与实现不自动包含提交、推送或线上部署；这些操作仍按项目 Git 与发布规则单独确认。

## 技术约束

- PostgreSQL 是发布业务状态的唯一来源，字段删除和守卫变更必须由新 Alembic revision 完成。
- API 删除、后端实现、生成类型和前端消费必须在同一版本交付，不支持新旧合同混跑。
- 任何失败都应通过现有显式错误、数据库约束和测试暴露，不增加静默回退。
