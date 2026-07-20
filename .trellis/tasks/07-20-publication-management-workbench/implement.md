# 发布管理人工发布工作台实施计划

## 0. 激活门禁

- [x] 用户已评审并明确批准 `research/gap-analysis.md`、`prd.md`、`design.md`、`implement.md`。
- [x] 用户已授权激活任务，Trellis 状态为 `in_progress`。
- [x] 主工作目录位于 `main`；已识别当前未提交的用户变更，本任务不得覆盖不相关改动。
- [x] 用户已授权实施；未经另行确认不提交、不推送、不部署。

## 1. 契约优先

### 1.1 OpenAPI

- [x] 在 `contracts/openapi.yaml` 新增 `GET /api/v1/publication-workbench-summary`、默认 7 且仅允许 7/30 的 `window_days` 查询参数，以及 `PublicationWorkbenchSummary`、当前状态计数、周期指标、异常计数、最近动态 schema。
- [x] 新增 `PublicationRecordListItem`，把 `PublicationRecordList.items` 改为列表投影；页面评审后为 `PublicationRecord` 详情补充锁定内容、平台和账号投影字段。
- [x] 新增 `PublicationAttentionListItem`，把 `PublicationAttentionList.items` 改为列表投影；保留 `PublicationAttention` 详情 schema。
- [x] 为 `PublicationCommand` 增加可选、唯一 `attachment_file_ids`，文档明确仅 `mark-published` 接受非空值。
- [x] 不新增发布状态、页面验证状态、异常枚举、负责人、优先级、排期或趋势字段。
- [x] 运行 `make contract-check`；再运行 `npm --prefix frontend run api:generate`，检查生成 diff 只反映批准契约。

### 1.2 数据库/状态机权威文档

- [x] 更新 `contracts/database.md`：7/30 天统计 cohort/分母/历史语义、最近动态来源、结果阶段附件仍是现有追加关联、无新状态和无迁移。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md` 的人工发布工作台、结果证据、人工验证与异常分类说明，删除与当前实现冲突的旧表述。
- [x] 实现未发现必须改表或新增结构化异常原因；没有创建迁移或兼容字段。

## 2. 后端实现

### 2.1 Schema 与路由

- [x] 在 `backend/app/schemas/publication.py` 增加与 OpenAPI 一致的列表/摘要模型和命令附件字段，所有时间、可空率和 enum 完全一致。
- [x] 在 `backend/app/routers/publication.py` 增加摘要 GET 路由，权限为 `CurrentUser`；列表路由返回新投影。
- [x] 命令路由继续使用 `EngineerUser/ContentEditor + CsrfProtected`，不新增前端可绕过的写入口。

### 2.2 批量查询与聚合

- [x] 在 `backend/app/services/publication_queries.py` 或同一职责模块实现发布记录列表批量投影：内容、版本、平台、账号、最后验证时间和 `available_actions` 一次查询当前页。
- [x] 实现关注列表批量投影，联接发布/内容/平台/账号/修复任务；不得在循环中调用 `publication_out` 或 `attention_out`。
- [x] 把候选的逐平台账号查询改为一次批量账号查询并按平台分组，输出契约不变。
- [x] 实现工作台摘要：七状态当前计数、OPEN attention、默认 7 天且可选 30 天的周期指标、三类异常和最近 5 条状态事件；非法周期在请求边界显式拒绝。
- [x] 查询统一使用数据库 UTC 时间边界和 `COUNT(DISTINCT publication_id)`；零分母返回 `None`。
- [x] 最近动态不读取全局审计表、不返回 actor/comment；所有展示上下文一次联接，无 N+1。

### 2.3 结果证据原子绑定

- [x] 在 `backend/app/services/publication.py` 的 `mark-published` 分支仅在该命令下接受 `attachment_file_ids`。
- [x] 复用 `verified_files`，拒绝重复、缺失、未验证或已经绑定的文件；其他命令携带非空附件返回明确 422。
- [x] 在同一行锁和数据库事务中写发布字段、追加附件、追加状态事件和审计；任何一步失败整体回滚。
- [x] 保留最终 URL 域名校验、发布字段不可变、内容版本/平台账号锁定和真实错误语义。
- [x] 页面评审后把候选创建和 `mark-published` 的文件类别统一收紧为 VERIFIED `OPERATION_SCREENSHOT`，错误类别在任何发布字段或附件关联写入前显式失败。
- [x] 不增加 PublicationRecord revision：继续以行锁、服务端转换检查和数据库触发器保证过期命令失败；前端 409 后重取权威状态。

### 2.4 性能和代码检查

- [x] 在真实 PostgreSQL fixture 上记录列表、关注列表、摘要查询次数，确保列表规模增长不增加逐行 SQL。
- [x] 对摘要和最后验证聚合执行 `EXPLAIN (ANALYZE, BUFFERS)`；查询计划未显示需要新增索引。
- [x] 运行 touched-scope 中文文档检查：新增/实质修改的模块、公共函数、复杂统计口径、异常路径、日志和开发者可见错误使用必要中文 Docstring/说明；不为显然代码堆注释。

## 3. 前端实现

### 3.1 数据边界

- [x] 更新 `frontend/src/shared/api/queryKeys.ts` 和 `queryOptions.ts`：新增 workbench summary；发布记录 query 接受真实 `page/page_size/status`，不再固定取前 100 条。
- [x] 候选、记录、关注、摘要的写后失效按 `design.md` 执行；不轮询所有详情，不做客户端全量统计。
- [x] 保留 `api` 的 typed OpenAPI、CSRF middleware、`ApiError` 和真实错误解析。

### 3.2 页面结构

- [x] 重构 `frontend/src/features/publications/PublicationWorkspace.tsx` 为 PageHeader、流程摘要、URL 驱动视图/筛选、批量列表投影、辅助模块和按需 Drawer。
- [x] 仅把具有独立状态与交互边界的发布 Drawer 拆为同 feature 组件，没有创建薄包装或新组件体系。
- [x] 候选列表继续只消费 `matching_accounts`；发布记录/关注列表只消费新列表 schema，不逐条请求详情。
- [x] 状态节点、页签、筛选、页码、选中对象/动作保持可深链；浏览器前进/后退恢复视图。

### 3.3 发布 Drawer

- [x] 候选模式复用 `PublicationPackage` 复制能力、匹配账号、栏目 URL、`DirectUpload` 与幂等创建。
- [x] 记录模式先加载单条详情，展示锁定内容版本、平台/账号、最终 URL、完整状态事件和已绑定附件。
- [x] 根据 `available_actions` 渲染动作表单；平台状态选择器不得允许服务端未返回的目标状态。
- [x] `mark-published` 表单包含实际标题、最终 URL、发布时间、备注和可选结果证据；账号/平台/版本只读。
- [x] 上传完成但提交未成功时标注“尚未绑定”；只有成功响应或详情附件显示绑定成功。
- [x] 发布包次级查询失败时显示真实错误和重试入口，并禁用复制与候选登记；不以候选摘要伪装发布包加载成功。
- [x] 409/422/403 保留服务端消息和 request ID；失败时保留输入，409/附件冲突重取权威详情且不静默重试。
- [x] Drawer 关闭前有未提交表单时使用现有 Ant 确认能力；Escape、关闭按钮、焦点圈闭和恢复由 Ant Drawer 语义承载，脏表单关闭确认有组件测试。
- [x] Drawer 显示锁定内容标题/版本、平台、账号标识和内容哈希；发布记录表显示实际标题；无匹配账号时提供业务设置恢复入口。
- [x] 旧发布详情路由改为只读历史页，写操作统一跳回 `/publications?record=<id>` 的工作台 Drawer，删除重复命令表单。

### 3.4 指引、异常、概览和动态

- [x] 发布指引使用当前真实五步静态文案，不增加配置接口。
- [x] 异常只显示 `REJECTED`、OPEN REMOVED、OPEN VERIFICATION_FAILED 三类及真实数量；点击进入真实筛选。
- [x] 数据概览默认 7 天，提供 7/30 天选择器并同步 URL；只显示四个周期数字和当前 OPEN attention；验证率空分母显示“—”；无趋势数据不显示同比/箭头/折线。
- [x] 最近动态显示摘要响应最近 5 条状态事件并深链记录；无数据时显示可解释空态，不造假。

### 3.5 视觉、主题和响应式

- [x] 在 `frontend/src/styles/global.css` 增加 `.publications-workbench` 作用域样式，复用现有 CSS 变量、玻璃/边框/阴影/半径和 motion Token；不写组件级硬编码色板。
- [x] 业务表格使用高可读 L1 表面；摘要、辅助卡和 Drawer 使用有意义的 L2 glass；不在所有单元格叠加 blur。
- [x] 验证 1536×1024、1024px、375×812 的流程摘要、筛选、表格、辅助区和 Drawer；页面本身无横向溢出。
- [x] 三态主题下分别验证文字/图标/边框/状态/焦点/遮罩；跟随系统模式实际切换系统 color scheme。
- [x] 使用 Ant 图标和现有图标语言，禁止 emoji、截图平台商标和新的图标依赖。
- [x] 所有图标按钮有可访问名称，状态含文字，移动端操作目标至少 44px，`prefers-reduced-motion` 生效。

## 4. 数据库迁移

- [x] 本计划无数据库迁移；`PublicationStatusEvent`、`PublicationAttention`、`PublicationAttachment` 已满足实现。
- [x] 不创建空迁移或推测性索引。
- [x] PostgreSQL 查询计划未证明需要新增索引，因此未产生迁移或二次设计评审。

## 5. 测试与验证

### 5.1 后端定向单元测试

- [x] URL 协议、真实域名边界和跨平台账号现有测试继续通过。
- [x] `mark-published` 仅接受 VERIFIED、未重复/未绑定附件；其他命令拒绝非空附件。
- [x] 统计覆盖默认 7 天、切换 30 天、两个半开窗口、零分母和异常状态集合；非法周期由 FastAPI/OpenAPI enum 请求边界拒绝。

建议首个命令：

```bash
uv run --project backend pytest backend/tests/unit/test_security_and_publication.py backend/tests/unit/test_contract.py
```

### 5.2 真实 PostgreSQL 集成测试

- [x] 当前七状态计数和 OPEN attention 与 SQL 真值一致，且不随 7/30 天选择变化。
- [x] PUBLISHED 在 7 天与 30 天窗口内/外、后续 VERIFIED、REMOVED、VERIFICATION_FAILED 的 cohort/历史口径正确。
- [x] 验证率分母、零分母、新增异常与未解决关注口径正确。
- [x] 结果证据、发布字段、状态事件和审计同事务；任何文件错误均不产生部分绑定。
- [x] 平台账号不匹配、最终 URL 域名、CSRF、权限、并发过期状态、关注 revision、修复任务不隐式解决继续通过。
- [x] 列表投影/最近动态字段正确且查询次数不随行数线性增长。

建议定向命令：

```bash
uv run --project backend pytest backend/tests/integration/test_publication_review_closure.py -m integration
```

### 5.3 OpenAPI 与前端组件测试

- [x] `make contract-check` 通过，生成类型无漂移。
- [x] 更新 `PublicationsPage.test.tsx`：摘要不取当前页长度、真实分页/筛选、匹配账号、结果登记成功/失败、证据绑定、冲突刷新、异常入口、URL 恢复和脏表单关闭确认。
- [x] 当前角色模型只有管理员/内容工程师，二者均可执行发布命令；未伪造不存在的“只读用户”，写权限、CSRF 与 403 继续由服务端依赖和真实错误处理保证。
- [x] 覆盖空、加载、错误、零分母和服务端错误状态；不存在的只读角色不作为前端第二套权限模型实现。

建议命令：

```bash
npm --prefix frontend test -- PublicationsPage.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

### 5.4 Playwright 浏览器验收

实施阶段必须使用项目 `playwright-cli` 工作流，优先扩展 `frontend/tests/e2e/mvp-flow.spec.ts` 和主题 E2E；真实 UI 操作不能继续全部由 `page.request` 代替。

- [x] 视口：1536×1024、1024px、375×812。
- [x] 主题：浅色、深色、跟随系统，并实际改变系统主题验证跟随。
- [x] 待发布候选、内容复制、匹配账号、没有账号的引导。
- [x] 创建待发布记录，平台审核，结果登记成功和服务端失败。
- [x] 跨平台账号拒绝、栏目 URL/最终 URL 域名拒绝。
- [x] 操作截图上传、完整性确认、结果登记原子绑定和失败不假绑定。
- [x] 发布记录分页/状态筛选、详情事件/附件。
- [x] 人工页面验证成功、验证失败、下线、平台拒绝。
- [x] 关注详情、修复任务创建后仍 OPEN、revision 冲突、显式解决。
- [x] 当前管理员/内容工程师权限边界；未引入不存在的只读角色。
- [x] 空、加载、错误状态；键盘与 Ant Drawer 语义、脏表单关闭确认、焦点恢复和减少动态。
- [x] 截图只用于视觉证据；同时检查 console、失败请求和页面级横向溢出。

建议回归命令：

```bash
npm --prefix frontend run e2e -- mvp-flow.spec.ts theme.spec.ts
```

## 6. 文档同步

- [x] OpenAPI 是 API 唯一权威，数据库/状态/统计历史语义写入 `contracts/database.md`，未在 README 复制 schema。
- [x] 更新系统方案中发布工作台、人工验证、异常、历史和附件流程。
- [x] 本任务没有改变跨页面主题约定或通用 E2E 操作方式，无需更新 `frontend/README.md`。
- [x] 新增或实质修改的中文业务代码完成 touched-scope 文档检查；最终说明注释/Docstring/开发者可见文本的处理情况。

## 7. 最终一致性检查

- [x] 代码、OpenAPI、生成类型、PostgreSQL 行为、测试和方案文档一致。
- [x] 搜索确认前端没有自建发布状态映射、异常文本模糊匹配、分页统计、全局审计复用、固定成功或静默错误。
- [x] 检查 diff：无负责人/优先级/排期/批量/导出/搜索/通知/假趋势字段，无新 UI/图表库，无不相关清理。
- [x] 检查所有列表查询没有 N+1，所有写入口服务端校验权限/CSRF/状态/平台/URL/文件完整性。
- [x] 检查历史记录、状态事件、附件和关注事项未被删除或覆盖。
- [x] 已完成定向与主要全量检查；全量 PostgreSQL 集成中 3 个失败来自本任务开始前未提交的 `0020_platform_branding_task_list` 与旧迁移头断言冲突，详见验证记录。
- [ ] 提交前向用户展示 commit plan 并获得确认；本任务当前明确禁止提交、推送和部署。

## 8. 验证记录（2026-07-20）

- 契约：`make contract-check` 通过，生成的 `schema.d.ts` 与 OpenAPI 一致。
- 后端：Ruff、mypy、75 个单元测试通过；发布工作台真实 PostgreSQL 定向集成测试通过。
- 查询：真实 PostgreSQL fixture 固定记录候选/记录/关注/摘要 SQL 数量为 2/2/1/2；`EXPLAIN (ANALYZE, BUFFERS)` 未发现本任务必须新增的索引。
- 前端：首轮 ESLint、typecheck、`PublicationsPage.test.tsx` 5/5、全量组件测试 74/74、生产构建通过；页面评审修复后的最终结果见第 9 节。
- 浏览器：发布主流程 E2E 复跑 1/1 通过；此前 `mvp-flow.spec.ts + theme.spec.ts` 全量 6/6 通过。使用 Playwright CLI 人工核验 1536×1024、1024×768、375×812，以及浅色、深色、跟随系统和移动端全宽 Drawer，未发现页面级横向溢出或 console 错误。
- PostgreSQL 全量集成测试结果为 29 通过、3 失败；失败全部位于既有 `test_migrations.py`，原因是工作区中本任务开始前存在未提交迁移 `0020_platform_branding_task_list`，而旧测试仍断言迁移头为 `0019_product_driven_tasks`。本任务未修改或绕过这组不相关变更。
- 数据库：没有新增表、字段、状态、约束、索引或迁移。
- Git/交付：任务保持 `in_progress`；没有提交、推送或部署，等待用户评审与后续明确指令。

## 9. 页面评审修复（2026-07-20）

- [x] 发布服务统一拒绝错误类别证据，候选创建和 `mark-published` 均覆盖真实 PostgreSQL 原子失败回归。
- [x] 候选 Drawer 展示发布包查询错误并阻止复制、上传和登记。
- [x] 详情契约与 Drawer 补齐锁定内容、平台、账号上下文，记录列表补实际标题。
- [x] 已上传文件明确显示“已上传，尚未绑定”，与详情中的已关联证据区分。
- [x] 旧发布详情删除重复写表单，只保留历史与返回工作台入口。
- [x] 无匹配账号候选提供 `/settings` 恢复入口，准备发布动作保持禁用。
- [x] 完成最终全量组件、构建、Playwright 浏览器回归和一致性检查后，向用户提交 commit plan。

最终复核结果：`PublicationsPage.test.tsx` 8/8、前端全量 77/77、ESLint、typecheck、生产构建、OpenAPI 契约检查、Ruff、mypy、后端定向单测 14/14、真实 PostgreSQL 发布闭环定向集成 1/1、Playwright 发布主流程 1/1 均通过。Playwright CLI 另行核验发布包错误禁用、无匹配账号恢复入口、锁定上下文、实际标题、已关联/未绑定证据语义、旧详情只读以及 375px 全宽 Drawer；未发现新的页面级横向溢出或非预期 console 错误。
