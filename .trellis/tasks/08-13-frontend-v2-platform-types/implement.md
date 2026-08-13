# 实施计划

## 0. Start Gate

- [x] 主工作目录为 `/Users/sc/PycharmProjects/partsignal`，当前分支 `main`，开始审计时工作区干净。
- [x] `30ae3f67` 与 `e669a492` 已进入 main。
- [x] Platform List、Workspace Core、Workspace Accounts、父 Workspace Task 均已归档。
- [x] 创建本 Task 前不存在 active Trellis Task；当前 Task 状态为 `planning`。
- [x] `prd.md / design.md / implement.md` 已形成可 review 版本。
- [x] 用户批准最新规划。
- [x] 批准后重新确认 main/工作区并运行 `task.py start`，再创建唯一临时分支 `codex/frontend-v2-platform-types`。

## 1. Ordered Implementation

1. Contract first：OpenAPI 增加 `platform_count`、name/slug 长度、POST slug conflict response 与 DELETE required revision；更新数据库合同说明。
2. Backend read model：复用 grouped count map 暴露 `platform_count`；列表改为 `lower(name), id`；保持固定查询次数。
3. Backend commands：schema owner trim name；create/update 只映射真实 slug constraint；DELETE 锁内先 revision 后 blocker。
4. Backend tests：contract/projection + targeted PostgreSQL CRUD/权限/排序/计数/唯一性/revision/blocker/query-count。
5. 生成 V1/V2 schema并运行 runtime OpenAPI consistency；V1 只补 Platform Type DELETE revision 与直接测试。
6. V2 API/model：扩展现有 `platform.api.ts` query key/API owner；实现 exhaustive action/form/error mapping。
7. V2 page/route：管理员 route、四列 table + 375 card rows、create/edit/delete/blocker/conflict/focus；List/Workspace 增加 admin-only subsettings link。
8. 精确实现三类 mutation cache matrix，不触碰其他 domain。
9. 新增 strict production-artifact fixture/Playwright，覆盖状态、CRUD、冲突、权限、导航和四档宽度。
10. 更新直接相关 spec/docs，自审 diff 后报告 changed files、行为、验证与风险；提交前另行给出 commit plan 等待确认。

## 2. Required Validation

以下命令只在规划批准并完成实施后运行：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_platform_types.py

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/configuration.py \
  backend/app/routers/configuration.py \
  backend/app/services/platform_configuration.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/integration/test_platform_types.py

cd frontend && npm exec -- vitest run src/features/configuration/PlatformTypesPage.test.tsx
cd ..

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/platform-types.model.test.ts \
  src/domains/configuration/platform-types-page.test.tsx \
  src/domains/configuration/platform-list-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-types.spec.ts
git diff --check
```

直接证明范围：

- backend/contract：required `platform_count`、两查询批量投影、`lower(name),id`、create、update/delete revision、stale 优先级、Enabled/Disabled blocker、name/slug rules、真实 constraint error、ADMIN 403、runtime OpenAPI consistency；
- frontend model/component：loading/empty/error/retry、固定四列、count、CRUD、blocker link、update/delete conflict、未知 token、Dialog focus、admin entry/boundary、精确 invalidation、375 card rows；
- production artifact：从 Platform Settings/Workspace 进入、direct/refresh、CRUD、blocker、revision conflict、Back/Forward、ENGINEER 403、375/768/1024/1440、console/page/request runtime audit。

若 targeted integration 合并到既有文件，Required command 必须改为精确 test node，不能机械运行无关 suite。

## 3. Optional Validation

```bash
make verify
npm --prefix frontend-v2 run e2e
make test-integration
```

- Phase 6 完整 real-stack E2E 留给后续独立 Task。
- 其他 Configuration/Content/Publication domain tests 仅在实施 diff 证明受影响时追加。
- Optional 不作为本 Task 默认 completion gate；Required 已直接覆盖该合同与页面。

### 实际结果（2026-08-13）

- OpenAPI 两套 generated schema 与 runtime contract check 通过。
- backend unit/contract `60 passed`；PostgreSQL integration `2 passed`；targeted ruff 通过。
- V1 直接兼容测试 `2 passed`；V2 targeted model/component `28 passed`。
- frontend-v2 lint、typecheck、production build 通过。
- Platform Type production-artifact Playwright mobile/desktop 共 `10 passed`，fixture teardown 同时完成 console/page/request error audit。
- `git diff --check` 通过。

## 4. Diff Self-review Gate

- [x] 无从 blockers/client list 推导 `platform_count`。
- [x] 无客户端排序、optional revision、自动重放或第二 endpoint。
- [x] 无 `isAdmin` 代替 row action/server permission；仅用于 subsettings 导航 UX 与既有 route boundary。
- [x] 无通用 CRUD/Table/Form/Action abstraction、新依赖或无关 V1 重构。
- [x] create/update uniqueness 只映射 `uq_platform_types_slug`，未知 IntegrityError 未被吞掉。
- [x] cache 只命中 Type list、Platform lists、Platform details；未清 QueryClient。
- [x] 375px 保留四字段/动作，未知 action/primary/blocker 会失败。
- [x] comments/docstrings/developer-visible text 完成 touched-scope 中文检查。
- [x] code、OpenAPI、database contract、spec、docs、tests 一致。

## 5. Completion and Delivery Gate

- [ ] 报告 changed files、contract/backend、platform_count、DELETE revision、权限/action、cache、实际测试、跳过项、未解决问题和文档一致性。
- [ ] 提交前提供 commit plan 并等待用户确认；不自动 push、不建 PR。
- [ ] 确认后提交、归档 Trellis Task、fast-forward 合入 main、删除本地临时分支。
- [ ] 推荐下一 Task：`frontend-v2-prompt-workspace`。
