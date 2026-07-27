# PartSignal 部署与运维

本文件只记录跨环境稳定原则，不承载任何环境的可执行部署步骤。Hostdzire 预发布的日常决策、停止条件、验收和回滚摘要见 [Hostdzire 部署上线 Runbook](./Hostdzire部署上线流程.md)；首次初始化、完整手工发布、备份恢复、Nginx 和排障命令见 [Hostdzire 部署附录](./Hostdzire部署附录.md)。

## 发布与配置原则

- 部署行为以 `deploy/` 中当前 Compose、脚本和环境模板为事实源，只发布干净、已推送且与远端权威提交一致的版本。
- release 不可覆盖。真实配置、密钥和持久数据必须独立于 release；环境文件、AccessKey、模型密钥、账号密码和私钥不得进入仓库、发布包、普通日志或对话。
- 发布失败必须保留可观察的错误、容器状态和数据现场，不用固定成功响应、静默回退、隐藏 allowlist 或放宽安全配置掩盖故障。
- 清理 release、镜像、备份和持久数据是独立破坏性操作，不属于部署或回滚的默认组成。

## 公网安全头

- `deploy/nginx/partsignal-security-headers.conf` 是 PartSignal 公网安全头的唯一仓库权威；外层 production/staging 站点引用它，容器内 `frontend/nginx.conf` 不重复定义。
- 外层 Nginx 必须为 `1.29.3` 或更高版本，并通过 `add_header_inherit merge` 让 location 缓存头与项目安全头同时返回。升级或回滚前运行 `node deploy/scripts/check-nginx-security.mjs` 和 `nginx -t`。
- CSP `script-src` 只允许同源脚本和 `frontend/index.html` 当前内联主题脚本的准确 SHA-256。主题脚本或 CSP 任一侧变化都必须同步更新并通过自动检查，不得改用 `unsafe-inline` 或宽松 fallback。
- Ant Design 运行时样式保留 `style-src 'unsafe-inline'`；对象存储直传和图片只保留已确认的 HTTPS scheme 边界。HSTS 固定为 `max-age=31536000`，不包含 `includeSubDomains` 或 preload。

## 数据与网络原则

- PostgreSQL 是业务状态唯一来源；Redis 只用于 Celery Broker，不能用 Redis 状态替代、修复或推断业务事实。
- 外部输入在系统边界校验。PostgreSQL 与 Redis 不暴露公网端口，也不因应用需要外部 API 就获得无关出站能力。
- 迁移前的只读 `preflight-integrity` 必须使用待部署后端实现；任何记录都阻断迁移，必须通过明确业务处置修复，不能自动改绑、删除历史、回退状态或维护隐藏 allowlist。
- 数据库默认不执行 Alembic downgrade。有损迁移必须具备迁移前完整备份、隔离恢复验证、明确维护窗口和数据取舍。

## 凭据与外部 AI

生产必须使用随机且经过备份恢复验证的 `AI_CREDENTIAL_ENCRYPTION_KEY`、真实 `CONTENT_GENERATOR=openai-compatible` 和 `AI_ALLOW_LOCAL_HTTP=false`。主密钥丢失后数据库密文无法恢复；轮换前必须显式重新加密或重新录入全部渠道 API Key 与敏感 Header。

读取接口只返回凭据已配置状态，复制配置不包含 API Key 或敏感 Header。排障不得从浏览器状态、数据库密文、普通日志或审计差异导出凭据。

AI 请求只连接经过校验的公网地址，TLS 身份与 Host 使用渠道原 hostname。连接兼容故障、peer 越界、重定向或响应超限必须显式失败；不得关闭证书校验、恢复不受控的二次 DNS 解析或在请求发送后自动重试。

只有作业输入完整且绑定事实快照的全部 Evidence 均为 `PUBLIC` 时才允许出站。供应商已接收但 Worker 丢失的作业只标记失败，不自动再次调用。

生产文件存储必须显式使用 `OBJECT_STORAGE_BACKEND=aliyun_oss` 并注入受控凭据。上线前必须验证预签名直传、后端 HEAD 校验、短期下载 URL 和 CORS 白名单；配置错误不得回退到开发存储。

## 生成恢复与历史门禁

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
