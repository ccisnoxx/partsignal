# AI 配置与生成边界

## 场景：OpenAI-compatible 配置中心

### 1. 范围与触发条件

- 当代码修改 AI 渠道、Header、模型、生成快照、外部模型调用或相关环境变量时，必须遵守本规范。
- PostgreSQL 保存当前配置和不可变作业快照；Redis 只传递 `GenerationJob.id`。
- `contracts/openapi.yaml` 与 `contracts/database.md` 是跨层契约源，运行时 Schema 和前端类型必须从它们保持一致。

### 2. 签名

- 渠道协议：`GET {base_url}/models`、`POST {base_url}/chat/completions`。
- 创建作业：`POST /api/v1/content-tasks/{content_task_id}/generation-jobs`，请求体只接收 `ai_model_id`。
- 重试作业：`POST /api/v1/generation-jobs/{generation_job_id}/retry`，复制原 `input_snapshot`。
- 核心表：`ai_channels`、`ai_channel_headers`、`ai_models`、`generation_jobs`。
- `generation_jobs.ai_channel_id` 和 `ai_model_id` 删除时 `SET NULL`；历史含义由 `input_snapshot` 保留。

### 3. 契约

- `AI_CREDENTIAL_ENCRYPTION_KEY` 必须是 Base64 编码的 32 字节密钥。
- 生产环境必须使用 `CONTENT_GENERATOR=openai-compatible` 和 `AI_ALLOW_LOCAL_HTTP=false`。
- `AI_ALLOW_LOCAL_HTTP=true` 只允许 `development`/`test` 的回环 HTTP 地址；公网仍使用 HTTPS，私网、链路本地和混合解析结果均拒绝。
- API Key 和敏感 Header 使用 AES-256-GCM 密文保存，关联数据绑定记录 ID；响应、日志、审计和作业快照不得包含明文。
- 作业快照冻结普通 Header、敏感 Header 名称、模型参数、system/user message、批准事实和任务要求；执行或重试时只读取快照所列敏感 Header 的当前值。后来新增的敏感 Header 不得进入旧作业，快照所列 Header 已删除或改为普通 Header 时必须失败。
- Chat Completions 正文必须直接解析为仅含 `title`、`summary`、`body_markdown`、`tags` 的非空 JSON 对象，不做提取、修复或补值。
- 模型“测试连接”与正式生成必须使用不同解析边界：测试请求只发送一条内容为 `hi` 的用户消息，并仅验证标准 `choices[0].message.content` 字符串；不得用业务草稿四字段 Schema 判断连接是否可用。
- 模型写操作按“渠道行 -> 模型行”顺序加锁。模型测试在读取配置后释放行锁，外部调用结束再按渠道和模型修订号回写；测试期间配置变化返回 `REVISION_CONFLICT`。
- API 提交 Job 后的 Broker 故障不得把业务作业改为失败；Beat 只补投递超龄 `PENDING`，Worker 只有完成原子 `PENDING -> RUNNING` 声明后才能调用供应商。
- `RUNNING` 租约必须按冻结快照的 `timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS` 计算；租约过期形成 `FAILED/WORKER_LOST`，不得自动再次调用供应商。
- 每次真实请求只解析一次完整 A/AAAA 集合并整体校验，只连接该集合中的 `sockaddr`；实际 TCP peer 必须在发送 Authorization 或敏感 Header 前属于批准集合。HTTPS 始终用原 hostname 完成 SNI、证书身份和 Host。
- 同一次请求开始发送 HTTP 字节后不得切换地址或自动重试；响应正文必须受固定大小上限保护。不得恢复“先校验 URL、再由通用客户端按 hostname 二次解析”的 TOCTOU 路径。
- Prompt 保存必须同时记录整份生成输入的分级、分类人和时间。只有任务分级与绑定事实快照的全部 Evidence 均为 `PUBLIC` 时才能调用第三方模型；历史空分级、`INTERNAL` 或 `RESTRICTED` 一律拒绝。
- 当前平台 Prompt 的唯一所有者是 `PlatformProfile`：`GET/PUT/DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt`。不得恢复类型级 Prompt API、双读、默认 Prompt 或兼容回退。
- 文章自然化只使用 `content_humanization_prompts.id=1` 的全局当前 Prompt。迁移不得种子默认值；管理员通过 `GET/PUT /api/v1/content-humanization-prompt` 首次创建或按 revision 更新，不提供删除、平台副本、用户临时 Prompt 或代码回退。
- 原始生成和自然化共用 `generation_jobs` 与一个 Celery UUID 消息。`job_type=GENERATE` 使用 `GenerationSnapshot`，`job_type=HUMANIZE` 使用 `HumanizationSnapshot`；必须按类型严格解析，不得候选解析或建立第二套队列、重试和指标来源。
- 自然化快照冻结源版本完整正文与哈希、全局 Prompt Markdown/revision、用户选择的渠道/模型、原始批准事实、PUBLIC 分类、任务要求和最终消息。重试只复制原快照，不读取当前 Prompt 或更换模型。
- 内容任务仍提交具体 `platform_profile_version_id`。服务端必须同时校验版本为 `ACTIVE` 且所属平台存在当前 Prompt；新作业快照必须写入具体平台身份和最终 system/user message，旧快照缺少平台对象只允许只读。

### 4. 校验与错误矩阵

- 非公网 HTTPS 或非回环 HTTP -> `AI_URL_FORBIDDEN`。
- HTTP 重定向 -> `AI_REDIRECT_FORBIDDEN`，不得跟随。
- 实际 TCP peer 不在本次批准集合 -> `AI_URL_FORBIDDEN`，且敏感 Header 尚未发送。
- 任务或事实证据未全部明确为 `PUBLIC` -> `AI_DATA_CLASSIFICATION_FORBIDDEN`。
- 具体平台没有当前 Prompt -> `PLATFORM_PROMPT_MISSING`；不得回退到平台类型或其他平台 Prompt。
- 全局自然化 Prompt 未配置 -> `HUMANIZATION_PROMPT_MISSING`；不得使用文档建议模板或代码常量代替。
- 自然化源不是 `OPEN` 任务中的 `AI DRAFT | CHANGES_REQUESTED`，或冻结身份/哈希失效 -> `HUMANIZATION_SOURCE_INVALID`；同源已有活动作业 -> `HUMANIZATION_ALREADY_ACTIVE`。
- 响应超过固定上限 -> `AI_RESPONSE_TOO_LARGE`，不得继续读取或改走其他地址。
- 保留 Header、非法 token 或控制字符 -> `INVALID_HEADER`。
- 密钥、密文格式或关联数据错误 -> `CREDENTIAL_DECRYPTION_FAILED`。
- `model`、`messages`、`stream` 出现在自定义参数 -> 请求校验失败。
- 渠道或模型未启用、模型未测试 -> `AI_CONFIGURATION_DISABLED` 或 `AI_MODEL_NOT_TESTED`。
- 配置行已物理删除 -> `AI_CONFIGURATION_DELETED`，不得用快照中的非敏感信息猜测调用。
- 快照所列敏感 Header 已删除或改为普通 Header -> `AI_CONFIGURATION_DELETED`，不得省略该 Header 或改用后来新增的 Header。
- 超时、网络失败、供应商 HTTP 错误和严格响应失败 -> 作业显式 `FAILED`，错误摘要不得包含凭据或响应正文。

### 5. 正常、基础与错误案例

- 正常：管理员保存公网 HTTPS 渠道，模型严格测试通过并启用；作业冻结快照后只调用一次供应商并创建一个 `DRAFT ContentVersion`。
- 连接测试：管理员对具体模型发起测试，系统携带当前凭据、Header、模型 ID 和自定义参数发送 `hi`；普通文本响应可以通过，且不会进入内容版本。
- 基础：供应商不返回 token 用量时，对应字段保存 `NULL`，不得补 `0`。
- 开发：显式开启本机 HTTP 后可连接 `127.0.0.1`/`::1` 测试服务，但不能连接 `10.0.0.0/8` 或公网 HTTP。
- 错误：模型响应包含代码块、附加字段或正文外说明时，整个调用失败，不创建内容版本。
- 错误：作业租约已被恢复器标记失败后，迟到响应不得覆盖终态或创建内容版本。
- 错误：旧作业创建后新增敏感 Header 时，执行或重试不得把该 Header 带入请求；旧作业所需敏感 Header 不再存在时显式失败。
- 错误：把 Humanizer-zh 当作后端 Skill 运行时，或在原始生成成功后自动串行调用自然化。
- 正常：用户对具体合格 AI 版本选择当前可用模型，独立自然化作业创建一个 `based_on_id` 指向源版本的新 AI 草稿，源正文和状态保持不变。
- 错误：0012 之前的历史 Job 快照缺少分级时不得重试到第三方模型；用户必须在当前任务重新保存 Prompt 与分级并创建新作业。

### 6. 必需测试

- 单元测试：凭据关联数据/错误密钥、Header 注入、保留字段、SSRF 地址、重定向、严格 JSON 和可空用量。
- 单元测试：连接测试请求必须只有一条 `hi` 用户消息；连接响应只校验通用 Chat Completions 结构，正式生成仍覆盖严格业务 JSON。
- 迁移测试：`0008_files -> head` 账号映射、旧权限表删除、新配置表/约束/触发器和有损回滚策略。
- 契约测试：`make contract-check` 验证 FastAPI/OpenAPI 语义和前端生成类型无漂移。
- 端到端测试：真实 HTTP 测试替身完成模型发现、测试和生成；确定性生成器只用于明确的单元/开发场景，不能伪装成真实云端成功。
- 并发断言：任务 Prompt 保存与作业创建使用同一任务行锁；过期租约后的迟到响应不能写入成功结果。
- 恢复断言：首次投递缺失、Broker 已接受但元数据未提交、重复消息和并发恢复均至多产生一次供应商调用和一个内容版本。
- 模型测试并发断言：外部调用期间配置可更新，但旧测试结果不得覆盖更新后的 `UNTESTED` 状态。
- 快照 Header 断言：只发送快照锁定的普通 Header 和敏感 Header 名称；敏感值取当前配置，新增名称被忽略，缺失名称返回 `AI_CONFIGURATION_DELETED`。
- 固定地址断言：混合公网/私网解析整体拒绝；连接只能使用首次解析集合；peer 越界时零 HTTP 字节；真实本地 CA/HTTPS 替身验证 SNI、证书 hostname 和 Host。
- 分类断言：迁移后历史任务保持 `NULL`；第三方创建、重试和 Worker 执行都拒绝缺失或非 PUBLIC 分级以及任一非 PUBLIC Evidence。

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
