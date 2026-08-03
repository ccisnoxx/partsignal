# 重新设计发布管理业务流程：实施计划

> 2026-08-03 用户已批准 `prd.md`、`design.md` 与本计划，任务已启动并完成代码实现；环境重置、提交和部署仍按下述边界单独执行。

## 0. 开始条件

- [x] 用户批准最新版 `prd.md`、`design.md` 和本实施计划。
- [x] 主工作目录位于 `main`，确认除本任务规划文件外没有无法归属的未提交改动。
- [x] 使用 `trellis-before-dev` 重新加载根目录、backend、frontend、contracts 和 docs 的适用规范。
- [x] 已确认本地隔离测试目标；开发与预发布环境重置仍须在执行前核对准确数据库，预发布先产生可恢复备份。

## 1. 权威文档与合同先行

- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md`：发布工作、首次核验完成边界、只读发布成果、发布后问题和修复回流。
- [x] 更新 `docs/architecture.md`：发布、GEO 与内容任务的所有权和跨模块依赖。
- [x] 重写 `contracts/database.md` 中发布迁移顺序、状态机、约束、GEO 文章身份、删除边界和新 revision。
- [x] 重写 `contracts/openapi.yaml`：新资源、显式命令、typed actions、错误响应和分页；删除旧 `PublicationRecord`、`PublicationAttention`、通用 command 与 DELETE 合同。
- [x] 更新 `.trellis/spec/backend/publication-workbench-guidelines.md`、`.trellis/spec/backend/database-guidelines.md` 及受影响的前端稳定规范，删除与旧状态机冲突的要求。
- [x] 运行 `make contract-generate`，只保留由 OpenAPI 生成的 `frontend/src/shared/api/schema.d.ts`。

停止点：OpenAPI、数据库合同和设计文档无法用同一组对象、状态和字段描述时，不进入迁移实现。

## 2. 数据库迁移与 ORM

- [x] 新建 `backend/alembic/versions/0034_publication_workflow_redesign.py`，不修改历史 revision。
- [x] 在迁移开头冻结旧表引用清单并检查非空旧发布/GEO 依赖；存在数据时汇总阻断并以 PostgreSQL `55000` 回滚。
- [x] 删除旧发布表、触发器和 revision `0030` 运行时删除门禁；保留 `platform_accounts`。
- [x] 创建 `publication_works`、`publication_work_events`、`publication_verifications`、`published_articles`、`published_content_issues` 和新的 `publication_attachments`。
- [x] 建立身份、部分唯一、非空说明、revision、终态冻结、追加式历史和完成工作/文章一对一约束。
- [x] 将 `content_tasks.source_publication_attention_id` 替换为 `source_published_content_issue_id`，保持唯一、不可改绑和 `RESTRICT`。
- [x] 将 GEO 关系的发布外键改为 `published_article_id`，更新产品归属、可观测资格和追加式门禁。
- [x] 更新通用文件引用检查，使发布证据只引用 `publication_attachments.publication_work_id`。
- [x] 重写 `backend/app/models/publication.py`，并调整 `content.py`、GEO 模型和模型导出；完成 touched-scope 中文文档检查。
- [x] 增加迁移测试：空库到 head、旧数据明确阻断、身份与状态约束、直接非法写入、不可安全 downgrade。

停止点：如果核心一对一完成约束、同平台内容唯一性或 GEO 资格只能靠前端/服务约定而无法在 PostgreSQL 保护，先回到设计评审。

## 3. 后端发布工作流

- [x] 在现有 `backend/app/schemas/publication.py` 定义严格请求/响应模型；删除多可选字段的 `PublicationCommand`。
- [x] 在现有 `backend/app/services/publication.py` 实现开始工作、更新准备、平台处理中、登记结果、核验、关闭、打开问题、修复任务和解决问题。
- [x] 在 `publication_queries.py` 实现就绪项、工作、文章、问题、摘要和批量动作投影；不得逐行查询或在 serializer 中访问数据库。
- [x] 在 `backend/app/routers/publication.py` 替换旧路由，保持权限、CSRF、结构化错误和关键失败审计。
- [x] 创建工作使用请求键 advisory lock；发布身份使用 `platform_profile_id + content_hash` advisory lock；各命令锁目标行并校验 `expected_revision`。
- [x] 核验失败只追加快照并保持待处理；核验成功原子创建文章和完成内容任务；关闭原子取消内容任务。
- [x] 平台账号引用门禁改为 `PublicationWork`，不改变账号历史身份。
- [x] 删除旧 transition table、attention 创建、发布记录 DELETE、通用 command 解析和所有兼容分支。
- [x] 重写发布集成测试，覆盖立即发布、平台处理中、请求键、身份、结果修正、连续失败、失败后复核成功、显式关闭、权限、revision、附件和审计。

## 4. GEO、修复、总览与共享门禁

- [x] 修改 `backend/app/services/geo_observation.py`：候选、完整集合锁和数据库写入只接受合格 `PublishedArticle`。
- [x] 问题打开与 GEO 创建锁同一文章，覆盖并发竞态；`OPEN` 或已 `RETIRED` 文章不进入新观测。
- [x] 修复上下文和修复任务继承原文章的产品与具体平台，来源字段只写一次；问题状态不从任务状态推断。
- [x] 更新内容任务删除保护：任一 `PublicationWork` 或非空修复来源都阻断删除，删除旧 attention 判断。
- [x] 更新总览和发布摘要查询：待开始、进行中、待核验、需处理、开放问题五个真实口径。
- [x] 更新文件清理、平台/账号引用统计和审计投影中所有旧 `PublicationRecord` 引用。
- [x] 更新 GEO、内容任务删除、总览和平台账号的集成/单元测试。

## 5. 前端发布工作台

- [x] 保持 `/publications` 稳定入口，将页面改为“发布工作 / 发布成果 / 内容问题”三类用户任务。
- [x] “发布工作”默认显示待开始与进行中，支持查看已关闭；优先展示 `ACTION_REQUIRED` 和待核验工作。
- [x] 详情 Drawer 分别展示工作事件与核验历史、只读文章结果、发布后问题；URL 是 Tab、筛选、分页和选中对象的唯一导航状态。
- [x] 所有命令入口只消费资源自己的 `available_actions` 和 `primary_action`；前端不根据 status、角色或是否有 URL 推断资格。
- [x] 实现严格的开始发布、登记结果、首次核验、关闭工作、打开/解决问题和创建修复任务表单；服务端失败原样展示，不增加补默认值或成功 fallback。
- [x] 删除旧 `PublicationAttentionPage`、旧详情/修复路由及不再被新工作台使用的组件和手写 publication 类型。
- [x] 更新 `StatusTag` 中文状态、总览快捷入口、GEO 文章展示和相关 query invalidation。
- [x] 复用现有 `PageHeader`、`MetricTile`、`TableRegion`、Ant Design 和主题 Token；不增加视觉依赖、全局 Store、页面壳或重复状态组件。
- [x] 重写 `PublicationsPage.test.tsx`，同步 Dashboard、GEO 页面和路由测试；覆盖服务端动作投影、URL 恢复、更多菜单、确认链、失败后继续待处理和移动端 Drawer。

## 6. 清除旧设计

- [x] 使用 `rg` 确认运行时代码、合同、生成类型和测试中不存在 `PublicationRecord`、`PublicationStatusEvent`、`PublicationAttention`、旧 command 路径和旧 Tab。
- [x] 删除只服务旧状态机的查询、Schema、状态标签、错误码、测试 fixture 和文档段落，不保留 alias、wrapper、双写或兼容读取。
- [x] 检查 diff，确认没有第二个当前状态、从前端重算权限、隐藏 fallback、无来源可选字段、无业务价值抽象或未说明行为变化。
- [x] 完成 touched-scope 中文注释、docstring、日志、异常和开发者输出检查；只为非显然边界补充说明。

## 7. 必需验证

### 7.1 合同、静态检查与构建

```bash
make contract-check
make lint
make typecheck
make build
```

### 7.2 后端与数据库

```bash
uv run --project backend pytest backend/tests/unit
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test
```

新流程测试位于 `backend/tests/integration/test_publication_workflow.py`，迁移测试位于 `backend/tests/integration/test_migrations.py`，均由 `backend-test` 的完整 PostgreSQL 集成回归执行。数据库验证不得以 SQLite 替代 advisory lock、行锁、部分索引、约束触发器或 `55000`。

### 7.3 前端组件

```bash
npx vitest run \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/dashboard/DashboardPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx
```

该命令从 `frontend/` 工作目录执行。记录实际通过、失败、跳过和耗时，不修改测试来掩盖失败。

### 7.4 真实浏览器闭环

```bash
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts \
  --project=e2e --grep '批准事实到人工发布和 GEO 观测保持完整追溯'
```

使用项目 `playwright-cli` 技能运行隔离浏览器闭环，真实调用 API 并验证：

- 已批准内容开始发布、平台处理中、结果登记和首次核验成功；
- 发布成果只读，打开内容问题后退出新 GEO 候选；
- 问题创建修复任务、显式解决和新内容重新发布互不代替；
- console、页面异常和失败请求无本任务回归。

首次核验失败后继续待办、重复复核和带原因关闭由 PostgreSQL 集成测试与前端组件测试覆盖。375/768/1024/1440px、实际 200% 缩放、浅/深/system、键盘和焦点恢复属于可选完整视觉回归，本轮未重复执行跨页视觉套件。

### 7.5 实际结果（2026-08-03）

- [x] `make contract-check`、`make lint`、`make typecheck`、`make build` 全部通过。
- [x] 后端单元测试 141 项通过；PostgreSQL 集成测试 50 项通过，用时 91.02 秒。
- [x] 受影响前端组件测试 22 项通过；前端全量回归先通过 170 项并发现 1 个旧审计动作 fixture，改为新 `publication_work.created` 后该文件 4 项通过。
- [x] 隔离 Playwright 共享数据准备与主闭环 2 项通过，用时 50.2 秒；临时数据库和存储均确认删除，Compose 前端已恢复。
- [x] `trellis-check` 已核对跨层数据流、动作投影、旧名清理、规范同步和 diff 基础质量。

## 8. 环境重置与上线验证

- [x] 先在隔离测试数据库证明：非空旧数据使 `0034` 明确失败，空库可完整升级到 head。
- [ ] 本地开发环境核对 Compose 项目和卷名后重建数据库卷，运行迁移、`seed-demo` 和真实 E2E 数据准备。
- [ ] 预发布环境停止写入、记录准确数据库、运行 `deploy/scripts/backup.sh` 并验证备份存在后，再按已批准窗口重建数据库。
- [ ] 预发布从空库迁移到 head、seed 账号、部署应用，执行登录、发布闭环、GEO 候选和问题回流 smoke。
- [x] 不自动推送，不在未核对目标时运行广泛删除命令，不把重置封装成日常管理 API。

## 9. 可选完整回归

核心必需验证通过后，时间允许再运行：

```bash
make verify
```

完整回归失败只修复有证据由本任务引入且属于本任务范围的问题；既有、环境或不相关失败单独记录，不扩大任务。

## 10. 完成条件

- [x] PRD 的 AC1–AC10 均有对应自动化或真实浏览器证据。
- [ ] 新空库、开发重置库和预发布重置库描述同一 head schema。
- [x] 代码、OpenAPI、数据库合同、权威业务文档、Trellis 规范和前端生成类型一致。
- [x] 旧状态机、旧 API、旧页面和旧类型在运行时不可达，且没有兼容双轨。
- [x] 完成 `trellis-check` 质量门禁并向用户汇报验证结果、剩余风险和文档更新。
- [ ] 提交前给出精确 commit plan 并取得用户确认；不自动 push。
