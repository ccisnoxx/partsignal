# PSR-002 Task Brief

## 目标与授权

将正式原始生成和自然化迁移到 PSR-001 官方同步 OpenAI SDK 薄适配层，继续使用 Chat Completions。用户已授权实现、本地 fake 验证及文档/状态记录；当前分支 refactor/PSR-002-generation-sdk，不提交、不推送、不部署。PSR-001 manifest=done，人工接受及验收记录见 [前置任务](../10-12-psr-001-openai-sdk-adapter/implement.md)。

## 验收与范围

- generate_for_job 使用 AIProvider.chat_completion；恰好发送冻结的 system/user 两条消息，原文不改，无新增 tools/role/prefix；max_retries=0。
- 业务服务直接校验 GeneratedDraft 四字段；空白正文、非法 JSON、额外字段、Schema 不符合都失败。
- request ID、duration、可空 prompt/completion/total tokens 继续写入既有字段；SDK 成功不等于业务成功。
- 保留 PUBLIC 门禁、凭据调用边界解密、快照/配置/Prompt/FactVersion/源版本追溯，PENDING→RUNNING→SUCCEEDED/FAILED、UUID 队列、lease、重复投递、调用后锁与资格复核、手动新作业重试。
- 不调用真实供应商；不改 GEO、Browser Collector、旧客户端/传输、Responses/流式/异步、公共合同、数据库或依赖。
- 完成将维护 manifest 与本 task 置 review，不得标记 done/completed。

## 设计

当前：API→冻结 Job→Celery UUID→process_generation_job→generate_for_job→OpenAICompatibleClient.complete→PinnedHTTPTransport。目标：同一执行器→AIProvider.chat_completion→官方 SDK→generation 的严格 JSON/GeneratedDraft 校验。适配层只补 duration 投影，不拥有业务 Schema 或状态。

消息、Header 普通值/敏感名称、模型参数从快照读取；仅快照指定敏感 Header 的当前值和当前 Key 在外发边界解密。业务模式关闭仍零外发，测试注入仅 APP_ENV=test。保留 Job 声明提交、timeout+grace lease、返回后 Job→Task→自然化源版本锁序和上下文/主线复核。成功收尾锁序和事务范围不变；异常收尾补同样的 Job 行锁与 RUNNING 复核，防止迟到 HTTP/业务校验失败覆盖已经提交的 WORKER_LOST。新反例在修复前 4 failed、修复后 4 passed；属于本任务终态保护验收。现有配置读取事务在调用期间可保持打开，但不持有 Job/Task 行锁，不宣称整个 I/O 无数据库事务。

SDK URL 边界继承 PSR-001：禁止凭据/query/fragment，生产 HTTPS、development/test 显式本机 HTTP；无 DNS/IP/peer 固定和响应字节上限。GEO 仍由旧栈维护这些保证。错误保留 timeout→AI_PROVIDER_TIMEOUT、connection→AI_PROVIDER_UNAVAILABLE、HTTP→AI_PROVIDER_ERROR、redirect→AI_REDIRECT_FORBIDDEN、外层/业务正文→AI_RESPONSE_INVALID；快照/事实/配置既有 4xx/409 不变。安全错误不含正文、Prompt、Key 或敏感 Header。

## 验证

- git diff --check；修改 Python 文件定向 Ruff/mypy。
- 生成、投递、模式单元；实际 SDK 序列化/错误、空/非法业务正文。
- PostgreSQL+本机 HTTP fake 的生成、自然化、重复/并发投递、lease、在途事实/任务/源资格与主线变化、非 PUBLIC、关闭模式、严格输出失败和指标保存。
- 高后果外发边界候选进行 fresh 独立只读复核；验证范围不扩大为全仓门禁。

## 基线

2026-10-13，修改生产代码前：
- uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py backend/tests/unit/test_generation_runtime_mode.py：59 passed，1.02s。
- 相同 uv/pytest 执行 integration/test_generation_reliability.py 与 test_generation_runtime_mode.py，PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres：32 passed、3 failed，50.42s。三项失败均为默认 redis:6379 无法解析。
- 补本轮独立 Redis REDIS_URL=redis://127.0.0.1:59328/14，重跑同两文件 -k 'accepted_broker_message or real_celery_duplicate'：3 passed、32 deselected，9.69s。基线失败已由环境修正消解。

隔离 PostgreSQL/Redis 与随机 fake HTTP 均由本轮创建，完成后停止并清理。保留任务开始前全部 modified/untracked 改动（含 PSR-001）；只检查当前增量。

## 停止条件

PSR-001 不为 done、需修改公共 API/数据库、必须真实凭据验证、SDK 公开入口无法实现合同、无法安全保留已有修改时停止并记录 blocker。已知环境失败先诊断，不能把 skip 或未运行记为通过。
