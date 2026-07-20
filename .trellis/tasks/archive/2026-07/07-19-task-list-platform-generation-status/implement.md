# 实施计划

## 1. 契约与数据库

- [x] 在 `contracts/openapi.yaml` 增加平台 Logo 输入/输出联合类型、`website_url`、`PLATFORM_LOGO` 文件类别和 `ContentTaskListItem` 聚合类型。
- [x] 新增 Alembic 0020 迁移：平台品牌字段、文件外键、Logo 来源互斥约束和有数据时拒绝降级。
- [x] 同步运行时 ORM 与 `contracts/database.md`，确认 0001–0008 的 `migration_schema_v1.py` 冻结快照保持不变。
- [x] 运行契约检查并重新生成 `frontend/src/shared/api/schema.d.ts`。

## 2. 后端平台品牌

- [x] 扩展平台 Pydantic Schema，使用 `source` 判别联合表达上传或外部 Logo。
- [x] 扩展文件上传类别、2 MiB 限制和 PNG/JPEG/WebP/ICO 类型白名单。
- [x] 在平台创建/更新服务校验 `VERIFIED + PUBLIC + PLATFORM_LOGO`，并持久化唯一 Logo 来源及官网。
- [x] 扩展单个平台和平台列表投影，批量解析上传 Logo 文件并签发读取 URL。
- [x] 补充平台创建、更新、清空、互斥输入、错误文件类别/状态及上传类型测试。

## 3. 后端任务列表聚合

- [x] 新增列表专用批量投影，批量读取产品、具体平台、Logo、最新 `GENERATE` 和进行中发布任务。
- [x] 保持 `ContentTaskOut` 详情投影不变；列表改用 `ContentTaskListItem`。
- [x] 覆盖无生成作业、只有 HUMANIZE、多个 GENERATE、时间相同时 ID 稳定排序和各作业状态。
- [x] 增加查询数量回归，证明任务数量增加不会带来线性查询增长。

## 4. 前端平台管理

- [x] 复用 `DirectUpload` 支持 accept 属性和平台 Logo 上传提示。
- [x] 创建/编辑平台支持 Logo 来源三态与平台官网，提交生成类型直接约束的 payload。
- [x] 平台列表显示 Logo/通用回退、名称和官网；外部图片不发送 Referrer。
- [x] 更新配置页组件测试，覆盖外部 URL、上传文件、清空和服务器错误反馈。

## 5. 前端内容任务台

- [x] 表格改为产品、单一目标平台、任务状态、AI 生成状态、创建时间、快捷操作。
- [x] 内容角度保留为产品列次级信息；搜索覆盖产品和平台。
- [x] 为无生成作业提供中性标签，其余状态复用 `StatusTag` 的真实枚举标签与语义色。
- [x] 保持现有筛选、指标、URL 分页、创建 Modal、任务详情和响应式局部滚动。
- [x] 更新任务页测试，覆盖字段、状态色类、搜索、分页和不发送额外请求。

## 6. 验证顺序

1. `make contract-check`
2. 后端新增/相关目标测试；可用时执行迁移升级/降级测试。
3. `uv run --project backend ruff check backend`
4. `uv run --project backend mypy backend/app`
5. `uv run --project backend pytest`
6. `npm --prefix frontend test -- src/features/configuration/ConfigurationPages.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx`
7. `npm --prefix frontend run api:check`
8. `npm --prefix frontend run lint`
9. `npm --prefix frontend run typecheck`
10. `npm --prefix frontend run build`
11. 使用项目 `playwright-cli` 验收平台创建/编辑、上传/外链 Logo、任务列表六列、浅色/深色/跟随系统以及 1536、1024、375 宽度。

## 7. 风险与回滚点

- 对象存储不可用时，外部 URL 路径和非上传后端测试仍可验证；上传集成限制必须如实记录。
- 上传成功后取消平台表单会留下未引用的 VERIFIED 文件；没有现成安全删除机制，本任务不自动删除。
- 外部 Logo 可在后续失效，前端必须显示平台首字回退，不把加载失败写回业务状态。
- 若生产已写入品牌资料，0020 降级会拒绝；使用向前修复，避免删除用户配置。
- 修改前后均检查任务详情、审核、发布和创建接口仍使用原 `ContentTask` 契约。

## 8. 验证记录（2026-07-19）

- `make contract-check` 与 `npm --prefix frontend run api:check` 通过，生成类型与冻结 OpenAPI 一致。
- 后端单元测试、Ruff、Mypy 和 Alembic 单 head 检查通过；0020 迁移与列表 PostgreSQL 集成用例已收集，但当前未配置 `PARTSIGNAL_TEST_DATABASE_URL`，按项目规则显式跳过，未用 SQLite 替代。
- 相关前端测试共 22 项通过，lint、typecheck、build 通过；构建只保留既有约 894 kB 主 chunk 提示。
- `playwright-cli` 使用真实 `/tasks` 路由和可重复接口响应验收 1536×1024、1024 与 375×812，覆盖浅色、深色、跟随系统、搜索、状态筛选、分页恢复、创建任务 Modal、加载、空、错误与重试、键盘访问和页面无整体横向溢出。
- 平台管理浏览器冒烟确认外部 URL 与上传文件两种 Logo 分支；本地未连接真实对象存储，因此未执行真实 Logo 文件 PUT，上传意图的类型、体积、状态、类别和公开级别由后端单元测试覆盖。
