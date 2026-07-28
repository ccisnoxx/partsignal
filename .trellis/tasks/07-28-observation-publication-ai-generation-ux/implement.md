# 观测发布界面与可配置 AI 生成优化：实施计划

## 1. Contract and Migration

- [x] 更新 `contracts/database.md`，定义 Prompt 模板库、平台可空绑定、删除边界、v3 快照和 `0031` 迁移。
- [x] 更新 `contracts/openapi.yaml`：
  - 新增 Prompt 模板库 CRUD。
  - 平台创建/更新/投影改为模板绑定。
  - 生成选项返回 Prompt 身份与 revision。
  - 原始生成与自然化使用独立请求 Schema。
- [x] 新建 `0031` Alembic 迁移，确定性迁移旧 Prompt 并回绑平台；加入升级计数/哈希断言和有界降级门禁。
- [x] 更新 ORM、Pydantic Schema、OpenAPI 生成类型和 `migration_schema_v1.py` 之外的当前目标模型；历史迁移文件保持冻结。

## 2. Backend Configuration

- [x] 将 `PlatformPrompt` 改为可复用模板实体，给 `PlatformProfile` 增加可空外键。
- [x] 实现模板列表、创建、详情、revision 更新和受引用删除拒绝。
- [x] 平台创建/编辑校验并提交 Prompt 绑定，更新配置完整性、筛选、统计、导出和详情投影。
- [x] 更新管理员权限、审计动作、失败审计和错误码；删除旧平台所属 Prompt CRUD，不增加兼容路由。
- [x] 更新种子、测试工厂和直接构造 `PlatformPrompt` 的测试数据。

## 3. Backend Generation

- [x] `GenerationOptions` 返回当前绑定 Prompt 的 ID、名称、revision 和正文。
- [x] 原始生成请求携带确认的 Prompt ID/revision；自然化请求保持只含模型。
- [x] 新作业在幂等判断后锁定并校验平台绑定与 Prompt revision；配置变化返回 `PLATFORM_PROMPT_CHANGED`。
- [x] 新增 `content-markdown-v3` 快照并冻结 Prompt 身份；v2/v3 都可显式读取和按原快照重试。
- [x] 保持严格两消息、事实出站分级、模型/渠道启用校验和人工首稿边界不变。

## 4. Frontend Configuration and Content Tasks

- [x] 将 Prompt 管理页改为模板库：命名、Markdown 编辑、绑定平台影响、revision 冲突和删除边界。
- [x] 平台新增/编辑表单增加可清空 Prompt 选择；列表、详情、筛选、统计和提示改用绑定投影。
- [x] 内容任务 AI 入口改为 Modal，只读确认平台 Prompt 并选择可用模型；提交 Prompt ID/revision。
- [x] 配置过期时保留 Modal、显示明确错误并提供重新加载；成功后关闭并刷新作业。
- [x] 手工录入与自然化交互保持现状。

## 5. Observation and Table UI

- [x] 从观测列表、筛选、URL 状态和旧版详情移除推荐/引用展示，保留历史观测其他字段。
- [x] 恢复 Drawer 原生遮罩外部点击关闭、Escape 和关闭按钮。
- [x] 调整平台表现对比的 GEO 平台列宽、ellipsis、Tooltip 与局部滚动。
- [x] 调整发布记录内容标题和实际标题的宽度层级、ellipsis 与 Tooltip，保持固定操作列。

## 6. Documentation Consistency

- [x] 更新两份 GEO 设计文档和相关 Trellis 稳定规范，删除当前设计中的旧一对一 Prompt 所有权与端点描述。
- [x] 检查代码、数据库契约、OpenAPI、生成类型、测试和文档使用同一 Prompt 绑定语义。
- [x] 对新增或实质修改的 Python 模块、函数、异常和审计文本执行中文文档检查；不修改无关旧代码。

## 7. Required Validation

### 7.1 Backend and Contract

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_migrations.py -k "platform_prompt"
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -k "platform_prompt or generation_options or generation_job"
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_generation.py
make contract-check
make typecheck
```

定向后端测试必须覆盖：

- 旧 Prompt 一对一迁移、正文/revision/操作者/时间保留和不自动去重。
- 一份模板绑定多个平台、平台换绑/解绑、引用中删除拒绝和平台删除不级联模板。
- Prompt revision 冲突、名称冲突、管理员权限和安全审计。
- 生成弹窗确认后 Prompt 被修改、换绑或解绑时，新请求明确失败。
- v3 快照身份与两消息逐字一致；v2/v3 历史读取和原快照重试。
- 自然化与人工首稿不要求平台 Prompt 确认字段。

### 7.2 Frontend

```bash
npm --prefix frontend exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx
npm --prefix frontend run lint
```

前端测试必须覆盖：

- Prompt 模板 CRUD、共享影响提示、平台选择绑定和服务端删除冲突。
- AI Modal 的 Prompt 只读确认、模型必选、提交 payload、过期配置错误和手工入口不受影响。
- 旧推荐/引用字段消失、Drawer 外部关闭。
- 两张表的 ellipsis/Tooltip 与关键列宽契约。

### 7.3 Playwright CLI

使用项目 `playwright-cli` 做定向浏览器验收，不运行全量 E2E：

1. 打开历史观测，确认无推荐/引用列和筛选；点击 Drawer 遮罩关闭。
2. 在 1440、1024、768 宽度检查平台表现对比和发布记录长标题，无页面级横向滚动。
3. 创建两份 Prompt，为两个平台绑定同一份；编辑时确认影响列表，引用中删除被拒绝。
4. 打开内容任务 AI Modal，确认 Prompt、选择已启用模型并创建作业；修改 Prompt 后用旧确认提交得到配置冲突。
5. 检查 `console` 和 `requests`，不保留认证状态文件到 Git。

## 8. Optional Validation

以下检查只在定向验证发现共享回归，或发布前需要更高置信度时运行：

```bash
make test-unit
make test-integration
make build
make e2e
```

默认不运行全量套件，避免把时间花在与本任务无关的测试上。

## 9. 实施验证记录（2026-07-28）

- `make contract-check`、后端 mypy、前端 lint/typecheck 通过。
- 后端生成、平台配置与审计定向单元测试通过；前端五个相关页面的定向测试通过。
- `0031` 已在本地开发 PostgreSQL 从旧结构执行到 `head`，迁移计数和哈希断言通过。
- Playwright CLI 已验证观测字段与 Drawer、Prompt 模板库、平台绑定展示、AI 弹窗、洞察和发布列表；768/1024/桌面宽度无页面级横向溢出，控制台无错误。
- PostgreSQL 集成测试因当前未配置独立测试数据库而跳过，以真实开发库升级和定向单元测试替代；未运行可选全量测试、构建或 E2E。

## 10. Rollback Points

- `0031` 迁移测试未通过时不进入后端 API 改造。
- Prompt CRUD、平台绑定和生成确认边界未全部通过时不接前端。
- v2/v3 快照读取或重试出现不一致时停止，不通过可空字段或默认值掩盖。
- Playwright 发现页面级溢出或生成配置错配时只修正对应局部，不扩展为全站重构。
