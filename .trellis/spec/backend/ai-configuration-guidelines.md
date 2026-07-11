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
- 模型写操作按“渠道行 -> 模型行”顺序加锁。模型测试在读取配置后释放行锁，外部调用结束再按渠道和模型修订号回写；测试期间配置变化返回 `REVISION_CONFLICT`。

### 4. 校验与错误矩阵

- 非公网 HTTPS 或非回环 HTTP -> `AI_URL_FORBIDDEN`。
- HTTP 重定向 -> `AI_REDIRECT_FORBIDDEN`，不得跟随。
- 保留 Header、非法 token 或控制字符 -> `INVALID_HEADER`。
- 密钥、密文格式或关联数据错误 -> `CREDENTIAL_DECRYPTION_FAILED`。
- `model`、`messages`、`stream` 出现在自定义参数 -> 请求校验失败。
- 渠道或模型未启用、模型未测试 -> `AI_CONFIGURATION_DISABLED` 或 `AI_MODEL_NOT_TESTED`。
- 配置行已物理删除 -> `AI_CONFIGURATION_DELETED`，不得用快照中的非敏感信息猜测调用。
- 快照所列敏感 Header 已删除或改为普通 Header -> `AI_CONFIGURATION_DELETED`，不得省略该 Header 或改用后来新增的 Header。
- 超时、网络失败、供应商 HTTP 错误和严格响应失败 -> 作业显式 `FAILED`，错误摘要不得包含凭据或响应正文。

### 5. 正常、基础与错误案例

- 正常：管理员保存公网 HTTPS 渠道，模型严格测试通过并启用；作业冻结快照后只调用一次供应商并创建一个 `DRAFT ContentVersion`。
- 基础：供应商不返回 token 用量时，对应字段保存 `NULL`，不得补 `0`。
- 开发：显式开启本机 HTTP 后可连接 `127.0.0.1`/`::1` 测试服务，但不能连接 `10.0.0.0/8` 或公网 HTTP。
- 错误：模型响应包含代码块、附加字段或正文外说明时，整个调用失败，不创建内容版本。
- 错误：作业租约已被恢复器标记失败后，迟到响应不得覆盖终态或创建内容版本。
- 错误：旧作业创建后新增敏感 Header 时，执行或重试不得把该 Header 带入请求；旧作业所需敏感 Header 不再存在时显式失败。

### 6. 必需测试

- 单元测试：凭据关联数据/错误密钥、Header 注入、保留字段、SSRF 地址、重定向、严格 JSON 和可空用量。
- 迁移测试：`0008_files -> head` 账号映射、旧权限表删除、新配置表/约束/触发器和有损回滚策略。
- 契约测试：`make contract-check` 验证 FastAPI/OpenAPI 语义和前端生成类型无漂移。
- 端到端测试：真实 HTTP 测试替身完成模型发现、测试和生成；确定性生成器只用于明确的单元/开发场景，不能伪装成真实云端成功。
- 并发断言：任务 Prompt 保存与作业创建使用同一任务行锁；过期租约后的迟到响应不能写入成功结果。
- 模型测试并发断言：外部调用期间配置可更新，但旧测试结果不得覆盖更新后的 `UNTESTED` 状态。
- 快照 Header 断言：只发送快照锁定的普通 Header 和敏感 Header 名称；敏感值取当前配置，新增名称被忽略，缺失名称返回 `AI_CONFIGURATION_DELETED`。

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
