# 开发与 Production 配置准备

当前项目处于开发阶段，Hostdzire 用于开发预览；当前操作请先读[开发预览配置说明](./development-preview.md)。本页保留正式 Production 合同，不能把它当成查看开发界面的必填清单。内部密码、系统密钥和初始账号密码由部署准备生成/管理，用户只提供自己拥有的外部服务信息。

## 1. 应该复制哪个文件

开发和生产分别维护配置。开发时复制 `.env.example → .env`；生产时复制 `.env.production.example → .env.production` 并补齐生产值。**不把开发 `.env` 再复制为 `.env.production`。** 生产文件在本地准备后，通过单独的受控配置交付安装到服务器固定路径；后续发布复用它，只有配置变化时才更新。

| 文件 | 用途 | 是否由当前程序直接加载 |
| --- | --- | --- |
| 根目录 `.env.example` | 可提交的开发配置模板 | 否，先复制为 `.env` |
| 根目录 `.env` | 本地开发，Dev Compose 和根目录后端进程使用 | 是 |
| 根目录 `.env.production.example` | 可提交的完整生产运行时模板 | 否，空值必须先填写 |
| 本地 `.env.production` | Git 忽略、`0600` 的生产配置准备文件 | 部署脚本不会自动上传 |
| `/root/partsignal/shared/.env.production` | Hostdzire 固定生产运行时文件，独立于 release | `ENV_FILE` 选择它；Production Compose 通过 `PARTSIGNAL_RUNTIME_ENV_FILE` 注入后端和 PostgreSQL |
| `deploy/production-ai.example.json` | 完整的 AI 首次初始化输入模板，无 API Key | 否，是操作输入清单，不是新的配置加载接口 |
| 本地 `.env.production.ai.json` | 操作者填写的 AI 输入清单，Git 忽略、`0600` | 按附录映射为 bootstrap 参数；不会由服务自动读取 |

本地初次准备可执行以下命令；目标已存在时保留原文件：

```sh
umask 077
test -e .env || cp .env.example .env
test -e .env.production || cp .env.production.example .env.production
test -e .env.production.ai.json || cp deploy/production-ai.example.json .env.production.ai.json
chmod 600 .env .env.production .env.production.ai.json
```

模板允许提交；填好的文件不能进入 Git、源归档、镜像、manifest、普通日志或聊天。不要使用 `source .env.production`：dotenv 不是 shell 脚本，也不要通过命令行参数传递 secret。

runtime 文件使用单行 literal `KEY=value`，不使用引号、内联注释、`source/include/export`、插值、命令替换、控制字符或 CRLF。首次生成 database/session/seed/storage secrets 使用 CSPRNG 至少 32 字节经 URL-safe 编码，只含 `A-Z/a-z/0-9/_/-`，至少 43 字符；AI 加密主密钥仍为随机 32 字节的标准 Base64，OSS 凭据由供应商提供。已有生产值继续保留，不能为了符合模板重新生成或轮换。

**当前 Hostdzire 已有受控创建的生产文件。新复制的本地模板只是草稿，不能覆盖它。** 当前首次发布尚缺的是 AI 初始化输入和凭据交接，填写它们不要求修改服务器 `.env.production`。现有数据库密码、session secret、加密主密钥等继续保留；不能为了补全本地模板生成另一组值并替换服务器现有值。

## 2. 生产运行时配置项

`.env.production.example` 列出 39 个字段（原有 35 项加 4 项 GEO 开关），不表示已运行的生产文件已更新。技术上必填空值共11项：六个内部secret由首次部署准备生成，`DATABASE_URL`由数据库身份派生，OSS四项由用户提供；不是要求用户手填11项。`VITE_API_BASE_URL` 在同源生产部署中为空。运行参数由部署操作者确认；已有环境复用原值。

| 字段 | 填写与校验 |
| --- | --- |
| `APP_ENV` | 固定 `production` |
| `APP_BASE_URL`、`API_BASE_URL`、`LOG_LEVEL` | 保留历史记录字段；当前 Settings/Compose 不读取，改值不会改变域名、路由或日志级别 |
| `POSTGRES_DB`、`POSTGRES_USER` | 与 `DATABASE_URL` 一致；现有环境不能只改 env 来变更数据库身份 |
| `POSTGRES_PASSWORD`、`DATABASE_URL` | 首次安装使用独立随机 URL-safe 密码，URL 中保持同一密码（percent encoding 后须解码一致）；拒绝插值，数据库容器地址固定 `postgres:5432` |
| `REDIS_URL` | 固定内部地址 `redis://redis:6379/0`，Redis 只作 broker |
| `SESSION_SECRET` | 首次生成至少 32 随机字节的 URL-safe 值（至少 43 字符）；应用底层最小值为 32 字符，发布准备使用更严格的生成要求；每次发布复用 |
| `SESSION_COOKIE_NAME`、`CSRF_COOKIE_NAME` | 默认 `partsignal_session`、`partsignal_csrf` |
| `SESSION_TTL_SECONDS` | 默认 `28800` |
| `SESSION_COOKIE_SECURE` | 固定 `true` |
| `CORS_ALLOWED_ORIGINS` | 实际 HTTPS 站点 origin；本环境为 `https://geo.962850.xyz`，无路径、无通配符 |
| `PARTSIGNAL_SEED_ADMIN_PASSWORD`、`PARTSIGNAL_SEED_ENGINEER_PASSWORD` | 首次分别生成至少 32 随机字节的 URL-safe 值；应用底层最小值为 12 字符；只负责空库创建 `admin`/`content_editor`，不覆盖现有账号密码 |
| `CELERY_CONCURRENCY` | 启动时读取，默认 `1`，范围 `1..10`；Celery prefetch=1，提升并发前须测目标环境内存、数据库连接和 Profile 准入限制 |
| `CONTENT_GENERATOR` | Production 固定 `openai-compatible`；`deterministic` 会被 Settings 启动校验拒绝。开发/预览保留该值为业务 no-egress，不能产生假 AI 成功 |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | 独立随机 32 字节经 Base64 编码；与数据库备份成对保护，不能随发布轮换 |
| `AI_ALLOW_LOCAL_HTTP` | 固定 `false` |
| `GENERATION_EAGER` | 固定 `false`，使用 Worker/Scheduler |
| `GENERATION_PENDING_REDISPATCH_SECONDS` | 默认 `120`，范围 `1..86400` |
| `GENERATION_FINALIZE_GRACE_SECONDS` | 默认 `120`，范围 `1..3600` |
| `GENERATION_RECOVERY_BATCH_SIZE` | 默认 `100`，范围 `1..1000` |
| `GENERATION_RECOVERY_SCAN_SECONDS` | 默认 `60`，范围 `5..3600` |
| `GEO_MONITORING_ENABLED` | 新 GEO 写能力总开关，默认 `false`；R0 只建立配置，不注册业务入口 |
| `GEO_API_COLLECTION_ENABLED`、`GEO_OPPORTUNITY_EVALUATION_ENABLED` | 默认 `false`；任一为 `true` 必须同时开启 Monitoring，否则 Settings 启动失败；子开关独立，不互相隐式启用 |
| `GEO_BROWSER_COLLECTION_ENABLED` | Production 固定 `false`；省略仍为 `false`，显式输入只接受 literal `false`；Monitoring=true 也不能启用 Browser，Settings 和 production preflight 拒绝 true |
| `OBJECT_STORAGE_BACKEND` | 固定 `aliyun_oss` |
| `UPLOAD_SIGNING_SECRET` | 独立随机生成；保留 storage 配置字段，Aliyun OSS 路径不使用开发签名 |
| `UPLOAD_INTENT_TTL_SECONDS`、`DOWNLOAD_URL_TTL_SECONDS` | 默认 `600`、`300` |
| `OSS_ENDPOINT` | 与 Bucket region 对应的 HTTPS `aliyuncs.com` endpoint |
| `OSS_BUCKET` | 已确认的 Bucket，准备空业务 namespace 和生命周期策略 |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 真实低权限凭据，权限与实际上传/HEAD/下载流程相符 |
| `VITE_API_BASE_URL` | 同源构建为空；属于前端构建输入，修改运行时 env 不会改变已构建的前端镜像 |

四项 GEO 是允许旧生产 runtime 省略的新增键；省略时由 `app.config.Settings` 唯一默认关闭，无需补键或轮换任何 secret。其余键仍要求完整，未知键拒绝；显式空值或非法布尔值不按省略处理。开关只控制后续新 GEO 能力，保留现有人工文章观测、洞察、优化命令和历史读取；开关不能替代权限、平台合规、凭据、预算或外发资格。

API、Worker、Scheduler 的 Compose backend 定义共享同一 env 文件，固定 `APP_ENV=production`，应用共用 `app.config.settings`，Beat 通过相同 `app.worker:celery_app` 启动。Browser 输入保留原值并明确失败，不覆盖为 false 掩盖错误。开关是进程启动快照，修改 env 文件后必须通过受控部署统一重建三个进程；不是热重载，也不能撤回已发请求。采集任务仍需在外部调用前执行开关与资格门禁。

GEO-1003 的生产部署、激活和前端回滚脚本在取得维护锁、改变部署状态或调用 Compose 前执行 `check-production-inputs.py --deployment-boundary <runtime_file>`。该模式只依赖 Python 标准库，并检查 runtime 与宿主环境：Browser 必须省略或 literal false；拒绝所有 Browser 会话材料；`COMPOSE_PROFILES` 只允许空值或 `production-async`；`COMPOSE_FILE` 只允许权威 `deploy/compose.prod.yaml`，拒绝 Browser/service-session overlay 和多文件组合。runtime 仍须符合普通文件、当前用户所有和 0600 合同。该模式不替代完整输入检查或 backend preflight。

权威 production Compose 不包含 Browser service/profile/session 卷；显式 `geo-browser`、`COMPOSE_PROFILES=geo-browser` 或 `--profile '*'` 展开也不会产生 Browser 服务。两个 Browser Compose 文件仅供非 production，独立 Collector 在 production 身份下先于 Chromium 启动拒绝。禁止通过手工多文件 Compose 绕过权威部署入口；非生产骨架与 GEO-801～803 本地合同继续保留，没有真实 Adapter。release manifest producer/consumer 当前固定13项tracked files，包含输入检查、迁移运行时与部署/supervisor模块；旧manifest不自动兼容。[ADR-008](./geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)将UI完成后新候选的门禁、工件和冻结归属GEO-1010-DEPLOY；目标Browser零服务/零会话材料仍须独立现场证据。

开发专用 `OBJECT_STORAGE_ENDPOINT`、`OBJECT_STORAGE_PUBLIC_ENDPOINT`、`OBJECT_STORAGE_PATH` 在开发模板中完整列出，生产 Aliyun OSS 不使用这三项。Production 不增加 `fake-oss`、`19001` 或 `/object-storage/`。

宿主机单独运行前端 Vite 时，开发代理的实际输入是进程环境 `VITE_API_PROXY_TARGET`；例如连接 Dev Compose 暴露的 API 时显式设置 `VITE_API_PROXY_TARGET=http://localhost:18000`。Dev Compose 已直接向 frontend 注入 `http://api:8000`。根目录 `.env` 不会自动传给宿主机 Vite。

## 3. AI 信息一次准备齐全

AI 的 provider、模型、API Key、敏感 Header 属于 PostgreSQL 配置，环境文件只保存加密主密钥。往 `.env.production` 添加 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 或 `OPENAI_MODEL` **不会被当前程序读取，也不会完成 AI 配置**。

在本地 `.env.production.ai.json` 填写：

| 字段 | 要求 / 对应 bootstrap 参数 |
| --- | --- |
| `channel_name` | 渠道名称，1–160 字符；`--channel-name` |
| `channel_description` | 描述，最长 500 字符，可为空；`--channel-description` |
| `protocol_type` | 固定 `openai-compatible-chat-completions`；`--protocol-type` |
| `provider_brand` | `OPENAI` / `ANTHROPIC` / `GOOGLE` / `AZURE_OPENAI` / `ZHIPU` / `QWEN` / `CUSTOM`；品牌只是显示分类，不能证明协议兼容；`--provider-brand` |
| `base_url` | 真实 HTTPS API base URL，通常含供应商提供的 API 前缀；程序会追加 `chat/completions` / `models`，不要填写完整的 `/chat/completions` endpoint；`--base-url` |
| `timeout_seconds` | `10..600`，模板 `60` 只是待确认值；`--timeout-seconds` |
| `model_display_name`、`model_id` | 非空，model ID 必须为该凭据实际可用的精确 ID；`--model-display-name` / `--model-id` |
| `request_parameters` | 非 secret JSON object，模板 `{}` 需确认；禁止覆盖 `model`、`messages`、`stream`；转为 JSON 文本传 `--request-parameters-json` |
| `chat_completions_compatibility_confirmed` | 操作者确认该端点与模型支持上述协议，确认后填 `true` |
| `custom_headers_required` | 首次 bootstrap 不支持自定义 Header，必须确认不需要并保持 `false`；需要时在维护前停止并解决合同缺口 |
| `credential_ready` | API Key 已在 owner 手中备妥，且核对其 JSON UTF-8 编码大小不超过下述声明上界，确认后填 `true`；文件内不保存 Key |
| `credential_json_bytes_upper_bound` | owner 确认真实 Key 经 `json.dumps(key, ensure_ascii=False)` 后 UTF-8 编码的字节上界，包含引号与转义；正整数、至少 `3`，模板 `0` 表示未提供；只填非 secret 数量，不填 Key |
| `credential_owner` | 指定交接责任人；不把其任何 credential 写入文件 |
| `credential_owner_tty_handoff_confirmed` | 确认维护窗口内可通过本机 `ssh -t hostdzire` 使用真实交互式 TTY，无回显输入一次 Key；确认后填 `true` |

最后六项是准备检查，不传给真实 bootstrap。该 JSON 是完整输入清单，**现有 bootstrap 不支持 `--config` 或自动读取它**；发布操作者按[部署附录第 6 节](./Hostdzire部署附录.md#6-clean-init)显式传递九项非 secret 参数。确认项全部就绪前，不预约维护或冻结新 release。

API Key 在 `PRODUCTION_PREPARED` 阶段通过现有 true-TTY bootstrap 一次性写成数据库密文。之后普通 upgrade 复用数据库配置，日常渠道变更走应用 Configuration。不需要每次发布改 env 或重新输入 Key；clean-init、数据恢复、密钥轮换另按对应合同执行。

## 4. 本地只读检查命令

从仓库根目录执行，使用项目已安装的后端依赖：

```sh
uv run --project backend python deploy/scripts/check-production-inputs.py \
  .env.production --ai-inputs .env.production.ai.json
```

**当前 Hostdzire 的 runtime 已由 I04-1 验证且没有配置变化时**，本地只填 AI 清单，使用下列命令即可，不需要读回服务器 secret 或填完新建的本地 runtime 空模板：

```sh
uv run --project backend python deploy/scripts/check-production-inputs.py \
  --ai-only --ai-inputs .env.production.ai.json
```

该模式返回 `runtime=NOT_CHECKED`，只确认 AI 输入；仍须在未来新候选的维护前复核既有服务器配置身份和状态。

该命令只读显式输入，要求普通文件、当前用户所有与 `0600`；完整模式检查 runtime 的键集合（仅允许省略四项默认关闭的 GEO 键）、重复/未知键、必填项、literal 语法、URL-safe secret、数据库 URL 解码后的身份一致、固定生产值及 OSS endpoint。AI 缺项和确认状态一起报告；在隔离 cwd/environment 中调用真实 backend 配置预检和 AI envelope reader 后，对 Schema 规范化的 URL 拒绝已知非公网 IP/localhost（包含缩写、十六进制等 IPv4 写法）。DNS 与实际网络仍由真实 Gate 检验。不会发现或读取另一份 `.env`，不会执行 Docker/SSH、连接数据库/provider、生成密钥、上传文件或改变状态；输出仅含已知字段名、固定错误码和配置状态。

AI 检查按 Host 真实的 UTF-8、`ensure_ascii=False`、紧凑 JSON 格式计算完整 envelope，并以 owner 声明的 credential JSON 字节上界预留空间；复用实际 backend 的 **64 KiB** 上限和严格 envelope reader，不放宽 bootstrap 合同。该检查不读取真实 Key；它依赖 owner 对上界的确认，真实输入 Key 大于声明上界时不能使用该准备结果。过大的参数、包含多字节字符的超限参数或不留 credential 空间，均在本地返回失败，避免在 durable `STARTED` 后才被拒绝。

未填模板返回 `NOT_READY` / exit `2`；插值等非法输入返回 `FAILED` / exit `2`；`PASSED` / exit `0` 仅证明输入结构与声明就绪，`external_services_gate` 仍为 `NOT_RUN`。省略 `--ai-inputs` 只检查 runtime，输出 `ai_inputs=NOT_CHECKED`，不能据此认定首次发布准备完成。先安装后端项目依赖；缺依赖时检查明确失败，不跳过。

受控配置暂存仍须在安装前执行同一输入限制，并检查 **Compose 解析后 PostgreSQL 实际环境与 DATABASE_URL 解码身份一致**。解析输出只在受控进程内比较，不打印 `docker compose config --environment` 或含值 JSON。`config --quiet` 本身不会拒绝插值；本地输入检查使本项目支持的 literal 格式没有插值、引号或注释造成的密码变形。

## 5. 本地准备到上线的顺序

1. **填写输入。** 开发用 `.env`；生产运行时用独立模板。当前主机已有有效 runtime 文件时复用它，重点补齐 AI 输入清单。域名/TLS/OSS 权限与 CORS、AI 协议与 model 权限、credential owner 交接应在此阶段明确。
2. **提前检查准备状态。** 在 release freeze 之前执行第 4 节只读命令，集中检查生产 39 项键名（四项 GEO 可安全省略）、11 项必填值、数据库身份、secret 格式、固定生产边界与 AI 清单确认。拒绝插值、控制字符、CRLF、`source/include` 等内容。真实 backend 预检不会测试 provider，不能代替 External Services Gate。缺项集中在此阶段报告；当前 Hostdzire 复用已验证文件，本地空模板不能作为安装输入。
3. **配置交付只在初次安装或配置变化时执行。** 完整本地生产文件可经现有 OpenSSH/scp 交付到明确批准的 Hostdzire 受控位置。现有 `deploy.sh` 不自动上传配置；配置交付与 release 包交付分开。已有文件更新必须保持现有 secret/数据库身份，先精确备份、同目录受控 `0600` 暂存、校验，再按旧文件 checksum 防止覆盖并发改动，原子安装为 `/root/partsignal/shared/.env.production`；不直接 scp 覆盖活动文件，不把未知或空值合并进去。首次安装使用排他创建。更新与应用生效分别执行受控步骤；改文件不等于运行中的容器已经加载。
4. **Repository 与新候选。** 完成当前源码 Gate、独立复核与新 release 冻结。每次 release ID、镜像 tags、commit、archive、manifest 都重新绑定；固定 runtime 文件不复制进 release。已冻结失败证据不得复用或覆盖。
5. **维护前复核。** 按附录第 3 节，以同一新 manifest 校验文件和实际 image identity，再运行 `run --rm --pull never --no-deps api ... preflight-production-config`。直接 Compose probe 需要 one-off 容器授权；普通 `docker compose run` 不能替代它。随后核验固定 project/network labels、资源与恢复路径，取得精确维护授权。
6. **首次 clean-init。** 按 runbook 完成维护、隔离、空库准备；使用已准备好的 AI 非 secret 参数和 owner TTY 输入一次 Key。真实 AI/OSS Gate 通过后才 activation、切流和 observation。
7. **后续 upgrade。** 继续指定 `ENV_FILE=/root/partsignal/shared/.env.production`，按新 manifest 运行受控 deploy/activate；未变更配置时无需交付 env，未清空数据库时无需再次 bootstrap。

完整清单能把已知缺项挡在发布准备阶段；真实供应商拒绝、网络/TLS 故障或 OSS 权限漂移仍须由实际 Gate 发现，不能用填写完成冒充成功。本次模板交付没有执行配置上传、远端更新、新 release、maintenance 或 cutover。


GEO-405 Worker 使用 `GEO_PENDING_REDISPATCH_SECONDS=120`、
`GEO_COLLECTION_FINALIZE_GRACE_SECONDS=120`、`GEO_RECOVERY_SCAN_SECONDS=60`、
`GEO_RECOVERY_BATCH_SIZE=100`。既有 runtime 可省略，唯一默认和范围校验由 Settings 拥有。
变更后重启 Worker/Beat；这些运行参数不授予 adapter 批准或数据外发权限。

GEO-901 保留策略配置及默认值见[GEO retention 运维](./geo-monitoring/03-technical/08-deployment-and-operations.md#geo-901--r8-retention-运维)：新任务默认dry-run=true、batch=100；raw/终态草稿/孤立文件期限默认省略不启用新策略。管理员只在数据负责人批准实际期限后配置runtime，并先预览；既有已到期文件清理继续有效。先迁移0064，再部署对应Worker。配置缺失不代表生产已验收，也不改变Browser必须false的核心门禁。
