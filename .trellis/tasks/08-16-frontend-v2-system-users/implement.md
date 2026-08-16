# Frontend V2 System Users 实施计划

## 0. 阶段门禁与交付纪律

- 规划已获用户明确批准，Task 已启动并在唯一获准临时分支 `codex/frontend-v2-system-users` 实施。
- 启动前已复核主工作目录为 clean `main`、Phase 6 Exit Gate 为 `MET`，且无同名 branch/worktree。
- 主 agent 自行实施和验证，不启动 implement/check subagent，不让 frontend/backend 边界 agent 改 root contract。
- 不 pull、push 或创建 PR。提交前展示精确 commit plan 并等待用户确认；不包含不认识的 dirty 文件。
- required validation 通过后才可请求提交批准。获批提交后，解释 Trellis archive/session bookkeeping，归档 Task；最后在主工作目录 `git merge --ff-only codex/frontend-v2-system-users` 合入 `main`，确认 clean 后删除本地临时分支。远端分支若意外存在，先报告并另取删除授权。

## 1. Contract-first 与后端命令

### 1.1 OpenAPI 与 schema

- [x] 在 `contracts/openapi.yaml` 为 User DELETE 增加 required `expected_revision` query。
- [x] `ResetPasswordRequest` 增加 required `expected_revision`；reset success 从 204 改为 `200 User`，补 401/403/404/409/422。
- [x] `UserBulkStatusFailure.code` 固定四个 enum，不添加兼容 string 或未知 fallback。
- [x] 在 `backend/app/schemas/common.py` 同步 Pydantic/Literal，保持唯一 `UserOut/UserList`。
- [x] 先更新 `backend/tests/unit/test_contract.py` 的精确合同断言，使 frozen OpenAPI/runtime drift 能捕获错误实现。

### 1.2 identity command owner

- [x] `delete_user` router 接收 query revision并传到 service。
- [x] delete service 在现有表锁/行锁内、状态与引用检查前比较 revision；保留 FK 竞态、session cascade 与 audit。
- [x] reset service 在行锁内比较 body revision；成功返回修改后的 model。
- [x] reset router 用 `present_managed_user` 返回 actor-aware safe `UserOut`，不回显 temporary password/hash/session。
- [x] `_update_user_locked` 只增加 bulk 真实状态变化门禁；同状态抛 `INVALID_STATE_TRANSITION`，普通完整 update 不受影响。
- [x] bulk allowlist 与 response Literal 同源包含四个 code；意外错误仍回滚整个事务，不转成 partial fake success。
- [x] Python touched-scope 未引入需要新增的 docstring；新增异常与开发者文本均为中文。

### 1.3 backend integration

- [x] 更新现有 delete/reset request 与成功状态断言。
- [x] 覆盖 stale delete 不删除、不写成功 audit。
- [x] 覆盖 stale reset 不改 hash/revision、不撤销会话、不写成功 audit。
- [x] 覆盖 reset 200 safe User、revision++、must-change、session revoke、response 不含密码。
- [x] 覆盖 bulk 混合 success + stale + last-admin + not-found + same-state，code/message 顺序与原 request 顺序稳定。
- [x] 覆盖自 reset 422、自降级/自停用遵守 last-admin 与 session 规则。
- [x] 参数化证明 ENGINEER 对 list/create/bulk/export/update/delete/reset 全部 403。
- [x] 用 statement counter 比较空/稀疏/密集 UserList，证明 SQL 次数不随行数增长；不改生产查询来迎合固定数字。

### 1.4 阶段退出条件

- OpenAPI、runtime schema/router/service 一致；所有破坏性命令提交 canonical revision。
- bulk 同态不再虚增 revision/audit；partial failure 有 typed code。
- 无数据库、认证、权限、Redis、依赖或部署改动。若出现这些必要性，停止并回到设计评审。

## 2. 两套生成类型与 V1 最小兼容

- [x] 运行 V1/V2 `api:generate`，只接受生成文件的合同差异，不手改 schema `.d.ts`。
- [x] `UserManagementPage.tsx` 的 delete query 携带当前 row revision。
- [x] reset body 合并当前 row revision，成功消费 safe User，并保留既有 refresh/session consequence 文案。
- [x] 不重写 V1 页面 URL、selection、Ant Design 表格或 action 逻辑。
- [x] 更新 `UserManagementPage.test.tsx` 的 request body/query、200 response 与 bulk code fixture。
- [x] 更新 `frontend/tests/e2e/mvp-flow.spec.ts` 所有 Users delete/reset 调用；revision 只能来自创建/列表/命令响应，禁止硬编码 0 或 fallback。
- [x] 更新 `frontend/tests/e2e/ai-channel-management.spec.ts` 中用于准备测试账号的 reset 调用；不改 AI 渠道行为。
- [x] 全仓 `rg` Users delete/reset operation，确认没有遗漏直接调用者。

退出条件：V1 核心管理行为不变，只适配共享 contract；无 `as any`、optional revision、204/200 双分支或临时 DTO。

## 3. Frontend V2 model、API 与 route

### 3.1 纯 model

- [x] 建立 `user-list.model.ts`：search Zod、canonical record、API params、page size、role/status/security labels。
- [x] 默认 canonical URL 为 `status=ENABLED&page=1&pageSize=20`；q/accountType 可选，ALL 映射为 API status omitted。
- [x] 实现 primary/overflow 穷尽映射与 blocker UI command；unknown/duplicate/contradiction 直接抛明确错误。
- [x] create/edit/reset RHF Zod schema 严格对应 generated contract；不把 create/reset 合并成 password optional form。
- [x] model tests 覆盖 direct raw normalization、API snake_case、filter page reset、动作去重与所有矛盾分支。

### 3.2 API module

- [x] 建立 `user.api.ts`，从 generated paths/components 推导 list/query/body/result。
- [x] list key 包含规范化 API params；提供 list root invalidation。
- [x] 实现 create/update/reset/delete/bulk/export；CSRF 只进 header，temporary password 不进 key/error。
- [x] export 读取服务器文件名，创建 Blob URL 后立即 revoke；不进入 query cache。
- [x] domain-local request error 只读标准 error payload；不 stringify request body。

### 3.3 Route

- [x] 替换 `system.users.tsx` placeholder：validateSearch、canonical replace、loader prefetch、RouteError。
- [x] route 只组合 search navigation、current user ID、csrf token、`auth.refresh`；不承载 table/form business UI。
- [x] 保留现有 `_admin` UX boundary；不新增权限组件或重算 ADMIN。
- [x] 确认 TanStack Router 自动生成 route tree，无手工 routeTree 修改。

退出条件：direct URL/refresh/Back/Forward 使用一个 canonical owner；首屏只有一个 Users GET；不存在详情/Audit请求。

## 4. Frontend V2 页面、selection 与敏感表单

### 4.1 页面骨架

- [x] `user-list-page.tsx` 复用 Page Header、FilterBar、TableShell/Skeleton/Empty、RowActions、BulkActionBar、TablePagination、Badge、Button、Dialog、RHF/Zod。
- [x] Page primary 只有“新增用户”，export 为次操作。
- [x] 全局 summary 用一条紧凑区域显示五个 server count，明确“不受当前筛选影响”。
- [x] 实现 loading/old-data refresh error/empty/filtered-empty/initial error retry/out-of-range last page。
- [x] 实现六列和局部 `.user-list-table` 375/768 compact facts；无 Avatar 请求、User Detail link 或根 overflow。

### 4.2 行动作与 Dialog

- [x] 每行最多一个 primary + overflow；调用 model resolver，页面不检查 role/status/must-change 来决定资格。
- [x] create/edit/reset 短 Form Dialog；enable/disable/delete/blocker 使用页面 custom Dialog，以便失败保留上下文和焦点 owner。
- [x] 停用、reset、delete 明确会话/首次改密/不可恢复影响。
- [x] 409 不 invalidate、不 replay；保留 Dialog/input，提供明确 reload。reload 前卸载敏感 form。
- [x] blocker 只显示 count/刷新，不产生 `/system/audit` href。

### 4.3 selection 与 bulk

- [x] selection 保存 canonical scope 和 `{id,username,revision}`；换 filter/page/pageSize 立即清理。
- [x] background refetch 若已选 row 消失或 revision 变化，清空整组并提示；revision 不变则保留。
- [x] selection>0 才显示 BulkActionBar，始终提供 Enable/Disable/Clear；不根据 action/status 推资格。
- [x] bulk disable 使用 custom confirm；请求每项发送观测 revision，pending 防重复。
- [x] 200 后清空 selection；显示 success count 和逐项 username/code/message；invalidate lists。
- [x] transport/顶层 failure 保留 selection/confirm；逐项 conflict 属于 200 partial，不自动重选失败项。

### 4.4 Cache 与 auth

- [x] 所有成功 mutation invalidate `userKeys.lists()`，不做 optimistic patch。
- [x] edit/status/bulk 若成功包含 current actor，等待 `auth.refresh()`；路由权限变化由 `_admin` boundary 接管。
- [x] delete 页尾导航前一页；其他命令不改 URL。
- [x] 无 User detail/Audit/全局 store cache。

### 4.5 密码生命周期

- [x] create/reset mutation owner 位于随 Dialog 卸载的私有组件或等价可证明边界，`gcTime=0`。
- [x] cancel/success/reload 销毁 form 并 `mutation.reset()`；409 仅在打开 Dialog 内保留输入。
- [x] DOM、query/mutation cache（Dialog 销毁后）、URL、logs/errors/Toast/feedback/test snapshot/fixture artifact 无 secret/CSRF/hash/session。

退出条件：所有 server state 都从 UserList/command response 来；没有客户端业务 eligibility、stale selection 或 secret 残留。

## 5. Strict E2E、文档与自审

### 5.1 production fixture

- [x] 新增 generated-type `users.fixture.ts`，只允许 auth/csrf、Users list/export/create/update/reset/delete/bulk。
- [x] fixture 执行 query、paging、revision、safe response、partial、same-state 与 Engineer 403；controller 只记录脱敏请求元数据，不保存临时密码 body/artifact。
- [x] `system-users.spec.ts` 显式关闭 trace，不让 create/reset postData 进入失败 trace；不附加 secret screenshot/snapshot。
- [x] 未声明 API 返回 501，teardown 汇总 unexpected API/non-2xx/console/page/request failure。

### 5.2 `system-users.spec.ts`

- [x] canonical URL/API mapping、direct/refresh/Back/Forward、sidebar/breadcrumb。
- [x] summary、固定列、loading/empty/filtered-empty/error/retry/越界。
- [x] primary/overflow/blocker、无详情/Audit link；projection contradiction 由 model 单测覆盖。
- [x] create/edit/reset/status/delete/export 的 payload、CSRF/revision、409 no replay、焦点恢复。
- [x] bulk selection scope/disable confirm/mixed partial/200 清理由 E2E 覆盖，revision refresh/transport 保留由页面单测覆盖。
- [x] temporary password 只在 request，response/DOM/console/artifact 无残留。
- [x] ENGINEER direct route 403；server interface 403 由 backend integration owner。
- [x] 375/768/1024/1440 的根无横向溢出、核心事实/动作可达、键盘/Dialog/overflow 焦点。

### 5.3 文档与 diff 自审

- [x] 更新 backend/frontend Trellis specs 与 V2 03/05/07/08/09 权威文档；只写实际实现。
- [x] 明确下一 Task `/system/audit?actorId=` handoff；不提前创建 route/链接。
- [x] `contracts/database.md` 不改并在 closeout说明无 persisted schema/constraint 变化。
- [x] diff 检查：无 symptom patch、重复 owner、silent fallback、broad catch、客户端权限、secret、死代码、无关格式化或未说明行为变化。
- [x] Python touched-scope comments/docstrings/developer text 已完成中文检查；收尾回复将明确说明。

## 6. Required validation

以下是实施后必须执行的直接门禁。失败只在代码/配置/环境发生可影响结果的变化后重跑；先归因，不扩修无关失败。

### 6.1 Contract generation 与 drift

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
make contract-check
```

### 6.2 Backend static、contract 与 PostgreSQL identity integration

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/schemas/common.py \
  backend/app/routers/identity.py \
  backend/app/services/identity.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_identity_management.py

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_runtime_openapi_matches_frozen_operations \
  backend/tests/unit/test_contract.py::test_user_management_contract_is_revisioned_and_typed \
  backend/tests/integration/test_identity_management.py
```

说明：identity integration 全文件是共享命令/权限/事务合同的直接 owner，避免只跑一个 happy-path node 而漏掉 delete/reset/bulk/session/audit 相互影响。

### 6.3 V1 共享合同兼容

```bash
npm --prefix frontend run test:watch -- --run \
  src/features/users/UserManagementPage.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run e2e -- \
  tests/e2e/mvp-flow.spec.ts \
  tests/e2e/ai-channel-management.spec.ts \
  --project=e2e
```

V1 E2E 是 required，因为 DELETE/reset 是共享 public contract；不运行不相关 V1 visual convergence 作为发现循环。

### 6.4 Frontend V2 unit、static、production artifact

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/identity/user-list.model.test.ts \
  src/domains/identity/user-list-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/system-users.spec.ts
```

`frontend-v2/playwright.config.ts` 会先 production build，再以 `vite preview` 服务 artifact；两个 project 加 spec 内四档循环共同覆盖 375/768/1024/1440。

### 6.5 Task 与 diff

```bash
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-16-frontend-v2-system-users
git diff --check
git status --short --branch
```

## 7. Optional full-suite / release validation

Required 全绿且以下触发条件成立时才升级：准备 release/Phase 7 总门禁、发现 shared common module 回归、或用户明确要求全套。

```bash
make test-unit
make test-integration
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
deploy/scripts/e2e-local.sh
make verify
```

- `make verify` 是长时、顺序、fail-fast 的最终候选，不作为逐个发现问题的循环。
- 运行最终候选前，先分别完成其可独立阶段（contract/lint/typecheck/unit/integration/build/目标 E2E），批量暴露所有当前可诊断 blocker。
- optional failure 不自动进入本 Task；只有证据指向当前 Users/shared contract 变更才修复。

## 8. 验收追踪

| PRD | 主要证据 |
| --- | --- |
| AC1/AC7 | `research/users-audit.md`、OpenAPI/contract/integration tests |
| AC2/AC3 | design 3-6、model/page tests、strict URL/list scenarios |
| AC4 | model action resolver tests + strict projection error |
| AC5/AC6 | design 8-11、page tests、bulk E2E、backend identity integration |
| AC8 | implement 6-7 的 Required/Optional 精确命令 |
| AC9 | strict fixture + system-users 四档/键盘/错误审计 |
| AC10 | design 14 + implement 0 的风险/Audit/Git/Trellis 计划 |
| AC11 | planning 阶段 validation、批准时 task/branch/worktree/git evidence |

## 9. 完成与提交门禁

- [x] Required validation 全部实际观察为成功，或明确记录非本变更/环境 blocker；不得以“应通过”替代结果。
- [x] OpenAPI、backend、V1/V2 generated types、tests、spec/docs 一致；没有数据库文档漂移。
- [x] 展示 commit plan（文件组、commit message、排除文件）并获得用户确认。
- [ ] 获批后提交到临时分支，不 push/PR。
- [ ] 解释 archive/session bookkeeping 后归档，fast-forward 合入主工作目录 `main`，删除临时分支；最终报告 commit、验证、残余风险和未运行 optional gate。
