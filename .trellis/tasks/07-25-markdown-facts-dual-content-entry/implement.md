# 实施计划

## 1. 契约与迁移设计

- [x] 完整复读 `prd.md`、`design.md`、`research/current-flow.md` 和 implement 上下文规范，核对工作区现有用户改动。
- [x] 先修改 `contracts/database.md`：定义产品事实 Markdown、事实版本字段、内容任务直接平台外键、删表顺序和历史快照边界。
- [x] 修改 `contracts/openapi.yaml`：删除结构化事实、任务要求、任务 Prompt、平台规则版本接口/类型，增加手动首稿命令和 v2 生成快照。
- [x] 新增一个 Alembic 前向迁移，按设计完成确定性事实渲染、保守分级、任务平台回填、约束替换和删表；旧迁移不改。
- [x] 保持 `backend/app/migration_schema_v1.py` 和历史迁移冻结，用新 revision、ORM 与迁移测试验证空库到 head 的目标 Schema。

## 2. 后端领域收敛

- [x] 修改产品事实 ORM、Schema、服务、投影和审核上下文：工作区只保存 Markdown/分级/修订，版本冻结正文，不再读取结构化子表或证据状态。
- [x] 修改内容任务 ORM、Schema、创建/列表/详情服务：请求只含产品、批准事实和 `platform_profile_id`；Prompt 门禁从任务创建移除。
- [x] 删除 `PlatformProfileVersion` ORM、PlatformRules Schema/路由/服务/影响分析，新查询统一从 `PlatformProfile` 读取。
- [x] 修改发布查询、关注修复、完整性检查和投影，删除规则版本连接与规则版本响应字段。
- [x] 保留历史平台规则审计记录的只读展示，移除所有新规则审计写入。

## 3. AI 与人工首稿

- [x] 删除固定 system 前缀和工程师/事实 JSON/任务要求拼装；创建 `content-markdown-v2` 快照。
- [x] 在 OpenAI-compatible 适配器边界保证实际请求只有两条消息，正文逐字等于平台 Prompt 与事实版本 Markdown。
- [x] 新 v2 作业和重试只使用冻结快照；旧 `chat-json-v1` 仅供历史读取，迁移前拒绝未结束旧作业，禁止创建旧契约重试。
- [x] 移除平台规则、任务字段和结构化事实质量检查，保留严格 JSON、非空正文、Markdown 安全、哈希和状态规则。
- [x] 调整自然化快照，只读取冻结事实 Markdown 和来源内容，不读取规则版本或已删除任务字段。
- [x] 新增任务级手动首稿命令，复用现有版本创建、哈希、版本号和审计逻辑；后续人工修订不要求 AI lineage。

## 4. 前端与生成类型

- [x] 运行 `npm --prefix frontend run api:generate`，只从 OpenAPI 生成 `schema.d.ts`。
- [x] 把产品事实页改为现有组件风格的 Markdown 编辑、预览、分级和版本审核工作台。
- [x] 把内容任务创建收敛为产品、批准事实、平台；详情增加 AI 模型生成与手动首稿两个入口。
- [x] 删除任务 Prompt、受众、角度、转化、格式、长度、官网 URL、规则版本和平台类型快照的表单、筛选和展示。
- [x] 删除平台规则路由、导航、预取、页面、组件、API 查询和相应测试，不保留隐藏入口。
- [x] 修改发布修复和发布投影 UI，统一使用 `platform_profile_id`；AI/人工内容继续进入现有编辑审核页。

## 5. 目标测试

- [x] 后端事实测试覆盖原样保存、乐观锁、空正文门禁、版本冻结、保守分级和批准不可变。
- [x] 后端任务/生成测试覆盖三字段创建、无 Prompt 可手工、AI Prompt 门禁、PUBLIC 门禁、两消息逐字相等、严格响应失败和 v2 重试快照不变。
- [x] 后端人工内容测试覆盖空任务首稿、空 lineage、后续修订、审核唯一批准版本和人工发布。
- [x] 迁移测试覆盖旧结构化事实确定性 Markdown、未知分级 `RESTRICTED`、任务平台回填、旧历史引用可读和目标 Schema 无规则表。
- [x] 前端 `ProductFactsPage`、`ContentTasksPage`、`ContentEditorPage`、`PublicationsPage` 与 App 路由/导航目标测试更新。
- [x] Playwright `mvp-flow.spec.ts` 覆盖 Markdown 事实、直接平台任务、AI/手工首稿、审核和人工发布；删除平台规则页面步骤。

## 6. 权威文档与稳定规范

- [x] 更新 `docs/architecture.md`、`docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md`，只描述最终实现。
- [x] 用 `trellis-update-spec` 更新受影响的数据库、AI 配置和前端稳定规范，删除规则版本和旧任务字段约束。
- [x] 对新增或实质修改的 Python/TypeScript 责任边界、错误、日志和注释做中文文档检查，不给显然代码添加机械注释。

## 7. 验证与检查

- [x] 先运行最小目标测试：
  - `uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py`
  - `uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_publication_review_closure.py backend/tests/integration/test_migrations.py`
  - `npm --prefix frontend exec vitest run -- src/features/product-facts/ProductFactsPage.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx src/features/content-editor/ContentEditorPage.test.tsx src/features/publications/PublicationsPage.test.tsx`
- [x] 运行 `make contract-check`，确认 OpenAPI 和生成类型一致。
- [x] 运行 `make lint`、`make typecheck`、`make test-unit`。
- [x] 在开发基础设施可用时运行 `make test-integration` 和目标 Playwright 主流程；若环境阻断，记录实际错误与替代验证。
- [x] 运行 `git diff --check`，检查没有兼容字段、第二套规则来源、隐藏回退、无关改动或未更新文档。
- [x] 使用 `trellis-check` 做契约、数据库、跨层数据流和测试独立检查，修复高/中严重级问题。

## 8. 交付边界

- [x] 规划获用户明确批准后才执行 `task.py start` 并写产品代码。
- [x] 不自动推送、部署或更新生产数据。
- [x] 提交前列出精确 commit plan 并再次取得用户确认；只提交本任务文件，不带入现有视觉任务和日志。
