# Research: wave3-reversible-business-scope

- Query: 在 Staging/预发布环境中，哪些产品事实、内容、发布、GEO、平台配置与系统管理流程可以使用统一 `TEST` 前缀创建并安全清理；哪些流程应仅规划为波次 4
- Scope: internal
- Date: 2026-08-30

## Findings

### 1. 研究边界与测试数据约束

当前任务的实施文档把波次 2 定义为一次登录后 GET-only 的 ADMIN 只读验收；波次 3 只有在再次确认目标为 Staging/预发布后，才可以使用专用测试数据；波次 4 覆盖不可回滚或会触发外部服务的流程。相关边界见 `.trellis/tasks/08-30-v2-live-readonly-acceptance/prd.md`、`design.md`、`implement.md`，以及 `.trellis/workflow.md`。

外部参考：无。本次结论仅基于仓库源码、合同、任务文档、Trellis 规格及现有前端测试；没有引入第三方文档、线上版本或外部运行结果。

建议所有新建实体使用每次运行唯一的 `TEST-W3-20260830-<run-id>-` 前缀。该前缀应放在业务可见名称或产品型号中，而不是伪造服务器生成的 ID；同一 `<run-id>` 不应跨验收运行复用。内容 Markdown、Query Topic 文本、Prompt 模板可以在标题或首行附加相同标记，便于清理时按实体 ID 精确定位。测试夹具中的 `PS-NEW-001`、`PS-NEW-002`（`frontend/tests/e2e/new-product.spec.ts:42-68`）只是本地 fixture 约定，不是已存在的 Staging 数据，也不能作为线上验收证据。

所有写请求都会在服务端重新校验权限、状态和版本；成功写入还会留下审计记录。因而“清理成功”不是无痕回滚：删除本体会保留相应的审计历史或追加删除审计，不能把数据库、审计或不可变版本恢复为完全未发生过的状态。任何清理返回引用阻塞、版本冲突或状态不符合，都应停止而不是尝试级联或重放。

### 2. 可安全创建、可在引用约束下清理的波次 3 流程

以下流程没有必需的第三方调用；它们的可清理性依赖于始终不进入后续业务链。页面与按钮名称以 canonical 前端路由和现有 E2E 为准，若 UI 文案有差异应以当前页面呈现为准。

#### 2.1 空产品（最小测试聚合）

- Canonical 页面/操作：`/products/new`，主操作“创建产品”；创建后进入 `/products/{productId}`，详情的 `workflow_stage` 应为 `FACTS_EMPTY`，`available_actions` 包含 `UPDATE`、`DELETE`。
- API：`POST /api/v1/products`（`frontend/src/domains/product/new-product.api.ts:13-20`；`backend/app/routers/product_facts.py:103-119`）。清理为 `DELETE /api/v1/products/{product_id}?expected_revision={revision}`（前端 `frontend/src/domains/product/product.api.ts:243-253`；后端 `backend/app/routers/product_facts.py:164-181`）。
- 前置条件：目标必须是再次确认的 Staging；调用者需有产品编辑权限，清理者需 ADMIN；`part_number`、`brand`、`category` 经过服务端校验且产品组合不能已存在。不要为该产品提交事实、创建内容任务或关联观测。
- 可观测结果：POST 返回 201 产品；列表和详情重新获取，产品在 `/products` 可见；删除成功后产品不再出现在活动列表，审计列表出现创建/删除记录。产品创建服务在 `backend/app/services/product_facts.py:395-424` 追加创建审计并提交。
- 清理动作：读取详情中的最新 `revision`，按该版本执行 DELETE。产品服务会锁定并检查事实版本、内容任务、GEO 观测引用（`backend/app/services/product_facts.py:488-557`）；无引用时才删除。
- 建议数据：`part_number=TEST-W3-20260830-<run-id>-P001`，品牌与类别也可带相同 run 标记，避免碰撞。
- 硬停止：目标身份或健康/发布身份未重新确认；POST 返回非 201；详情不是 `FACTS_EMPTY`；删除返回引用阻塞、409 版本冲突或任何未预期状态；不得改用强制级联删除。
- 测试参考：`frontend/tests/e2e/new-product.spec.ts:42-68`（trim、CSRF、重复提交、成功跳转），`frontend/tests/e2e/new-product.spec.ts:70-100`（结构化错误）。测试本身为 fixture，不是实网写入。

#### 2.2 独立 Query Topic

- Canonical 页面/操作：`/geo/topics`，主操作为创建 Query Topic，编辑/删除均应使用列表项的服务端动作投影；创建后保持在 Query Topic 列表或详情上下文。
- API：`POST /api/v1/query-topics`、`PATCH /api/v1/query-topics/{id}`、`DELETE /api/v1/query-topics/{id}?expected_revision={revision}`；后端路由见 `backend/app/routers/planning.py:124-186`，前端客户端见 `frontend/src/domains/geo/geo.api.ts:145-199`。
- 前置条件：创建/编辑者需 ENGINEER 或 EDITOR，删除需 ADMIN；Query Topic 必须不被内容任务、GEO 优化任务或观测引用。不要把它用于观测创建。
- 可观测结果：列表项显示创建的题目、变体、revision 与 `available_actions`；编辑后 revision 增加；成功删除后列表移除，审计记录可查询。服务端创建、修改和引用校验在 `backend/app/services/content_planning.py:193-257` 及其 Query Topic 删除实现附近。
- 清理动作：如果只做创建，直接按最新 revision DELETE；如果做编辑，先读取最新 revision 再删除。
- 建议数据：题目、变体和描述均使用 `TEST-W3-20260830-<run-id>-QT001` 标记。
- 硬停止：任何引用计数大于零；删除返回 409、403 或 revision conflict；出现需要把题目绑定到观测/内容任务才能继续的 UI 引导；不要为清理而解除真实业务引用。
- 测试参考：`frontend/tests/e2e/geo-topics.spec.ts:25-32` 验证有引用时删除受阻；该文件的创建/更新 CSRF、revision 与冲突场景（约 `:113-130` 及后续）验证了客户端应保留草稿并显式刷新。

#### 2.3 独立 Platform Type

- Canonical 页面/操作：`/settings/platforms/types`，创建、编辑、删除 Platform Type。
- API：`POST/PATCH/DELETE /api/v1/platform-types/{id}`（创建路由在 `backend/app/routers/configuration.py:341-394` 附近，前端 `frontend/src/domains/configuration/platform.api.ts:132-157`）。删除携带 `expected_revision`。
- 前置条件：ADMIN；创建后 `platform_count=0`，不能绑定 Platform Profile。类型名称和 slug 必须唯一。
- 可观测结果：类型列表出现测试项；更新增加 revision；详情/列表的删除投影保持可用；删除成功后列表移除并生成审计。服务端删除只有在没有 Profile 引用时才允许（`backend/app/services/platform_configuration.py:424-541`）。
- 清理动作：按最新 revision DELETE；若先编辑，必须重新读取 revision。
- 建议数据：`name=TEST-W3-20260830-<run-id>-PlatformType`，`slug=test-w3-20260830-<run-id>-platform-type`。
- 硬停止：`platform_count>0`、存在 Profile 引用、唯一性冲突、revision 冲突或服务端返回非预期状态；不要为清理而删除/迁移真实 Profile。
- 测试参考：`frontend/tests/e2e/platform-types.spec.ts:34-83`（创建、更新、删除、CSRF、revision），约 `:85` 之后的 blocker/conflict 场景。

#### 2.4 未绑定 Platform Prompt

- Canonical 页面/操作：`/settings/prompts`，创建 Prompt，必要时编辑，然后删除；不进入平台绑定流程。
- API：`POST/PUT/DELETE /api/v1/platform-prompts/{id}`，前端 `frontend/src/domains/configuration/prompt.api.ts:35-125`；后端服务创建/更新/删除见 `backend/app/services/platform_configuration.py:612-789`。
- 前置条件：ADMIN；名称唯一、模板 Markdown 非空；创建后 `bound_platform_count=0`。全局 humanization Prompt 是单例且没有删除接口，不属于本候选。
- 可观测结果：列表/详情显示测试 Prompt 及零绑定数；更新 revision 增加；删除后列表移除，审计可查询。
- 清理动作：按最新 revision DELETE，确认仍为零绑定。服务端删除已绑定 Prompt 会解除所有绑定并增加平台 revision（`backend/app/services/platform_configuration.py:742-789`），因此不能把已绑定项当作可安全清理数据。
- 建议数据：`name=TEST-W3-20260830-<run-id>-Prompt`；模板内容首行带相同标记，不包含密钥、真实业务事实或真实客户内容。
- 硬停止：绑定数不为零、删除需要解除绑定、名称冲突、revision 冲突或出现全局 Prompt 入口；不要继续做级联解绑。
- 测试参考：`frontend/src/domains/configuration/prompt.api.ts:35-125`；绑定/删除行为的服务端合同在 `.trellis/spec/backend/available-actions-contract.md` 和 `backend/app/services/platform_configuration.py:742-789`。

#### 2.5 未绑定、无账户的 Platform Profile

- Canonical 页面/操作：`/settings/platforms` 的平台配置工作区，创建 Profile；之后可查看 overview，必要时执行“禁用”，再删除。
- API：`POST/PATCH /api/v1/platform-profiles`、`POST /api/v1/platform-profiles/{id}/disable`、`DELETE /api/v1/platform-profiles/{id}?expected_revision={revision}`；后端创建/删除约 `backend/app/routers/planning.py:216-232`、`backend/app/routers/configuration.py:573-650`，服务端约 `backend/app/services/content_planning.py:300-342`、`backend/app/services/platform_configuration.py:846-983`；前端 `frontend/src/domains/configuration/platform.api.ts:54-116,292-305`。
- 前置条件：ADMIN；先创建独立 TEST Platform Type，可选绑定未绑定 TEST Prompt；Profile 使用测试名称、slug、允许域名。不要创建 Platform Account、上传 logo、创建内容任务或发布工作。
- 可观测结果：Profile 出现在平台列表；新建时 readiness 通常为 `MISSING_PROMPT` 或 `MISSING_ACCOUNT`，workflow 为 `GENERATION_UNCONFIGURED`，随后禁用为 `DISABLED`。详情会显示 revision、账户数和 OPEN task/in-flight work 投影。
- 清理动作：若为 ACTIVE，先按最新 revision 执行 disable，重新获取 revision，再 DELETE。服务端要求 Profile 非 ACTIVE，并阻止存在 OPEN 内容任务或进行中的发布工作（`backend/app/services/platform_configuration.py:900-983`）。为避免未知账户清理语义，测试时不要创建账户。
- 建议数据：`name=TEST-W3-20260830-<run-id>-Platform`，`slug=test-w3-20260830-<run-id>-platform`，允许域名只使用受控的测试域名字符串。
- 硬停止：无法禁用、存在 OPEN task/in-flight work、已有账户或 logo 对象、Profile 变为 `OPERATIONAL`、revision 冲突或删除返回 blocker；不要删除 Profile 关联的真实任务/账户。
- 测试参考：`frontend/tests/e2e/platform-list.spec.ts:59-80`（服务端 primary、enable/disable 和删除条件），`frontend/tests/e2e/platform-workspace.spec.ts:43-80`（overview revision），账户和 logo 流程约 `:82`、`:142-182`，后两者不应在本候选中执行。

#### 2.6 已批准事实所需的最小产品事实聚合（条件性波次 3）

- Canonical 页面/操作：先进入 `/products/{productId}/facts` 事实工作区，保存草稿；再在事实 review 上下文执行提交审核，ADMIN/审核者执行批准。对应详情和历史页为只读。
- API：`PUT /api/v1/products/{product_id}/facts`（`frontend/src/domains/product/product.api.ts:157-172`）、`POST /api/v1/products/{product_id}/fact-review-submissions`（`:174-189`）、审批 `POST /api/v1/products/{product_id}/fact-versions/{version_id}/approve`（`:191-207`；后端 `backend/app/routers/product_facts.py:263-285,354-375`）。
- 前置条件：已有 TEST 空产品；事实 Markdown 非空且使用完全合成的、已知可接受的字段；保存需 expected revision，提交需非空 change summary，且不能已有 pending review。审批者权限和服务端状态必须匹配。
- 可观测结果：事实草稿 revision 增加；提交后生成不可变 `PENDING_REVIEW` FactVersion，提交按钮消失；批准后 workflow 为 `FACT_APPROVED`，内容任务创建选项才可能包含该产品。状态机和输出字段见 `backend/app/schemas/product_facts.py:16-35,133-175`；服务端提交见 `backend/app/services/product_facts.py:633-716`。
- 清理动作：只在没有 ContentTask、ContentVersion、GEO 引用时，按最新 revision 删除该 FactVersion（`DELETE /api/v1/products/{product_id}/fact-versions/{version_id}`，后端 `backend/app/routers/product_facts.py:319-336`；服务端 blocker `backend/app/services/product_facts.py:560-630`），然后删除空产品。删除 FactVersion 会删除关联 review 记录，但审计仍保留。
- 建议数据：事实字段、摘要和 change summary 首行使用 `TEST-W3-20260830-<run-id>-FACT001`；不写入真实供应商、客户、价格、凭据或未核验产品事实。
- 硬停止：任何事实不确定、服务端要求额外真实字段、出现既有 ContentTask/ContentVersion/GEO 引用、审批后不允许删除、pending/revision 冲突或无法明确区分 TEST 产品；不能用猜测值、零值或兼容性 fallback 补齐事实。
- 测试参考：`frontend/tests/e2e/fact-workspace.spec.ts:46-106`（PUT、冲突保留本地草稿、提交到 pending），`frontend/tests/e2e/fact-review.spec.ts:16-40,53-110`（只读 review 与 approve/request changes）。该候选虽可在“无引用”条件下清理，但已经产生不可变版本和审计，风险高于空产品。

#### 2.7 OPEN 内容任务（不生成内容）

- Canonical 页面/操作：`/content/tasks/new`，主操作“创建内容任务”；成功后进入 `/content/tasks/{contentTaskId}`。任务应保持 `OPEN`，`current_content_version_id` 为空，不进入编辑、生成、审核、发布或 GEO。
- API：`POST /api/v1/content-tasks`，必须带 `Idempotency-Key`；前端 `frontend/src/domains/content/content.api.ts:281-294`，后端 `backend/app/routers/planning.py:235-287`。清理可用 `DELETE /api/v1/content-tasks/{id}?expected_revision={revision}`（客户端 `frontend/src/domains/content/content.api.ts:608`，后端路由 `backend/app/routers/planning.py:347-367`），也可先 cancel 再 delete（`:370-391`、`:1469-1499`）。
- 前置条件：TEST 产品有批准且非空 FactVersion；Platform Profile ACTIVE 且可用；请求只包含 `product_id`、`fact_version_id`、`platform_profile_id` 三个字段。服务端还会以 advisory idempotency lock 检查重复键并锁定产品/事实/平台（`backend/app/services/content_planning.py:345-400`）。
- 可观测结果：返回 201，任务详情显示 `OPEN`、事实和平台引用、没有当前内容；同一 Idempotency-Key 重试应返回同一聚合或结构化冲突，不能产生第二个任务。列表可见 `CT-XXXXXXXX` 形式的服务器标识（`backend/app/schemas/content.py:152-165`）。
- 清理动作：读取最新 revision，直接 DELETE 仅适用于 OPEN/CANCELLED 且没有 generation job、ContentVersion、PublishedArticle、GEO 引用；成功后任务从活动列表移除并保留审计。服务端删除规则见 `backend/app/services/publication.py:1469-1557`。
- 建议数据：任务没有用户可控业务前缀，使用其 TEST 产品、TEST Platform Profile 和唯一 Idempotency-Key 作为追踪标记；不要把测试 ID 伪装成服务器 CT ID。
- 硬停止：产品事实不是 `APPROVED`、平台不 ACTIVE、任务非 OPEN、出现 current content/job/发布/GEO 引用、重复键发生 IDEMPOTENCY_CONFLICT、revision 冲突或任何外部生成按钮被触发；不调用 generation job。
- 测试参考：`frontend/tests/e2e/new-content-task.spec.ts:120-170`（批准事实/ACTIVE 平台、三字段 body、CSRF、幂等），后续失败/409 场景；该 fixture 不产生真实任务。

#### 2.8 HUMAN 手动草稿（仅在需要验证内容编辑器时）

- Canonical 页面/操作：从 OPEN TEST 内容任务进入 `/content/tasks/{id}/editor`，执行“手动录入/创建版本”，只保存 DRAFT；不提交 review。
- API：`POST /api/v1/content-tasks/{content_task_id}/manual-versions`（前端 `frontend/src/domains/content/content.api.ts:313`；服务端 `backend/app/services/content_production.py:693-718`），保存 `PUT /api/v1/content-versions/{content_version_id}`（`:347`、服务端 `:756-814`），清理 `DELETE /api/v1/content-versions/{content_version_id}`（`:439`、服务端 `:817-879`）。
- 前置条件：OPEN TEST 内容任务、批准 TEST FactVersion；正文必须是合成 Markdown，当前没有版本；只验证本地手动编辑和 expected revision。
- 可观测结果：产生 `HUMAN`、`DRAFT` ContentVersion，任务 current version 指向它；保存增加版本 revision，详情 `available_actions` 仍包含 `SAVE`、`DELETE`、`SUBMIT_REVIEW` 等适用动作（`backend/app/schemas/content.py:425-475`）。
- 清理动作：在 DRAFT 且没有 review、发布、GEO 或其他引用时按最新 revision DELETE；服务端会将任务 current version 恢复到 parent（若有）并删除草稿。随后按 2.7 清理任务。
- 建议数据：标题、摘要和正文首行写入 `TEST-W3-20260830-<run-id>-DRAFT001`，不使用 AI 生成结果、不上传附件。
- 硬停止：点击/调用 submit review、approve、generation/humanization、revision、publication 或 GEO；版本变成非 DRAFT、产生任何引用、出现 revision conflict 或删除 blocker；不要以 permanent-delete 清理该草稿。
- 测试参考：`frontend/src/domains/content/content.api.ts:313-439`；内容版本状态/动作合同 `backend/app/schemas/content.py:425-475`。现有 `new-content-task.spec.ts` 主要覆盖建任务，不应被误认为覆盖真实草稿写入。

#### 2.9 测试用户（条件性，仅使用合成临时密码）

- Canonical 页面/操作：`/system/users`，创建 `TEST-W3-...` 用户；如需验证管理列表，可编辑显示名或禁用，然后删除。
- API：`POST /api/v1/users`、`PATCH /api/v1/users/{id}`、`DELETE /api/v1/users/{id}?expected_revision={revision}`；前端 `frontend/src/domains/identity/user.api.ts:36-115`，后端 `backend/app/routers/identity.py:178-308`。
- 前置条件：ADMIN；`temporary_password` 必须至少 12 字符，且只能由执行方安全地在内存中提供合成值。研究和记录中不得出现该密码、Cookie、token 或导出内容；新用户默认 `must_change_password=true`（`backend/app/services/identity.py:399-428`）。
- 可观测结果：用户列表出现 TEST 用户，账号可被禁用；服务端审计只应记录安全投影，不返回密码。创建、更新、禁用与删除均有 revision/状态变化。
- 清理动作：先 PATCH 为 disabled，重新读取 revision，再 DELETE。服务端要求用户已禁用且没有任何业务历史引用（`backend/app/services/identity.py:431-531,597-649`）。
- 建议数据：`username=TEST-W3-20260830-<run-id>-user`，显示名同样带前缀；不要将该账号加入真实流程或给它配置外部平台身份。
- 硬停止：无法安全处理合成临时密码、用户被启用、是最后一个活动 ADMIN、产生业务历史、DELETE 返回 blocker/revision conflict，或页面/日志暴露密码；不得 reset 真实用户，不得导出真实用户数据。
- 测试参考：`frontend/tests/e2e/system-users.spec.ts:45-99,127-189`（创建、编辑、禁用/删除 blocker、bulk）；该测试明确校验密码不进入请求记录，应保留相同不泄漏约束。

### 3. 明确归入波次 4 的流程（仅规划，不执行）

这些流程或不可恢复，或会触发第三方/对象存储/AI，或会把测试数据接入已有业务历史。每项都给出其 canonical 入口、接口和停止条件，便于后续单独审批；当前不得通过它们“顺便”完善波次 3 聚合。

#### 3.1 Platform Account 与 Logo 上传

- 入口/接口：`/settings/platforms` 工作区；账户 `POST/PATCH/POST enable/disable/DELETE /api/v1/platform-profiles/{profile_id}/accounts...`，前端 `frontend/src/domains/configuration/platform.api.ts:177-228`；logo 文件 intent/complete/abort 在同文件 `:239-` 之后。
- 原因：账户标识可能对应真实外部身份，且启用后可成为发布候选；logo 生命周期会写入对象存储。现有 E2E 的 create→edit→disable→delete 序列见 `frontend/tests/e2e/platform-workspace.spec.ts:142-182`，但它是 fixture 证据。
- 硬停止：没有明确的 Staging 专用账户标识/对象存储隔离，或任何操作需要真实账户、上传真实文件；不创建账户、不上传 logo。

#### 3.2 Publication Work、结果登记与关闭

- 入口/接口：`/publishing/work` 的 START；`POST /api/v1/publication-works`（需 Idempotency-Key，前端 `frontend/tests/e2e/publication-work-list.spec.ts:50-79`，后端 `backend/app/routers/publication.py:339-360`）；工作台后续准备、平台审核、登记结果、切换版本、验证、关闭见 `backend/app/routers/publication.py:413-560`。
- 原因：创建 work 本身虽从 `PREPARING` 开始，但没有删除 work 的对称 API；关闭会把源 ContentTask 置为 `CANCELLED` 且不能恢复（服务端 `backend/app/services/publication.py:780-804`），登记结果/验证还会创建发布历史或使用外部 URL。状态包括 `PREPARING`、`PLATFORM_REVIEW`、`AWAITING_VERIFICATION`、`COMPLETED`、`CLOSED`（`backend/app/schemas/publication.py:276-325`）。
- 硬停止：没有 Staging 专用平台账户和允许域名、页面显示可发布到真实平台、缺少明确的 work 删除/恢复路径，或任何需要真实最终 URL/截图/人工审核；只规划，不 START。

#### 3.3 Published Article、Issue、Repair、永久删除

- 入口/接口：`/publishing/articles` 只读详情后“登记内容问题”；`POST /api/v1/published-articles/{id}/issues`、`POST /api/v1/published-content-issues/{id}/repair-task`、`POST /api/v1/published-content-issues/{id}/resolve`，前端序列见 `frontend/tests/e2e/published-content-issues.spec.ts:27-64`，路由 `backend/app/routers/publication.py:639-770`。
- 原因：打开问题、创建修复任务、解决问题都会改变保留的发布历史；文章永久删除需要预览、精确确认 `永久删除`，并且 GEO 引用是 blocker（服务端 `backend/app/services/publication.py:1043-1115`；合同 `backend/app/schemas/publication.py:430-480`）。
- 硬停止：没有预先批准的专用文章、没有完整删除预览和恢复计划、存在 GEO 引用或任何真实发布 URL；不打开 issue、不创建 repair、不执行 resolve/permanent-delete。

#### 3.4 GEO Observation、Correction、Optimization Task

- 入口/接口：`/geo/observations` 创建观测 `POST /api/v1/geo-observations`，修正页面使用 correction context 与同一 POST；前端 `frontend/src/domains/geo/geo.api.ts:219-346`，路由 `backend/app/routers/observation.py:270-339`。Insight 优化任务为 `POST /api/v1/geo-insights/optimization-content-tasks`（`:367-391`；前端 `:242`）。
- 原因：创建观测要求已完成发布工作、候选文章、Query Topic 和经验证附件；服务端会校验候选 ID 集合，修正链 append-only、不可分支/复用（`backend/app/services/geo_observation.py:2370` 附近）。删除观测会删除完整人工修正链（`:2549-2605`），不是普通可恢复删除。优化任务会引用现有 Insight/文章/事实快照，且源过期时返回 409（`:2197-2326`）。
- 硬停止：没有专用 TEST 发布候选、没有隔离的上传对象、候选集合变化、任何 correction chain 已存在，或 UI 要求使用真实观察数据；不创建观测、不上传截图、不创建优化任务。
- 测试参考：`frontend/tests/e2e/new-geo-observation.spec.ts:99-204`（候选、上传、幂等/冲突），`frontend/tests/e2e/geo-observation-correction.spec.ts:52-151,154-210`（append-only 修正与冲突）。

#### 3.5 AI Channel、API Key、Header、Model 测试与 Discovery

- 入口/接口：`/settings/ai` 及 channel workspace；创建 channel、替换 API key、创建 Header/Model、test/discover/enable/disable/delete，前端 API 在 `frontend/src/domains/configuration/ai-channel.api.ts:58-` 之后，后端路由 `backend/app/routers/configuration.py:672-1108`。
- 原因：Channel 创建需要 `api_key`，服务端会加密存储；test model 与 discover models 在提交前后读取真实凭据并调用 `OpenAICompatibleClient`（`backend/app/services/ai_configuration.py:461-508,924-1017`）。Header/连接修改会使测试状态失效，Model 状态机要求测试通过后才可启用。当前研究不记录、请求或猜测任何 key、Cookie、token。
- 硬停止：没有专用 Staging provider、合成且可撤销的测试 key、外部调用预算/隔离、超时与审计确认；不得创建含 key 的 channel，不得 test/discover，不得启用模型。
- 测试参考：`frontend/tests/e2e/ai-channel-workspace-core.spec.ts`（channel/header/config fixture），`ai-channel-workspace-models.spec.ts`（model discovery/test/enable/disable/delete fixture），`ai-channel-workspace-runtime.spec.ts`（usage/logs 只读）。这些 fixture 不能证明真实 provider 可用。

#### 3.6 Generation、Humanization、Review/Approval 及正式发布链

- 入口/接口：内容编辑器的 generation/humanization job（`POST /api/v1/content-tasks/{id}/generation-jobs`、`POST /api/v1/content-versions/{id}/humanization-jobs`，前端 `frontend/src/domains/content/content.api.ts:138,156`）；review/approve/abandon/revision 在同文件 `:330-439`。
- 原因：Generation/Humanization 会调用 AI 或 Celery/外部模型，生成快照和不可变内容版本；job 为 PENDING/RUNNING 时阻止任务删除。提交审核、批准、创建 revision 会把内容接入历史，通常没有普通回滚，只能走归档与受阻的永久删除流程。
- 硬停止：没有明确的开发适配器与真实服务分界、没有专用模型/队列、没有发布隔离，或任何 job 不是可观测且可取消的；波次 3 不点击这些动作。

#### 3.7 Global Humanization Prompt、用户 reset/bulk/export、Audit 写入

- Global humanization Prompt：`PUT` 单例配置在 `backend/app/services/platform_configuration.py:742-789`，无删除接口；它影响全局内容生成，归波次 4。硬停止是没有变更窗口、旧值快照和恢复方法。
- 用户 reset/bulk/export：`POST /api/v1/users/{id}/reset-password`、bulk status、`GET /api/v1/users/export`，后端 `backend/app/routers/identity.py:216-265,311-331`。它们会改变或导出账号数据；不操作真实用户。硬停止是目标不是专用 TEST 用户或会产生密码/业务数据泄漏。
- Audit：`/system/audit` 只能 GET；审计写入由所有成功业务变更在调用者事务内追加。审计敏感键拒绝 auth/cookie/password/token/secret/prompt/response 等值（`backend/app/audit.py:22-159`）。波次 2 只读审计，波次 3 的写入会附带审计但不应人为创建/修改审计记录。硬停止是发现敏感值进入响应、请求记录或日志。

### 4. 权限、状态机、并发与幂等风险

#### 权限与边界

- `ADMIN` 是平台类型、平台 Profile、Prompt、用户、审计及多数删除动作的服务端边界；产品/事实/内容任务/GEO 创建由 `ENGINEER`/`EDITOR` 等合同授权，不能根据隐藏导航推断权限。产品路由和 schemas 见 `backend/app/routers/product_facts.py:103-181`、`backend/app/schemas/product_facts.py:64-92`；系统用户/审计见 `backend/app/routers/identity.py:178-394`。
- 前端隐藏按钮不是安全控制；每次候选流程必须记录 HTTP 状态与结构化错误。403/401/CSRF 失败是权限或环境问题，应停止，不应改用另一个账号或绕过 CSRF。

#### 状态机与引用阻塞

- 产品/事实：`FACTS_EMPTY → FACTS_EDITING → FACT_REVIEW_PENDING → FACT_APPROVED`，批准事实及其后内容/发布引用会使删除受阻；FactVersion 是不可变对象。
- 内容任务：`OPEN` 可取消/删除；生成、版本、发布、GEO 引用会阻止普通删除；`ARCHIVED` 只能 restore 或按精确预览走 permanent delete。ContentTask action/status 合同见 `backend/app/schemas/content.py:46-63,112-195`。
- Platform Type/Prompt/Profile：删除必须满足零引用；Prompt 删除若已绑定会解除平台绑定，Profile 删除须先 DISABLED 且无 OPEN task/in-flight work。
- 发布/GEO：Publication Work 状态只向前推进，关闭还会取消源任务；Published Article/Issue 与 Observation/Correction 是保留或 append-only 历史，不应当视为可逆测试数据。

#### 版本、并发与幂等

- 产品、事实、配置、草稿、用户等更新/删除普遍要求 `expected_revision` 并在服务端锁定；409 必须保留本地内容、重新 GET 后人工判断，不能盲目重放。事实工作区已有冲突保留测试（`frontend/tests/e2e/fact-workspace.spec.ts:73-92`）。
- 内容任务、Publication Work、GEO optimization task 使用 `Idempotency-Key` 和 advisory lock；同一 key 的重试应检查原响应/冲突，不可换 payload 重用。内容任务建任务测试覆盖该要求（`frontend/tests/e2e/new-content-task.spec.ts:141-170`）；发布 work 覆盖见 `frontend/tests/e2e/publication-work-list.spec.ts:50-79`。
- GEO Observation 创建要求候选集合精确匹配，但当前候选/附件变化可能产生 409；修正链禁止重放、分支或复用 evidence。`frontend/tests/e2e/new-geo-observation.spec.ts:186-204` 和 `geo-observation-correction.spec.ts:154-210` 是冲突/append-only 参考。
- AI test/discovery 会在外部调用前提交/释放锁，完成后重新锁定并检查配置 revision；期间修改 channel/header/model 会触发 revision conflict（`backend/app/services/ai_configuration.py:924-1017`），因此绝不能在波次 3 试探性调用。
- 清理应在单一运行窗口内完成，且每一步重新 GET revision。若另一个验收运行使用同一实体或 TEST 前缀不唯一，不能判定引用归属，不应删除。

## Caveats / Not Found

- 本研究没有运行浏览器、没有调用线上接口、没有使用或请求凭据/Cookie/token，也没有读取真实业务数据；所有前端 E2E 引用都是 fixture 行为参考，不能替代 Staging 实际证据。
- 现有代码允许若干“技术上可删除”的对象留下审计记录；因此本文把“可清理”定义为满足服务端引用阻塞和状态条件后的精确删除，不定义为无痕回滚。
- Platform Profile 删除实现会统计账户和 logo 关系，但在本次只读范围内没有把账户级联清理当作安全能力；建议波次 3 不创建账户或 logo，遇到已有关系即硬停止。
- 没有找到可安全创建并回滚真实 PublishedArticle、GEO Observation、Publication Work 或 AI provider 调用的闭环；这些对象依赖外部身份、已发布候选、追加历史、对象存储或不可逆状态，已按波次 4 处理。
- “重新确认目标为 Staging/预发布”是执行前条件，不能由本研究推断。若健康检查、release identity、host、数据库或平台配置出现 Production/未知漂移，所有波次 3 写入应为 `BLOCKED`。
