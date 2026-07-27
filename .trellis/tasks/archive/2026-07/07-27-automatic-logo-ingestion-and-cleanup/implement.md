# 自动 Logo 导入与资源清理实施计划

## 1. 契约与数据库先行

- [ ] 更新 `contracts/openapi.yaml`：
  - 新增 `POST /api/v1/platform-logo-candidates`、候选请求/响应与稳定错误；
  - 写入侧 Logo 只允许 `UPLOAD`；
  - `PlatformProfileUpdate.logo` 改为可省略三态；
  - 读取侧暂时保留 `EXTERNAL`；
  - `FileRecordOut.status` 增加 `DELETING | DELETED`。
- [ ] 更新 `contracts/database.md`，冻结 FileRecord 状态转换、`cleanup_after`、`deleted_at`、引用权威、保留期、迁移与 downgrade 门禁。
- [ ] 新增 `backend/alembic/versions/0028_platform_logo_lifecycle.py`：
  - 增加字段和必要索引/检查；
  - 更新 `file_records_guard`；
  - 增加平台 Logo 最终数据库校验触发器；
  - 为既有未引用 `VERIFIED PLATFORM_LOGO` 设置迁移后 7 天截止；
  - 存在 `DELETING/DELETED` 时拒绝降级。
- [ ] 同步运行时 ORM 与 Pydantic Schema；`backend/app/migration_schema_v1.py` 和历史 revision `0008`、`0020` 必须保持冻结。
- [ ] 为 `PlatformProfileUpdate.logo` 使用 `model_fields_set` 实现省略/清空/替换，先增加服务测试再改调用链。

验收映射：AC4、AC5、AC6、AC9、AC10。

## 2. 对象存储最小扩展

- [ ] 在 `backend/app/services/storage.py` 的既有协议和两个适配器增加服务端 `put`、幂等 `delete`。
- [ ] 在 `backend/app/dev_storage.py` 增加签名 DELETE 和后端可用的内部写入路径；删除对象时同时删除 metadata。
- [ ] OSS 使用现有 `oss2.Bucket`，对象不存在视为成功，其他 SDK 错误统一映射为 `StorageUnavailable`。
- [ ] 增加开发存储与适配器单元/集成测试，不创建第二个存储客户端。

验收映射：AC4、AC5、AC6。

## 3. Icon Horse 单候选导入

- [ ] 在 `backend/pyproject.toml` 增加 Pillow 并更新锁文件。
- [ ] 新增聚焦的 `backend/app/services/platform_logo_files.py`，负责：
  - 官网 hostname 规范化；
  - 固定 Icon Horse URL 构造；
  - 禁止重定向的 `httpx` 流式下载；
  - 2 MiB、格式、真实图片、尺寸和像素上限校验；
  - PENDING 记录、对象写入、HEAD 校验、VERIFIED 与 24 小时截止；
  - 平台绑定文件锁、最后解绑 7 天调度及清理批次。
- [ ] 在配置 Schema/Router 增加管理员、CSRF 保护的候选端点；成功只返回 `file_id` 和 `SignedUrl`。
- [ ] 写入候选导入的真实用户审计；远端响应正文、Header 和 Cookie 不进入日志或审计。
- [ ] 用 `httpx.MockTransport` 或等价注入边界覆盖成功、超时、3xx、4xx/5xx、超限、SVG/HTML、伪造类型、损坏图片和对象存储失败；测试不访问真实 Icon Horse。

验收映射：AC1、AC2、AC8、AC11。

## 4. 绑定与清理生命周期

- [ ] 平台创建、更新和删除统一调用平台 Logo 文件生命周期所有者：
  - 新文件只接受锁定后的 `VERIFIED/PUBLIC/PLATFORM_LOGO`；
  - 绑定清空 `cleanup_after`；
  - 替换、清空或删除后只在最后引用解除时设置 7 天截止；
  - 旧外链保持分支只由 PATCH 省略语义触发，不允许新写。
- [ ] 手工上传 Logo 完成校验时设置 24 小时截止；其他文件类别行为保持不变。
- [ ] 清理器按有限批次、`FOR UPDATE SKIP LOCKED` 和完整外键集合声明到期文件。
- [ ] 清理引用集合以当前 head 的 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id` 为准；不得查询 revision `0025` 已删除的 `evidences` 表。
- [ ] 对象删除成功转 `DELETED`；暂时失败保持 `DELETING` 并可幂等重试。
- [ ] 增加共享文件、多个平台、绑定/清理竞态、平台删除、错误截止时间和对象已不存在测试。

验收映射：AC4、AC5、AC6、AC7。

## 5. 周期执行与可观测性

- [ ] 在 `backend/app/worker.py` 复用现有 Celery Beat，增加小时级清理任务。
- [ ] PostgreSQL 是候选与执行权威；Celery 消息不携带文件列表，Redis 不保存文件状态。
- [ ] 记录 selected/deleted/retry/failed 结构化结果和非敏感 file_id；后台任务不伪造审计 actor。
- [ ] 测试 Beat 注册、空批次、部分失败和重复运行幂等性。

验收映射：AC5、AC6。

## 6. 前端单候选 UX 与全局刷新

- [ ] 重新生成 `frontend/src/shared/api/schema.d.ts`，业务代码只使用生成类型。
- [ ] 在 `PlatformsPage.tsx` 的现有品牌区域实现页面本地候选状态：
  - 从当前表单 `website_url` 请求一张候选；
  - 预览、“使用此 Logo”“取消”；
  - 使用候选只写入待提交 `file_id`，既有保存按钮才创建/PATCH；
  - 旧外链只读展示并标记；
  - 删除“使用外部 URL”写入入口；
  - 保留 `DirectUpload` 和明确清空。
- [ ] 编辑旧外链平台且未操作 Logo 时省略 `logo`；清空发送 `null`；候选或上传发送 `UPLOAD`。
- [ ] 保存平台身份成功后统一失效平台列表、具体详情和 `queryKeys.contentTasks.all`。
- [ ] 更新配置页、内容任务页及共享 Avatar 相关测试，覆盖取消不写、确认后才随保存绑定、旧外链只读、手工上传复用和缓存刷新。

验收映射：AC3、AC7、AC8、AC9、AC11。

## 7. 权威文档与阶段边界

- [ ] 更新 `docs/GEO系统前后端技术与部署方案.md` 的 API、对象存储、Worker 和两阶段迁移说明。
- [ ] 更新 `docs/GEO多平台内容运营系统方案设计.md` 的平台品牌来源、人工确认和资源生命周期。
- [ ] 明确本阶段不删除 `logo_external_url`；后续任务必须先验证所有环境旧外链计数为零。
- [ ] 对新增/实质修改 Python 代码完成中文 Docstring、日志、异常和注释检查；不为明显代码增加机械注释。

## 8. 验证顺序

先运行最小检查：

```bash
uv run --project backend pytest \
  backend/tests/unit/test_platform_branding.py \
  backend/tests/unit/test_platform_logo_import.py \
  backend/tests/unit/test_platform_logo_cleanup.py

uv run --project backend pytest \
  backend/tests/integration/test_platform_logo_lifecycle.py

uv run --project backend pytest \
  backend/tests/integration/test_migrations.py -k platform_logo_lifecycle

npm --prefix frontend exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx
```

再运行跨层和质量门：

```bash
make contract-generate
make contract-check
make lint
make typecheck
make test-unit
uv run --project backend pytest backend/tests/integration
make build
```

- CI 测试不得访问真实 Icon Horse；真实服务仅做一次人工非阻塞 smoke，失败不能用固定成功路径替代。
- 若完整集成测试或构建超时，保留已完成的目标测试证据，并在交付说明中列出未运行项和剩余风险。

## 9. 风险文件与回滚点

- `contracts/openapi.yaml`、`contracts/database.md`：公共契约和数据生命周期权威。
- `backend/alembic/versions/0028_platform_logo_lifecycle.py`：状态机、历史数据初始化和不可逆删除门禁。
- `backend/app/services/platform_logo_files.py`：外部网络、图片验证、文件锁与清理共同边界。
- `backend/app/services/storage.py`、`backend/app/dev_storage.py`：生产 OSS 与开发存储一致性。
- `backend/app/services/content_planning.py`、`backend/app/services/platform_configuration.py`：平台创建/更新/删除事务。
- `frontend/src/features/configuration/PlatformsPage.tsx`：旧外链三态保存和候选本地状态。

停止 Beat 可以阻止新的删除声明，但不能恢复已经删除的对象。出现 `DELETING/DELETED` 后不得降级迁移；采用前滚修复或恢复 PostgreSQL 与 OSS 的一致备份。
