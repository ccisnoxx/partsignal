# Research: V1 frontend artifact 与 candidate backend API 兼容性

- Query: 审计固定 V1 frontend artifact `mvp-20260806-195740-afb1b8c82f40` 是否已经有充分证据可在数据库前进到 `0043_geo_platform_identity` 后，单独作为 UI 接回始终运行的 V2 candidate backend；区分实证与推断，并给出最小 SAFE Gate。
- Scope: internal
- Date: 2026-08-25

## 主代理综合判定

本文第 1–6 节对“精确历史镜像是否已被证明兼容”的 `BLOCKED`
判定保持有效，但它不是本 Task 的最终方案。进一步对精确历史 commit
`afb1b8c82f408f18cf16c5bde094d5eb59768899` 与当前候选的静态差异表明，该历史 V1
artifact 已经不只是“缺证据”，而是已知不能作为完整可操作 V1 UI 的回退目标：

- 历史 V1 UI 删除 AI Channel、AI Model、Platform Type、Platform Profile、
  Content Task、Product、Platform Account 和 User 时未提交当前必需的
  `expected_revision`/`expected_channel_revision`；模型测试、模型发现和用户重置密码
  也缺少当前必需的 revision body。证据是
  `git diff afb1b8c82f40..HEAD -- frontend/src`，对应当前实现位于
  `frontend/src/features/configuration/AIChannelDetailPage.tsx`、
  `AIChannelsPage.tsx`、`PlatformTypesPage.tsx`、`PlatformsPage.tsx`、
  `frontend/src/features/content-tasks/ContentTasksPage.tsx`、
  `frontend/src/features/product-facts/ProductsPage.tsx`、
  `frontend/src/features/settings/SettingsPage.tsx` 和
  `frontend/src/features/users/UserManagementPage.tsx`。
- 这些不是可以忽略的额外响应字段，而是当前命令并发合同。历史页面的相关
  mutation 会被 candidate API 拒绝，因此不得把
  `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40` 冒充为已验证的回退 artifact。

本 Task 的最小可行方案是：从最终固定 candidate release 中仍保留的
`frontend/` 构建一个 **candidate-aligned V1 UI artifact**，用
`partsignal-frontend-v1:<candidate-release>` 与冻结 image ID 识别。该源码树与 Phase 8
全门禁候选 `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403` 之间，`frontend/`、
`backend/`、`contracts/` 及 `deploy/scripts/e2e-local.sh` 均无差异；当时已观测
V1 E2E `52 passed`、V1 unit `205 passed`、V1 visual `24 passed` 且 production build 通过。
因此新 artifact 是“已与 candidate API/head DB 配对验证的现行 V1 UI”的冻结镜像，
不是旧 backend 兼容层。

这一选择使本 Task 的总体方案可继续设计，但保留两个硬停止条件：

1. 若候选固定前 `frontend/`、candidate API/DB 合同或上述门禁基线发生新变化，必须重跑相关
   V1 兼容验证，不得继承过期结果。
2. 未来 staging activation 必须在 migration 前完成 V1/V2 两个镜像的构建、tag 和
   image ID 冻结；任一 artifact 不存在或身份不匹配就停止激活。

## Findings

### 1. 历史 artifact 结论

针对历史镜像的审计结论必须是 **BLOCKED（兼容证据不足）**，且主代理补充差异证据后已确认存在实际 API 漂移；这不等于“任何 UI-only rollback 都不可能”。

方案在责任边界上成立的关键前提已经有强证据：`0043` 要求的
`publication_works.platform_profile_id_snapshot` 不是 frontend 请求字段，而是 candidate backend
从已锁定的 Platform Profile 写入的数据库快照。公开创建请求仍严格只有
`content_version_id` 与 `platform_account_id`（`backend/app/schemas/publication.py:142-145`、
`contracts/openapi.yaml:5871-5886`）；candidate service 在创建行时写入
`platform_profile_id_snapshot=profile.id`（`backend/app/services/publication.py:517-523`）。因此**不需要也不允许**
给 V1 frontend 或公开 API 增加猜测性兼容字段。

但现有门禁没有把固定历史 artifact 与 candidate backend 配对：它构建并运行候选提交中的当前
`frontend/` 源码，而不是加载 `mvp-20260806-195740-afb1b8c82f40` 的不可变镜像。当前本机 Docker
也没有该 tag（只读 `docker image inspect` 返回 `No such image`）。在 exact artifact 的 endpoint、query/header、
request/response 字段与错误分支尚未静态对账、且 exact artifact 尚未在 `0043` 隔离栈上运行前，不能把
“当前 V1 源码通过”外推为“历史 V1 artifact 可安全回退”。

### 2. 固定 V1 artifact 已确认的事实

- 归档盘点确认 release=`mvp-20260806-195740-afb1b8c82f40`、commit=
  `afb1b8c82f408f18cf16c5bde094d5eb59768899`，其 release Compose 使用
  `context: ../frontend`（`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:98-102`）。
- 已观察的精确 frontend tag 为
  `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40`，image ID 为
  `sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec`
  （同文件 `:102`）。
- 该 release 被观察到健康运行时，API/worker/scheduler 也使用同一旧 release，数据库 revision 为
  `0040_content_draft_management`（同文件 `:102,106`）。这只证明 **V1 UI + V1 backend + 0040**，
  不证明 **V1 UI artifact + candidate backend + 0043**。
- 归档任务已经正确否定整栈回滚：候选会执行 `0041`、`0042`、`0043`，旧 backend 不写 snapshot，
  所以旧整栈命令不得执行（同文件 `:108-110`）。该结论不自动否定 UI-only 回退。

### 3. 现有 V1 E2E 实际证明了什么

现有根 E2E 的确在同一隔离生命周期中把**当前 V1 源码**接到**当前 candidate backend**：

1. runner 先把临时数据库迁移到 `head`（`deploy/scripts/e2e-local.sh:87-96`）；
2. 从当前工作树构建 V1 和 V2（同文件 `:93-96`）；
3. 启动当前 `app.main:app`、worker、scheduler 与 fake services（同文件 `:101-115`）；
4. 启动当前 `frontend/` 的 Vite dev server 5173 和当前 build 的 preview 4173（同文件 `:116-123`）；
5. 先跑 V2 real-stack，再跑整个 V1 Playwright suite（同文件 `:159-180`）。

P9.1 的历史门禁记录 V1 E2E `52 passed`（`docs/frontend-v2/08-testing-quality-and-acceptance.md:414-416`；
相同候选证据见 `docs/frontend-v2/07-migration-plan.md:545-550`）。这提供了高价值证据：candidate backend
仍兼容候选提交中当前维护的 V1 UI/API 调用面。

它不能证明固定历史 artifact，原因有三项：

- V1 runner 每次执行 `npm --prefix frontend run build`，并启动当前源码 Vite；没有拉取或启动历史 tag
  （`deploy/scripts/e2e-local.sh:93-95,116-120`）。
- V1 Playwright 默认 base URL 是 5173（`frontend/playwright.config.ts:32-35`）；runner 没有设置
  `PARTSIGNAL_E2E_BASE_URL`，只设置了 `PARTSIGNAL_E2E_PRODUCTION_BASE_URL=4173`
  （`deploy/scripts/e2e-local.sh:177-180`）。因此大部分 52 项运行的是当前源码 dev server，不是 production image。
- 唯一显式使用 4173 的 Trusted Types 场景虽然加载当前 production preview，但把 Auth、Product 与 Facts API
  全部用 `page.route` fixture 替代（`frontend/tests/e2e/trusted-types.spec.ts:7-8,33-99`），不证明其与
  candidate backend 的真实响应兼容。

此外，后续任务明确修改过 V1 E2E 以对齐新合同/locator（`docs/frontend-v2/07-migration-plan.md:387`）。
因此“当前测试源码通过”不能代替“旧 release 内实际 JS 与 current API 合同相容”。

### 4. 已有 endpoint / field 实证分层

| 调用面 | 现有实证 | 精确边界 |
| --- | --- | --- |
| Auth、Users、Audit 与权限 | 当前 V1 `mvp-flow.spec.ts` 真实登录、改密、Users/Audit 与服务端 403；测试入口见 `frontend/tests/e2e/mvp-flow.spec.ts:40-236` | 当前 V1 源码 + candidate backend；不是固定 artifact |
| Product、Fact、Content 主流程 | 当前 V1 第二条 MVP flow 从 Product UI、Fact UI、Content UI 进入真实 API；入口和代表流程见同文件 `:284-375,698-754` | 当前 V1 源码 + candidate backend；部分 setup/decision 使用 `page.request`，不是每一步都由 UI 发起 |
| AI Channel 管理 | 当前 V1 suite 包含真实管理闭环和 ENGINEER 拒绝；测试入口见 `frontend/tests/e2e/ai-channel-management.spec.ts:138,570` | 当前 V1 源码 + candidate backend；未加载旧 image |
| `POST /api/v1/publication-works` 请求 | 当前 V1 real-stack E2E 以 `Idempotency-Key`、CSRF 和仅含两个 UUID 的 body 成功创建工作（`frontend/tests/e2e/mvp-flow.spec.ts:756-763`） | **真实 candidate backend/0043 请求形状证据，但请求由 Playwright API 发出，不是 V1 页面点击发出** |
| 当前 V1 页面创建发布工作的 body | 当前页面实现只发送两个 UUID（`frontend/src/features/publications/PublicationsPage.tsx:219-228`）；component test 精确断言同一 body（`frontend/src/features/publications/PublicationsPage.test.tsx:398-418`） | 当前源码的实现/unit 证据；不能证明历史 artifact 包含相同 bundle |
| Publication UI 后续 lifecycle | 工作由 API 创建后，当前 V1 UI 真实完成换版后结果登记与最终核验（`frontend/tests/e2e/mvp-flow.spec.ts:795-856`），并读取成果详情（`:860-890`） | 当前 V1 源码 + candidate backend；缺少“从旧 artifact UI 点击开始发布”的端到端证据 |
| GEO list/create/detail/correction | 当前 V1 UI 真实打开列表、创建人工观测、读取详情并更正（`frontend/tests/e2e/mvp-flow.spec.ts:910-1029`） | 当前 V1 源码 + candidate backend；不是固定 artifact |
| `platform_profile_id_snapshot` | `0043` 的 BEFORE INSERT trigger 拒绝 null/不一致值（`backend/alembic/versions/0043_geo_insight_platform_identity.py:136-151`）；candidate service 写 profile ID（`backend/app/services/publication.py:517-523`） | 服务端/数据库实证；frontend 不应看到或发送此字段 |
| candidate public create schema | Pydantic 与 OpenAPI 均只声明 `content_version_id`、`platform_account_id`（`backend/app/schemas/publication.py:142-145`、`contracts/openapi.yaml:5871-5886`） | 强合同证据；还需证明 exact artifact 确实使用该旧形状 |
| exact artifact 的全部 response 字段/枚举/错误码消费 | 无可执行 artifact 或静态消费矩阵 | **未证明** |

### 5. 可以支持兼容性的静态证据，但仍只是推断

- `0041` 只给 `content_tasks` 增加 `updated_at` 与索引
  （`backend/alembic/versions/0041_content_task_list.py:13-30`）；`0042` 只给 `content_versions` 增加可空
  `updated_at`（`backend/alembic/versions/0042_content_version_detail.py:13-23`）。二者没有删除旧表/列。
- `0043` 增加 nullable snapshot、确定性回填和 INSERT/UPDATE guard；公开 create schema 未扩字段。故从 migration
  形状看，UI-only rollback 比旧 backend rollback 风险小得多。
- Frontend V2 路线文档多次保留 V1 合同：Fact Version 旧调用保持不变
  （`docs/frontend-v2/07-migration-plan.md:354`）；Content Task list 省略分页参数时仍返回 V1 完整集合（`:360`）；
  GEO 旧 collection/POST 保持兼容（`:426`）；Query Topic 完整列表继续供 V1 使用（`:430`）。
- 当前 V1 generated client、unit、typecheck 与 52 项 E2E 持续通过，说明项目在实现新 read model 时有维护 V1
  兼容的实际机制。

这些证据能把方案提升为“值得做 exact artifact 验证”，不能把 Gate 直接提升为 SAFE。它们没有覆盖历史 bundle
实际读取的 response required fields、未知 enum/action token、query 默认值、错误 envelope 与历史页面路由行为。

### 6. 若仍使用历史 artifact 的最小 SAFE 验证

不需要新 deployment framework，也不应给 backend 增兼容层。最小充分 Gate 是：

1. **冻结 exact artifact。** 取得并核对
   `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40` 的 image ID 必须为
   `sha256:9c1c346caf8710fe33e89eae995b9ff646d1460cef6e9cb83dbd81009d8668ec`；没有 exact image 或可验证的
   等价导出时停止，不能用当前 `frontend/` rebuild 冒充。
2. **静态消费矩阵。** 从 release commit/source map 或 exact bundle 只读提取所有真实 API method/path、query/header、
   request body、读取的 response 字段/enum/error code，与 candidate OpenAPI/runtime 对账。任何 endpoint 删除、required
   response 字段缺失、enum 语义改变或错误 envelope 不一致均 BLOCKED；额外 response 字段本身不构成 blocker。
3. **隔离 `0043` 配对。** 使用现有 PostgreSQL/Redis/API/worker/scheduler/fake-oss E2E 生命周期，把数据库迁移到
   current head；API/worker/scheduler 始终来自 candidate。只把同源入口的 frontend 指向 exact V1 image，禁止启动旧
   backend，禁止 downgrade。
4. **复用现有 V1 Playwright 业务流。** 当前 runner 固定启动当前 V1 source，因此必须用最小参数/override 让既有
   suite 指向 exact image；不复制 52 项测试、不新建编排。至少必须真实覆盖登录、Workbench、Product、Content、
   Publication、GEO、Configuration、Users/Audit 的代表页面及 direct/refresh，并保持 console/page/request failure 为零。
   由于这是回退整套 UI 的合同，若 exact image 可用，运行现有完整 V1 suite 比另写一组缩减 smoke 更小、更可信。
5. **锁定 0043 的唯一写风险。** 测试必须从 exact V1 UI 点击“开始发布”，捕获请求仅有两个 UUID，随后在数据库断言
   新行 `platform_profile_id_snapshot = platform_profile_id`。这一步不能继续用 `page.request` 代替 UI，也不能要求
   frontend 发送 snapshot。
6. **SAFE 判定。** 上述全部通过后，才可声明 `V1 frontend artifact + candidate backend + 0043 = SAFE`。只要 exact
   image 不可得、静态矩阵不完整、UI 发不出当前合同请求、任一核心页面/API 失败或 snapshot 不一致，就保持 BLOCKED；
   不增加 fallback、旧字段、兼容 alias 或旧 backend。

在本 Task 明确禁止 SSH/实际 staging 操作的边界内，如果 exact image 仅存在于 Hostdzire 本机 Docker，则当前仓库任务
无法完成第 1、3、4、5 项的运行证据；应将本 Task判为 BLOCKED 并记录“缺 exact artifact 的本地/隔离可执行来源”，
而不是用当前源码 E2E 代替。

## Files Found

- `.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md` — exact V1 release/tag/image、0040→0043 差异与旧 backend 不兼容的现场证据。
- `.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/design.md` — 原整栈 rollback 前置与 BLOCKED 判据。
- `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-9-staging-integration/{prd,design,implement}.md` — P9.1 staging owner、V1 保留与旧回滚假设。
- `deploy/scripts/e2e-local.sh` — 当前 V1/V2 与 candidate backend 的隔离真实栈编排。
- `frontend/playwright.config.ts`、`frontend/tests/e2e/*.spec.ts` — 当前 V1 测试的真实 base URL、production preview 与 mock/real-stack边界。
- `frontend/src/features/publications/PublicationsPage.tsx` — 当前 V1 页面创建发布工作的两字段请求。
- `backend/app/schemas/publication.py`、`contracts/openapi.yaml` — candidate 对外 PublicationWork create 合同。
- `backend/app/services/publication.py` — snapshot 的服务端唯一写入 owner。
- `backend/alembic/versions/0041_content_task_list.py`、`0042_content_version_detail.py`、`0043_geo_insight_platform_identity.py` — 0040 后三步 migration 的真实 DDL/guard。
- `backend/tests/integration/test_publication_workflow.py`、`backend/tests/integration/test_migrations.py` — candidate create service、历史回填与 guard 回归。
- `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` — V1 兼容保留声明、当前 V1 52 项历史门禁与 Phase 9 结论。

## Code Patterns

- API request contract 保持旧形状，新增持久化不变量由 backend service 写入并由 PostgreSQL trigger 最终守卫；不得把数据库快照字段泄漏为 frontend 兼容字段。
- V1/V2 real-stack 共用一个 candidate backend/DB 生命周期，但 V1 页面 owner 仍由 runner 动态构建当前 source；“共用 backend”与“复用历史 artifact”是两个不同测试维度。
- production-artifact fixture 使用 mock API 时只能证明 bundle/CSP/DOM 行为，不能宣称 backend compatibility。
- UI-only rollback 的最小 owner 应是既有 Compose frontend service + exact image；测试只需改变 frontend artifact source，不应重启或替换 backend services。

## External References

- 无。未访问公网 staging、未 SSH、未执行 activation/rollback，也未引用第三方兼容保证。
- 本次未重跑历史 52 项 E2E；引用的是仓库已归档的候选结果。

## Related Specs

- `.trellis/spec/infra/e2e-isolation.md:22-44` — V1/V2 real-stack 的独占 DB/Redis、运行顺序、production preview 与真实服务边界。
- `.trellis/spec/frontend/quality-guidelines.md:108-157` — 当前 V1/V2 根门禁及 production artifact/fixture 不能冒充真实 backend E2E。
- `.trellis/spec/backend/publication-workbench-guidelines.md:51-76` — PublicationWork create 只接收两个字段、禁止兼容字段/别名、服务端与数据库持有身份不变量。
- `.trellis/spec/backend/database-guidelines.md:338-348` — 发布结构和不可安全降级原则。
- `.trellis/spec/guides/cross-layer-thinking-guide.md:35-50` — backend/frontend 边界必须核对 exact input/output contract，不能靠格式假设。

## Caveats / Not Found

- 用户列出的 `docs/frontend-v2/10-implementation-roadmap.md` 在当前工作树不存在；Frontend V2 执行路线实际由
  `docs/frontend-v2/07-migration-plan.md` 持有（其标题也是“总体实施路线与交付规则”）。
- 当前工作树没有历史 release 的 source checkout，也没有 exact Docker image；因此未能直接枚举历史 bundle 的完整 API
  消费面。当前 `frontend/src` 是后续持续维护后的 V1 source，不能当作 `afb1b8c82f40` 的逐字替身。
- 未发现“exact V1 image + candidate backend + 0043”的历史测试日志、测试命令或 artifact digest 配对记录。
- 未发现从 exact V1 UI 点击“开始发布”并验证 0043 snapshot 的 E2E；现有 real-stack create 由
  `page.request.post` 发出。
- 现有 V1 52 项结果有历史运行记录，但其中大多数连接当前 5173 Vite dev server；不能作为历史 production image 证据。
