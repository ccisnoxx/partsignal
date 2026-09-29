# 开发阶段：本地开发与服务器预览

当前项目仍在开发阶段，Hostdzire 用于查看页面和验证业务。正式 Production 发布、clean-init 和 observation 暂不执行；部署到服务器并不表示已进入正式生产。

## 1. 你需要提供什么

| 配置 | 负责方 | 当前是否必需 |
| --- | --- | --- |
| 预览网址 | 用户确认，当前为 `https://geo.962850.xyz` | 服务器预览需要 |
| 数据库名称、用户、内部地址 | 部署准备从模板派生 | 无需用户填写 |
| 数据库密码、session secret、AI 加密主密钥、upload signing secret | 首次部署准备自动随机生成并持久保存 | 无需用户提供，后续不能重生成 |
| 初始 admin/content_editor 密码 | 首次准备自动生成，账号初始化命令在空库创建账号 | 无需用户编造，通过受控方式交付登录信息 |
| AI 服务商、API base URL、精确 model ID、API Key | 用户拥有的外部服务信息 | 测试真实 AI 时需要 |
| OSS endpoint、bucket、AccessKey | 用户拥有的外部服务信息 | 仅测试真实 Aliyun OSS 时需要 |

Docker 启动 PostgreSQL；镜像用收到的 `POSTGRES_*` 初始化数据库。它不会同时为应用生成 session/encryption 密钥或创建应用账号。完整 env 是组件间的技术接口，不是要求用户提供所有字段的表单。

## 2. 完整配置怎样产生

本机开发从 `.env.example` 复制为 `.env`，默认值已完整，不能直接用于公网。服务器开发预览使用 `.env.staging.example`；首次运行下列命令自动生成六个独立 secret、匹配的 `DATABASE_URL` 和完整38项 runtime配置，不上传、不部署：

```sh
uv run --project backend python deploy/scripts/prepare-preview-env.py \
  --origin https://geo.962850.xyz
```

输出为 Git 忽略的 `.env.staging`，权限 `0600`。既有文件或 symlink 明确拒绝，不覆盖、不为升级重生成。真实 Settings 在隔离进程中校验后，完整暂存并排他安装，日志不输出值。密码已进入受控 runtime 文件；部署时的 `initialize-accounts` 才创建应用账号，生成配置不表示账号或数据库已创建。

默认 `APP_ENV=staging`、安全 HTTPS Cookie、`AI_ALLOW_LOCAL_HTTP=false`。默认 `CONTENT_GENERATOR=deterministic` 与开发对象存储 `fake-oss`，可验证页面、工作流和上传功能，无需真实 AI/OSS 账号；它们是明确的开发适配器，不能当成真实供应商验收。真实 AI 可在首次准备时添加 `--generator openai-compatible`；既有环境需要受控更新并使容器加载，不会因填写 JSON 自动切换模式。

准备文件在后续获准部署时单独交付到共享路径，各 release 引用同一份配置。当前生成器不上传，部署脚本不自动生成 env；普通发布复用配置与数据库 AI 设置。本次清理保留旧配置，新首次预览部署须明确选择复用配置或新独立环境，不会悄悄覆盖已有值。正式生产另有专用模板/runbook，预览生成器不会生成 Production env。

## 3. 开发阶段如何配置真实 AI

AI 可用于开发、预览和正式生产，配置 owner 都是 PostgreSQL。开发/预览通常由管理员在 `/settings/ai` 操作：新建渠道并输入地址/Key，添加精确模型 ID，测试连接，成功后显式启用模型与渠道；业务生成还需要 Prompt/平台绑定、公开事实和任务。连接成功不等于业务生成通过。

API Key 只在受控管理员表单输入并加密入库，不进入聊天、env、JSON输入清单或源归档。开发/预览不用 Production maintenance bootstrap。`deploy/ai-settings.example.json` 是九项非 secret 填写参考，可以复制为 Git 忽略的 `.env.ai.json` 方便记录；服务不会自动读取它，不能用文件存在代替渠道创建/启用。

| 字段 | 含义 | 填写方式 |
| --- | --- | --- |
| `channel_name` | 渠道在页面中的名称 | 自己起名，如“开发预览 AI” |
| `channel_description` | 备注 | 可为空或写用途 |
| `protocol_type` | 实际调用协议 | 保持 `openai-compatible-chat-completions`，供应商须支持该协议 |
| `provider_brand` | 管理页面品牌分类，不转换协议 | `OPENAI/ANTHROPIC/GOOGLE/AZURE_OPENAI/ZHIPU/QWEN/CUSTOM`；网关或未登记品牌用 `CUSTOM` |
| `base_url` | API 根地址 | 供应商的 HTTPS 地址，含其要求的 `/v1` 等前缀；不填写完整 `/chat/completions`，不含Key/query |
| `timeout_seconds` | 单次调用超时秒数 | 默认60，允许10..600 |
| `model_display_name` | 页面展示名 | 自己起一个易读名称 |
| `model_id` | 发给供应商的精确模型标识 | 原样使用供应商的 ID，大小写敏感，不猜测 |
| `request_parameters` | 模型额外 JSON 参数 | 不确定时保留 `{}`；不能填写系统保留的 `model/messages/stream` |

缺少真实服务信息时可先用开发适配器查看界面；要测试真实 AI 业务时才补齐这些信息与 Key，不能把未调用真实服务的结果标为真实 AI 测试通过。

## 4. 上一轮 Production AI 文件的额外字段

`.env.production.ai.json` 是前一轮正式发布操作清单，不是应用“只支持生产 AI”的配置加载文件。九项 metadata 含义同上；下列六项属于 Production 发布准备，当前开发预览不用手工填写：

| 字段 | 含义 / 负责方 |
| --- | --- |
| `chat_completions_compatibility_confirmed` | 操作者确认供应商支持协议，不表示真实测试成功 |
| `custom_headers_required` | 是否还要求自定义 Header；第一版 Production bootstrap 不支持，不能改为false掩盖需求；开发配置页面可管理Header |
| `credential_ready` | owner确认Key已备妥并符合声明预算，不保存Key |
| `credential_json_bytes_upper_bound` | 旧Production工具的credential JSON字节上界，用于64KiB限制；由操作方处理，不是模型参数 |
| `credential_owner` | 谁持有并输入Key，不是平台账号密码 |
| `credential_owner_tty_handoff_confirmed` | 是否安排正式bootstrap的真实无回显TTY交接；开发页面配置不需要 |

这些字段不改变程序加载方式，也不应成为查看开发界面的前置条件。

## 5. 本次清理与后续部署

用户已授权永久删除旧测试数据，保留配置和历史冻结证据。清理关闭现有预览，不创建新release、不重新部署。后续以用户通知为准，先检查新的预览输入、源码与部署入口，再执行独立的开发预览部署；Production切换暂不推进。
