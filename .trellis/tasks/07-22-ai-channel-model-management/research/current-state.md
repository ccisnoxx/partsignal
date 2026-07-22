# AI 渠道与模型现状调查

## 结论

项目已经具备可真实运行的 OpenAI-compatible 渠道、凭据、Header、模型、模型发现、连接测试、启停、生成调用、服务端权限和追加式审计基础。本任务不需要重建配置体系；核心工作是把现有列表与独立详情页重组为原型要求的三栏工作区，补齐可恢复的集合状态、渠道描述、渠道级最近测试投影、测试/发现审计，以及原型要求但当前没有读取投影的使用统计和渠道操作日志。

调查时，原型中的供应商类型、供应商专属图标和每渠道重试次数没有既有契约依据。产品现已确认协议类型与受控供应商品牌分离，品牌目录为 `OPENAI | ANTHROPIC | GOOGLE | AZURE_OPENAI | ZHIPU | QWEN | CUSTOM`；协议仍只有当前 OpenAI-compatible 实现，自动重试仍禁止。

## 当前已有能力

### 前端

- `/configuration/ai` 使用 `AIChannelsPage`，`/configuration/ai/channels/:channelId` 使用 `AIChannelDetailPage`；配置子路由由 `ConfigurationLayout` 统一执行管理员守卫（`frontend/src/app/App.tsx:56-64`、`frontend/src/features/configuration/ConfigurationLayout.tsx:5-8`）。
- 全局导航已有配置中心二级菜单，用户管理和审计日志当前是系统管理一级管理员入口（`frontend/src/app/AppLayout.tsx:30-42`）。
- 渠道列表已经一次读取 `GET /api/v1/ai-channels`，展示名称、状态、API 根地址、超时、API Key 状态、Header 和已启用模型；不存在模型列表 N+1（`frontend/src/features/configuration/AIChannelsPage.tsx:32-142`）。
- 渠道创建、启停、删除均调用真实 API；详情页覆盖渠道更新、API Key 替换、Header CRUD、模型发现、模型 CRUD、测试、启停与删除（`frontend/src/features/configuration/AIChannelsPage.tsx:39-59`、`frontend/src/features/configuration/AIChannelDetailPage.tsx:48-135`）。
- 服务端状态由 TanStack Query 持有，query key 统一登记在 `frontend/src/shared/api/queryKeys.ts:8-16`；HTTP、CSRF 和错误解析统一经过 `frontend/src/shared/api/client.ts`。
- 前端类型来自 OpenAPI 生成产物，没有本地第二套 AI 数据类型。

### 后端、凭据与调用链

- `AIChannel` 保存名称、根地址、API Key 密文、更新时间、超时、启用状态、修订号、创建人与时间；Header 和模型是渠道从属实体（`backend/app/models/ai_generation.py:22-117`）。
- API Key 和敏感 Header 使用 `CredentialCipher` 加密并绑定关联数据；只在外部调用边界解密（`backend/app/services/ai_configuration.py:66-92`、`:323-349`、`:494-537`）。
- 渠道响应只给出 `api_key_configured` 和更新时间；敏感 Header 的 `value` 恒为 `null`，普通 Header 才返回明文（`backend/app/routers/configuration.py:117-145`）。
- URL 经过协议、凭据、查询、片段、DNS 地址集合和公网/本机边界校验；请求固定连接已批准地址，校验 TCP peer，禁止重定向和超限响应（`backend/app/services/pinned_http.py:74-153`、`:193-292`）。
- Header 名、保留 Header 和控制字符在服务端校验，`Authorization` 由系统唯一注入（`backend/app/services/openai_client.py:27-46`、`:79-122`）。
- 模型发现真实调用 `{base_url}/models` 且不自动落库；模型测试真实调用 `{base_url}/chat/completions`，只发送一条 `hi` 用户消息（`backend/app/services/openai_client.py:124-175`）。
- 渠道连接配置变化会停用渠道和全部模型并将测试状态重置为 `UNTESTED`；模型调用参数变化会停用该模型并重置测试（`backend/app/services/ai_configuration.py:40-49`、`:283-320`、`:389-424`）。
- 模型只有测试通过后才能启用，渠道至少存在一个测试通过模型才能启用（`backend/app/services/ai_configuration.py:354-386`、`:465-491`）。
- 正式生成只接受固定适配器，重新读取仍存在且启用的渠道/模型和当前敏感值，并使用冻结的非敏感快照发起一次真实请求（`backend/app/services/generation.py:458-489`）。
- 渠道删除级联 Header 和模型，历史作业外键 `SET NULL`，不可变快照保留非敏感历史含义；待执行作业在配置删除后显式失败，不回退或猜测（`contracts/database.md:71-73`、`:202-205`）。

### 权限与审计

- 所有 AI 配置读取接口要求 `ADMIN`，写接口同时要求管理员会话和 CSRF；账号类型是唯一权限来源（`backend/app/deps.py:72-102`、`backend/app/routers/configuration.py:393-750`）。
- 渠道、API Key、Header、模型 CRUD 和启停均写入 PostgreSQL 追加式审计；审计写入递归拒绝敏感键（`backend/app/services/ai_configuration.py`、`backend/app/audit.py:11-57`）。
- 当前模型连接测试和模型发现没有审计事件，是明确缺口。
- 审计读取接口支持分页及 `target_type`、`target_id` 过滤（`backend/app/routers/identity.py:202-240`）。

### 测试与运行时

- 前端配置组件测试已覆盖列表字段、避免 N+1、敏感 Header 不回显、模型测试入口、缓存失效和模型发现添加（`frontend/src/features/configuration/ConfigurationPages.test.tsx:333-445`）。
- 后端边界测试已覆盖凭据关联数据、审计敏感键、SSRF、重定向、Header 和精确 Chat Completions 请求（`backend/tests/unit/test_ai_boundaries.py`）。
- 本地 E2E 使用真实 API、PostgreSQL、Redis、Celery 和独立本机 OpenAI-compatible HTTP 测试服务；它不访问真实云模型，也不以确定性成功路径替代 HTTP 边界（`deploy/scripts/e2e-local.sh:10-15`、`:37-74`）。

## 与原型的功能和视觉差距

| 范围 | 当前实现 | 原型与需求 | 差距 |
| --- | --- | --- | --- |
| 页面结构 | 列表页后进入独立纵向详情页 | 分类、表格、右侧详情同屏 | 需要在现有稳定 URL 上重组为三栏工作区，不能复制详情实现 |
| 集合状态 | 无搜索、筛选、排序、分页和选中行 | 全部能力可用且可恢复 | 目标态采用服务端摘要、搜索、筛选、稳定排序、分页和分类计数，URL 只保存前端视图状态 |
| 状态分类 | 无分类栏 | 全部、启用、停用及数量 | 可从渠道响应确定性派生 |
| 渠道描述 | 无字段 | 创建、编辑、搜索和详情显示 | 需要新增单一契约字段和迁移 |
| 渠道类型 | 固定 OpenAI-compatible 协议，无品牌字段 | 协议与供应商品牌分离展示及筛选 | 新增已确认的协议字段和受控品牌目录；既有行品牌回填 `CUSTOM`，不从名称或 URL 猜测 |
| 最近测试 | 模型详情有测试状态和时间 | 渠道列表显示最近测试 | 需要从子模型确定性投影渠道最近一次模型测试 |
| 渠道测试 | 只能对具体模型测试 | 顶部和行内测试渠道 | 必须让管理员明确选择模型，再复用现有模型测试接口 |
| 详情布局 | 连接、Header、模型三个纵向 Card | 右侧 Tabs 和快捷操作 | 需要重排，不改变后端所有权和 mutation |
| 重试次数 | 单次作业禁止自动重试，失败由新作业显式重试 | 原型显示重试次数 | 显示“仅手动重试”，不得新增自动重试次数配置 |
| 使用统计 | 作业保存状态、耗时和 token，但无渠道聚合接口 | 详情统计 Tab | 按确认的 7/30/90 天或全部时间实时聚合正式业务作业；测试/发现不计入，不新增状态表 |
| 操作日志 | 全局审计页；模型事件按模型 ID | 渠道详情日志 Tab | 需要复用审计表并补充安全的渠道关联投影，不建立日志副本 |
| 复制配置 | 无 | 复制非敏感配置 | 前端从当前渠道、Header 和模型构造白名单 JSON，排除 API Key 和敏感值 |
| 导航 | 配置中心五个子项；用户、审计为一级入口 | 原型六个配置子项 | 可移动导航入口但保留现有 URL、权限和页面所有权 |
| 顶栏 | 现有页面上下文、主题和用户菜单 | 原型含全局搜索 | 采用权限感知的页面/功能导航搜索；不声称搜索无契约的跨域业务数据 |
| 视觉 | 通用 PageHeader、Card、Table、纵向详情 | 高密度玻璃三栏工作区 | 需要复用现有主题变量增加配置页专属布局、选中态、紧凑行高和响应式 |

## 可复用代码

- `AIChannelsPage` 的列表 query、创建/启停/删除 mutation 和现有渠道表单。
- `AIChannelDetailPage` 的详情/model query、全部 mutation、Header/模型表单及 `ModelDiscoveryModal`。
- `ConfigurationLayout` 管理员守卫、`AppLayout` 菜单树、`PageHeader`、`TableRegion`、`StatusTag`、异步状态组件。
- `queryKeys.aiChannels`、统一 OpenAPI 客户端、CSRF 和错误投影。
- `ai_configuration` 的修订锁、测试失效、凭据边界和启停门禁。
- `OpenAICompatibleClient`、`PinnedHTTPTransport`、`append_audit` 和审计分页接口。
- `GenerationJob` 已有状态、耗时和 token 字段，可用于只读统计投影。

## 跨层影响

- **前端**：重组两张 AI 页面但保留现有 URL；增加 URL 查询参数、三栏布局、Tabs、权限感知导航搜索、显式模型选择测试、复制白名单配置和统计/日志读取。
- **后端**：新增渠道身份字段与服务端集合投影；增加渠道最近测试、按时间窗统计和渠道操作日志投影；为模型测试与发现补审计，并为模型审计添加安全渠道关联。
- **OpenAPI**：同步渠道身份、服务端分页摘要、最近测试、统计和渠道日志读取契约，再重新生成前端类型。
- **数据库**：为渠道增加描述、协议类型和受控供应商品牌列；统计和日志继续从 `generation_jobs`、`audit_logs` 派生，不增加第二套表或缓存。
- **权限**：沿用 `AdminUser` 和 CSRF；新增读取投影同样为管理员专用，测试/发现保留服务端权限并新增审计。
- **文档**：更新数据库、OpenAPI、AI 配置规范和系统方案，记录固定协议、无自动重试和渠道工作区的数据边界。

## 目标态设计起点

1. 直接重构现有 `/configuration/ai` 与 `/configuration/ai/channels/:channelId` 为同一三栏工作区，URL 是选中状态唯一来源。
2. 为名称、描述、品牌、状态、排序和分页建立明确的服务端集合契约；列表只返回页面需要的摘要，不产生 N+1 或泄露 Header 值。
3. 渠道最近测试由模型测试事实确定性投影；渠道测试要求明确模型，不猜测测试对象。
4. 使用统计从现有生成作业权威数据按 7/30/90 天或全部时间查询，默认 30 天；只统计正式生成和自然化作业，操作日志继续使用现有审计表。
5. 所有视觉通过现有 Ant Design 与主题变量完成，不引入第二套组件、主题、配置或状态来源。

## 已确认的产品边界

- 协议类型/供应商品牌、品牌目录、重试语义、统计口径和全局搜索边界均已由产品确认。
