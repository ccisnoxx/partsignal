# PartSignal 部署与运维

当前开发阶段与服务器预览的输入归属、自动生成配置和AI字段说明见[开发预览说明](./development-preview.md)。Production runbook保留正式发布合同，不是当前界面验收的前置流程。

本文件只记录跨环境稳定原则，不承载任何环境的可执行部署步骤。Hostdzire 预发布的日常决策、停止条件、验收和回滚摘要见 [Hostdzire 部署上线 Runbook](./Hostdzire部署上线流程.md)；首次初始化、完整手工发布、备份恢复、Nginx 和排障命令见 [Hostdzire 部署附录](./Hostdzire部署附录.md)。

## 发布与配置原则

- 部署行为以 `deploy/` 中当前 Compose、脚本和环境模板为事实源，只发布干净、已推送且与远端权威提交一致的版本。
- release 不可覆盖。真实配置、密钥和持久数据必须独立于 release；环境文件、AccessKey、模型密钥、账号密码和私钥不得进入仓库、发布包、普通日志或对话。
- 开发 `.env` 与生产 `.env.production` 使用独立模板；完整字段、AI 初始化清单和本地准备/受控交付见[配置准备说明](./production-configuration.md)。普通发布复用固定生产文件与数据库中的 AI 配置；不会自动上传 env，也不随 release 重生成 secret。已知输入缺项必须在冻结候选和维护前集中确认。
- 发布失败必须保留可观察的错误、容器状态和数据现场，不用固定成功响应、静默回退、隐藏 allowlist 或放宽安全配置掩盖故障。
- 清理 release、镜像、备份和持久数据是独立破坏性操作，不属于部署或回滚的默认组成。

## 公网安全头

- `deploy/nginx/partsignal-security-headers.conf` 是 PartSignal 公网安全头的唯一仓库权威；外层 production/staging/maintenance 站点引用它，容器内 `frontend/nginx.conf` 不重复定义。
- 外层 Nginx 必须为 `1.29.3` 或更高版本，并通过 `add_header_inherit merge` 让 location 缓存头与项目安全头同时返回。升级或回滚前运行 `node deploy/scripts/check-nginx-security.mjs` 和 `nginx -t`。
- CSP `script-src` 只允许同源脚本，HTML 不得保留内联脚本。Markdown 只通过 canonical `MarkdownContent` 边界渲染，必须同时使用 `react-markdown`、`rehype-sanitize`、`skipHtml` 和显式禁用 raw HTML 元素；DOM HTML sink、依赖补丁或 CSP 任一侧变化都必须通过自动检查，不得改用 `unsafe-inline`、`unsafe-eval` 或宽松 default policy。
- 当前样式运行时保留 `style-src 'unsafe-inline'`；文件上传经应用后端中转，外部下载和图片只保留已确认的 HTTPS scheme 边界。全域 HTTPS 台账和分阶段观察获得明确授权前，HSTS 现状保持 `max-age=31536000`，不提前添加 `includeSubDomains` 或 preload；后续只按 `07-28-pagespeed-p0-security-domain` 的域级单一 snippet、观察期和回滚门禁推进。

## 数据与网络原则

- PostgreSQL 是业务状态唯一来源；Redis 只用于 Celery Broker，不能用 Redis 状态替代、修复或推断业务事实。
- 外部输入在系统边界校验。PostgreSQL 与 Redis 不暴露公网端口，也不因应用需要外部 API 就获得无关出站能力。
- Hostdzire Production 保留固定 Compose project `partsignal-staging`；三个 network logical key、physical name 和既有 `com.docker.compose.network` label 精确相同，为 `partsignal-staging-internal/egress/edge`。internal 网络继续隔离 PostgreSQL/Redis，backend 只连接 internal/egress，frontend 只连接 edge；不能用 external、override、relabel/recreate 或另一 project 隐藏 ownership mismatch。
- 迁移前的只读 `preflight-integrity` 必须使用待部署后端实现；任何记录都阻断迁移，必须通过明确业务处置修复，不能自动改绑、删除历史、回退状态或维护隐藏 allowlist。
- 数据库默认不执行 Alembic downgrade。有损迁移必须具备迁移前完整备份、隔离恢复验证、明确维护窗口和数据取舍。

## 凭据与外部 AI

生产必须使用随机且经过备份恢复验证的 `AI_CREDENTIAL_ENCRYPTION_KEY`、真实 `CONTENT_GENERATOR=openai-compatible` 和 `AI_ALLOW_LOCAL_HTTP=false`。主密钥丢失后数据库密文无法恢复；轮换前必须显式重新加密或重新录入全部渠道 API Key 与敏感 Header。

读取接口只返回凭据已配置状态，复制配置不包含 API Key 或敏感 Header。排障不得从浏览器状态、数据库密文、普通日志或审计差异导出凭据。

Production clean-init 的首个真实 AI credential 只通过 Hostdzire root/operator maintenance CLI 注入：deploy 状态 owner 必须在同一锁内证明 run、manifest、candidate 与 `PRODUCTION_PREPARED`，credential owner 在真实 TTY 以 no-echo 输入，secret 仅经进程内存、内核 pipe、Docker exec 与 provider buffer，并最终只以应用既有 `CredentialCipher` 密文持久化。不得把 credential 放入 argv、环境变量、文件、history、日志、Docker metadata、Trellis 或对话，也不得读取 seed admin password；固定 `admin` 仅作为 maintenance 操作的业务审计归属。

该 bootstrap 是单次 fail-closed 状态机：T1 原子创建停用 channel/model，T2 在数据库事务外进行至多一次真实连接测试，T3 仅在 `PASSED` 时原子启用二者。provider 失败、revision 冲突、host/容器结果未知或任何已有 AI 配置/attempt 都禁止自动重试和 credential 覆盖；数据库事实与 operator 确认必须分开处理。bootstrap connection test 不替代真实正式生成、OSS 或浏览器 External Services Gate。

AI 请求只连接经过校验的公网地址，TLS 身份与 Host 使用渠道原 hostname。连接兼容故障、peer 越界、重定向或响应超限必须显式失败；不得关闭证书校验、恢复不受控的二次 DNS 解析或在请求发送后自动重试。

只有作业输入完整且绑定事实快照的全部 Evidence 均为 `PUBLIC` 时才允许出站。供应商已接收但 Worker 丢失的作业只标记失败，不自动再次调用。

生产文件存储必须显式使用 `OBJECT_STORAGE_BACKEND=aliyun_oss` 并注入受控凭据。上线前必须验证同站点后端上传、服务端 OSS PUT、HEAD complete 和短期下载 URL；浏览器跨域读取下载字节时才核对所需 GET CORS。应用上传不要求 Bucket CORS 管理权限；配置错误不得回退到开发存储。

## 生成恢复与历史门禁

`CONTENT_GENERATOR` 是进程启动配置：`deterministic` 保留为正式业务 no-egress 模式，关闭生成、自然化与重试，不输出假内容；Production Settings 仍要求 `openai-compatible`。管理员显式模型测试/发现不受业务模式关闭影响。API 拒绝为 `409 AI_GENERATION_DISABLED`，没有 Job/commit/Redis 副作用；读投影移除相关动作，模型候选为空。Worker 对关闭模式的 PENDING 原子写入 `FAILED/AI_GENERATION_DISABLED`、finished_at 并清 lease，保留 attempt/started，重复消息不重复改变终态或新增审计。供应商 metadata 保持未报告值，不补零。

API、Worker、Scheduler 必须加载同一模式；配置文件修改不是热重载，也无法撤回已经 RUNNING 的请求。RUNNING 重投始终不再次外发，原调用继续按租约收尾，迟到结果不能覆盖已经提交的失败终态。Beat 只补投递超龄 PENDING UUID，不替 Worker 判定供应商资格；模式关闭后的历史 PENDING 最终由 Worker 拒绝。没有新配置版本/运行进程证据时不得宣称门禁已在线生效。

生成恢复默认每 60 秒扫描一次，只补投递超过 120 秒的 `PENDING` Job；`RUNNING` 租约按作业快照供应商超时加 120 秒收尾裕量计算。可按负载显式配置 `GENERATION_PENDING_REDISPATCH_SECONDS`、`GENERATION_FINALIZE_GRACE_SECONDS`、`GENERATION_RECOVERY_BATCH_SIZE` 和 `GENERATION_RECOVERY_SCAN_SECONDS`，不得把阈值设为零规避状态机。

诊断必须同时观察 Worker、Scheduler 和 PostgreSQL 业务积压，输出只允许包含数量、年龄、错误码和供应商耗时。消息风暴时先停止 Scheduler；不得批量改写 PostgreSQL 作业状态，也不得自动重放已经进入 `RUNNING` 或 `FAILED` 的 Job。

`COMPLETED_WITHOUT_VERIFIED_PUBLICATION` 表示完成任务缺少追加式 `VERIFIED` 发布事件；`PUBLICATION_PLATFORM_MISMATCH` 表示尚未进入明确终态的发布账号与任务锁定平台不一致。两者都必须保留历史并显式处置。

## 备份、恢复与回滚

数据库备份必须权限受限，并配套异地、加密和保留策略；只生成本机压缩文件不等于备份完成。恢复能力必须定期在隔离数据库验证，验证目标不得指向业务主库。

数据库备份与当时的 `AI_CREDENTIAL_ENCRYPTION_KEY` 必须成对保护。恢复数据库但使用另一主密钥，会使已有 AI 渠道凭据无法解密。

应用回滚只允许使用与当前数据库契约兼容的旧版本，并必须重新完成相应验收。状态机或数据契约不兼容时，先停止相关写流量与 Scheduler，再由负责人确认前滚或恢复方案。

Nginx 回滚必须把站点模板和 PartSignal 项目安全 snippet 恢复到同一个已验证 release，运行 `nginx -t` 后再 reload。已经被客户端接收的 HSTS 在有效期内不能通过服务器回滚立即撤销。

## 验收与 E2E 边界

健康端点、命令行探针和容器健康不能替代真实浏览器对渲染、认证路由和控制台的检查。浏览器验收只从本机通过真实入口执行，不在服务器或容器安装浏览器环境，也不把凭据输出或持久化。

纵向业务 E2E 只在本地或 CI 隔离环境执行，并使用真实 PostgreSQL、Redis、Celery 和显式 Mock Provider。公网环境保持 `AI_ALLOW_LOCAL_HTTP=false`，不得为依赖回环 Provider 的测试放宽安全策略。
