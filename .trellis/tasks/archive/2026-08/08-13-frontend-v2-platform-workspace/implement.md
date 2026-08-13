# 实施计划

## 0. 批准与启动 gate

- [x] 用户批准 Core / Accounts 两子 Task。
- [x] 已创建并关联两个 planning 子 Task，各自写明依赖、范围和验证。
- [x] 用户审阅并批准两个子 Task 的最新 `prd.md`、`design.md`、`implement.md` 和候选分支。
- [x] Core 启动前重新确认主工作目录、`main`、前置 Platform List 交付/归档/journal 和无未识别改动。
- [x] Accounts 在 Core 合入、归档和删除分支后，从更新后的干净 `main` 启动。
- [x] 父 Task 未运行 `task.py start`，未创建业务分支。

## 1. 已批准拆分后的最小执行顺序

### Task A：Platform Workspace Core

- [x] **Contract first**：Detail 增加 `platform_type_options`，明确全认证读取与 actor-aware Platform projection；同步 runtime schema。
- [x] **Backend read owner**：复用现有 Detail 查询，首次查询前设置 `REPEATABLE READ`，传入 `can_manage`，以固定批量查询生成 type options；不新增 Workspace endpoint。
- [x] **Backend evidence**：覆盖 ADMIN/ENGINEER detail、action差异、404、account/reference/readiness summary、稳定 type options、`repeatable read` 与固定 query count。
- [x] **Generated types**：重新生成 V1/V2 schema，运行 contract runtime consistency。
- [x] **V2 model/API**：扩展 platform keys/detail/update/prompt-options/logo upload；最小提取 List/Workspace 共享的 Platform lifecycle command/action owner。
- [x] **Route/URL**：注册 UUID + canonical `tab` route、non-blocking prefetch、static breadcrumb和 Platform List return。
- [x] **Workspace surface**：实现 header、Overview、只读 Accounts按需列表、Generation、loading/403/404/error/retry、responsive/accessibility。
- [x] **Overview mutations**：一次 PATCH、Slug readonly、type options、status/delete actions、409草稿保留、精准 cache invalidation。
- [x] **Logo**：已有/缺失、显式候选确认、PLATFORM_LOGO 手工上传、保持/替换/移除三态与焦点/错误。
- [x] **Generation**：ADMIN 按需 Prompt options、bind/unbind单 PATCH、409选择保留；ENGINEER 只读且不请求 options。
- [x] **Core frontend evidence**：model/component tests + generated-type production-artifact fixture，覆盖三个 URL tab、read-only account list、Overview/Generation/Logo/错误/DirtyGuard/四档宽度。
- [x] **Docs/self-review**：更新直接相关 ADR、Phase 6、acceptance 与 spec；检查无 waterfall、client permission、通用 framework、重复 action owner 或无边界 cache clear。

### Task B：Platform Workspace Accounts（依赖 Task A 已合入 main）

- [x] **Contract first**：Account DELETE 增加 required `expected_revision` query；Account List 不增加集合 `CREATE` token；同步 runtime schema。
- [x] **Backend command owner**：router传 revision，service锁 Platform/Account 后先校验 stale revision，再实时复核非终态 PublicationWork blocker；唯一性预检/constraint 统一结构化字段错误。
- [x] **Backend evidence**：ADMIN/ENGINEER row actions、page create、create/update/status/delete、identifier预检与真实约束、stale delete、blocker、平台停用投影和固定 query count。
- [x] **Generated + bounded V1 compatibility**：重新生成 V1/V2 types；只修改 V1 `SettingsPage` 的 Account DELETE 直接调用和测试，不重构 V1。
- [x] **V2 account API/model**：create/update/enable/disable/delete、generated types、穷尽 primary/action/deletion mapping和账号 query keys。
- [x] **Account UI**：在 Core 的 Accounts tab 增加 create/edit Dialog、status/delete/blocker、409显式 reload、focus return；375px 保持 label/status/actions 可达。
- [x] **Account cache ownership**：按 mutation matrix 失效 Platform list/detail/accounts和 Publication ready/work list/workspace context；不触碰终态 PublishedArticle cache。
- [x] **Accounts frontend evidence**：component + fixture Playwright 覆盖 empty/create/edit/status/delete/blocker/conflict/permissions/focus/mobile。
- [x] **Docs/self-review**：更新 account revision/action/cache直接相关 spec/ADR/acceptance，无 optional revision或先 GET 后 DELETE。

## 2. Required validation — Core

命令在批准实施后按实际专项测试文件名收紧；不机械扩大为全套：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_platform_workspace.py

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/platform-list.model.test.ts \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-workspace.spec.ts
git diff --check
```

Core production-artifact Playwright 必须直接覆盖：

- Platform List → Workspace、direct/refresh/Back/Forward、三个 tab URL canonicalization。
- Overview edit/cancel/save、status action、Slug readonly、Platform revision conflict、DirtyGuard。
- Logo missing/upload/candidate confirm/remove；未确认候选不进入 PATCH。
- Accounts只读按需请求、Generation options按需请求/bind/unbind。
- ADMIN/ENGINEER、loading/403/404/error/retry、Dialog/tab focus。
- 375/768/1024/1440 根无横向溢出；375 账号 label/status可读。
- 未声明 API、console.error、pageerror、requestfailed 均失败。

## 3. Required validation — Accounts

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_platform_accounts.py

cd frontend && npm exec -- vitest run \
  src/features/settings/SettingsPage.test.tsx
cd ..

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-workspace.spec.ts
git diff --check
```

Accounts tests 必须直接覆盖：

- ADMIN/ENGINEER account actions、平台停用 action projection、unknown token穷尽失败。
- create/update/enable/disable/delete、normalized identifier唯一性、stale revision、PublicationWork blocker。
- 409 不自动重放且保留输入；显式 reload后采用新 revision。
- mutation cache invalidation 精确命中 Platform 与 Publication consumers。
- empty state、Dialog关闭焦点返回、375 mobile list动作可达。

如果实施沿用 `test_publication_workflow.py` 而不是新建 `test_platform_accounts.py`，Required command 改为实际精确 test node；不得因此运行整份超大 integration 文件。

## 4. Optional validation

```bash
make verify
npm --prefix frontend-v2 run e2e
make test-integration
```

以上覆盖其他 domain 或全仓，只有共享合同回归证据不足、发布准备或用户明确要求时运行。Phase 6 完整 real-stack E2E 与其他 domain E2E 保留给后续独立 Task，不作为本次 Required gate。

## 5. Actual validation evidence

- Core Required validation 已在子 Task 中通过：两套 schema generation、contract check、backend unit/integration、Logo/configuration unit、Frontend V2 定向测试、lint、typecheck、production build、production-artifact Playwright 和 `git diff --check`。完整证据见归档 Core `implement.md`。
- Accounts Required validation 已在子 Task 中通过：两套 schema generation、contract check、backend unit/PostgreSQL integration、V1/V2 定向测试、Ruff、lint、typecheck、production build、production-artifact Playwright 和 `git diff --check`。完整证据见归档 Accounts `implement.md`。
- 父 Task 仅执行文档一致性收口，没有独立业务代码变化，因此没有重复运行上述测试。
- Optional `make verify`、全域 E2E、全量 integration 和 Phase 6 real-stack E2E 仍按两个子 Task 的批准范围保持未运行。

## 6. Documentation consistency

- [x] `contracts/openapi.yaml` 与 runtime/generated clients 一致。
- [x] backend specs 记录 actor-aware Detail、Account action projection 与 DELETE revision。
- [x] frontend state spec 记录 Platform Workspace URL/server/form/cache owner。
- [x] Frontend V2 acceptance 与 ADR 记录 production fixture、首屏/按需边界和 Core/Accounts 拆分。
- [x] 父 `prd.md`、`design.md`、`implement.md` 已按两个子 Task 的实际交付结果收口。

## 7. 最终收口

- [x] Core 交付 `30ae3f67`，归档 `f7887c23`，已进入 `main`。
- [x] Accounts 交付 `e669a492`，归档 `23ff00d8`，已进入 `main`。
- [x] 父 Task 没有独立业务分支和独立业务代码提交。
- [x] 父 Task 只产生文档收口、归档与 developer journal 的 Trellis bookkeeping 变更。
- [x] 不 push、不创建 PR、不创建或启动下一项 Task。
- [x] Phase 6 下一项为 Platform Type subsettings。
