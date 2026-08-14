# Frontend V2 AI 渠道列表

## Goal

在 Frontend V2 提供管理员可用的 `/settings/ai` AI 渠道列表页。列表以服务端投影为唯一业务事实来源，在一次集合请求内展示渠道状态、模型数量、连接状态、配置状态与下一步动作，并让搜索、筛选、排序和分页状态可通过 URL 恢复。

本任务只交付列表与列表内已有服务端命令；AI Channel Workspace、创建/编辑渠道、API Key、Header、模型配置、用量与日志不在本任务内。

## 用户与权限

- 目标用户为 `ADMIN`；Frontend V2 路由继续复用 `_admin` 边界，后端所有 AI 渠道接口继续以 `AdminUser` 为最终权限边界。
- `ENGINEER` 访问页面或直接请求集合/命令接口均不得获得数据或执行命令，后端返回 `403`。
- 本任务不新增角色、权限模型或前端平行权限判断。

## 范围内

- 新增 Frontend V2 路由 `/settings/ai`、导航项、列表页、API/状态模型、单元/组件/E2E 测试。
- 固定七列：渠道标记与名称、Provider / Protocol、Enabled / Disabled、启用模型数 / 模型总数、连接 Passed / Failed / Untested、配置 Ready / Needs setup、主动作与 overflow。
- 服务端搜索、状态筛选、Provider 筛选、排序与分页；浏览器 URL 保存 `q`、`status`、`provider`、`sort`、`page`、`pageSize`，并映射到 API 的 `provider_brand`、`page_size`。
- 名称与服务端动作可生成未来 Channel Workspace 的真实目标链接；本任务不创建占位详情页。
- 直接在列表执行服务端允许的启用、停用与删除；均使用行内 `revision`，显示确认、执行中、失败与冲突状态。
- 收紧并补齐现有 AI 渠道列表/命令契约，使列表无需客户端 join、推断或逐行请求。
- 保持 V1 对变更后共享 OpenAPI 的编译与现有行为兼容。
- 更新对应契约、稳定规范与 Frontend V2 设计文档。

## 范围外

- AI Channel Workspace 及其 Basic、Request、Models、Usage、Logs 分区。
- 新建渠道、编辑渠道、替换 API Key、Header 管理、模型发现/创建/测试/启停、用量和审计日志 UI。
- 为未来 Workspace 创建空路由、占位页面或兼容分支。
- 新数据库表/列、迁移、Redis 状态、部署配置、第三方依赖、通用 DataTable/动作框架重构。
- 浏览器端拼接渠道详情、模型列表或统计；客户端推断配置状态、workflow 或允许动作。
- 自动重放 revision 冲突命令、乐观伪成功或未知 token 回退。

## 功能要求

### 列表读取

- 页面只调用一次 `GET /api/v1/ai-channels` 获取当前查询的完整列表投影；不得为每行读取详情、模型、Header、用量或日志。
- 集合必须由后端完成搜索、筛选、稳定排序、分页和聚合，返回 `items/page/page_size/total`。
- 列表项必须直接包含 `enabled_model_count`、`model_count`、`latest_test_status`、`configuration_status`、`workflow_stage`、`primary_task`、`available_actions` 和 `revision`。
- 列表响应不得包含 `base_url`、API Key、Header 名/值或其他凭据材料。
- 搜索仅匹配渠道名称和描述；不得再以不回显的完整 `base_url` 作为可探测搜索面。

### URL 与交互

- canonical URL 显式保留 `page` 与 `pageSize`，可选参数为 `q/status/provider/sort`；无效、空白或未知值规范化后 `replace` 到 canonical URL。
- `status` 只接受 `ENABLED | DISABLED`，`provider` 只接受 OpenAPI 中的 `AIProviderBrand`，`sort` 只接受 `AIChannelSort`，`pageSize` 只接受 `10 | 20 | 50`。
- 搜索、筛选、排序和 page size 变化重置 `page=1`；翻页只改变 `page`。
- 刷新、直达、前进/后退必须恢复同一查询；页面不得维护第二份筛选或分页业务状态。
- 提供初次加载、无数据、筛选无结果、初次加载失败/重试、保留旧数据的刷新失败和页码越界状态。

### 行展示与动作

- Provider 使用现有图标能力或短标记，不新增品牌图标依赖；协议以注册表显示可读标签。
- `is_enabled`、`latest_test_status`、`configuration_status` 直接映射为 badge，不互相推导。
- 主动作完全由 `primary_task` 决定；overflow 完全由 `available_actions` 决定。未知 token 或矛盾 projection 必须抛出显式中文错误。
- `COMPLETE_CONFIGURATION`、`TEST_MODEL`、`VIEW_RUNTIME` 及编辑类动作只生成未来 Workspace 的对应 tab 链接；不额外请求详情，也不创建占位页。
- `ENABLE_CHANNEL` 可作为主动作执行启用；`ENABLE`、`DISABLE`、`DELETE` 可在 overflow 执行。相同命令不得重复出现在主动作与 overflow。
- 启用、停用、删除都发送当前行 `revision`；服务端最终校验 revision、当前状态及启用门禁。
- `409 REVISION_CONFLICT` 必须保留明确冲突提示和“重新加载列表”入口，不自动重放命令；其他错误显示服务端消息与 request ID。
- 成功后只失效受影响的 AI 列表、Prompt Preview 模型选项与内容生成模型选项缓存；不得刷新无关详情或历史。

### 响应式与可访问性

- 复用现有 FilterBar、Table Kit、RowActions、Badge、Dialog、Pagination 和 Notice；不新建通用列表框架。
- 桌面显示七列；移动端把 Provider/Protocol、模型计数、连接和配置状态收进主单元的紧凑摘要，隐藏相应独立列，但保留动作可达性和全部业务事实。
- 页面根节点不得产生横向溢出；对话框需有标题、描述、明确按钮，关闭后焦点返回触发元素。
- 搜索输入、筛选、表格区域、状态和动作具备可访问名称；仅靠图标或颜色不得传递状态。

## 服务端契约要求

- `AIChannelSummary` 删除 `base_url`，新增 `model_count` 与显式 `configuration_status`。
- `configuration_status` 由服务端统一计算：API Key 已配置且 `model_count > 0` 为 `READY`，否则为 `NEEDS_SETUP`；连接状态和启用状态独立表达。
- `latest_test_status` 继续直接表达最近已测试模型的 `PASSED | FAILED`，没有测试记录为 `UNTESTED`。
- 启用/停用响应改为安全的 `AIChannelSummary`，避免列表命令在浏览器响应中带出完整 base URL 或 Header；V1 可在成功后继续失效并重取详情。
- 删除增加必填 query `expected_revision >= 0`；锁定目标后比较 revision，冲突返回 `409 REVISION_CONFLICT`。
- 启用/停用在 revision 检查后拒绝 no-op 状态切换，返回明确 `409 INVALID_STATE_TRANSITION`；启用仍要求至少一个测试通过模型。
- OpenAPI 为启用/停用列出 `409/422`，删除列出 `409/422`；生成的 V1/V2 类型必须同步。
- 列表数据库访问保持固定三条 SQL（全局计数、筛选总数、当前页），稀疏或密集模型/Header 数据不得导致逐行查询。

## 验收标准

- [x] `ADMIN` 可从导航进入 `/settings/ai`；`ENGINEER` 页面与直接 API 均为 `403`。
- [x] 页面按规定显示七列，服务端给出的状态、计数和动作无客户端推断。
- [x] `enabled_model_count / model_count`、`latest_test_status`、`configuration_status` 在稀疏与密集数据中正确。
- [x] 集合响应与启停命令响应不含 `base_url`、API Key、Header 名/值；前端 DOM、fixture、日志和快照不出现敏感值。
- [x] 单次集合请求完成服务端搜索、筛选、排序和分页，数据库查询数量不随行数增长。
- [x] URL canonical 化、刷新、直达、前进/后退、搜索/筛选/排序/分页重置规则通过自动化测试。
- [x] 主动作/overflow 严格跟随服务端 token；未知 token 和矛盾 projection 显式失败。
- [x] 名称和迁移动作指向未来 Workspace 的具体 tab，但仓库中没有新增 Workspace 占位路由。
- [x] 启用、停用、删除发送 `expected_revision`；冲突明确、命令只发送一次、无自动重放；服务端拒绝 no-op。
- [x] 成功命令只失效 AI 列表、Prompt Preview 选项和内容生成选项；失败不写入伪成功缓存。
- [x] 初次加载、空、筛选空、错误/重试、旧数据刷新失败和越界页均可访问且可恢复。
- [x] 375、768、1024、1440 四档视口无页面根横向溢出，移动端仍能读取全部事实并执行动作。
- [x] V1 在共享契约收紧后仍通过类型检查、列表/详情组件测试和既有 AI 管理 E2E。
- [x] OpenAPI、后端测试、V1/V2 生成类型、Frontend V2 单元/组件/E2E、lint、typecheck、build 及 `git diff --check` 通过。
- [x] 对应 `.trellis/spec/` 与 `docs/frontend-v2/` 文档与实现一致；`contracts/database.md` 无变化，因为无持久化模型变化。

## Notes

- 父任务：`.trellis/tasks/archive/2026-08/08-13-frontend-v2-prompt-workspace`，已归档。
- 候选实现分支：`codex/frontend-v2-ai-channel-list`；仅在本计划获批并执行 `task.py start` 后创建。
- 本计划阶段不修改业务代码、不启动任务、不建分支、不提交、不推送、不创建 PR。
