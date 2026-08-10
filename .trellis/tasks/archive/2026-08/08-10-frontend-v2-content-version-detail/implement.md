# Frontend V2 Content Version Detail — Implementation Plan

## 1. Preconditions

- [x] 用户批准最新 `prd.md` / `design.md` / `implement.md`。
- [x] 用户明确批准唯一 `frontend/` 例外：只更新 generated `frontend/src/shared/api/schema.d.ts`，不改 V1 runtime/UI。
- [x] 执行 `task.py start` 后，从最新、干净的 `main` 创建 `codex/frontend-v2-content-version-detail`。
- [x] 使用 `trellis-before-dev` 重新加载 task artifacts 和 backend/frontend specs。

## 2. Ordered Implementation

### 2.1 Contract and Database

- [x] 更新 `contracts/database.md`：nullable `content_versions.updated_at`、legacy null、合法更新时机、detail snapshot/immutable boundary。
- [x] 新增 Alembic revision：增加 nullable updated_at；只为未来 INSERT 设置 default；downgrade 删除列。
- [x] 更新 ORM ContentVersion timestamp mapping，并保证 draft save、review transition、supersede 都触发真实更新时间。
- [x] 更新 `contracts/openapi.yaml`：新 detail path、compact schemas、nullable snapshot/time、明确错误响应；基础 ContentVersion schema 保持不变。
- [x] 同步 V1/V2 generated TypeScript schema。

### 2.2 Backend Read Model

- [x] 提取/公开 Content review history 单一 helper，保持现有累计顺序和 ActorSummary。
- [x] 新增 focused Content Version Detail projection，复用 AI lineage resolver，映射 compact Prompt/model/channel/source steps、Fact/task identity、creator、result/timeline。
- [x] 新增 version-scoped `REPEATABLE READ` GET route；保持与基础 GET 相同 read permission。
- [x] 对不存在/断裂 owner/非法 lineage 返回结构化 404/409，不增加 fallback。

### 2.3 Backend Tests

- [x] contract test 冻结新 schema/path/errors、compact boundary 与基础 ContentVersion 不变。
- [x] migration test 覆盖旧行 null、新写入/更新、downgrade。
- [x] 新 focused integration 覆盖 HUMAN/AI、current/history、snapshot 有无、review result/timeline、404、repeatable read 与 fixed query count；六状态和 403 由页面 component/fixture 层覆盖。

### 2.4 Frontend V2 Domain and Route

- [x] 在 `content.api.ts` 增加 detail query key/options/error classifier。
- [x] 收敛 ContentVersion status presentation 为 Content domain 单一 owner，并让现有实际消费者使用它。
- [x] 新增 readonly page：header、canonical links、Markdown、metadata、lineage/prompt/model、review result/timeline、loading/errors/stale refresh。
- [x] 新增 thin TanStack route；运行生成流程更新 route tree。
- [x] 不修改 Editor/Review Workspace；确认 Task Detail 现有 version links 可导航到新 route。

### 2.5 Frontend Tests and Docs

- [x] 新增 component test，覆盖状态/source/snapshot/error/readonly/long-content/canonical links。
- [x] 扩展 Content fixture 并新增 production-artifact Playwright spec；未声明请求/写请求失败。
- [x] 新增 independent real-stack read spec，并接入 `e2e-local.sh`。
- [x] 更新 `docs/frontend-v2/03/05/07/08/09` 的直接受影响段落。

### 2.6 Quality Gates

- [x] 运行 required validation；失败只修复可归因于本 Task 的问题。
- [x] 使用 `trellis-check` 完成 spec、contract、lint/typecheck/test、跨层数据流和一致性检查。
- [x] 自审最终 diff：只读、single request、无动作、无 client join、无新依赖、V1 generated-only、中文 developer-visible text。
- [x] 抽象回顾：只提升已由真实消费者证明的 Content status presentation；不新增通用 Detail/Snapshot framework。
- [x] 报告 Outcome、files、contract decisions、validation、docs、risks、branch/commit 状态。

## 3. Expected Files

### Contract / Database / Backend

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/alembic/versions/0042_content_version_detail.py`（新增，最终 revision 名以仓库 head 为准）
- `backend/app/models/content.py`
- `backend/app/schemas/content.py`
- `backend/app/routers/production.py`
- `backend/app/services/content_version_detail.py`（新增）
- `backend/app/services/review.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/integration/test_migrations.py`
- `backend/tests/integration/test_content_version_detail.py`（新增）

### Generated API

- `frontend/src/shared/api/schema.d.ts`（唯一允许的 V1 generated 文件；待批准）
- `frontend-v2/src/shared/api/generated/schema.d.ts`

### Frontend V2

- `frontend-v2/src/domains/content/content.api.ts`
- `frontend-v2/src/domains/content/content-version.model.ts`（新增，单一 status presentation owner）
- `frontend-v2/src/domains/content/content-review-page.tsx`
- `frontend-v2/src/domains/content/content-task-detail-page.tsx`
- `frontend-v2/src/domains/content/content-version-detail-page.tsx`（新增）
- `frontend-v2/src/domains/content/content-version-detail-page.test.tsx`（新增）
- `frontend-v2/src/routes/_app/content/versions_.$versionId.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/tests/e2e/fixtures/content.fixture.ts`
- `frontend-v2/tests/e2e/content-version-detail.spec.ts`（新增）
- `frontend-v2/tests/e2e/content-version-detail-real-stack.spec.ts`（新增）
- `deploy/scripts/e2e-local.sh`

### Documentation

- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

预计 30 个主要/生成/文档文件；实现时若可在同一 owner 内完成，应删除而不是增加计划外文件。Editor、Review route、`frontend/` runtime 和其他 domain 不在修改范围。

## 4. Required Validation

按失败归因规则逐项运行；前一项失败且未改变代码/环境时不重复执行同一命令。

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/integration/test_migrations.py backend/tests/integration/test_content_version_detail.py -q
npm --prefix frontend-v2 run test -- src/domains/content/content-version-detail-page.test.tsx src/domains/content/content-review-page.test.tsx src/domains/content/content-task-detail-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/content-version-detail.spec.ts
deploy/scripts/e2e-local.sh
git diff --check
```

Required evidence：

- contract/runtime/generated types 一致；基础 ContentVersion 未扩张。
- migration、HUMAN/AI、六状态、current/history、snapshot present/absent、review/result/timeline、404/403、repeatable read/fixed query count 通过；断裂 owner/lineage 的 409 由显式投影分支与合同冻结，不添加浏览器 fallback。
- component/fixture 覆盖 loading/error/retry/stale、sanitized Markdown、长内容、canonical links、无 mutation、四档宽度、keyboard/focus/runtime audit。
- real-stack spec 独立通过真实登录、数据库、FastAPI 和 V2 production preview；不使用 fixture。

## 5. Optional Full-Suite Validation

```bash
npm --prefix frontend-v2 run test
make test-unit
make test-integration
make e2e
make verify
```

`deploy/scripts/e2e-local.sh` 已是本 Task required real-stack 入口；其余 full-suite 命令只在共享门禁/release 需要或用户明确要求时追加，不授权修复无关失败。

## 6. Review Gates

- detail response 无 `primary_task` / `available_actions` / mutation URL / full Task / full Fact / Diff / unrelated jobs。
- 页面 source/status/current 只用于展示，不生成动作。
- `updated_at=null` 明确显示未知，不使用 created/task/review/migration time fallback。
- lineage 仅目标祖先链；review result 来自记录，不从 status 推导；timeline 保持服务端顺序。
- 浏览器单一 detail GET，无 waterfall；fixture 拒绝未声明请求。
- 无新依赖、store、通用 Version framework、V1 runtime/UI 改动或 `frontend/` 非生成文件。
- 直接影响的合同、docs、tests 与实现一致。

## 7. Rollback Points

1. **数据库**：downgrade 0042 删除 `updated_at`；在应用回滚后执行，避免旧代码引用新字段。
2. **API/backend**：移除新 route/schema/projection 和 history helper 调用；基础 GET/Review/Editor 路径未变。
3. **Frontend V2**：移除 query/page/route/spec，重新生成 route tree/schema；Task Detail 既有链接不改变业务状态。
4. **Docs/generated**：随对应合同回滚，不单独保留漂移描述或 generated 输出。

## 8. Git and Delivery

- 实施分支：`codex/frontend-v2-content-version-detail`，仅在规划获批、`task.py start` 后从最新干净 `main` 创建。
- 不 push。
- 提交前先展示 commit plan，列出合同/迁移/backend/frontend-v2/tests/docs/generated 范围并等待用户确认。
