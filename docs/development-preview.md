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

默认 `APP_ENV=staging`、安全 HTTPS Cookie、`AI_ALLOW_LOCAL_HTTP=false`。准备工具默认写入 `CONTENT_GENERATOR=deterministic`，对象存储采用开发适配器 `fake-oss`。当前源码中，`deterministic` 是兼容保留的业务 no-egress 值：正式生成、自然化和重试均关闭，不提供固定成功的假 AI 内容；人工内容流程仍可使用。管理员明确执行的模型连接测试和发现属于独立管理操作，仍可能调用供应商。真实业务生成需显式 `CONTENT_GENERATOR=openai-compatible`，并在 PostgreSQL 中配置已启用、测试通过的渠道/模型及合格的业务上下文。

首次准备真实生成环境可加 `--generator openai-compatible`；准备文件不会创建数据库渠道或写入 Key。既有 env 不由工具覆盖，须通过独立受控配置更新与服务重载使 API、Worker、Scheduler 加载同一模式。Settings 是各进程启动快照，修改文件不是即时关闭开关。API 关闭模式时返回 `409 AI_GENERATION_DISABLED` 且不写入/提交 Job 或投递 Redis；actions、generation-options 与 Prompt Preview 不提供生成/自然化/retry 动作或真实模型候选。Worker 最终将关闭模式下的 PENDING 标记 `FAILED/AI_GENERATION_DISABLED`，重复投递不改变终态、不调用供应商、不创建新版本。Beat 仍只补投递超龄 PENDING UUID，由 Worker 最终拒绝。

模式切换或停用渠道/模型不能撤回已发请求。已经 RUNNING 的重复消息不会重放，原执行继续遵守快照租约与迟到结果合同；已通过渠道/模型检查的旧进程仍可能外发。关闭后需核对每个服务实际加载的模式、积压和 RUNNING 状态，不能仅据 env 字面值声称所有调用停止。停用操作须使用最新 revision 并保留部分成功或并发冲突的实际状态。

准备文件经授权部署时单独交付到服务器共享路径，各 release 引用同一份配置。生成器本身不上传，部署脚本不自动生成 env；后续发布复用配置与数据库 AI 设置。本次首次预览已先备份旧配置，再安装新的完整 staging 配置。正式生产另有专用模板/runbook，预览生成器不会生成 Production env。

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

缺少真实服务信息时仍可查看页面并使用人工内容流程；真实 AI 业务需要合格的渠道、模型与业务上下文，不能把未调用真实服务的结果标为真实 AI 测试通过。

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

## 5. 当前开发预览

用户授权清理旧测试数据后，已单独授权首次重新部署。开发预览现在可访问 `https://geo.962850.xyz/`；当前 release 为 `preview-20260930-111500-2f171300`（源码精确 `2f17130055439f59dfc11fed42ada47d066c71cf`）。首次部署走 staging `full` 路径，已完成数据库迁移和 `admin`、`content_editor` 初始化。登录密码由准备工具生成，保存在本机 Git 忽略且权限为 `0600` 的 `.env.staging` 中，分别对应 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 和 `PARTSIGNAL_SEED_ENGINEER_PASSWORD`；请在本机查看，不要将其粘贴到聊天或提交到 Git。修改 env 中的初始密码不会自动修改已经创建的账号密码，后续改密应通过应用流程。

2026-09-29 的独立真实 AI 接入任务中，用户通过管理员页面配置了 HTTPS `api.deepseek.com` 渠道与精确模型 `deepseek-flash`，模型通过真实测试并启用。一次正常 Content Editor 生成成功，Job `01f4506d-9975-4779-9d81-ac5663f79511` 创建 AI 草稿 ContentVersion `8494fa1f-ab2c-4bb0-b5a0-f1337ee1d342`；Worker、Usage 与 lineage 证据见 `.trellis/tasks/09-29-development-preview-real-ai-integration/implement.md`。双方确认按现有真实路径验证并采用上述配置停用门禁；env 没有切换、容器没有重建，模式开关缺陷没有修复。对象存储仍为 `fake-oss`，没有接入真实 OSS。`.env.production.ai.json` 不会自动启用预览 AI；旧冻结证据保留，正式 Production 切换暂不推进。

2026-09-30 的独立 `development-preview-runtime-gate-rollout` 任务已将运行模式门禁部署到上述新 release。staging 共享配置只将 `CONTENT_GENERATOR` 从 `deterministic` 改为 `openai-compatible`；API、Worker、Scheduler 已重建并加载同一模式。现有 PostgreSQL、Redis、fake-oss、账号、渠道/模型与上一轮 Job/ContentVersion 保留；没有迁移、clean-init、Production cutover 或历史清理。原 env 和一致性数据库备份配对保存在 Hostdzire 受限目录，旧 release 与镜像保留。

部署后正常管理员流程仅确认一次真实生成：任务 `CT-43997411`，Job `abc4e3cd-efc2-40fb-a87d-330a378bfecb` 为 `SUCCEEDED`、attempt=1，创建不可变 AI DRAFT ContentVersion `40445d14-fa04-4bb9-80b0-f9cef49257b0`。Prompt/PUBLIC Fact/channel/model/provider lineage、Worker、Usage 和部署证据见 `.trellis/tasks/09-30-development-preview-runtime-gate-rollout/implement.md`。current 在健康与真实生成通过后才原子切换；对象存储仍为 `fake-oss`，本次草稿没有审核、批准或发布。上段“env 没有切换”的描述仅属于上一轮修复前历史。

2026-09-30 的独立 `development-preview-real-aliyun-oss-integration` 前置检查停在配置写入之前：候选 OSS Settings 和适配器可以构造，但 Bucket 的 `GetBucketInfo` 返回 `public-read`，不满足必须私有的合同；现有凭据的 `GetBucketCors` 与 `ListObjects(staging/)` 均返回 `403 AccessDenied`，无法证明精确 CORS 与 namespace 隔离。本任务不授权修改 Bucket ACL，因此未切换对象存储、未上传文件、未修改 CORS 或重建服务。开发预览仍为 `openai-compatible` + `development/fake-oss`，current、release、镜像与历史数据保持。真实浏览器文件验收尚未执行；准确恢复点见该任务 `implement.md`。没有推进 Production、Observation 或其他后续任务。


2026-10-01 用户确认输入 Bucket 身份并取消本开发预览任务的强制 private 要求，计划保留共享 Bucket 的现有 ACL。前一段 private 阻断仅属于修订前验收合同；当前必要 CORS 和 staging namespace 读取仍为 403，尚未执行配置切换。public-read 下当前适配器上传对象继承 Bucket ACL，短期下载签名不能被表述为对象整体访问期限；后续须记录匿名访问实态。该次权限复核未修改产品源码或其他环境合同。


2026-10-01 用户将上传架构改为“浏览器 → PartSignal 后端 → OSS”，并明确本轮只完成代码和定向验证、保留当前 staging release。源码候选的文件意图改为应用内上传路径，三个上传入口携带会话与 CSRF，后端校验实际大小/哈希后写入存储并沿用 HEAD complete；OSS 上传 CORS 管理权限不再是该架构的前置条件。共享 Bucket 的身份确认不授予删除其他项目对象的权限，应用仍只操作服务端生成的单一 UUID key。当前在线版本仍是上述 2f171300 release 的直传流程和 development/fake-oss；候选尚未部署，也没有真实 OSS 文件验收结果。后端中转实现与定向证据见 `.trellis/tasks/10-01-backend-relay-file-upload/`，不推进 Production 或 Observation。


后端中转候选的源码与定向验证已完成（后端467、前端32、桌面fixture5用例通过），完整API契约和secret扫描通过，独立源码复核NO BLOCKER。此结论只覆盖本轮代码范围，未完成真实PostgreSQL并发或实际OSS验收。结束核对发现现有同一Scheduler容器RestartCount从0增为1，当前healthy、OOM=false；一小时内Docker事件/错误类别读取没有提供原因，未自行重建服务。current、配置、镜像、数据库/AI指纹、fake目录与应用Nginx保持一致，不能宣称运行期间完全无重启。
