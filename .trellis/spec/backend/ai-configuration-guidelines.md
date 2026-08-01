# AI 配置与生成边界

## 场景：OpenAI-compatible 配置中心

### 1. 范围与触发条件

- 当代码修改 AI 渠道、Header、模型、生成快照、外部模型调用或相关环境变量时，必须遵守本规范。
- 当代码修改渠道集合搜索、分页、最近测试、使用统计或渠道操作日志时，也必须遵守本规范；这些读取投影不能成为第二套配置、统计或审计数据源。
- PostgreSQL 保存当前配置和不可变作业快照；Redis 只传递 `GenerationJob.id`。
- `contracts/openapi.yaml` 与 `contracts/database.md` 是跨层契约源，运行时 Schema 和前端类型必须从它们保持一致。

### 2. 签名

- 渠道协议：`GET {base_url}/models`、`POST {base_url}/chat/completions`。
- 创建原始作业：`POST /api/v1/content-tasks/{content_task_id}/generation-jobs`，请求体接收 `ai_model_id`、`platform_prompt_id` 和 `platform_prompt_revision`；自然化请求只接收 `ai_model_id`。
- 重试作业：`POST /api/v1/generation-jobs/{generation_job_id}/retry`，复制原 `input_snapshot`。
- 核心表：`ai_channels`、`ai_channel_headers`、`ai_models`、`generation_jobs`。
- `generation_jobs.ai_channel_id` 和 `ai_model_id` 删除时 `SET NULL`；历史含义由 `input_snapshot` 保留。
- 管理读取：`GET /api/v1/ai-channels?q=&status=&provider_brand=&sort=&page=&page_size=`、`GET /api/v1/ai-channels/{channel_id}/usage-summary?period=7d|30d|90d|all`、`GET /api/v1/ai-channels/{channel_id}/audit-logs?page=&page_size=`。
- 渠道命令：创建/更新、`PUT .../api-key`、Header/模型命令、`POST .../discover-models`、具体模型 `POST .../test|enable|disable`、渠道 `POST .../enable|disable` 和删除；读取与写入均要求 `ADMIN`，写入还要求 CSRF。

### 3. 契约

- `AI_CREDENTIAL_ENCRYPTION_KEY` 必须是 Base64 编码的 32 字节密钥。
- 生产环境必须使用 `CONTENT_GENERATOR=openai-compatible` 和 `AI_ALLOW_LOCAL_HTTP=false`。
- `AI_ALLOW_LOCAL_HTTP=true` 只允许 `development`/`test` 的回环 HTTP 地址；公网仍使用 HTTPS，私网、链路本地和混合解析结果均拒绝。
- API Key 和敏感 Header 使用 AES-256-GCM 密文保存，关联数据绑定记录 ID；响应、日志、审计和作业快照不得包含明文。
- `AIChannel.protocol_type` 决定真实调用协议，`provider_brand` 只决定管理端身份、筛选和本地图标。当前协议只有 `openai-compatible-chat-completions`；品牌目录为 `OPENAI | ANTHROPIC | GOOGLE | AZURE_OPENAI | ZHIPU | QWEN | CUSTOM`。未知值或未登记组合必须拒绝，品牌不得改写地址或选择另一个客户端。
- 渠道集合只返回 `AIChannelSummary`，包含身份、状态、根地址、API Key 配置状态、Header 数、启用模型数、最近测试和修订号；不得返回 Header 值、模型数组或任何密钥片段。`counts` 应用 `q` 和 `provider_brand`，但不应用 `status`。
- 使用统计只聚合该渠道正式 `GENERATE`/`HUMANIZE` 作业，默认最近 30 天；连接测试和模型发现只进入测试状态与审计。业务作业数为时间窗内全部正式作业，成功/失败只计对应终态；成功率分母为成功加失败，平均耗时只聚合非空耗时，Token 只求和已报告值，完全未报告时返回 `null` 而非 `0`。
- 渠道操作日志继续读取 `audit_logs`。模型 CRUD、启停、测试和发现事件通过脱敏 `channel_id` 建立渠道投影；不得复制日志表，也不得为历史缺失关联的已删除模型猜测渠道。
- 作业快照冻结普通 Header、敏感 Header 名称、模型参数、平台身份、事实版本身份和最终 system/user message；执行或重试时只读取快照所列敏感 Header 的当前值。后来新增的敏感 Header 不得进入旧作业，快照所列 Header 已删除或改为普通 Header 时必须失败。
- Chat Completions 正文必须直接解析为仅含 `title`、`summary`、`body_markdown`、`tags` 的非空 JSON 对象，不做提取、修复或补值。
- 模型“测试连接”与正式生成必须使用不同解析边界：测试请求只发送一条内容为 `hi` 的用户消息，并仅验证标准 `choices[0].message.content` 字符串；不得用业务草稿四字段 Schema 判断连接是否可用。
- 模型写操作按“渠道行 -> 模型行”顺序加锁。模型测试在读取配置后释放行锁，外部调用结束再按渠道和模型修订号回写；测试期间配置变化返回 `REVISION_CONFLICT`。
- 渠道与 Header 物理删除必须先以 `SELECT ... FOR UPDATE` 锁定删除目标，再追加成功审计和执行副作用。同一目标的两个并发 DELETE 必须分别返回 `204`、`404`；只能产生一条成功审计，Header 删除引起的渠道/模型失效和 revision 递增也只能执行一次。
- API 提交 Job 后的 Broker 故障不得把业务作业改为失败；Beat 只补投递超龄 `PENDING`，Worker 只有完成原子 `PENDING -> RUNNING` 声明后才能调用供应商。
- `RUNNING` 租约必须按冻结快照的 `timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS` 计算；租约过期形成 `FAILED/WORKER_LOST`，不得自动再次调用供应商。
- 每次真实请求只解析一次完整 A/AAAA 集合并整体校验，只连接该集合中的 `sockaddr`；实际 TCP peer 必须在发送 Authorization 或敏感 Header 前属于批准集合。HTTPS 始终用原 hostname 完成 SNI、证书身份和 Host。
- 同一次请求开始发送 HTTP 字节后不得切换地址或自动重试；响应正文必须受固定大小上限保护。不得恢复“先校验 URL、再由通用客户端按 hostname 二次解析”的 TOCTOU 路径。
- 渠道和生成页面统一展示 `AT_MOST_ONCE + 显式手动重试`。发送前可在同次已批准地址集合内建立连接；开始发送后不自动重放。用户重试必须创建带 `retry_of_id` 的新作业并复制原快照，不能增加“重试次数”渠道字段。
- 只有绑定 `FactVersion.classification=PUBLIC` 且 Markdown 正文非空时才能调用第三方模型；任务不保存第二份分级、用户 Prompt 或结构化事实副本。
- 平台 Prompt 是可复用模板库：`GET/POST /api/v1/platform-prompts` 与 `GET/PUT/DELETE /api/v1/platform-prompts/{platform_prompt_id}`。一个平台通过可空 `platform_prompt_id` 最多绑定一份当前模板，一份模板可绑定多个平台；不得恢复类型级 Prompt、双读、默认 Prompt 或兼容回退。
- Prompt 名称全局唯一。PUT 与 DELETE 都必须携带当前 `expected_revision`；服务锁定模板行后比较修订号，过期命令返回 `REVISION_CONFLICT`。被任一平台绑定的模板不得删除，平台删除或换绑不得级联删除模板。
- 平台集合的可空 `platform_prompt` 摘要只能批量投影当前外键目标；配置完整性只由绑定是否存在派生，不得保存 `prompt_configured`、`prompt_updated_at` 或其他平行汇总字段。
- 文章自然化只使用 `content_humanization_prompts.id=1` 的全局当前 Prompt。迁移不得种子默认值；管理员通过 `GET/PUT /api/v1/content-humanization-prompt` 首次创建或按 revision 更新，不提供删除、平台副本、用户临时 Prompt 或代码回退。
- 配置页输出预览必须创建现有 `GENERATE` 或 `HUMANIZE` 作业，并按任务级作业列表中的返回 Job ID 轮询后读取不可变 `ContentVersion`；不得新增无痕模型调用、预览专用结果源，或为显示预览读取含完整输入快照的作业详情。未保存的 Prompt 草稿不能用于预览。
- 原始生成和自然化共用 `generation_jobs` 与一个 Celery UUID 消息。`job_type=GENERATE` 使用 `GenerationSnapshot`，`job_type=HUMANIZE` 使用 `HumanizationSnapshot`；必须按类型严格解析，不得候选解析或建立第二套队列、重试和指标来源。
- 自然化快照冻结源版本完整正文与哈希、全局 Prompt Markdown/revision、用户选择的渠道/模型、事实版本身份和最终消息。重试只复制原快照，不读取当前 Prompt 或更换模型。
- 内容任务直接提交 `platform_profile_id`。新原始生成作业使用 `content-markdown-v3`，服务端必须校验请求中的 Prompt UUID/revision 仍等于平台当前绑定，并冻结 Prompt 身份、名称、revision 和正文；请求仍恰好为 `system = PlatformPrompt.template_markdown`、`user = FactVersion.body_markdown`。`content-markdown-v2` 仅作为明确历史类型读取和按原快照重试，v1 快照仅供历史读取且禁止重试。

### 4. 校验与错误矩阵

- 非公网 HTTPS 或非回环 HTTP -> `AI_URL_FORBIDDEN`。
- HTTP 重定向 -> `AI_REDIRECT_FORBIDDEN`，不得跟随。
- 实际 TCP peer 不在本次批准集合 -> `AI_URL_FORBIDDEN`，且敏感 Header 尚未发送。
- 绑定事实版本不是 `PUBLIC` -> `AI_DATA_CLASSIFICATION_FORBIDDEN`。
- 具体平台没有当前 Prompt -> `PLATFORM_PROMPT_MISSING`；不得回退到平台类型或其他平台 Prompt。
- 全局自然化 Prompt 未配置 -> `HUMANIZATION_PROMPT_MISSING`；不得使用文档建议模板或代码常量代替。
- 自然化源不是 `OPEN` 任务中的 `AI DRAFT | CHANGES_REQUESTED`，或冻结身份/哈希失效 -> `HUMANIZATION_SOURCE_INVALID`；同源已有活动作业 -> `HUMANIZATION_ALREADY_ACTIVE`。
- 响应超过固定上限 -> `AI_RESPONSE_TOO_LARGE`，不得继续读取或改走其他地址。
- 保留 Header、非法 token 或控制字符 -> `INVALID_HEADER`。
- 密钥、密文格式或关联数据错误 -> `CREDENTIAL_DECRYPTION_FAILED`。
- `model`、`messages`、`stream` 出现在自定义参数 -> 请求校验失败。
- 未知 `protocol_type`、未知 `provider_brand` 或未登记品牌—协议组合 -> 请求校验失败；不得按名称、URL 或品牌猜测协议。
- 非法列表页码、`page_size` 不属于 `10|20|50`、未知排序或统计周期 -> 请求校验失败；不得静默改成默认值。
- 渠道或模型未启用、模型未测试 -> `AI_CONFIGURATION_DISABLED` 或 `AI_MODEL_NOT_TESTED`。
- 配置行已物理删除 -> `AI_CONFIGURATION_DELETED`，不得用快照中的非敏感信息猜测调用。
- 同一渠道或 Header 已被另一个并发 DELETE 提交 -> HTTP `404`；不得再次返回 `204`、追加成功审计或重复失效关联配置。
- 快照所列敏感 Header 已删除或改为普通 Header -> `AI_CONFIGURATION_DELETED`，不得省略该 Header 或改用后来新增的 Header。
- 超时、网络失败、供应商 HTTP 错误和严格响应失败 -> 作业显式 `FAILED`，错误摘要不得包含凭据或响应正文。

### 5. 正常、基础与错误案例

- 正常：管理员保存公网 HTTPS 渠道，模型严格测试通过并启用；作业冻结快照后只调用一次供应商并创建一个 `DRAFT ContentVersion`。
- 正常：两个请求并发删除同一渠道或 Header 时，先获得目标行锁的请求返回 `204`，后一个在锁释放后确认目标不存在并返回 `404`。
- 连接测试：管理员对具体模型发起测试，系统携带当前凭据、Header、模型 ID 和自定义参数发送 `hi`；普通文本响应可以通过，且不会进入内容版本。
- 基础：供应商不返回 token 用量时，对应字段保存 `NULL`，不得补 `0`。
- 管理：按描述搜索并筛选 `OPENAI` 时，列表 `total` 与 `counts` 来自同一服务端查询；切换状态只改变 `items/total`，分类数量仍保留同一搜索和品牌条件下的全部/启用/停用计数。
- 管理：零业务作业时返回 `total_jobs=0`、成功/失败数为零，`success_rate`、平均耗时、Token 和最近使用均为 `null`；模型测试成功不改变这些统计。
- 管理：复制配置只允许名称、描述、协议、品牌、根地址、超时、普通 Header 值、敏感 Header 名称/已配置状态和模型非敏感配置；不得复制 API Key 或敏感 Header 值。
- 开发：显式开启本机 HTTP 后可连接 `127.0.0.1`/`::1` 测试服务，但不能连接 `10.0.0.0/8` 或公网 HTTP。
- 错误：模型响应包含代码块、附加字段或正文外说明时，整个调用失败，不创建内容版本。
- 错误：作业租约已被恢复器标记失败后，迟到响应不得覆盖终态或创建内容版本。
- 错误：旧作业创建后新增敏感 Header 时，执行或重试不得把该 Header 带入请求；旧作业所需敏感 Header 不再存在时显式失败。
- 错误：把 Humanizer-zh 当作后端 Skill 运行时，或在原始生成成功后自动串行调用自然化。
- 正常：用户对具体合格 AI 版本选择当前可用模型，独立自然化作业创建一个 `based_on_id` 指向源版本的新 AI 草稿，源正文和状态保持不变。
- 错误：legacy Job 快照不得重试到第三方模型；用户必须基于当前三个字段任务创建新 v3 作业。

### 6. 必需测试

- 单元测试：凭据关联数据/错误密钥、Header 注入、保留字段、SSRF 地址、重定向、严格 JSON 和可空用量。
- 单元测试：连接测试请求必须只有一条 `hi` 用户消息；连接响应只校验通用 Chat Completions 结构，正式生成仍覆盖严格业务 JSON。
- 迁移测试：`0008_files -> head` 账号映射、旧权限表删除、新配置表/约束/触发器和有损回滚策略。
- 契约测试：`make contract-check` 验证 FastAPI/OpenAPI 语义和前端生成类型无漂移。
- 端到端测试：真实 HTTP 测试替身完成模型发现、测试和生成；确定性生成器只用于明确的单元/开发场景，不能伪装成真实云端成功。
- Prompt 管理断言：平台列表批量返回当前模板摘要，共享更新列出全部受影响平台，绑定模板拒绝删除，未绑定模板按 revision 删除；配置页两类输出预览创建真实作业和 AI `DRAFT`，并对 Markdown 结果做安全清理。
- 并发断言：作业创建锁定任务并读取当前平台 Prompt 与冻结事实；过期租约后的迟到响应不能写入成功结果。
- 恢复断言：首次投递缺失、Broker 已接受但元数据未提交、重复消息和并发恢复均至多产生一次供应商调用和一个内容版本。
- 模型测试并发断言：外部调用期间配置可更新，但旧测试结果不得覆盖更新后的 `UNTESTED` 状态。
- 删除并发断言：使用隔离 PostgreSQL、独立请求会话和同步屏障同时删除同一渠道及同一 Header；分别断言状态码为 `[204, 404]`、成功审计恰好一条、级联最终状态正确，且 Header 删除只递增一次渠道和模型 revision。
- 快照 Header 断言：只发送快照锁定的普通 Header 和敏感 Header 名称；敏感值取当前配置，新增名称被忽略，缺失名称返回 `AI_CONFIGURATION_DELETED`。
- 固定地址断言：混合公网/私网解析整体拒绝；连接只能使用首次解析集合；peer 越界时零 HTTP 字节；真实本地 CA/HTTPS 替身验证 SNI、证书 hostname 和 Host。
- 事实断言：第三方创建和 Worker 执行都拒绝非 `PUBLIC` 或空白事实；legacy 快照重试明确返回 `LEGACY_GENERATION_RETRY_FORBIDDEN`。
- 渠道管理断言：迁移把旧渠道协议回填为当前协议、品牌回填 `CUSTOM` 而不猜测，运行时无数据库默认；列表搜索/筛选/稳定排序/分页/分类数量、最近测试、统计可空口径和审计归属均由 PostgreSQL 集成测试覆盖。
- 安全断言：普通用户读取返回 403，写请求缺少 CSRF 被拒绝；创建、换 Key、敏感 Header 表单关闭后 React Query mutation state 不保留明文，读取/审计/复制/浏览器存储均无明文。
- 端到端断言：真实本机 HTTP 协议替身覆盖模型发现、成功与失败测试，确认测试后模型保持停用并需手动启用；替身不得用前端路由或固定成功响应代替服务端调用。

### 7. 错误与正确写法

#### 错误

```python
# 失败后改用确定性生成器会伪造真实调用成功。
try:
    return client.complete(...)
except Exception:
    return DevelopmentContentGenerator().generate(snapshot)
```

#### 正确

```python
# 供应商失败直接形成显式失败作业，重试创建新作业并复用原快照。
result = client.complete(...)
draft = result.draft
```

```python
# 生成作业只按快照名称读取当前敏感值，不合并渠道当前的全部 Header。
api_key, sensitive_headers = request_credentials(
    db,
    channel,
    sensitive_header_names=snapshot.channel["sensitive_header_names"],
)
headers = build_snapshot_request_headers(
    snapshot.channel["plain_headers"],
    snapshot.channel["sensitive_header_names"],
    sensitive_headers,
)
```

```python
# 错误：根据供应商品牌隐式选择协议或为列表补兼容默认值。
protocol = "anthropic-native" if channel.provider_brand == "ANTHROPIC" else "openai-compatible-chat-completions"

# 正确：协议字段是唯一调用依据，品牌只参与已登记组合校验和管理投影。
protocol = require_supported_protocol(channel.protocol_type)
```

```python
# 错误：普通读取允许两个并发删除都进入成功审计和副作用。
target = db.get(AIChannel, channel_id)

# 正确：目标行串行化后，等待者会在前一事务提交删除后得到不存在结果。
target = db.scalar(select(AIChannel).where(AIChannel.id == channel_id).with_for_update())
```
