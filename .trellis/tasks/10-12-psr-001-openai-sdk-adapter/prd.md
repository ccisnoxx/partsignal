# PSR-001 Task Brief

## 目标与授权

引入官方 OpenAI Python SDK 薄同步业务适配层，仅迁移 AI 渠道模型发现和连接测试。用户授权直接实施和本地验证，无需等待确认。当前分支 `refactor/PSR-001-openai-sdk-adapter`；不提交、不推送、不部署。

## 验收

- 后端运行时依赖与 uv.lock 登记官方 openai SDK；同步客户端支持管理员 base URL、API Key、额外 Header、超时，max_retries=0。
- Models list 发现远端模型，Chat Completions 用一条 hi 消息测试；自定义模型参数保留。
- SDK 异常映射现有 AppError，不暴露供应商错误正文或敏感信息。
- 保留 CredentialCipher、channel/model revision 复核、channel → model 行锁和事务外 I/O；管理员测试成功后模型仍停用。
- 不修改 OpenAPI/数据库/Alembic，不迁移生成、自然化或 GEO，不删除旧网络栈，不调用真实 Provider。
- 指定 sync/import、定向 Ruff/mypy、单元和本地 fake 集成检查有精确命令与实际结果；完成后工作流状态为 review。

## 设计与资料

稳定范围与决策见 [维护工作流](../../../docs/maintenance/openai-sdk-refactor/README.md)。当前：Router → ai_configuration → OpenAICompatibleClient → PinnedHTTPTransport；目标：Router → ai_configuration → AIProvider → 官方 OpenAI。适配层不拥有数据库、认证、revision、审计或网络协议实现。

URL 只做输入结构检查；生产保留 HTTPS，development/test 显式允许本机 HTTP。生成/GEO 保留旧网络安全 owner。明确任务授权更新旧文档适用范围，未发现不可消解冲突。

## 基线与工作区

- 单元命令：`uv run --project backend pytest backend/tests/unit/test_ai_boundaries.py backend/tests/unit/test_contract.py -k 'ai_channel or ai_model or connection or credential or header or snapshot or generated_draft or url_validation or chat_completions or provider_timeout or redirect'`：21 passed，56 deselected。
- 集成命令：`uv run --project backend pytest backend/tests/integration/test_ai_channel_management.py`：18 skipped，未设置 PostgreSQL 测试连接。Docker daemon 不可用，准备本机隔离 PostgreSQL。
- 初始工作区已有部署脚本、AGENTS、operations 与 infra/GEO 文档修改；保留这些修改，只在 operations 中追加当前网络边界所需片段。GEO task manifest 不改。

## 停止条件

仅在 SDK 公开 API 无法实现业务合同、必须修改数据库/公共 API、必须用真实凭据验证、存在无法消解的已接受文档冲突或无法安全处理用户修改时停止并标记 blocked。
