# Research: Content Version review state 合同与稳定规格证据

- Query: 核对 content-version-review-state-integrity-mapping 对两个 ContentVersion review-state partial unique 的最终合同、command owner、公共合同零 diff、稳定 spec 同步、任务依赖与 scope-stop 条件。
- Scope: mixed（内部代码、迁移、合同、稳定规格与前置 Trellis 任务；未执行外部网络研究）
- Date: 2026-09-14

## Findings

### 1. 完整阅读范围与决策状态

本研究完整阅读并以行号复核以下资料：

- .trellis/workflow.md：planning/execute 边界、复杂任务必须具备 PRD/design/implement、manifest 与 review gate；见 :1-155、Phase 1、Phase 2、Phase 3。
- .trellis/tasks/09-04-integrity-error-domain-mapping/prd.md：父任务的 unknown boundary、三类失败、公共合同顺序、后续 T4/I4 边界；见 :3-22、:46-78、:97-111。
- .trellis/tasks/09-04-integrity-error-domain-mapping/design.md：command-scoped diagnostics、root rollback、全局 handler 去留、T4/I4 拆分与停止条件；见 :1-12、:74-116、:156-185、:255-299。
- .trellis/tasks/09-04-integrity-error-domain-mapping/implement.md：I4 的单一目标、required validation、依赖顺序与 closeout；见 :1-22、:107-159、:160-206。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/prd.md：九项 content/generation 决策任务的范围及唯一新公共码候选；见 :1-7、:20-30、:50-63。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/design.md：review-state 分类、HTTP/前端合同、事务表、同步策略与风险；见 :1-17、:64-87、:89-128。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/implement.md：后续 I4 implementation Task 的范围、验证和依赖；见 :1-20、:91-129、:130-182。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/research/contract-decision-matrix.md：九项最终矩阵，特别是 review pending/approved 两行；见 :1-30、:124-150；同步与测试见 :42-79。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/research/content-version-integrity.md：ContentVersion identity 与 review-state owner/rollback 候选；见该文 :1-72，其中 review-state 行的最终候选见 :37-40。
- .trellis/tasks/09-05-content-integrity-error-contract-decision/research/public-contract-frontend-impact.md：operation status、ErrorDetail 开放 string、Content Editor/Review Page consumer 与生成类型影响；见该文 :1-114，review 行见 :37-40。
- .trellis/spec/backend/error-handling.md：唯一约束窄映射、unknown 500、ErrorEnvelope 与 operation metadata；见 :61-116、:127-142、:173-205、:207-250。
- .trellis/spec/backend/database-guidelines.md：ContentVersion 分配与 final transaction、content task/版本状态规则；见 :346-353、:501-535、:577-581。
- .trellis/spec/frontend/state-management.md：Content Editor 本地/服务端状态与冲突恢复、Content Review 命令合同；见 :231-237、:445-497。
- contracts/openapi.yaml：submitContentVersion 与 approveContentVersion 已声明的 200/401/403/404/409/422/400；见 :2458-2474、:2492-2508；开放 ErrorDetail.code 见 :4192-4206。
- contracts/database.md：ContentVersion 状态机、任务 current pointer、唯一 pending 与版本分配规则；见 :377-423。
- docs/frontend-v2/05-business-actions-state-and-api-contract.md：Content Version 单主线、revision、Editor Context 与 Review Context 的动作/409 policy；见 :112-127、:181-189、:257-259。

前置合同决策任务虽仍保留其 planning 状态，但用户已批准该决策并在当前请求明确冻结最终实现合同。因此本子任务必须使用用户本次明确的最终结果覆盖前置 research 中“建议/待批准”的历史措辞：pending exact pair 映射 CONTENT_REVIEW_PENDING；approved exact pair 保持 unknown/default 500。

### 2. 两条约束、唯一 owner 与当前代码事实

ORM 的 authoritative ContentVersion 定义明确声明：(task_id, version) 与 source_job_id 是唯一约束，approved/pending 是以 task_id 为 key 的两个 partial unique index；见 backend/app/models/content.py:91-115。其中：

- approved index：uq_content_versions_one_approved_per_task，谓词 status = 'APPROVED'，见 backend/app/models/content.py:98-103。
- pending index：uq_content_versions_one_pending_per_task，谓词 status = 'PENDING_REVIEW'，见 backend/app/models/content.py:104-109。
- 状态可选值由 ck_content_versions_status_business_workflow 限定，见 backend/app/models/content.py:110-114。

当前 migration 证据有两个来源，必须在 implementation 前以 current-head PostgreSQL catalog 复核而不可仅凭命名约定：

- 初始 schema metadata 在 backend/app/migration_schema_v1.py:466-479 创建 approved partial index。
- 业务工作流 migration 0035_business_workflow_primary_tasks.py:173-198 创建 pending partial index，并以迁移前检查拒绝多 pending 数据，检查见 :35-59。

因此两个 index 的最终名称/定义应由 real PostgreSQL pg_indexes/pg_class/pg_index 与真实异常 diagnostics 再确认；若实际 catalog 缺名、谓词、唯一性或列定义不一致，触发 scope stop，禁止添加 alias、message fallback 或 migration。

唯一 command owner 是 review.transition_content_version：

- 读取目标版本并加行锁，比较 expected_revision，见 backend/app/services/review.py:340-357。
- 加锁 ContentTask，并验证 current pointer、状态转换和 blocking quality gate，见 backend/app/services/review.py:358-370。
- submit-review 会更新目标状态/revision、追加 ContentReviewRecord，并在同一函数末尾 db.commit()，见 backend/app/services/review.py:386-411。
- approve 会读取旧 approved，先标记 SUPERSEDED 并递增 revision、显式 db.flush()，再更新目标为 APPROVED/递增 revision、追加 review record 和 SUCCESS audit，最终仍由同一个 db.commit() 提交，见 backend/app/services/review.py:371-411。

这证明两个约束必须作为同一 command owner/同一事务设计审查，但失败语义不同：pending 是可由精确 index identity 证明的业务 blocker；approved 不能从 constraint identity 推断哪个 approved version 应为 canonical winner。

### 3. 冻结的 backend 合同

实现只允许在 transition_content_version 自己拥有的 flush/commit 边界捕获 IntegrityError；分类必须同时满足：

    error.orig.sqlstate == "23505"
    and error.orig.diag.constraint_name == "uq_content_versions_one_pending_per_task"

只有该 exact pair 才能在 root transaction rollback 后抛出：

    HTTP 409
    code: CONTENT_REVIEW_PENDING
    message: 该任务已有待审核内容版本
    details: {}
    error.request_id == response header X-Request-ID

禁止使用 REVISION_CONFLICT、INVALID_STATE_TRANSITION、通用冲突码、str(error)、数据库 message、substring 或回查 winner 猜测约束身份。稳定 error-handling spec 的通用规则已经要求只读 orig.diag.constraint_name、其他 IntegrityError 原样上抛，见 .trellis/spec/backend/error-handling.md:76-88 与 :109-116；未知边界和 no-leak 要求见 :173-205。本 Task 应将 content review 两个 exact pair 加入该 spec 的稳定领域矩阵，而不是建立全局 mapper/registry。

下列输入必须在 flush 前保持现有优先级和结果：

- stale expected_revision 仍在 review.py:356-357 返回 REVISION_CONFLICT；
- 非当前内容版本仍在 :358-360 返回 CONTENT_VERSION_NOT_CURRENT；
- 非法状态转换仍在 :361-365 返回 INVALID_STATE_TRANSITION；
- request-changes 空备注与 blocking quality gate 仍分别在 :366-370 返回既有错误。

approved exact pair（uq_content_versions_one_approved_per_task）必须重新抛原始 IntegrityError，保持 unknown/default 500：不返回“已有批准版本”409，不返回 revision/state code，不自动选择 winner、supersede、reload 或 replay。默认 500 的 body/code/media type/header 不能被本 Task 固化为新公共合同；该结论直接受 .trellis/spec/backend/error-handling.md:177-205 约束。

### 4. 事务原子性证据与实现约束

approve 的操作顺序存在可观察的晚期失败窗口：旧 approved 的状态/revision 已 flush（review.py:375-385），目标状态/revision、review record 与 SUCCESS audit 在 :386-410 加入 Session，commit 在 :411。因此 approved constraint failure 的 required proof 必须在真实 current-head PostgreSQL 中确认 root rollback 恢复：

- 原 approved 的原始状态与 revision；
- 目标版本的原始状态与 revision；
- 不新增 ContentReviewRecord；
- 不新增 SUCCESS AuditLog；
- ContentTask.current_content_version_id 与 task revision 不变；
- 其他同事务写入不残留；
- rollback 后 request Session 可继续查询。

pending submit 同样必须证明目标状态/revision、待新增 ContentReviewRecord 及其他同事务写入整体回滚；不得改变 task pointer/revision、其他 ContentVersion、AuditLog 或 dispatch。contracts/database.md:409-423 和 .trellis/spec/backend/database-guidelines.md:346-353 已冻结 immutable version、pointer、版本分配和原子 final transaction，但没有把 review pending/approved 两条 exact diagnostics 与上述晚期 rollback 清单写成稳定条款；这是本 Task implementation 允许的必要 database-guidelines 同步范围。

SQLAlchemy failed-session 规则来自父设计：flush/commit 失败后必须先 rollback 才能继续查询或写入，业务 command 负责 root rollback；见 .trellis/tasks/09-04-integrity-error-domain-mapping/design.md:74-116。不应让 classifier 隐藏 rollback ownership，也不应为本任务引入 savepoint abstraction；只有真实外层组合事务需要保留外层状态时才由外层建立 nested savepoint，且 begin_nested() 前置 flush 失败仍要求 root rollback，见父 implement :289-295。

### 5. 公共 contract 零 diff 结论

静态 OpenAPI 已为两个 operation 预留 409 ErrorResponse：

- submitContentVersion 及参数/响应见 contracts/openapi.yaml:2458-2474；
- approveContentVersion 及参数/响应见 contracts/openapi.yaml:2492-2508；
- ErrorDetail.code 是开放 string，details 是开放 object，且 request_id 已是必需字段，见 contracts/openapi.yaml:4192-4206。

后端 router metadata 与静态合同相同，submitContentVersion/approveContentVersion 都调用 error_responses(401, 403, 404, 409, 422)，见 backend/app/routers/production.py:541-570；路由函数把 request.state.request_id 传给 service，见 :547-563、:572-588。因此 CONTENT_REVIEW_PENDING 只是已声明 409 envelope 内的开放 code，不改变 status/schema/media type/header；approved unknown 500 也不是新增稳定 response。

generated client 同样已有两个 operation 的 200/400/401/403/404/409/422 response union，见 frontend/src/shared/api/generated/schema.d.ts:9105-9137；无需新增 enum、500 类型或 regenerated diff。backend/tests/unit/test_contract.py:216-218 的 operation inventory 也已包含两个 operation；backend/tests/unit/test_runtime_response_metadata.py:338-345 的 runtime status map 已声明相同 409 集合。实施只能运行生成/contract gate 证明零 diff，不得修改这些只读 owner。

如果证据要求改变 409 status、ErrorEnvelope 字段、ErrorDetail.code enum、稳定 500 response、runtime metadata 或 generated type，必须停止当前 implementation planning/实施并另建 contract-first Task；不能在 I4 中扩大范围。

### 6. 前端 consumer 与当前缺口

真正的 pending consumer 是 Content Editor 的“提交审核”Dialog，而不是 Content Review Page：

- Editor 的 submit mutation 使用 baseRevision 和 Dialog comment，见 frontend/src/domains/content/content-editor-page.tsx:194-199。
- 当前 submitReview 成功关闭 Dialog；catch 只对 REVISION_CONFLICT 调用 conflict projection，其他 code 直接 rethrow，见 :297-307。
- Dialog 在 :780-843 持有 comment；button 只有 submitting 或 Boolean(conflict) 时禁用，见 :825-841。因此若 CONTENT_REVIEW_PENDING 不进入独立 conflict/blocker state，Dialog 会保留普通错误但可能再次 POST，违反“用户显式 reload 前禁止再次 POST”。
- 共用的 ContentEditorConflictNotice 当前标题硬编码“检测到 revision 冲突”，见 :875-919；pending 不能复用该文本而伪装 revision，需要 code-aware 的独立 pending blocker/notice 或等价投影。
- Editor 查询在有 conflict 时禁用自动 query/refetch 并取消 exact query，见 :78-94；canonical context 仅在显式 reload 成功后 reset form/base revision/conflict，见 :322-338。这支持 pending 的“暂停背景采用、reload 失败保留备注/error/request ID、成功后采用 canonical context”合同。
- 现有 mapContentEditorError 已保留开放 code 与 requestId，并只从结构化 details 投影字段，见 frontend/src/domains/content/content-editor.model.ts:136-183；应增加 exact-code 纯投影，不以 message 推断类型。

现有 Editor 测试只覆盖 REVISION_CONFLICT submit-dialog 保留备注、request ID、reload failure/success、POST once，见 frontend/src/domains/content/content-editor-page.test.tsx:330-382、:384-450。这些测试可作为新 pending cases 的基线，但不能证明 pending；content-editor.model.test.ts 当前主要覆盖 mode/action/payload，见 :96-161，需新增 exact/negative/malformed details 纯投影测试。

Content Review Page 仅负责 approve/request-changes：approve mutation 和 request-changes mutation 见 frontend/src/domains/content/content-review-page.tsx:108-121；其 409 handler 目前对任意 409 刷新 context，见 :145-153。approved unknown 500（status 500）不会进入该 409 分支，但必须新增回归证明 generic server failure、不自动 replay、不自动 reload/选择其他 approved version。现有 Review Page 409 测试证明 request changes 只 POST 一次并保留意见/request ID，见 frontend/src/domains/content/content-review-page.test.tsx:350-375；它不是 pending submit consumer。

稳定前端规则已经要求 Content Editor 的 form/Dialog/local state 与 TanStack Query server state 分离，且 revision conflict 仅显式 reload，见 .trellis/spec/frontend/state-management.md:231-237；Content Review page 的 409 input/request ID preserve/no replay 见 :465-497。但该 spec 目前没有 CONTENT_REVIEW_PENDING 专用 blocker、背景 canonical pause 或 approved unknown 500 规则；implementation 必须在同一稳定 spec 中新增最小语义，不改变视觉设计、配色或动效。

Frontend V2 文档当前把 Content Version 409 统一写成保留本地表单、显式 reload、禁止 replay，见 docs/frontend-v2/05-business-actions-state-and-api-contract.md:181-189；Review Context 也规定 409 保留输入/request ID、刷新 canonical、不 replay，见 :257-259。该表述应细化为：Editor submit 的 CONTENT_REVIEW_PENDING 是独立 pending blocker，且 approved unknown 500 是 generic failure；不能把所有 409 或 500 都改成 revision 专用路径。文档更新限定于稳定语义，不改 operation/schema。

### 7. 任务依赖、允许文件与 scope-stop 条件

任务依赖是单向且必须写入 child artifacts：

    09-05-content-integrity-error-contract-decision（已批准的合同决策，仍 planning）
      -> I1 generation-job-idempotency-integrity-mapping
      -> I3 content-version-identity-integrity-boundary
      -> I4 content-version-review-state-integrity-mapping（本任务）

I4 不依赖 I1/I2/I5 的业务代码；但依赖前置合同决策已批准，并建议按 I1→I3→I4 的 review 顺序以减少同一稳定 spec/测试文件冲突。父 implement 已明确 I4 单一目标与 required command，见 .trellis/tasks/09-05-content-integrity-error-contract-decision/implement.md:91-129。

允许 production/test owner：

- Backend：backend/app/services/review.py、backend/tests/integration/test_content_review.py。
- Frontend：frontend/src/domains/content/content-editor-page.tsx、content-editor-page.test.tsx、content-editor.model.ts、content-editor.model.test.ts、content-review-page.test.tsx；content-review-page.tsx 仅在 generic 5xx 行为不满足冻结合同才做最小修改。
- Docs/spec：.trellis/spec/backend/error-handling.md、.trellis/spec/backend/database-guidelines.md、.trellis/spec/frontend/state-management.md、docs/frontend-v2/05-business-actions-state-and-api-contract.md。

只读/zero-diff owner：contracts/openapi.yaml、contracts/database.md、backend/app/routers/production.py、backend/tests/unit/test_contract.py、backend/tests/unit/test_runtime_response_metadata.py、frontend/src/shared/api/generated/schema.d.ts、数据库 schema/migration。其 zero-diff 应通过门禁验证；不得为了测试 convenience 触碰 Task/Version 锁、状态机、migration 或全局 mapper。

必须停止并向主 agent 报告的证据条件：

1. current-head PostgreSQL 中任一 partial unique 的名称、列、谓词、唯一性与 ORM/migration 不一致；不得使用猜测或改 schema 补救。
2. exact pending 409 无法继续使用现有 ErrorEnvelope/409/request-ID metadata，或需要新增 OpenAPI status/schema/code enum/generated type。
3. approved exact 23505 无法在相同 command transaction 中完整 rollback，或只能通过 winner 查询/自动 supersede/replay 才能恢复。
4. 既有 stale revision、current-version、state、permission、quality-gate 错误在 flush 前无法保持 code/message/details/status 原样。
5. 前端要跨出 Content Editor/Review owner，或需要修改公共状态机、权限模型、ContentTask pointer、FactVersion/publication/GEO、全局 error registry。
6. 实现需要把 pending blocker 当 revision、解析 message、宽泛映射 23505、增加稳定 500 JSON、自动 POST replay 或背景 canonical adoption。

### 8. Required validation 对 planning 的约束

后续 implementation 的最小可观察验收必须覆盖：

- classifier exact/negative matrix：sqlstate、constraint name、diagnostics 缺失、其他 unique/partial index、CHECK/FK/NOT NULL/trigger-like failure 均有明确原抛或映射结果；classifier 不执行 rollback/查询。
- current-head PostgreSQL：直接读取两个 partial index 的真实名称、定义/谓词，并捕获真实 23505 + diag.constraint_name。
- pending HTTP：exact pending pair 返回 409 CONTENT_REVIEW_PENDING、固定 message/details、body error.request_id 与 X-Request-ID 相等；其它 diagnostics unknown 500。
- approved HTTP：exact approved pair default 500/no-leak；不返回“已有批准版本”、REVISION_CONFLICT 或稳定内部错误 body/code/media type。
- submit rollback：目标 status/revision、ReviewRecord、Task pointer/revision、其他 ContentVersion/AuditLog/dispatch 保持基线；rollback 后 Session 可复用。
- approve rollback：原 approved 的 SUPERSEDED/revision、目标 APPROVED/revision、ReviewRecord、SUCCESS AuditLog、Task pointer/revision 和其他写入全部保持基线；rollback 后 Session 可复用。
- precheck priority：真实 stale revision、非当前版本、非法状态、权限与 quality gate 均在 flush 前保持原合同；成功 submit/approve regression 通过。
- Editor model/component：exact pending 纯投影；malformed details、其他 code、缺 request ID fallback；备注/code/request ID 保留；Dialog 保持打开；背景 canonical 不采用；reload failure 保留输入与错误；reload success 后才采用 canonical；submit POST 恰一次；不自动 replay。
- Review Page：approved unknown 500 generic server failure，不进入 revision reload 专用分支，不自动 approve/replay/采用其他 approved。
- zero-diff/quality：运行指定 integration/unit/Vitest/typecheck/ESLint、git diff --check、OpenAPI/router/generated/database/migration zero-diff gates、Trellis validation 与一次独立只读 review；full backend/frontend suite 和完整 build 仍是 optional，未运行时记录替代证据和残余风险。

## External references

- 未使用外部网页或第三方引用；本结论以仓库内 OpenAPI、ORM/migration、服务、测试、Frontend V2 文档与 Trellis specs 为 authority。
- PostgreSQL 23505/DBAPI diag.constraint_name 的真实值必须在 implementation 的 current-head PostgreSQL 中观测；静态 ORM/migration 行号只能作为候选证据，不能替代运行时 catalog/diagnostics 验证。

## Related specs

- .trellis/spec/backend/error-handling.md:61-116,173-205：窄 diagnostics mapper、unknown default 500、no-leak 与 rollback 后映射。
- .trellis/spec/backend/database-guidelines.md:346-353,501-535：ContentVersion lock/version/final transaction、不可变内容与任务 pointer 约束；需补 review-state exact pair/rollback 语义。
- .trellis/spec/frontend/state-management.md:231-237,445-497：Editor 本地表单/冲突恢复与 Review 命令输入/request ID/no replay；需补 pending 独立 blocker 与 approved unknown generic 500。
- docs/frontend-v2/05-business-actions-state-and-api-contract.md:112-127,181-189,257-259：ContentVersion 单主线、revision、Editor/Review 409 行为；需细化 submit pending 与 approve unknown 500。
- contracts/openapi.yaml:2458-2474,2492-2508,4192-4206、backend/app/routers/production.py:541-588、frontend/src/shared/api/generated/schema.d.ts:9105-9137：公共 operation/status/schema/metadata 已足够，implementation 应保持零 diff。

## Caveats / Not Found

- 未运行 PostgreSQL、HTTP、worker 或 frontend tests；本研究证明静态 owner/合同边界，不证明 race 可达性、当前数据库实例 catalog 或默认 500 的具体 body/header。后者只能由 I4 required validation 观测，且不得固化为公共合同。
- 前置决策 research 的 review pending 行仍使用“建议新增/待 T4-C 批准”措辞（例如 contract-decision-matrix.md:133-139、content-version-integrity.md:37）；这是历史决策阶段残留，不是当前用户冻结的未决产品决定。I4 artifacts 应明确“已批准且唯一新增 code 为 CONTENT_REVIEW_PENDING”。
- backend/app/migration_schema_v1.py 的 approved index 与 later Alembic 0035 的 pending index 分属不同建表阶段；若 current-head DB 实际缺 approved index 或出现不同谓词，必须 scope stop，不能自行新增 migration，因为 schema/migration 是本任务只读 owner。
- contracts/database.md:383-423 记录状态机、唯一 pending、pointer 与版本分配，但未分别写出 approved partial unique 的 no-winner 语义；本 Task 不能修改该 contract，只能在 .trellis/spec/backend/database-guidelines.md 写必要的 transaction/constraint-owner 语义，并把 contract zero diff 作为验收项。
- 当前 ContentEditorConflictNotice 的标题明确写作 revision conflict（content-editor-page.tsx:875-903），而 submitReview 只处理 REVISION_CONFLICT（:297-307）；这是已证实的实现缺口，不是允许把 pending 映射成 revision 的理由。
- content-review-page.tsx:145-153 对任何 409 触发 refresh，但 approved unknown 500 不会走该分支；若现有 generic 500 已满足冻结合同，production page 应保持零 diff，仅增加 content-review-page.test.tsx 回归。
- 不存在安全证据支持全局 IntegrityError registry、message parser、post-error winner inference、自动 replay 或第二套 error type system；这些均保持禁止。
