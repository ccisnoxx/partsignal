# OpenAI SDK 维护工作流

## 当前状态与验收入口

状态权威为 [task manifest](./task-manifest.yaml)。2026-10-13，用户已人工审查并接受 PSR-007 及整个 OpenAI SDK 替换、Browser 延期清理和手工质量验证分层工作流。PSR-001～007 全部为 `done`，对应 Trellis task 为 `completed`；各 Task Brief、实现、历史限制和人工接受记录保留原文。完整 `verify-release` 的 Docker 环境阻断记录保持，人工接受不改写为发布门禁通过。

| 任务 | 最终范围 | 已接受记录 |
| --- | --- | --- |
| PSR-001 | 官方 SDK 薄适配层、AI 模型发现与连接测试 | [证据](../../../.trellis/tasks/10-12-psr-001-openai-sdk-adapter/implement.md) |
| PSR-002 | 正式生成与自然化迁移 SDK、迟到失败终态保护 | [证据](../../../.trellis/tasks/10-13-psr-002-generation-sdk/implement.md) |
| PSR-003 | GEO API Collector、授权窗口与严格原始字节解析 | [证据](../../../.trellis/tasks/10-13-psr-003-geo-api-sdk/implement.md) |
| PSR-004 | Profile 诊断迁移，删除旧网络栈、客户端及专属测试 | [证据](../../../.trellis/tasks/10-13-psr-004-remove-custom-http/implement.md) |
| PSR-005 | Browser 能力延期，清理当前文档和默认验证/部署入口 | [证据](../../../.trellis/tasks/10-13-psr-005-defer-browser-collector/implement.md) |
| PSR-006 | 手工快速/领域/发布验证，删除未使用 Actions | [证据](../../../.trellis/tasks/10-13-psr-006-layered-manual-checks/implement.md) |
| PSR-007 | 最终一致性和发布前证据 | [Brief](../../../.trellis/tasks/10-13-psr-007-final-alignment/prd.md)、[验收记录](../../../.trellis/tasks/10-13-psr-007-final-alignment/implement.md) |

前序记录中的阶段范围、当时未执行项与旧实现名称属于历史事实；当前能力以下文与权威架构/测试/部署文档为准。

## 官方 SDK 与应用责任

AI 配置的模型发现/连接测试、正式生成/自然化、GEO Profile 连接诊断及已实现的 GEO API Collector，统一使用官方 `openai` Python SDK。继续使用 OpenAI-compatible Chat Completions；模型发现使用 Models list。同步非流式调用显式 `max_retries=0`，不跟随重定向、不继承环境代理。管理员配置 Base URL、模型、API Key 和受支持 Header；品牌只用于识别，不切换协议。

适配层只拥有 SDK 生命周期、调用、固定安全错误映射及结果投影。应用继续负责 `CredentialCipher` 加密、边界解密、业务快照、PUBLIC 数据门禁、严格输出 Schema、资格/revision/lease/状态机、预算、审计和指标。生成正文必须直接满足四字段 `GeneratedDraft`；GEO 原始 JSON、重复键、Decimal、引用/证据和凭据回显拒绝由 Collector 拥有。未知事实、usage、cost 不猜测或补零。

URL 只校验 HTTP(S) 输入结构、端口及禁止内嵌凭据/query/fragment；生产保持 HTTPS，development/test 显式 `AI_ALLOW_LOCAL_HTTP` 才允许本机 HTTP fake。当前没有自研 DNS pinning、TCP peer、TLS 或 HTTP/1.1 传输，也不承诺 DNS/IP/peer 固定保证。

SDK 不接受非空进程级 `OPENAI_CUSTOM_HEADERS`，零发送边界返回 `INVALID_HEADER`；管理员普通/敏感 Header 不能覆盖 `X-Stainless-Raw-Response` 控制名（大小写等价）。其他受支持 Header 保持转发，Key/Header 保持既有可打印 Latin-1 合同。非法 UTF-8 响应安全失败。响应、日志和审计不包含凭据、Header 值、供应商错误正文或原始异常。

配置管理和 Profile 诊断保留预留、事务外测试、调用后资格/revision 复核；管理员测试后模型保持停用，等待显式启用。既有 maintenance bootstrap 的 T3 启用合同继续独立适用。生成/自然化由 Job owner 声明 RUNNING、按租约和调用后业务资格复核提交；迟到结果不能覆盖已经确认的失败终态。

GEO API 在 SDK 方法前执行原发送授权/预算回调；失败不启动 SDK，成功持久化 SENT 并进入外部窗口。明确 HTTP 状态为 COMPLETED，之后 timeout/connection/不确定网络结果为 UNKNOWN，不自动重放同 attempt。内部 `max_response_bytes` 保留，使用公开 raw-response.content 在完整接收后、业务解析前检查字节；不能限制接收期内存。该字段不属于公共 OpenAPI/数据库合同。

## GEO 当前能力与 Browser 延期

当前支持人工录入和已经实现的 API 型采集。Browser Collector、自动登录、浏览器会话材料和页面采集属于后续能力，当前不启用、不部署、不作为默认验证门禁。

历史源码、公共 Schema、数据库对象、Alembic 与隔离非生产资产继续保留。默认安装、静态/单元、领域、E2E、发布验证与 Dev/Staging/Prod Compose 不依赖 Browser 专属包、合同或 overlay。显式实验入口只服务延期资产，不能证明当前产品支持浏览器采集；普通前端 Playwright 与 API GEO 验收继续保留。生产 Browser 禁止与历史材料失败边界保持。

## 手工分层验证与部署

小任务使用 `check-fast` 或单侧快速命令；功能切片使用 `check-ai`、`check-geo` 或现有领域文件。领域命令要求专用测试 PostgreSQL，GEO 人工文件流还要求本地 development 对象存储；只使用虚构凭据与本机 HTTP fake，不调用真实 AI。范围、前置条件、有效证据与未运行项见 [测试策略](../../testing.md#手工分层命令)。

完整 `verify-release` 只在准备部署目标 commit 或当前交付明确要求时执行；旧 `verify` 是直接兼容别名。GitHub 只作代码备份和服务器拉取，无 Actions、required checks 或分支保护前提。Docker 部署可按 commit SHA 追踪，无 GitHub Release/Git tag 要求；release ID、镜像 tag、image ID/RepoDigest 与不可变 manifest 仍按 [Hostdzire Runbook](../../Hostdzire部署上线流程.md#验证选择合同) 核验。

PSR 工作流未改变公共 OpenAPI、数据库合同、ORM 或 Alembic，未删除/重写历史迁移。PSR-007 的命令结果、逐行残留分类、合同比较、Compose 与清理证据保存在本任务记录中；环境阻断不能记作发布门禁通过。

## SDK 依据与后续范围

运行时依赖 `openai>=3.29,<4`，锁定 `3.29.0`，通过安装版本公开类型/实现验证。该版本使用 `httpx2`；项目保留文件存储、平台 Logo 与测试使用的 `httpx`。公开 API 参考：[官方 Python SDK](https://developers.openai.com/api/reference/python)、[Models](https://developers.openai.com/api/reference/python/resources/models)、[Chat Completions](https://developers.openai.com/api/reference/python/resources/chat/subresources/completions/methods/create)。不使用 SDK 私有协议、模块或属性。

Responses API、流式/异步 SDK、新编排架构、Browser 实现、真实供应商验收和远端部署均不属于本次维护收敛；后续需求须另行定义和授权。
