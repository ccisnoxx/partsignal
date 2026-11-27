# PSR-004 Task Brief

## 目标、依赖和授权

删除自研 AI 网络栈、旧客户端及只服务其内部实现的测试/文档。PSR-001～003 的 prd/implement/review 已读；维护 manifest 的 PSR-002、PSR-003 均为 done，人工接受记录完整。当前分支 refactor/PSR-004-remove-custom-http。用户授权本地实现、验证、任务状态/规范更新；不提交、推送、部署或使用真实 Provider。

## 盘点与设计

正式配置/生成/GEO API Collector 已迁至 AIProvider。维护 README 明确把剩余 GEO Profile 固定诊断留给 PSR-004：先改用 AIProvider.test_connection，保留预留/事务外调用/调用后依赖 revision 与资格复核、凭据加密/解密、hi 消息和参数，然后证明零运行时旧栈调用再删除。Header token/Latin-1/保留名校验迁到现有 SDK 配置 owner ai_provider，所有已知调用者同批迁移；不保留旧文件名 shim。

逐引用盘点见 evidence/references-before.tsv（1756 行引用、468 个文件，含历史记录1523、测试130、运行时代码74、文档/配置17、脚本10、fixture2）。历史记录、Alembic、与 AI 无关的 Socket/IP/Nginx/Browser 用法保留。旧栈的运行时调用为 Profile 诊断；其余运行时依赖仅 Header 校验。

删除 pinned_http.py、openai_client.py、unit/test_pinned_http.py、integration/test_ai_egress_https.py 及混合文件中固定 DNS/peer/TLS/底层限体/旧协议专属测试与 fake；保留 SDK、配置、凭据、快照、严格草稿、生成/自然化、Collector/解析/预算/状态机、Profile 权限/revision 和 fake provider 测试，必要时迁移装配。

## 合同与边界

运行时统一官方 openai Python SDK，显式 max_retries=0。PartSignal 继续负责业务快照、凭据加密、数据分级、严格输出校验、错误映射和作业状态。API GEO 调用后无法确认结果的网络故障为 UNKNOWN，不自动重放。Collector 内部 max_response_bytes 仍为完整接收后的业务检查，不承诺底层接收内存上限；Profile 诊断不增加旧栈上限的替代设施。

无 OpenAPI、数据库/ORM、Alembic 或依赖/锁文件变化。httpx 由 storage/platform_logo_files 和测试使用；httpx2 由 SDK/Starlette 使用。Browser Collector、Makefile 分层、出口代理/白名单/防火墙、协议切换和无关重构均范围外。保留任务开始前全部 modified/untracked 文件。

## 基线

- uv run --project backend pytest backend/tests/unit/test_ai_provider.py backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py backend/tests/unit/test_generation_runtime_mode.py backend/tests/unit/test_generation_provider.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py --tb=short：293 passed，5.11s。
- PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr004@127.0.0.1:65533/postgres uv run --project backend pytest backend/tests/integration/test_ai_provider_configuration.py backend/tests/integration/test_generation_provider.py backend/tests/integration/test_geo_sdk_collection.py --tb=short：39 passed，42.60s。
- 隔离 PostgreSQL 17 由本轮创建，只监听回环65533，精确资源记录在系统临时目录；完成后停止删除。没有 Redis/容器/浏览器。

## 验收与停止条件

执行定向 Ruff、运行时 mypy、SDK Adapter/AI配置/生成与自然化/GEO关键单元与集成、Profile权限/诊断/revision竞争、安全业务测试、全仓残留搜索和 import/启动烟雾、git diff --check。实际删除证明与保留测试对照写入 implement.md；外发尾部迁移候选做 fresh critical_reviewer 复核并保存有效 Digest。若依赖非done、仍存在不能迁移的运行时旧栈调用、必须改公共合同/数据或使用真实凭据、无法保留已有修改，则停止对应范围并标记blocked。失败先诊断，未运行/skip不记通过。

完成 manifest 与 Trellis task 置 review，保留原实现/验收历史；不自动标记done/completed或归档。
