# Research: 0043 数据库与后端兼容边界

- Query: 审计 `0040_content_draft_management` 到 `0043_geo_platform_identity`、Publication Work 创建链路、数据库/HTTP 合同和测试，判定旧 V1 backend 是否能安全连接 0043，以及 candidate backend 长驻、仅回切 V1 UI 所需的不变量与停止条件。
- Scope: internal
- Date: 2026-08-25

## Findings

### 1. 结论

1. **旧 V1 backend 不能作为 0043 数据库的安全回连目标。** `0043` 的列虽然为 nullable，但 `BEFORE INSERT` trigger 要求每条新 `publication_works` 同时提供非空且等于实时 `platform_profile_id` 的 `platform_profile_id_snapshot`；精确 V1 release 的 backend 没有该字段。旧 API 可能仍能启动并完成部分读取，但合法的“开始发布”写命令会确定性失败，因此这种“部分可用”不能算兼容。
2. **该字段不要求 V1 frontend 参与。** HTTP 创建合同仍只有 `content_version_id` 和 `platform_account_id`；candidate backend 从账号解析实时平台，并在唯一生产创建 owner 中同时写实时 ID 和 snapshot。响应也不暴露 `platform_profile_id_snapshot`。因此仅就 0043 这一变更，`V1 UI -> candidate API -> 0043 DB` 是正确责任链，给 V1 UI 增加字段反而会制造错误兼容层。
3. **已有 V1 E2E 是“接口兼容”的强证据，但不是精确旧 artifact 的充分证据。** 现有 runner 会迁移独立 PostgreSQL 到当前 head、启动当前 backend，并构建/运行仓库当前 `frontend/`；Phase 8 最终门禁记录 V1 E2E `52 passed`。它证明当前 V1 源码可使用 candidate backend/0043，也覆盖 Publication Work 创建；但它没有运行 `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40` 这个旧镜像，不能单独证明精确 release artifact 与 candidate API 的全部兼容性。
4. **安全合同必须是数据库只前滚、candidate backend 集合长驻、仅替换 frontend artifact。** 至少 API 必须保持 candidate，因为它拥有 0043 新写字段；为避免混合 backend release 和未验证的旧 worker/scheduler schema 兼容性，API、worker、scheduler、fake-oss 都不得在 UI 回退/恢复命令中被重建、替换或重启。任何旧 backend tag、migration、Alembic downgrade 或数据库恢复进入 frontend 回退命令，都应立即停止。
5. **当前不存在任何“旧 V1 backend 可安全回连”的正面证据，反而有直接反证。** 已归档 staging 盘点确认精确 release/镜像存在，但旧 commit 的 backend 没有 `platform_profile_id_snapshot`，并据此将原整栈 rollback 判为 `NOT_MET`。

### 2. Files found

| Path | Description |
| --- | --- |
| `backend/alembic/versions/0040_content_draft_management.py` | 远程当前 revision；该 revision 本身不新增列，并明确拒绝有损降级。 |
| `backend/alembic/versions/0041_content_task_list.py` | `content_tasks.updated_at` 的确定性回填、非空化和列表索引。 |
| `backend/alembic/versions/0042_content_version_detail.py` | `content_versions.updated_at` 可空新增列，只为后续写入设置默认值。 |
| `backend/alembic/versions/0043_geo_insight_platform_identity.py` | 新增 Publication Work 平台 UUID snapshot、回填、INSERT/UPDATE guards 和 downgrade guard。 |
| `backend/app/models/publication.py` | `PublicationWork` ORM 字段与实时平台/账号外键。 |
| `backend/app/schemas/publication.py` | Publication Work HTTP 请求/响应模型；snapshot 不在 HTTP surface。 |
| `backend/app/routers/publication.py` | `POST /api/v1/publication-works` 的唯一生产 HTTP 入口。 |
| `backend/app/services/publication.py` | 唯一生产 `PublicationWork(...)` 构造与 snapshot 写入 owner。 |
| `backend/app/services/publication_queries.py` | Publication Work 列表/详情投影；继续返回实时 nullable ID 与状态感知名称/账号快照。 |
| `contracts/openapi.yaml` | 冻结的 Publication Work HTTP 合同。 |
| `contracts/database.md` | 0040–0043 与历史平台身份的权威数据库合同。 |
| `backend/tests/integration/test_migrations.py` | 0043 回填、不可修改、平台删除保留、升级失败和 downgrade 拒绝测试。 |
| `backend/tests/integration/test_publication_workflow.py` | 在迁移到 head 的独立 PostgreSQL 上通过 candidate service 创建和推进 Publication Work。 |
| `frontend/src/features/publications/PublicationsPage.tsx` | 当前 V1 UI 的 Publication Work 请求，仍只发送两个批准字段。 |
| `frontend/tests/e2e/mvp-flow.spec.ts` | V1 真实栈流程直接创建、登记、失败核验、换版并继续发布。 |
| `deploy/scripts/e2e-local.sh` | 把独立数据库迁移到 head，启动当前 backend/worker/scheduler，并运行当前 V1/V2 前端真实栈测试。 |
| `.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md` | 精确 V1 release、远程 0040、candidate 0043 和旧 backend 不兼容的已观察证据。 |
| `.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-post-blocker-recheck/implement.md` | 当前 V1 源码对 candidate backend 的完整 E2E 通过证据。 |

### 3. 0040 -> 0043 migration 链与字段语义

- revision 链是 `0040_content_draft_management -> 0041_content_task_list -> 0042_content_version_detail -> 0043_geo_platform_identity`（`backend/alembic/versions/0041_content_task_list.py:7-9`、`0042_content_version_detail.py:7-9`、`0043_geo_insight_platform_identity.py:8-10`）。已归档 staging 盘点确认远程数据库在 0040，而 candidate head 为 0043（`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:104-109`）。
- 0041 给 `content_tasks.updated_at` 先回填 `created_at`，再设为非空且带数据库默认值（`backend/alembic/versions/0041_content_task_list.py:13-30`）；0042 给 `content_versions.updated_at` 增加 nullable 列并只为未来 INSERT 配默认值（`backend/alembic/versions/0042_content_version_detail.py:13-23`）。这两项没有发现与 Publication Work 旧写形状同级的硬冲突。
- 0043 新列的**存储 nullability**与**新写合同**必须分开理解：列本身是 nullable，保留给升级前已丢失实时平台且尚未形成 Published Article 的历史工作（`backend/alembic/versions/0043_geo_insight_platform_identity.py:104-113`；`contracts/database.md:361-363`）；但新 INSERT trigger 明确拒绝 `NULL` 或与实时 `platform_profile_id` 不同的值，SQLSTATE 为 `23514`（`backend/alembic/versions/0043_geo_insight_platform_identity.py:136-151`）。不能因为列 nullable 就推断旧 backend 可继续写。
- upgrade 只从现存实时 `platform_profile_id` 确定性回填（`backend/alembic/versions/0043_geo_insight_platform_identity.py:114-119`）。若任一 Published Article 对应 work 仍为 null，整个 revision 以 `55000` 中止（`:120-134`），不按名称、审计或随机 UUID 猜测。
- update guard 把 `platform_profile_id_snapshot` 纳入不可原地修改的身份字段（`backend/alembic/versions/0043_geo_insight_platform_identity.py:14-18,33-40,154-158`）。平台删除可把实时外键置空，但 snapshot 保留；迁移测试直接断言 `(platform_profile_id, platform_profile_id_snapshot) == (None, original_id)`（`backend/tests/integration/test_migrations.py:4167-4191`）。
- downgrade 不是 UI rollback 手段。0043 在任一 work 已失去实时平台 ID 时以 `55000` 拒绝降级（`backend/alembic/versions/0043_geo_insight_platform_identity.py:162-182`），数据库权威合同也要求保存已成为唯一历史 owner 的 snapshot（`contracts/database.md:361-363,445`）。当前 Task 还显式禁止 Alembic downgrade，因此 UI 切换命令不得包含任何迁移操作。

### 4. Publication Work 创建的唯一生产链路

生产代码搜索结果只有一条创建路径：

```text
POST /api/v1/publication-works
  -> PublicationWorkCreate(content_version_id, platform_account_id)
  -> create_publication_work(...)
  -> PublicationWork(
       platform_profile_id=profile.id,
       platform_profile_id_snapshot=profile.id,
       ...
     )
  -> PostgreSQL BEFORE INSERT validation trigger
```

- router 的请求模型、权限、CSRF、幂等 header 和 service 调用位于 `backend/app/routers/publication.py:339-360`。
- 请求模型只含 `content_version_id`、`platform_account_id`（`backend/app/schemas/publication.py:142-145`）；OpenAPI 同样只要求这两个字段（`contracts/openapi.yaml:5871-5886`），稳定 spec 也冻结这一签名（`.trellis/spec/backend/publication-workbench-guidelines.md:216-232`）。
- service 先由 `platform_account_id` 查出实时平台、锁定账号/平台与批准内容，再创建 work（`backend/app/services/publication.py:462-516`）。唯一生产构造在 `backend/app/services/publication.py:517-530`，其中实时 `platform_profile_id` 与 `platform_profile_id_snapshot` 同时写为 `profile.id`。
- 全仓生产代码没有第二个 `PublicationWork(...)` 或 Core INSERT owner；另一个 ORM 构造仅是故意制造损坏上下文的集成测试，raw SQL INSERT 仅存在于 migration tests。因此不需要为回退新增 wrapper、兼容字段或第二套创建服务。
- HTTP response 的 `PublicationWorkListItem/Out` 仍暴露 nullable 实时 `platform_profile_id`、名称和账号身份，但不暴露数据库 snapshot 字段（`backend/app/schemas/publication.py:276-326`；`contracts/openapi.yaml:5895-6076`）。V1 UI 不需要知道 0043 的内部存储责任。

### 5. 为什么旧 V1 backend 不能连回 0043

- 已归档只读盘点确认精确上一 release 是 `mvp-20260806-195740-afb1b8c82f40`，其 frontend tag/image/source 都存在（`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:96-103`）。同一盘点确认该旧 commit 的 `backend/` 没有任何 `platform_profile_id_snapshot` 引用，而 candidate service 才写该字段（`:104-110`）。
- 旧 ORM INSERT 不会提供未知列；PostgreSQL 会令该列为 null。0043 的 INSERT trigger 随即以 `23514` 拒绝，因此旧 API 的合法 `POST /api/v1/publication-works` 会失败。该结论来自明确 DDL + 已核对的旧代码形状，不是“可能不兼容”的猜测。
- 风险不是“旧 backend 一定无法启动”，而是“它可以看似健康，却在受支持写流上失败”。仅用 `/health/ready` 或首页 smoke 不能证明 schema compatibility；必须验证代表性业务写流，或静态证明每个新强制写字段由该 backend 提供。
- worker/scheduler 当前没有独立创建 Publication Work 的生产路径，但没有证据证明旧 worker/scheduler 对 0041–0043 的全部 ORM/schema 行为安全。既然安全 UI rollback 不需要替换它们，最小且可审计的合同就是完全不触碰 candidate backend service set，而不是逐项为旧 backend 组件寻找例外。
- 现有 Runbook 也已声明应用回滚只能在旧应用与当前 DB 契约兼容时进行，数据库默认不 downgrade（`docs/Hostdzire部署上线流程.md:133-139`）。已归档激活任务因此正确禁止了旧整栈 `up -d --wait worker scheduler api frontend fake-oss`（`.trellis/tasks/archive/2026-08/08-25-frontend-v2-phase-9-staging-activation-validation/research/audit.md:108-110`）。

### 6. candidate backend 对 V1 UI 的兼容证据与证据缺口

#### 已证明

- 0043 没有改变 `POST /api/v1/publication-works` 的 HTTP 输入；当前 V1 页面仍只发送两个字段（`frontend/src/features/publications/PublicationsPage.tsx:219-228`），其组件测试精确断言没有第三个字段（`frontend/src/features/publications/PublicationsPage.test.tsx:398-418`）。
- 当前 V1 API client 默认使用浏览器同源并携带 cookie（`frontend/src/shared/api/client.ts:43-48`）。只切静态 frontend artifact 后，请求仍由外层 `/api` upstream 到长驻 candidate API；不需要 CORS、API base 或 frontend compatibility proxy。
- V1 MVP E2E 直接向 `/api/v1/publication-works` 发送两个字段，随后完成平台审核、结果登记、失败核验、批准新版本和 work 换版（`frontend/tests/e2e/mvp-flow.spec.ts:759-793`），覆盖了 0043 最关键的新写路径。
- E2E runner 先对独立 PostgreSQL 执行 `alembic upgrade head`，再启动当前 API/worker/scheduler，并构建和运行仓库当前 `frontend/`（`deploy/scripts/e2e-local.sh:87-123,149-180`）。Phase 8 最终固定候选的 V1 E2E 为 `52 passed / 0 failed`（`.trellis/tasks/archive/2026-08/08-24-frontend-v2-phase-8-exit-gate-post-blocker-recheck/implement.md:182-187`）。这证明 current V1 source 与 candidate backend/head DB 兼容。

#### 尚未证明

- 上述 runner 在每次运行时执行 `npm --prefix frontend run build`，不是运行精确旧镜像 `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40`（`deploy/scripts/e2e-local.sh:92-95,116-120`）。
- 旧 artifact 的 commit 早于当前候选；其全部 route、请求参数、响应消费和运行时依赖是否与 candidate API 兼容，不能仅凭当前 `frontend/` 的 E2E 外推。类型生成检查也只覆盖当前源码，不覆盖已发布旧 bundle。
- 因此，精确 V1 UI fallback 合同只有在**精确旧 image/tag/digest**对 candidate backend + 0043 的定向验证通过后才能判定 `MET`。最低价值验证应覆盖：登录/session、核心只读路由、至少一个 candidate API 读取，以及创建 Publication Work 这一代表性 0043 写流。若本 Task 约束不允许业务写入真实 staging，则该代表性写流应在本地隔离数据库/服务中使用精确旧 artifact 完成；公网只读 smoke 不能替代它。

### 7. 必须写入设计/实施计划的安全不变量

1. **DB head 单向不变量**：激活迁移后数据库保持 candidate head；UI rollback/recovery 都不得执行 `alembic downgrade`、`upgrade`、restore、seed 或任意 SQL。
2. **写入 owner 不变量**：迁移后唯一允许连接业务数据库的 API 是包含 `backend/app/services/publication.py:522` snapshot 写入的 candidate backend。任何旧 API/backend tag 都是硬停止条件。
3. **backend service set 不变量**：UI rollback/recovery 不重建、不替换、不重启 API、worker、scheduler、fake-oss；切换前后应以 container ID/image/tag 证明这些服务未变。即使某组件暂未命中 0043 写路径，也不为它创建混合版本例外。
4. **frontend-only 不变量**：回退只把 Compose `frontend` service 切到已验证的精确 V1 artifact；恢复只切回固定 V2 artifact。frontend 不拥有 migration、backend health migration 或 schema preflight side effect。
5. **HTTP 边界不变量**：V1 UI 继续调用同源 `/api/v1`；不添加 `platform_profile_id_snapshot` 请求字段、旧 backend fallback、compatibility proxy、第二 API 路径或默认值。
6. **artifact 身份不变量**：V1/V2 都必须固定 release tag，最好同时记录 image ID/digest；禁止 floating tag、在 candidate release 临时改 build context 后现场重建、或把当前源码 E2E冒充旧 artifact 证据。
7. **可恢复性不变量**：V1 -> V2 回切命令与 V2 -> V1 同样只操作 frontend；验证失败时保留 candidate backend 和 0043 DB，不现场用旧 backend 或 downgrade“救活”UI。

### 8. 失败停止条件

出现任一项即停止并把 Task 判为 `BLOCKED`，不得以兼容 hack 绕过：

- 精确 V1 artifact/tag/image ID 无法确认、无法取得或无法在 candidate backend + 0043 上验证。
- 只有“当前 `frontend/` E2E 通过”，没有精确旧 artifact 证据，却准备宣称 rollback contract 已成立。
- V1 artifact 对 candidate API 出现 route、认证、请求形状、响应消费或代表性 Publication Work 创建失败。
- rollback/recovery 的 Compose 展开或测试显示 API、worker、scheduler、fake-oss 会被 create/recreate/restart/replace，或会启动旧 release 的 backend image。
- 命令包含依赖启动、migration、seed、数据库 restore/downgrade、旧 backend preflight，或无法证明数据库 revision 前后不变。
- 为通过验证而修改 0043、让 snapshot 可省略、给旧 backend 添加猜测字段/default/fallback、让 V1 UI发送数据库内部字段，或新增第二套 deployment/compatibility framework。
- frontend fallback 后只能通过 health/homepage，无法验证真实 V1 bundle 的核心 API 消费；健康探针不能替代业务兼容验证。

### 9. 测试现状与最小缺口

- `backend/tests/integration/test_migrations.py:4155-4231` 已覆盖 0043 正常回填、snapshot 不可修改、删除实时平台后保留、无法回填 Published Article 时 upgrade 原子失败，以及依赖 snapshot 时 downgrade 失败。
- `backend/tests/integration/test_publication_workflow.py:138-156` 明确把临时数据库迁移到 head；其多个 `create_publication_work` 流证明 candidate backend 能满足 INSERT trigger。当前测试没有单独模拟“旧 backend INSERT 缺 snapshot 后被 23514 拒绝”，但 migration DDL 和已归档旧 commit 静态审计已足以判定旧 backend 不安全。
- 本 Task 新增的定向部署测试应证明 frontend 切换命令的 service 集合精确只有 `frontend`，并证明命令文本/Compose 展开不包含 backend、migrate、database、seed。它不能替代精确 V1 artifact 对 candidate API 的兼容验证；两类证据分别回答“命令不会碰 backend/DB”和“旧 UI 确实能用新 API”。

### 10. Code patterns

- **应用推导内部 snapshot，客户端只提交业务身份**：`PublicationWorkCreate` 两字段 -> service 锁定 account/profile -> 同时写 live ID 与 snapshot（`backend/app/schemas/publication.py:142-145`；`backend/app/services/publication.py:482-530`）。
- **数据库是最终边界**：INSERT trigger 拒绝缺失/错配 snapshot，UPDATE guard 拒绝身份原地修改（`backend/alembic/versions/0043_geo_insight_platform_identity.py:136-158`）。
- **无法证明时显式失败，不猜历史身份**：upgrade 对 Published Article 缺 snapshot 使用 `55000` 中止（`backend/alembic/versions/0043_geo_insight_platform_identity.py:120-134`）。
- **当前/历史身份分离**：实时外键允许 `SET NULL`，历史 Published Article/GEO 继续读取无外键 UUID/name snapshots（`backend/app/models/publication.py:116-125`；`contracts/database.md:445`）。
- **现有原生链路已经足够**：production 创建只有 route -> service -> ORM -> DB guard；无需新 adapter、wrapper 或 V1 专用 API。

### 11. External references

- 无。本结论只依赖仓库内冻结 migration、合同、生产代码、测试和已归档 staging 只读证据；未使用网络资料，也未执行 SSH、staging activation/rollback、数据库迁移或 Git 操作。

### 12. Related specs

- `.trellis/spec/backend/database-guidelines.md:1-5`：PostgreSQL 是唯一业务状态来源，Alembic 是唯一迁移入口，历史 revision 不得追改。
- `.trellis/spec/backend/database-guidelines.md:338-348`：Publication Work 当前态、追加历史与数据库最终 guard；开始发布只绑定内容版本和账号。
- `.trellis/spec/backend/publication-workbench-guidelines.md:216-255`：Publication Work 创建的两字段 HTTP 签名、错误矩阵和跨层测试要求。
- `contracts/database.md:361-363,443-445`：0043 snapshot ownership、确定性回填、不可变性和历史身份合同。
- `docs/Hostdzire部署上线流程.md:133-139`：旧应用只有在与当前数据库兼容时才可回滚，数据库默认不 downgrade。

## Caveats / Not Found

- 没有找到精确旧 V1 frontend 镜像 `partsignal-frontend:mvp-20260806-195740-afb1b8c82f40` 在 candidate backend + 0043 上运行的本地/CI证据；现有 V1 E2E构建的是仓库当前 `frontend/`。
- 没有找到任何旧 V1 backend 对 `platform_profile_id_snapshot` 的写入、server default、兼容 trigger 或安全回连测试；已归档盘点给出了相反证据。
- 未执行测试。本研究是只读代码/合同审计；精确 artifact 验证和 frontend-only Compose 命令测试应由当前 Task 的 implement/check 阶段执行。
- 0043 migration test 没有一个命名明确的“缺 snapshot INSERT 返回 23514”断言；这不改变兼容结论，但若未来有人放宽 trigger，现有负向回连结论主要由 migration 源码/合同而非单独回归测试保护。
