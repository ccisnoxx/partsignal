# AI 渠道列表现状审计

## 1. 审计范围

已阅读项目工作流、Frontend V2 总览与 01-09 设计文档、前后端 Trellis specs、OpenAPI、AI 配置后端 schema/service/router/test、V1 AI 配置消费者、V2 Platform List/Prompt Workspace 模式，以及已归档的 Platform List、Platform Types、Prompt Workspace 父子任务。

本记录只保存会影响 `frontend-v2-ai-channel-list` 方案的证据；不复制基础文档全文。

## 2. 前置条件证据（2026-08-14）

- 主工作目录：`/Users/sc/PycharmProjects/partsignal`。
- 分支：`main`；创建本 Trellis planning 目录前工作树 clean。
- `main...origin/main [ahead 190]`，没有落后信息；本任务不需要网络同步。
- `git worktree list` 仅有主工作目录。
- 本地/远端均无 `codex/frontend-v2-ai-channel-list`。
- 父任务位于 `.trellis/tasks/archive/2026-08/08-13-frontend-v2-prompt-workspace`，状态已完成归档。
- 当前任务 `.trellis/tasks/08-14-frontend-v2-ai-channel-list/task.json` 为 `planning`，`branch/worktree_path/commit` 均为空。

## 3. 权威合同与代码证据

### 3.1 OpenAPI

- `contracts/openapi.yaml:1056`：AI 渠道集合 GET 已声明 `q/status/provider_brand/sort/page/page_size`，响应为 `AIChannelList`。
- `contracts/openapi.yaml:1198`、`:1216`：启用/停用接收 `RevisionRequest`，当前 200 为完整 `AIChannel`。
- `contracts/openapi.yaml:1092`：DELETE 当前没有 `expected_revision`。
- `contracts/openapi.yaml:4409`：`AIChannelSummary` 当前要求 `base_url`、`enabled_model_count` 等，但没有 `model_count/configuration_status`。
- `contracts/openapi.yaml:4371`：完整 `AIChannel` 合法包含 base URL 与脱敏 Header，仍供 detail/Workspace 使用。

结论：现有集合端点足够复用，但 summary 不能直接满足固定列，也不满足“列表/命令浏览器输出不含完整 base URL/Header”的边界。

### 3.2 后端 schema/service/router

- `backend/app/schemas/configuration.py:483`：`AIChannelSummary` 与 OpenAPI 一致，含 `base_url`，缺模型总数/配置状态。
- `backend/app/services/ai_configuration.py:155`：搜索对 `%/_` 做 literal escape 并参数化，但匹配 name、description、base_url。
- `backend/app/services/ai_configuration.py:170`：列表由服务端完成筛选、排序、分页和聚合。
- `backend/app/services/ai_configuration.py:199`：`model_count` 已在 SQL 中计算；仅没有写入 summary。
- `backend/app/services/ai_configuration.py:229`：当前页 SQL 已携带 Header/启用模型/总模型/测试计数与最近状态相关子查询。
- `backend/app/services/ai_configuration.py:499`：删除持有行锁但没有 expected revision 参数/校验。
- `backend/app/services/ai_configuration.py:801`：共同启停函数已校验 revision 和启用门禁，但未拒绝相同状态。
- `backend/app/routers/configuration.py:628`：集合最终权限为 `AdminUser`。
- `backend/app/routers/configuration.py:771`、`:789`：启停返回完整 `AIChannelOut`。
- `backend/app/routers/configuration.py:807`：删除没有 revision query。

查询数量推导：一次集合调用固定执行三次 `db.execute`（counts、total、rows）；相关子查询属于 rows SQL，不是 Python N+1。实施时用 SQLAlchemy event 计数测试锁定这一事实。

### 3.3 服务端 workflow/action

`ai_channel_stage` 当前已经按 Key、模型、测试和启用状态产生：

- `INCOMPLETE / COMPLETE_CONFIGURATION`
- `UNVERIFIED / TEST_MODEL`
- `READY_TO_ENABLE / ENABLE_CHANNEL`
- `RUNNING / VIEW_RUNTIME`

`ai_channel_actions` 当前返回 `UPDATE`、`REPLACE_API_KEY`、`ENABLE` 或 `DISABLE`、`DELETE`、`DISCOVER_MODELS`、`CREATE_HEADER`、`CREATE_MODEL`。因此无需新增前端状态机；只需穷尽映射与服务端命令终检。

### 3.4 后端测试

- `backend/tests/integration/test_ai_channel_management.py:121` 已证明 Engineer 集合 GET 为 `403`。
- 同文件约 `:200` 已覆盖 q/provider/status/sort/page_size；需把 base URL 搜索改为不可命中并补 summary 新字段。
- 同文件约 `:299` 已覆盖启停 revision/门禁；需补 safe response 与 no-op。
- 同文件约 `:354`、`:391` 覆盖删除与并发删除；需全量带 expected revision 并补 stale conflict。
- `backend/tests/unit/test_contract.py` 已有多处 expected_revision OpenAPI 形状断言，可按相同模式增加 AI delete/response contract。

## 4. Frontend V2 可复用模式

### 4.1 Platform List

- `frontend-v2/src/domains/configuration/platform-list.model.ts:55`：Zod 校验 URL，camelCase 到 API snake_case 映射，canonical record 显式保留 page/pageSize。
- 同文件约 `:124`：主动作/overflow 用生成类型穷尽 switch，未知 token 走 `assertNever`。
- `frontend-v2/src/domains/configuration/platform-list-page.tsx:1`：复用 Table Kit、RowActions、Dialog、Notice 与 TanStack Query mutation。
- `frontend-v2/src/routes/_app/settings/platforms/index.tsx:1`：route 负责 prefetch、canonical 与跨域 cache invalidation。
- 已归档 Platform List 任务明确允许未来 Workspace href，但不创建 placeholder；AI 列表采用同样迁移策略。

### 4.2 Prompt/Content cache

- `frontend-v2/src/domains/configuration/prompt.api.ts:29`：`promptKeys.previewOptionsRoot()` 是 Preview 可用渠道/模型的根 key。
- `frontend-v2/src/domains/content/content.api.ts:45`：`contentKeys.isGenerationOptions` 可精确识别各任务生成选项。
- `frontend-v2/src/routes/_app/_admin/settings.prompts.tsx:52`：现有配置变更已使用两者做精确 invalidation，可直接复用。

### 4.3 路由与权限

- `_app/_admin` 已承载 Prompt 管理等管理员设置页，AI 列表无需新增权限组件。
- 导航已有 `adminOnly` 过滤和 `navId` 测试模式，新增一个静态项即可。

## 5. V1 直接影响

- `frontend/src/features/configuration/AIChannelsPage.tsx:120` 使用 snake_case URL（V1 保持，不要求迁移）；约 `:322` 显示 `base_url` 列，搜索文案含地址；删除请求不带 revision。
- `frontend/src/features/configuration/AIChannelDetailPage.tsx:214` 删除详情也不带 revision。
- `frontend/src/features/configuration/AIChannelFormModal.tsx:53` 把 `AIChannelSummary` 作为可编辑 base URL 来源；summary 收紧后应改为完整 detail 类型，而非 fallback。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx` 的 summary fixture 需新增必填字段并移除 base URL 列断言。
- `frontend/tests/e2e/ai-channel-management.spec.ts` 的 afterEach 与页面删除当前不传 revision；需保存/获取真实 revision。该 E2E 是共享合同变更的 required 兼容门禁。

启停 mutation 不依赖完整响应字段，只在成功后重取，因此响应改为 safe summary 不需要兼容 wrapper。

## 6. 决策与未采用方案

| 决策 | 原因 | 未采用 |
| --- | --- | --- |
| summary 删除 `base_url` | 列表固定列不需要；避免浏览器输出与隐藏搜索 oracle | 前端收到后丢弃：网络响应仍泄漏 |
| summary 新增 `model_count` | SQL 已有，零额外查询 | 客户端再拉 models 或用 enabled count 猜总数 |
| 服务端新增 `configuration_status` | 服务端是状态最终权威 | 前端用 Key/model/workflow 拼状态 |
| 启停返回 safe summary | 列表命令无需 detail；避免完整配置进入 mutation cache/网络 | 保持完整响应并忽略 |
| delete 必带 revision | 与其他 mutable command 一致，明确 stale intent | 删除前客户端先 GET detail；会多请求且仍有窗口 |
| no-op 在共同 service 拒绝 | 一处覆盖 enable/disable，避免虚假 revision/audit | 前端隐藏按钮作为唯一门禁 |
| 不直接测试模型 | summary 没有唯一模型 ID | 列表逐行加载模型或默认第一个 |
| 不加创建入口 | 创建必然带 Key/完整配置，超出本列表范围 | 半成品弹窗/Workspace placeholder |
| invalidate list 而非 optimistic patch | 启停会改变过滤归属，删除会改变页码 | 手工遍历所有 query key 维护第二真相 |
| 不修改通用 Table Kit | 只此列表需要移动摘要 | 为一页扩展通用框架 |

## 7. 风险与控制

- **共享 summary 收紧影响 V1**：列出所有直接消费者，生成类型后以 typecheck、组件测试和真实 AI E2E 证明兼容。
- **DELETE 合同破坏旧调用者**：全仓搜索所有 DELETE 调用与测试清理，禁止默认 revision；OpenAPI contract test 固定 required query。
- **隐藏 base URL 后搜索语义变化**：在 PRD/设计明确这是安全边界的有意变更，V1 文案同步，integration 锁定不命中。
- **未来 Workspace 尚未实现**：只断言 href，不把目标页面成功作为本任务验收；不创建占位页。
- **并发命令**：服务端行锁+revision；客户端冲突不重放，显式 refetch 后由用户重新决定。
- **响应式重复文本**：桌面/移动摘要通过 CSS 切换；E2E 四档视口验证无根溢出和事实可见。

## 8. 规划结论

当前没有需要产品补答才能规划的合同空白。最小完整交付是：收紧一个既有服务端列表投影、补两条命令规则、做 V1 兼容，再复用 V2 Platform List 模式实现单页。无需数据库、依赖、通用框架、Workspace 占位或跨服务设计。
