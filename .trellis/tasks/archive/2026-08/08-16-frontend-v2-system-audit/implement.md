# Frontend V2 System Audit 实施计划

## 0. 阶段门禁与交付纪律

- [ ] 用户明确批准本轮 `prd.md/design.md/implement.md` 后，才运行：

```bash
python3 ./.trellis/scripts/task.py start \
  .trellis/tasks/08-16-frontend-v2-system-audit
git switch -c codex/frontend-v2-system-audit
```

- [ ] 启动前再次确认 primary workdir 为 clean `main`，没有同名 branch/worktree/current task；`main` ahead origin 不触发 pull/push。
- [ ] 唯一实施分支为 `codex/frontend-v2-system-audit`。不处理无关 branch，不 push/PR。
- [ ] 主会话 inline实施和检查，不 dispatch implement/check subagent。
- [ ] 先 contract/backend，再生成类型/compatibility，再 V2 UI/test/docs；不得先用前端 fallback绕过合同。
- [ ] Required validation通过后展示 commit plan（文件组、commit message、排除文件）并等待用户确认；确认前不 commit。
- [ ] archive/session bookkeeping、fast-forward main、删除分支均在后续明确授权后执行，并在可能生成 bookkeeping commit前解释。

当前状态：Task 已获批准并进入 `in_progress`；实现与 required validation 已完成，等待提交计划确认，尚未 commit、archive、合入或 push。

## 1. Contract-first 安全 read model

### 1.1 OpenAPI

- [ ] 从 `AuditLog` 的 required/property删除 `change_summary`；不增加第二 list DTO、不保留 optional compatibility field。
- [ ] 声明 `AuditSafeScalar`（null/string/number/boolean）与 `AuditSafeValue`（scalar或一维 scalar list）。
- [ ] `AuditChange.before/after` 与 `AuditLogDetail.facts.additionalProperties`引用 safe value。
- [ ] Detail endpoint补 `409 ErrorResponse`；冻结 `AUDIT_PROJECTION_FAILED`而不公开 raw key/value。
- [ ] 在 contract unit test先写出 metadata-only list、safe detail、409和 runtime schema一致性断言。

### 1.2 Shared registry 与 write boundary

- [ ] 将 `_SAFE_FACT_KEYS/_SAFE_CHANGE_FIELDS`从 read service移到既有 `backend/app/audit_types.py`，命名为唯一共享 registry。
- [ ] 保留九个模块全部 entry，补已确认实际 writes：
  - CONFIGURATION：`bound_platform_count/bound_platform_ids/unbound_platform_count/platform_account_count`。
  - CONTENT_PLANNING：`generation_job_count/content_version_count/content_review_record_count/publication_work_count`。
- [ ] `validate_audit_entry`按 entry.module检查 fact/change key和 safe value；unknown/object/nested list显式 ValueError，敏感 key仍由现有递归检查拒绝。
- [ ] 全仓枚举 `AuditEntry(` write sites，确认每个真实 fact/change key都已登记；不为未观察字段添加 speculative key。
- [ ] unit test参数化 primitive/null/flat list成功与 unknown/sensitive/object/nested list失败。

### 1.3 Metadata list 与 strict detail

- [ ] `AuditLogOut`移除 `change_summary`，`project_audit_log`只投影 metadata/actor，不访问 details。
- [ ] `_project_details`复用 shared registry；完整验证 details/facts/changes/key/value，任何失败转为 generic `AppError('AUDIT_PROJECTION_FAILED', ..., 409)`，不部分返回。
- [ ] List含不安全历史 row时仍返回 metadata；请求该 Detail时返回 generic 409，response/error中无 sentinel。
- [ ] 保持 related lookup，不为 unsupported target新增 guess；PlatformProfileVersion读取必要 safe parent fact时也遵守 strict projection。

### 1.4 Keyword、稳定查询与权限

- [ ] keyword改为只匹配 current actor display/username，以及 `business_module/action/target_type/target_id/request_id/result_message/error_code`；移除 details JSON搜索。
- [ ] count/rows共享相同 conditions与 actor outerjoin；保留 `(created_at DESC,id DESC)`、`>= from/< to`。
- [ ] filter-options保持两个 `DISTINCT ORDER BY` query；不并入 list。
- [ ] 补 ADMIN三 GET 200、ENGINEER三 GET 403。
- [ ] statement counter比较 empty/sparse/dense list，确认固定2；options固定2；detail无/有 related lookup固定1/2。

### 1.5 Backend阶段退出

- [ ] unit/integration证明 deleted actor为 `actor_id=null/actor=null`，UI合同文案不需要 Users join。
- [ ] related AVAILABLE/MISSING/UNSUPPORTED均有 server payload证据。
- [ ] 无 migration/model/table/permission/append-only/history变化；若出现必要性，停止并回到评审。
- [ ] Python touched-scope documentation pass：新增/改变的 registry、projection/error/query docstring、日志/异常文本为必要且中文；不机械注释明显代码。

## 2. Generated types 与 shared consumer compatibility

### 2.1 生成与 V1

- [ ] 运行两套 `api:generate`；只接受合同产生的生成差异，不手改 `.d.ts`。
- [ ] 更新 V1 `AuditLogPage.test.tsx`和`ConfigurationPages.test.tsx` fixtures，删除 list `change_summary`。
- [ ] 搜索所有 `AuditLog/AuditLogList/change_summary` consumer，确认业务 `change_summary`同名字段不被误改。
- [ ] V1 component若没有真实引用则不改；禁止 optional field/empty summary fallback。

### 2.2 AI Channel backend/V2 list

- [ ] `list_ai_channel_audit_logs`继续返回同一个 metadata-only `AuditLogList`，保留 stable order/actor/query owner。
- [ ] AI Runtime删除“安全摘要”header/cell/mobile summary；保留动作、时间、actor、结果、现有详情入口。
- [ ] fixture/component/integration更新 list shape；安全 facts/changes只在 lazy Detail继续展示。

阶段退出：global/channel list共用一个 metadata item；V1/V2编译类型一致；无第二 DTO、双 contract或兼容 branch。

## 3. Frontend V2 Audit model/API/shared detail

### 3.1 `audit.model.ts`

- [ ] 建立 search schema与 canonical record：page/pageSize/date pair/actorId/module/action/targetType/targetId/outcome/requestId/keyword/logId。
- [ ] URL camelCase只映射批准 snake_case；page/pageSize/date显式，optional blank省略，UUID lowercase，ISO统一UTC。
- [ ] 默认 near-3-day range只计算一次；native `datetime-local`与固定 Beijing `+08:00`互转，无日期依赖。
- [ ] invalid/repeated/unknown/date pair规范化；from>=to整体恢复默认，不保留半个时间窗。
- [ ] 实现 module/outcome/action labels、strict primary task、facts/changes/value projection与 related route resolver。
- [ ] model tests覆盖全部映射、page reset、time inclusive/exclusive表示、safe scalar/null/list、empty list、unknown/object/nested list、related map。

### 3.2 `audit.api.ts`

- [ ] 建立 `auditKeys.list/filterOptions/detail`，list key只含 API params，detail key只含 logId。
- [ ] list/filter/detail query options使用 generated path/types、`retry:false/retryOnMount:false/staleTime:30_000`。
- [ ] request error只读取标准 ErrorEnvelope/message/request ID，不 stringify response/request body或console输出。
- [ ] 删除 Configuration私有 global audit detail key/options，让两个 consumer使用同一个 key/queryFn。

### 3.3 `AuditDetailContent`

- [ ] 展示全部批准 metadata、result/error、changes、facts、related_entry。
- [ ] null/boolean/number/string/flat list有明确 renderer；无 `JSON.stringify`、raw object、change_summary。
- [ ] unknown primary/key/value整体 generic projection failure，不部分展示原始详情。
- [ ] related三态与精确 route map按 design 12；缺 parent/无 stable route只给文案。
- [ ] Configuration sheet复用该组件；channel-specific workspace/page/link ownership不移入 Audit domain。

阶段退出：API/query/projection/detail content只有一个 global owner；没有通用 renderer framework、registry injection或新依赖。

## 4. `/system/audit` route、filters、table 与详情容器

### 4.1 Route/navigation

- [ ] 新建 `_admin/system.audit.tsx`：validateSearch、middleware、beforeLoad canonical replace、list prefetch、RouteError。
- [ ] 用户交互navigate默认push；route correction/out-of-range显式replace。
- [ ] navigation新增ADMIN-only Audit item/navId/breadcrumb并更新test；route tree由Vite/TanStack自动生成。
- [ ] ENGINEER仍由 `_admin` UX boundary阻止，server 403不变。

### 4.2 Filters与queries

- [ ] FilterBar第一层放keyword、Beijing日期、module、outcome；moreFilters放actorId/action/targetType/targetId/requestId。
- [ ] action/targetType只来自独立 filter-options query；module/outcome只来自 generated enum；当前页 rows不参与。
- [ ] actorId用UUID text input；不请求 Users。
- [ ] filter submit/reset/pageSize回page1；Back/Forward重置 filter draft到URL。
- [ ] options loading/error不阻塞 list；当前URL value在 options错误时仍可见/可清除。

### 4.3 Table与states

- [ ] 固定七个 header，使用 metadata-only list；无 action column/button。
- [ ] `<tr>`保留table语义，增加tabIndex/aria-selected/focus ring与click/Enter/Space handler；Space防滚动。
- [ ] deleted actor固定“用户已删除/未记录”；三种 outcome使用文字+Badge。
- [ ] initial/background loading/error、empty/filtered-empty、retry、out-of-range replace全部可恢复。
- [ ] TableShell局部overflow，页面root保持min-width/overflow边界；不复制mobile list data source。

### 4.4 URL-owned Detail/focus/responsive

- [ ] row activation push `logId`，detail query仅 logId enabled；选择不改变list key/请求。
- [ ] page-local row element map记录focus target，不镜像selected business state。
- [ ] `matchMedia('(min-width:1280px)')`只选择Pane/Sheet容器；viewport切换不改URL/query。
- [ ] Pane提供close；Sheet用Base UI Escape/close/focus trap；close push移除logId。
- [ ] prior logId消失后返回对应row；direct/off-page detail回退table region或heading。
- [ ] detail 404/403/409/transport error局部呈现并可retry/close，list保持。

阶段退出：initial=1 list+1 options+0 detail；direct logId最多再1 detail；无 Users/业务API/逐行detail/auto refresh。

## 5. Users handoff 与 Configuration reuse

- [ ] Users deletion blocker文案改为可从审计追溯，增加typed Link到`/system/audit?actorId=user.id`。
- [ ] Link点击只导航；Users page/query/api不import或调用 Audit。
- [ ] Users component/E2E更新“无link”旧断言为exact actorId URL与focus行为。
- [ ] Configuration移除private detail query/projection；复用global Audit owner。
- [ ] 保留AI Runtime自己的“查看详情”button/Sheet/focus，这是Configuration页面既有交互，不套用System Audit row规则。
- [ ] AI Runtime详情lazy GET、Escape focus、related channel/model link、unknown shape failure、无Users与sentinel回归继续通过。

## 6. Strict production fixture 与 Playwright

### 6.1 Fixture

- [ ] 新建generated-type `system-audit.fixture.ts`，只允许auth/csrf和三Audit GET。
- [ ] 模拟完整server filter/paging/stable order、options sort/dedupe、deleted actor、三outcome、related三态、detail 404/409。
- [ ] controller记录method/path/query/status，不记录raw detail values；内部secret sentinel不进入response/controller。
- [ ] 未声明API返回501，teardown把unexpected API/non-approved non-2xx/console/page/request failure作为失败。
- [ ] spec `test.use({trace:'off'})`；断言本spec无trace artifact。

### 6.2 `system-audit.spec.ts`

- [ ] navigation/breadcrumb、ADMIN与ENGINEER route。
- [ ] canonical URL、全部snake_case mapping、Users actorId handoff、direct/refresh/Back/Forward。
- [ ] server filtering/pagination/options、loading/empty/filtered-empty/error/retry/out-of-range。
- [ ] 固定七列、无操作列/详情button、click/Enter/Space。
- [ ] desktop Pane、375/768/1024 Sheet、1440 Pane、root no overflow。
- [ ] direct detail URL、lazy GET/no per-row detail、list key/request不因selection变化。
- [ ] close/Escape/Back focus恢复。
- [ ] deleted actor、SUCCESS/FAILED/DENIED、related三态。
- [ ] primitive/null/list、安全projection failure，无raw JSON/change_summary/sentinel。
- [ ] response/DOM/URL/controller/console/error/output artifact无sentinel；无Users/业务详情请求。

### 6.3 Existing Playwright compatibility

- [ ] `ai-channel-workspace-runtime.spec.ts`：shared detail owner与metadata list。
- [ ] `system-users.spec.ts`：blocker link精确handoff且Users自身不发Audit data GET。
- [ ] 不新增Phase 7完整real-stack管理员E2E；backend integration已经是三个API权限/数据库权威。

## 7. 文档与自审

- [ ] `contracts/database.md`更新metadata-only list、strict read/write allowlist、keyword批准字段；明确无schema变化。
- [ ] `.trellis/spec/backend/database-guidelines.md`移除本Task明确排除的自动刷新要求，保留默认近三天/URL/right detail/security并补strict projection/query count。
- [ ] `.trellis/spec/frontend/state-management.md`记录Audit canonical URL/logId/query ownership。
- [ ] V2 02 nav/route、03 page/handoff、05 read contract、07 slice status、08 evidence、09 ADR同步实际实现。
- [ ] `docs/frontend-v2/README.md`仅更新status/index需要的事实。
- [ ] diff自审：无list details、silent fallback、raw dump、client join、second DTO、duplicate owner、broad catch、unknown action guess、mutation、polling、依赖或无关格式化。
- [ ] Python touched-scope comments/docstrings/developer-visible text检查并在closeout明确说明。

## 8. Required validation

以下命令按最终已批准diff执行。先运行可独立阶段收集问题，再用contract/build/E2E确认候选；失败先归因，只修当前Task导致且在scope内的问题。

### 8.1 Contract generation/drift

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
make contract-check
```

### 8.2 Backend unit/static

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_audit.py \
  backend/tests/unit/test_contract.py::test_runtime_openapi_matches_frozen_operations \
  backend/tests/unit/test_contract.py::test_audit_contract_separates_list_metadata_from_safe_detail

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/audit.py \
  backend/app/audit_types.py \
  backend/app/schemas/common.py \
  backend/app/routers/identity.py \
  backend/app/services/audit_logs.py \
  backend/app/services/ai_configuration.py \
  backend/tests/unit/test_audit.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_identity_management.py \
  backend/tests/integration/test_ai_channel_management.py

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app
```

### 8.3 PostgreSQL integration

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
  tests/integration/test_identity_management.py \
  tests/integration/test_ai_channel_management.py
```

两个文件是required：identity文件拥有global Audit filter/detail/permission/actor；AI文件拥有共享AuditLogList channel consumer。执行后核对test容器退出，且不遗留本Task创建的临时数据库/container。

### 8.4 V1 shared contract compatibility

```bash
npm --prefix frontend exec -- vitest run \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend run test:visual-contract
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

V1完整E2E不是required：共享list字段在V1 production组件中没有UI consumer，targeted unit+typecheck+production build直接证明contract适配。若实施搜索发现真实V1 runtime分支读取该字段，再把对应V1 E2E提升为required。

### 8.5 Frontend V2 unit/static/build

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/audit/audit.model.test.ts \
  src/domains/audit/system-audit-page.test.tsx \
  src/domains/configuration/ai-channel-workspace-page.test.tsx \
  src/domains/identity/user-list-page.test.tsx \
  src/app/navigation.test.ts
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

### 8.6 Existing Playwright Test Runner

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/system-audit.spec.ts \
  tests/e2e/ai-channel-workspace-runtime.spec.ts \
  tests/e2e/system-users.spec.ts
```

该命令使用现有production build + Vite preview、mobile/desktop projects；新spec内部覆盖375/768/1024/1440，不创建ad-hoc browser session。

### 8.7 Task/diff/security

```bash
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-16-frontend-v2-system-audit
git diff --check
git status --short --branch
```

同时人工/脚本检查：

- `AuditLog` generated list item没有 `change_summary`。
- System Audit production代码不存在 `JSON.stringify` detail renderer、Users GET、mutation、polling。
- strict fixture唯一允许的secret sentinel只在fixture内部声明；response/controller/Playwright output无该值。
- `routeTree.gen.ts`仅包含生成route差异，无手改迹象。

## 9. Optional full-suite / release validation

只有准备Phase 7/release gate、shared core回归证据不足或用户明确要求时运行：

```bash
make test-unit
make test-integration
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
deploy/scripts/e2e-local.sh
make verify
```

- Phase 7完整ADMIN real-stack scenario与抽象回顾仍是后续Task，不因本Task跑full suite而视为完成。
- `make verify`是长时fail-fast最终候选，不作为发现循环；运行前先完成contract/lint/typecheck/unit/integration/build/target E2E各独立阶段。
- optional failure不自动扩scope；只修证据归因到当前Audit/shared contract diff的问题。

## 10. 验收追踪

| PRD | 实施证据 |
| --- | --- |
| AC1/AC10 | backend integration、`_admin` route、strict ENGINEER fixture |
| AC2 | audit model tests、route tests、System Audit E2E |
| AC3/AC4 | page tests + four-width production E2E |
| AC5/AC6 | query records、state tests、lazy detail E2E |
| AC7/AC8 | backend safe projection、AuditDetailContent tests、related matrix |
| AC9 | OpenAPI/runtime/generated/contract tests、registry tests |
| AC11 | AI Runtime/Users component+E2E、V1 compatibility gate |
| AC12 | strict fixture teardown、sentinel assertions、trace-off artifact check |
| AC13 | docs/spec/diff review、no DB/dependency/mutation evidence |

## 11. 提交、归档与合入门禁

- [ ] Required validation全部实际观察成功，或明确记录与当前diff无关/环境失败；不得用预计结果替代。
- [ ] 展示commit plan：建议一个业务commit `feat(frontend-v2): implement system audit log`，列出contract/backend/V1/V2/test/docs文件及所有排除项。
- [ ] 用户确认后才在临时branch commit；不push/PR。
- [ ] 再获用户授权后运行Trellis finish/archive流程；如会生成journal/bookkeeping commit，执行前说明。
- [ ] primary workdir clean main上用`git merge --ff-only codex/frontend-v2-system-audit`；确认validated commit已在main。
- [ ] 删除本地临时branch；若远端同名branch意外存在，停止并单独请求删除授权。
