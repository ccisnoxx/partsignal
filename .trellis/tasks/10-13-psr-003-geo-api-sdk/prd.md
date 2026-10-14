# PSR-003 Task Brief

## 目标、依赖与授权

将已实现的 OpenAI-compatible GEO API Collector 迁移到 PSR-001 官方同步 SDK 适配层。PSR-001 在维护 manifest 为 done，其 implement.md 包含用户人工接受声明；openai 锁定 3.29.0。用户授权实现、本地 fake 验证和状态更新；当前分支 refactor/PSR-003-geo-api-sdk。不提交、推送或部署，不接真实供应商。

## 边界与方案

- 当前 geo_runs claim 在短事务校验 Profile/Surface/Channel/Model/adapter、解密凭据、预留预算；PinnedHTTPTransport 连接后调用 before_send，授权事务重验 revision、lease/token、预算并持久化 SENT。
- 目标 Collector → AIProvider → chat.completions.with_raw_response.create；客户端配置完成后在 SDK 方法前一行执行原 before_send。回调失败原样交还 owner，SDK 不启动；成功进入外部调用窗口。NOT_STARTED 仅用于配置/分级/授权前失败，明确 HTTP 状态为 COMPLETED，方法启动后 timeout/connection/未知网络故障为 UNKNOWN。
- 原有 SENT 数据库标记、短事务/锁序、预算账本、迟到结果、恢复和显式新 attempt 规则不改。SDK max_retries=0、禁止 redirect、关闭环境代理。UNKNOWN 不自动重放。
- max_response_bytes 是内部 CollectionRequest 合同；搜索 contracts、ORM/schema 和历史 Alembic 未发现该字段。保留并使用锁定版本公开 LegacyAPIResponse.content 字节，在接收后、业务解析前检查；不能防止接收时内存占用。公开文档：https://developers.openai.com/api/reference/python 。无流式读取、自定义 Transport、Socket 或字节阶段 hook。
- 接收后仍由 openai_response 原始 JSON/Decimal/重复键/引用/证据规则与 Pydantic 校验。只投影允许落库字段；这些字段出现 API Key/敏感 Header/Cookie 原值或已有 URL/JSON/base64 变体时整份失败。普通日志不含正文、Prompt、URL、秘密或 traceback。
- 不保留旧 DNS/IP/peer 固定保证；生产 HTTPS 与显式 development/test 本机 HTTP、URL 结构校验、Header 校验仍由 SDK 适配层拥有。Browser Collector 和 pinned_http.py 不修改。

## 修改范围与合同

Collector、AIProvider 薄适配层、响应解析输入边界、geo_runs 授权注释、GEO 单元/本地 fake/PG 测试及受影响测试装配、直接相关技术文档。OpenAPI、数据库 Schema/ORM、Alembic 和历史快照零变化；根合同仅在必须时停止并标记 blocked。保留初始工作区其他任务所有修改。

## 验收与验证

基线：uv run --project backend pytest backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py → 137 passed，4.59s。

完成全部实现后集中运行 git diff --check、修改文件 Ruff、运行时文件定向 mypy；Collector 单元/现有解析金标和受影响 AIProvider 回归；本机 fake HTTP 成功、401/403/429/5xx/timeout/disconnect/connection error、非 PUBLIC 零调用、预算/发送授权失败零 SDK 调用、凭据回显、UNKNOWN 不自动重放、接收后 response size 边界。PG 定向执行采集/预算/并发/迟到结果和恢复，不使用 SQLite。高风险发送窗口变更须 fresh critical_reviewer 只读复核，使用 multi-agent-orchestration 审计。

## 停止条件

PSR-001 不为 done；SDK 公开能力无法完成业务合同；必须改变公共 API/数据库合同；必须使用真实凭据/供应商；无法保留其他任务修改。环境不可用时保留证据并报告验证缺口，不写成通过。完成后维护 manifest 与本 Trellis task 标记 review，记录精确命令、结果、未运行项及限制。
