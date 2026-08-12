# Audit — Publishing Vertical Slice 抽象回顾

## 1. Executive conclusion

Publishing vertical slice 的主架构成立：三个资源与三组 canonical URL 独立；route 保持薄层；API/query keys/action qualification 为单一 owner；页面没有 browser join、当前页过滤、第二 DTO 或 role/status 资格推导；三个 read-model 边界为单请求；已共享的 Workspace、Detail、Timeline、StickyActionBar、RowActions、Dialog 与 Badge 没有反向依赖 Publication。

本轮不应创建任何新 shared framework，也没有可整文件删除的测试。需要最小代码调整：3 个前端一致性缺陷，以及 2 个局部删除项。另有 1 个 backend snapshot projection 缺陷和 1 个 OpenAPI error response 缺口必须由后续 Task 修复；因此当前 Phase 4 Exit Gate 初判为 `NOT_MET`。

## 2. Audit matrix

| # | Audit item | Evidence | Result |
|---|---|---|---|
| 1 | 三资源与三组 URL | backend models/router；`routes/_app/publishing/{work,articles,issues}`；generated route tree | PASS — 独立资源，不合并 |
| 2 | route 薄层 | 六个 Publishing route 仅校验、prefetch、metadata、composition；cache callback 有归档设计授权 | PASS |
| 3 | API/query/action/error owner 唯一 | `publication.api.ts:36-456`；三个 model registry | PASS，error alias 可删 |
| 4 | server-projected eligibility | backend action functions；页面只读取 `primary_task` / `available_actions` / candidates | PASS |
| 5 | join/waterfall/filter/DTO/fallback | list 直接渲染 server `items`；generated aliases；fixture 拒绝未声明 API | PASS，但 resolved outcome 有 silent default defect |
| 6 | single-request snapshot boundary | Work Context、Article Detail、Issue Context 各一 GET；Package/repair 按需 | PASS，repair 409 reload 有 stale-cache defect |
| 7 | immutable snapshot/history | DB guards、RR reads、real-stack verification/event/content lineage | PARTIAL — Work display live-first projection 与 frozen rule 冲突 |
| 8 | 万能 DataTable 风险 | 三列表列、过滤、row action 不同，只复用 Table primitives | PASS — 不提升 |
| 9 | 可提升重复 | WorkspaceShell、DetailSection、Timeline、StickyActionBar、RowActions 已共享且有跨域消费者 | PASS — 无新增提升 |
| 10 | 重复 DS pattern | Publication 已直接消费现有 primitives/workspace kit | PASS |
| 11 | shared 反向依赖 | DS/shared 未导入 Publication DTO/token/permission/state machine | PASS |
| 12 | 三层测试互补性 | component、fixture、real-stack 分别证明逻辑、浏览器边界、真实栈生命周期 | PASS — 无测试文件可删 |
| 13 | cache/409/URL/RHF/local owner | URL canonical、RHF、query keys 明确；Article/Issue 两处 409 owner 不完整 | PARTIAL |
| 14 | wrapper/helper/registry/options-heavy | `publicationCoreActions` 无生产消费者；error mapper alias 无语义 | PARTIAL — 可局部删除 |
| 15 | docs/OpenAPI/code/generated/real-stack | contract check 与 generated types 对齐；runtime list 409 未声明 | PARTIAL |

## 3. Ownership findings ledger

### F-01 — Three resource boundaries

- severity: INFO
- file:line: `backend/app/models/publication.py:61-250`; `backend/app/routers/publication.py:337-708`; `frontend-v2/src/routes/_app/publishing/work/index.tsx:11-49`; `articles/index.tsx:10-39`; `issues/index.tsx:10-37`
- observed evidence: Work、Article、Issue 各有独立 ORM/schema/router/model/list/detail URL；PublishedArticle 与 Work 同 ID 是 ADR 决策，不是第二 DTO。
- impact: 保持生命周期、查询与 action 语义清晰，避免错误合并状态机。
- current owner: backend Publication + frontend Publication routes/models
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 无。
- validation: canonical model tests、fixture direct/reload/history、contract check。
- defer trigger: 无；后续也不得仅因名称相似而合并。

### F-02 — Thin routes and cache composition

- severity: INFO
- file:line: `frontend-v2/src/routes/_app/publishing/work/index.tsx:11-49`; `work/$workId.tsx:12-59`; `articles/$articleId.tsx:10-52`; `issues/$issueId.tsx:12-59`
- observed evidence: route 无 form、status、role、`available_actions` 推导；`contentKeys` callbacks 是归档 Work/Issue design 明确要求的 application composition，用于避免 Publication domain 导入 Content internals。
- impact: 路由边界成立；把 callback 下沉反而会制造跨域依赖或 QueryClient wrapper。
- current owner: route/application composition
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 无；不创建 generic route/cache factory。
- validation: route canonical fixture tests、typecheck、dependency-direction search。
- defer trigger: 出现第四个完全同合同消费者且提取能净删代码、又不隐藏 TanStack 类型时再评估。

### F-03 — Unique API/query/error owner with alias debt

- severity: LOW
- file:line: `frontend-v2/src/domains/publication/publication.api.ts:36-81,90-227,230-456`; `start-publication-dialog.tsx:23-25`
- observed evidence: endpoint、query key、error mapping 都集中在 `publication.api.ts`；但 `mapPublicationError = mapPublicationStartError` 是无语义 alias。
- impact: 两个导出名暗示两个 error owner，增加搜索与漂移成本。
- current owner: Publication API
- recommended owner: Publication API 的单一 `mapPublicationError`
- decision: Simplify locally
- proposed minimal change: 保留一个 mapper，更新 Start dialog 与现有 API test，删除 alias。
- validation: `publication.api.test.ts`、typecheck、Publication domain tests。
- defer trigger: 无外部消费者；若实施前发现白名单外公开消费者，停止并重新评估。

### F-04 — Server-driven action qualification

- severity: INFO
- file:line: `backend/app/services/publication_queries.py:112-201`; `publication-workspace.model.ts:62-94`; `published-content-issue.model.ts:105-177`; `published-article-detail-page.tsx:126-131`
- observed evidence: backend 生成三类 action tokens；前端只读取 tokens/candidates，未知组合 fail closed，没有 role/status 资格推导。
- impact: 状态机和权限仍由 server 权威控制。
- current owner: backend projection；frontend domain presentation
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 无；不创建跨资源 action framework。
- validation: backend action unit tests、frontend model/page tests、real-stack flows。
- defer trigger: 无。

### F-05 — No browser join, local filtering, or second DTO

- severity: INFO
- file:line: `frontend-v2/src/domains/publication/publication-work-page.tsx:347-397`; `published-article-list-page.tsx:164-206`; `published-content-issue-list-page.tsx:120-153`; `publication.api.ts:1-35`
- observed evidence: list 直接消费 server pagination；所有 DTO 是 generated schema alias；Work 页三个 GET 各服务独立 surface，不在浏览器合并业务资格。
- impact: bounded query、URL state 与 backend projection 边界清晰。
- current owner: Publication domain + backend query
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 无。
- validation: API call-count tests、strict fixture unexpected-request teardown、backend query-count tests。
- defer trigger: 新需求要求跨 surface 原子快照时先改 server read model，不在浏览器 join。

### F-06 — Single-request read models

- severity: INFO
- file:line: `backend/app/services/publication_queries.py:468-569,678-855,951-1029`; `backend/app/routers/publication.py:118-121`; `frontend-v2/tests/e2e/publication-workspace.spec.ts:5-24`; `published-articles.spec.ts:11-37`; `published-content-issues.spec.ts:11-25`
- observed evidence: Work Context 固定五条 backend queries 但一个 HTTP snapshot；Article Detail 与 Issue Context 各一 GET；Package/repair 只在用户动作时加载。
- impact: 页面无 waterfall，snapshot owner 在 server transaction。
- current owner: backend Publication read models
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 无；不要为复用改写 bounded query assembly。
- validation: query-count integration、fixture request counts、real-stack exact Article GETs。
- defer trigger: query count 随关系数量增长或一个页面首屏出现第二业务 GET 时。

### F-07 — Resolved issue silently defaults to retired

- severity: P2
- file:line: `frontend-v2/src/domains/publication/published-content-issue-workspace-page.tsx:201-209`; `frontend-v2/src/generated/schema.d.ts:4433-4437`
- observed evidence: `RESOLVED` 分支用 `RESTORED ? 已恢复 : 已退役`；nullable/未知 `resolution_outcome` 会被猜成 RETIRED。
- impact: UI 可展示错误的不可变 resolution 事实，违反 unknown fact 必须显式失败。
- current owner: Issue Workspace page
- recommended owner: 同一 Publication Issue page/model trust boundary
- decision: Confirmed defect requiring change
- proposed minimal change: 穷尽两个合法值；缺失时显示明确 context/contract incomplete failure，不增加 fallback。
- validation: 现有 Issue workspace component test 增加 `RESOLVED + null` regression；typecheck。
- defer trigger: 无。

### F-08 — Article OPEN_ISSUE 409 lacks stale/no-replay recovery

- severity: P2
- file:line: `frontend-v2/src/domains/publication/published-article-detail-page.tsx:236-337`; `backend/app/services/publication.py:784-808`
- observed evidence: mutation catch 只设置 server error；dialog 没有 stale state、显式 reload 或 submit disable。后端在已有 OPEN/RETIRED issue 时合法返回 409。
- impact: 过期 token 下用户可再次 POST；输入与 canonical Article context 的恢复所有权不清晰。
- current owner: Article Detail / OpenIssueDialog
- recommended owner: 同一 Article query + dialog owner
- decision: Confirmed defect requiring change
- proposed minimal change: 409 保留输入、禁用 submit、只允许显式 refetch Article；reload 后读取最新 `available_actions`/`open_issue_id`，不自动 replay。
- validation: component test 证明一次 POST、输入保留、显式 GET/reload、token 重判；Article fixture regression。
- defer trigger: 无。

### F-09 — Issue repair context remains stale after reload

- severity: P2
- file:line: `frontend-v2/src/domains/publication/published-content-issue-workspace-actions.tsx:59-60,123-127,154-170`
- observed evidence: create repair 使用按需 query 中的 revision/candidates；409 后 `reloadContext()` 只刷新 Workspace，未刷新 repair query。
- impact: 显式 reload 后仍可能用旧 revision/candidates 再次冲突，破坏 no-replay 恢复语义。
- current owner: Issue Workspace Actions
- recommended owner: 同一 component 的两个 canonical query owners
- decision: Confirmed defect requiring change
- proposed minimal change: `CREATE_REPAIR_TASK` stale reload 时显式 `repair.refetch()`；两个 context 成功后再清 stale，保留输入且不 replay。
- validation: 现有 workspace test 增加 conflict → reload → repair GET → latest revision submit。
- defer trigger: 无。

### F-10 — Dead `publicationCoreActions`

- severity: LOW
- file:line: `frontend-v2/src/domains/publication/publication-workspace.model.ts:62-78`; `publication-workspace.model.test.ts:25-37`
- observed evidence: production search 无调用；实际 action bar 使用 `publicationWorkspaceActions`，只有单测调用该 helper。
- impact: 重复 action resolver 制造不存在的第二 owner 与维护成本。
- current owner: Publication Workspace model
- recommended owner: 删除；保留 `publicationWorkspaceActions`
- decision: Simplify locally
- proposed minimal change: 删除 helper、只为它存在的类型/测试；不添加替代层。
- validation: model tests、domain tests、typecheck。
- defer trigger: 若实施前出现真实 production consumer，停止删除并重新判断，而不是为未来保留。

### F-11 — Stable shared workspace/table primitives

- severity: INFO
- file:line: `frontend-v2/src/design-system/workspace/workspace-shell.tsx:89-103`; `detail-section.tsx:5-25`; `timeline.tsx:5-35`; `sticky-action-bar.tsx:3-129`; `design-system/data-table/row-actions.tsx:68-220`
- observed evidence: Publication Work/Issue/Article 与 Content/Product 至少两个真实消费者共用相同通用 props、DOM/a11y；DS 无 Publication import。
- impact: 已有正确抽象边界；再包 Publication-specific Workspace/Timeline/RowActions 只会增加层级。
- current owner: Design System/shared
- recommended owner: 不变
- decision: Keep in Design System/shared
- proposed minimal change: 无。
- validation: `workspace-kit.test.tsx`、`table-kit.test.tsx`、Publication page tests、dependency search。
- defer trigger: 业务 token/权限/status 进入 props 时应拒绝提升并回退 domain mapping。

### F-12 — Similar local metadata/failure helpers are not stable patterns

- severity: INFO
- file:line: `publication-workspace-page.tsx:296-303,358-360`; `published-content-issue-workspace-page.tsx:297-313`; `published-article-detail-page.tsx:411-427`
- observed evidence: `ContextValue`/`Metadata`/`errorMessage` 名称相似，但 value 类型、className、mono、spacing、failure recovery 与 a11y 语义不同。
- impact: 提取会产生 options-heavy abstraction，隐藏页面语义且未必净删代码。
- current owner: 各 Publication page
- recommended owner: 暂不改变
- decision: Promote only after proven consumers
- proposed minimal change: 无。
- validation: 现有 page tests；实施 diff 不新增 shared helper。
- defer trigger: 至少两个真实页面在 DOM、props、交互、a11y 完全一致，且提取能净删代码。

### F-13 — Test layers are complementary

- severity: INFO
- file:line: `frontend-v2/src/domains/publication/publication-work-page.test.tsx:103-252`; `publication-workspace-page.test.tsx:118-342`; `publication-evidence-upload.test.tsx:7-40`; `frontend-v2/tests/e2e/publication-work-list.spec.ts:5-120`; `publication-workspace-real-stack.spec.ts:140-623`
- observed evidence: component 证明 projection/RHF/payload/409；fixture 证明 built app/router/history/strict API/focus；real-stack 证明跨域真实生命周期与 lineage；upload unit 独有 digest/signed PUT。
- impact: 按文件数或 happy-path DOM 重叠删除会丢失不同 failure mode。
- current owner: Publication component tests + Publishing E2E
- recommended owner: 不变
- decision: Keep in Publication Domain
- proposed minimal change: 不删除测试文件或 fixture；本次只在现有 component tests 增加缺陷 regression。
- validation: 最终 targeted tests、fixture specs、`make e2e`。
- defer trigger: 有 CI runtime/coverage 数据证明某个精确断言完全重复且删除后 failure mode 仍被同层覆盖。

### F-14 — Work projection uses live-first values against frozen snapshot rule

- severity: P2
- file:line: `backend/app/services/publication_queries.py:335-363`; `.trellis/spec/backend/publication-workbench-guidelines.md:76,285-286`; `docs/frontend-v2/07-migration-plan.md:402`
- observed evidence: name/label/identifier 使用 `coalesce(live, snapshot)`；终态 Work 会随仍存在的 live profile/account 改名而漂移，非终态 live 缺失则静默退到 snapshot。稳定 spec 要求非终态使用 live 且缺失 409、终态使用 frozen snapshot。`website_url` 没有 Work 自有 snapshot，不纳入本缺陷。
- impact: Work list/detail/workspace 可显示可变或错误来源，破坏 snapshot 与 explicit failure 边界。
- current owner: backend Publication read model
- recommended owner: follow-up `publication-work-projection-contract-correction`
- decision: Confirmed defect requiring change
- proposed minimal change: 本 Task 不改；follow-up 按终态/非终态显式选择来源并补 integration，不添加前端 fallback。
- validation: backend projection integration 覆盖 live rename、terminal frozen、nonterminal missing 409；frontend real-stack。
- defer trigger: 无；这是 Phase 4 blocker。

### F-15 — PublicationWork list runtime 409 missing from OpenAPI

- severity: P2
- file:line: `contracts/openapi.yaml:2122-2131`; `backend/app/services/publication_queries.py:375-384`; `backend/app/routers/publication.py:361-382`
- observed evidence: list operation 只声明 200/401/422；必经 `_work_list_item` 在缺 latest event 时可抛 `PUBLICATION_CONTEXT_INCOMPLETE` 409。现有 contract checker 不枚举所有 runtime error paths。
- impact: API 消费者与生成文档无法知道合法 409；代码、合同与错误 owner 不一致。
- current owner: root OpenAPI + backend Publication router/query
- recommended owner: follow-up `publication-work-projection-contract-correction`
- decision: Confirmed defect requiring change
- proposed minimal change: 本 Task 不改；follow-up 为该 GET 声明 409，并增加 malformed-context contract/runtime regression。
- validation: contract check、backend contract/unit/integration、generated type check。
- defer trigger: 无；这是 Phase 4 blocker。

### F-16 — Intentionally deferred UX/contracts

- severity: INFO
- file:line: `docs/frontend-v2/09-architecture-decisions.md:153-159`; `backend/app/services/publication_queries.py:980-985`; `frontend-v2/src/routes/_app/publishing/**`
- observed evidence: Article permanent deletion API 存在但 V2 明确只读；Issue API omitted status 返回 ALL 而 UI canonical URL 明确发送 OPEN；Publication route 未配置通用 `errorComponent`；website snapshot 来源未定义。
- impact: 未经产品/合同决策实现会扩展范围或猜测业务语义。
- current owner: Product/UX + API contract owners
- recommended owner: 各自独立批准的后续 Task
- decision: Deferred product/UX decision
- proposed minimal change: 本 Task 无代码；不加占位路由、默认值或 fallback。
- validation: 对应需求批准后更新 ADR/contract/acceptance，再实现。
- defer trigger: 独立 Article deletion UX、API default 语义、route error UX 或 website snapshot 合同被正式批准。

## 4. Deletable code and tests

### Delete after approval

- `publicationCoreActions` 及其仅有死-helper 单测。
- `mapPublicationStartError` alias，统一到既有 `mapPublicationError` owner。

### Do not delete

- 任何 component、fixture Playwright 或 real-stack test 文件。
- Work/Article/Issue 各自 model、action registry、status/event presentation。
- route composition cache callbacks。
- Workspace Context、Article Detail、Issue Context 的独立 read model。

## 5. Deferred evidence gaps

以下不是当前已证实缺陷，也不构成增加代码的理由：

- fixture command path 未同时白名单 HTTP method；出现 method regression 时再改成 method/path tuples。
- responsive tests 证明 document root 不溢出，但未锁定 TableRegion 局部 scroll；出现布局回归或明确验收时补。
- 关键键盘/focus 有覆盖，但没有全量 axe/WCAG audit；新增明确质量门槛时补。
- real-stack 证明 lineage/snapshot 保留，但未调用不存在的 mutation API 做负向不可变测试；出现写/删能力时补。
- standalone real-stack 依赖 `e2e-local.sh` 的 per-run DB/storage cleanup；迁移到共享/并行环境时补 test-level cleanup。

## 6. Final validation evidence

白名单实施后的直接证据：

- targeted component/API/model tests：4 files / 22 tests passed；完整 Publication domain：12 files / 48 tests passed。
- `frontend-v2` typecheck、lint、build 全部通过；build 仅报告既有 chunk-size warning。
- Publishing fixture Playwright：3 specs / 11 tests passed（foundation desktop）。
- Publishing real-stack：Flow A、Flow B、Article readonly 三条全部通过；隔离数据库与临时存储均由脚本删除。
- `git diff --check`、Task validation 与 `trellis-check` diff 自审通过；没有越出 10 个批准的主要代码/测试文件，没有新增 shared framework、DTO、fallback 或依赖反转。

完整门禁结果：

- 最终代码与恢复后的 npm 依赖布局上重新运行 `make verify`：合同/API check、lint、typecheck、backend unit 177、V1 unit 203 与 visual-contract 24 全部通过；V2 unit 为 281 passed / 1 failed。唯一失败是范围外 `src/domains/content/new-content-task-page.test.tsx` 的 DirtyGuard 断言；该文件不在本 Task diff，且 isolated rerun 可复现。Makefile 在 `test-unit` 停止，未越界修复。
- `make e2e` 已运行但失败。10 条 real-stack 中 9 passed / 1 failed；唯一失败为范围外 `content-ai-real-stack.spec.ts:245` 等待“自然化次数：1”超时。Publishing 三条 real-stack 全绿；失败发生后 Makefile 未进入完整 fixture 阶段，而本 Task 要求的三个 Publishing fixture 文件已单独 11/11 通过。
- planning audit 的 backend Publication/security/projection unit subset 30 tests、OpenAPI contract checker 与 `npm run api:check` 仍作为审计证据；本 Task 未修改对应文件。

## 7. Final Phase 4 Exit Gate

| Category | Final result | Reason |
|---|---|---|
| Product | MET_BY_EVIDENCE | 三资源生命周期、三组 canonical URL 与完整 Publishing real-stack 主流程成立 |
| Engineering | NOT_MET | task-specific checks 全绿，但最终 `make verify` 与完整 `make e2e` 均非零退出 |
| UX | MET_BY_EVIDENCE | canonical URL/history、关键 focus/keyboard、Dialog、loading/empty/error 与 responsive root 有互补证据 |
| Architecture | NOT_MET | F-07/F-08/F-09 已关闭；F-14 backend Work projection blocker 未关闭 |
| Contract | NOT_MET | F-14 snapshot projection 与 F-15 list 409 声明仍不一致 |
| Documentation | MET | 当前代码、审计 finding、验证失败归因与 migration plan 已同步为同一 `NOT_MET` 状态 |

**Final verdict: `NOT_MET`.**

当前 frontend Task 的白名单调整已完成且专项验证通过，但 Phase 4 仍不得退出。下一步应独立批准 `publication-work-projection-contract-correction` 关闭 F-14/F-15，并在范围外 Content unit/real-stack 阻塞被其 owner 修复后，从最终候选 commit 重新运行 `make verify` 与完整 `make e2e`。不得进入 GEO。
