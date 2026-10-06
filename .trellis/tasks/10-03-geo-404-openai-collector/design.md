# GEO-404 实施设计

Collector 是 provider 协议与解析 owner，不拥有业务状态。受控调用方构造一次调用内存配置：channel/model UUID、协议、base URL、model ID、当前凭据/Header、模型参数；CollectionRequest 仍不携带这些秘密。模型参数仅允许非指令采样/输出配置，拒绝 system/messages/tools 等输入污染；Profile temperature/max_output_tokens 显式覆盖对应模型键。只发送原 prompt。

复用 PinnedHTTPTransport，增加可选 before_send 和每请求响应上限，旧内容调用者继续原签名。网络失败以 AppError 子类提供 CONNECT/SEND/RECEIVE 及是否已开始发送；GEO 映射 NOT_STARTED、UNKNOWN 或 SENT，成功完整接收后为 COMPLETED。回调本身原样上抛，不被 transport 改写。所有请求 bytes 在回调前准备，TLS/peer 在回调前完成，无自动重发。

独立解析标准 choices[0].message.content string。明确 top-level citations(url/title/position) 保留位置，同URL不去重；标准 message.annotations.url_citation 根据正文位置排序，转为引用序号。两种同时存在拒绝歧义；无 TEXT 猜测。结构化 web_search_observed 只接受 bool/null，不因引用推导搜索。usage 三字段独立，不补算；cost.amount/currency 仅已报告有效完整金额；source_product/model/source_version 和 x-request-id 只读取已报告。raw/debug/headers/cookie 不保存；摘要只有既有四字段。

所有已识别元数据严格校验；未知 provider 扩展不进入结果。非法 JSON、重复键、NaN、非法UTF8、空/NUL/超长答案、无效引用、usage/cost 或截断 finish_reason 都失败。amount 使用 Decimal，不能舍入或补零。Registry 保持 diagnostic answer_text/approved=false；optional 元数据可解析但不伪造能力/采集批准。无 OpenAPI/DB/Alembic 或 frontend 变化。

来源校验：OpenAI 官方 Python 类型 https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_message.py 定义 annotations.url_citation 的 URL/title/start_index/end_index；2026-10-03 查阅。成本与顶层 citation/source_version/web_search_observed 为本地 fake provider 已建立的显式兼容扩展，不声称标准 Chat Completions 保证提供。

受控配置将非敏感 Header 放入 headers、敏感 Header 放入 sensitive_headers；调用方按已有 AIChannelHeader.is_sensitive 显式映射，不根据名称猜自定义 Header 的敏感性。API Key 和敏感 Header 的原值、URL/JSON/base64 形式在允许保留的结果边界统一检查；Cookie 无论哪组都纳入检查。命中则整份回答返回固定 PARSE/COMPLETED 错误，不能修改原文后伪装成功。丢弃的 debug/Header/原始响应不参与落库结果检查。所有凭据仅存在本次受控装配内存，不进入 CollectionRequest、repr、日志、摘要或任务证据。

传输映射显式区分授权回调与传输异常来源，授权方即使抛 PinnedTransportError 也原实例传播。HTTP 非法范围状态不写 provider_status，而为固定 RECEIVE/COMPLETED 错误；巨型整数采样参数先比较范围避免浮点转换溢出；HTTP 序列化 Unicode 失败发生在回调前且连接关闭、NOT_STARTED。AST 架构断言只为两个 adapter 文件开放技术05已批准的具体 pinned transport/Header 符号，仍禁止业务服务、ORM、事务与生成解析依赖。
