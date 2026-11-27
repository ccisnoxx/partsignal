# PSR-003 实现与验证证据

## 状态、授权与范围

用户已人工审查并接受 PSR-003；维护 manifest 为 done，Trellis task 为 completed，completedAt=2026-10-13。

PSR-001 done、人工接受记录已读，SDK 锁定 openai 3.29.0。分支 refactor/PSR-003-geo-api-sdk。用户授权本地实现/验证和维护状态；没有提交、推送、归档、部署或真实 Provider 调用。初始工作区 PSR-001/002、部署/infra/AGENTS 修改全部保留。

## 实现

- OpenAICompatibleGeoCollector 改调用 AIProvider.raw_chat_completion，删除本 adapter 的 PinnedHTTPTransport 请求和错误映射，不删除 pinned_http.py。
- AIProvider 复用 PSR-001 的独立同步客户端生命周期、生产 HTTPS/开发测试本机 HTTP、Header 输入校验与 Latin-1 转发、关闭环境 Header/代理/重定向和 max_retries=0。raw 入口消费公开 with_raw_response.create/content，返回仅驻留内存且隐藏 repr 的原始 bytes/status/request ID/安全 Retry-After/duration；不调用 SDK 的宽松 response.parse。
- _client 在授权前明确拒绝普通/敏感且大小写等价的 SDK 控制 Header X-Stainless-Raw-Response，固定 INVALID_HEADER；其他 Header 保留。首轮独立复核发现该值覆盖SDK raw=true时完整200会因类型变化而误记UNKNOWN，已按权威SDK配置边界修复。
- _client 只拥有创建/释放；既有配置/生成的 SDK→AppError 映射抽为 _sdk_errors，保持其公开错误行为，避免将 GEO 授权 callback 的同类异常误映射成网络错误。
- GEO 响应解析器输入改为 bytes + request ID + duration，移除 PinnedResponse 耦合。原 JSON/重复键/有限 Decimal/引用/证据/Pydantic 校验不变，不采集生成草稿四字段，不猜 usage/cost/search。
- GeoCollector/geo_runs 注释同步授权窗口；实际资格、PUBLIC、凭据解密、预算账本、锁序、幂等、恢复与提交逻辑不改。
- 测试迁移旧 Socket/DNS/peer Collector 金标到 SDK MockTransport 窗口和接收后大小/秘密边界；原本机 HTTP 故障矩阵、共同合同与请求正文 hash 保留。共同套件允许显式 failure_cases，SDK 完整超限期望 COMPLETED；测试用参考驱动仍保留传输期 SENT 的独立合同。
- geo_e2e_runtime 的 API Collector 装配移除旧 _transport 注入，使用生产 SDK 和真实 Run 测试 Header；Profile 固定诊断仍保留旧栈。新 PG 用例验证授权/预算拒绝零 SDK 启动、connect/timeout 已提交 SENT/账本后 UNKNOWN 与无重放。
- architecture/operations/testing、SDK 维护工作流、GEO 技术/安全/测试文档、AI spec 同步实际语义。只更新本轮三份技术文档对应 SHA，其他初始 SHA 条目保留。

## 状态、大小与敏感边界

配置/分级/授权失败 SDK 不启动、NOT_STARTED。before_send 是 SDK 方法前的最后业务操作，失败原样交回 owner；成功即进入外部窗口，PG 原子持久化 SENT/预算授权后释放锁。明确 HTTP 状态 COMPLETED；timeout/connection/不确定网络故障 UNKNOWN。UNKNOWN 与已授权 SENT 不自动重放，迟到结果仍由 token/expiry/终态拒绝，显式 retry 创建新 attempt。

401/403 PROVIDER_AUTH_FAILED；429 PROVIDER_RATE_LIMITED，Retry-After 只接受不超过9位 ASCII 非负整数（未知为 null）；5xx PROVIDER_UNAVAILABLE；非法状态/响应 PROVIDER_RESPONSE_INVALID；完整超限 PROVIDER_RESPONSE_TOO_LARGE/COMPLETED。错误只有固定摘要，SDK/HTTP 日志不传播，无供应商正文/Prompt/Answer/URL/API Key/Header/traceback 普通日志。

max_response_bytes 搜索 contracts、ORM/schema、Alembic 未出现，是内部 CollectionRequest。字段保留，使用锁定3.29.0公开 LegacyAPIResponse.content 完整接收后按实际 raw bytes 检查（包括 UTF-8、扩展字段、chunked），再严格业务解析；接收期内存没有上限保证。无流式读取、自研 Transport、Socket 或恢复首字节 hook。SDK URL不承诺旧 DNS/IP/peer 固定，Profile 固定诊断暂留旧栈。

API Key、显式敏感 Header/Cookie 仍仅执行内存使用。全部允许落库字段扫描已知原值/URL大小写等价编码/JSON/base64与Latin-1变体，命中整份失败、原文不改写。debug/任意响应 Header不落库，raw bytes/截图仍为None。

OpenAPI、数据库合同、ORM/Schema、Alembic、历史快照与 pinned_http.py 零 diff。预算 owner/锁顺序/日预算/滚动配额不变；未知报价仍阻断受预算约束采集，UNKNOWN成本保留不清零。

## 实际命令与结果

全部从仓库根执行；只用虚构 Key 与本机 HTTP/MockTransport/隔离真实 PostgreSQL。

### 基线

`uv run --project backend pytest backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py`

exit0，137 passed，4.59s。

### 集中单元与 SDK 影响范围

`uv run --project backend pytest backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py backend/tests/unit/test_geo_collector_suite.py backend/tests/unit/test_geo_e2e_runtime.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_generation_provider.py --tb=short`

首轮 exit1，20 failed、267 passed，11.66s。20项失败全部是我新增的错误 SDK wire 字段顺序预期，与业务结果无关；一次无落盘 MockTransport诊断确认3.29.0实际序列化与原 suite completion_body 一致。删除新增 request_body 参数/重复预期后只重跑失败文件：

`uv run --project backend pytest backend/tests/unit/test_geo_openai_collector.py --tb=short`

exit0，47 passed，3.62s。其余240项通过后的相关源码/配置/测试输入未再改变，成功证据复用；结合定向复验覆盖7文件287项，不宣称重新执行整轮或全量门禁。

覆盖本机 fake 成功/引用/usage/cost/秘密丢弃、401/403/429/503/timeout/slow-body/disconnect/redirect/Content-Length和chunked超限；SDK MockTransport connect/ConnectTimeout/ReadTimeout/ReadError/RemoteProtocolError无重试、配置URL/环境Header零SDK、回调BudgetExceeded/OSError/AppError/APIConnectionError原样零SDK、原始UTF-8精确size边界/扩展字段、全部保留字段与编码变体回显失败；非 PUBLIC、adapter绑定与严格解析原有反例继续。

### PostgreSQL 采集与 admission

`PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr003@127.0.0.1:64407/postgres uv run --project backend pytest backend/tests/integration/test_geo_sdk_collection.py backend/tests/integration/test_geo_collection_admission.py backend/tests/integration/test_geo_at_most_once.py backend/tests/integration/test_geo_worker.py -k 'not real_redis_celery and not accepted_broker_lost_ack' --tb=short`

exit0，63 passed、2 deselected，9.20s。4个新 SDK 窗口反例，既有真实HTTP成功/原子引用费用、并发claim、预算/配额、发送前日预算重验、重复消息、租约/旧token/独立Worker丢失/迟到结果与显式新attempt均覆盖。2个Redis/Celery专用用例未运行，不记通过；没有启动Redis。

### 静态与差异检查

`uv run --project backend ruff check backend/app/collectors/openai_compatible.py backend/app/collectors/openai_response.py backend/app/collectors/base.py backend/app/services/ai_provider.py backend/app/services/geo_runs.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_geo_openai_response.py backend/tests/geo_collector_contract.py backend/tests/geo_e2e_runtime.py backend/tests/integration/test_geo_sdk_collection.py`

最终exit0，All checks passed；初始import/行长错误已修正，未重格式化其他源码。

`uv run --project backend mypy --config-file backend/pyproject.toml backend/app/collectors/openai_compatible.py backend/app/collectors/openai_response.py backend/app/collectors/base.py backend/app/services/ai_provider.py backend/app/services/geo_runs.py`

exit0，Success: no issues found in 5 source files。复验前仅collector分行/import格式变化，最终再次exit0。

额外 `uv run --project backend mypy --config-file backend/pyproject.toml backend/tests/geo_e2e_runtime.py` exit1；测试动态装配的缺py.typed/import-untyped、动态继承valid-type/misc和Any返回错误。相同命令目标换为本轮保存的初始文件 `/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/psr003-w958xeml/backend/tests/geo_e2e_runtime.py` 同样exit1，全部同类诊断，仅本轮新增3行引起后续line偏移。Makefile正式mypy边界为backend/app；不扩大修复预先存在的测试类型设计，测试装配另由Ruff和pytest验证。

`git diff --check` 多次exit0；OpenAPI/ORM/Schema/Alembic/pinned_http git diff为空。三份实际更新技术文档对应SHA256检查一致。

### 独立复核发现后的直接回归

先补最小可观察反例：

`uv run --project backend pytest backend/tests/unit/test_geo_openai_network.py -k 'sdk_control_header or shared_sdk_client' --tb=short`

pre-fix exit1，10 failed、44 deselected，0.72s：8项普通/敏感/大小写/false或stream配置仍执行了授权callback；2项Models/Chat已有I/O且错误分类不符合授权前INVALID_HEADER。符合本次遗漏的边界，未编造mock成功。

在_client配置检查拒绝SDK控制Header后，运行直接受影响范围：

`uv run --project backend pytest backend/tests/unit/test_geo_openai_network.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_generation_provider.py backend/tests/unit/test_geo_openai_collector.py --tb=short`

exit0，185 passed，5.04s。普通/敏感/大小写SDK控制Header在callback/SDK/transport之前拒绝；其他普通/敏感及Latin-1、原始raw/文本/Models调用保持合同，Collector完整HTTP矩阵再次通过。其余解析/共同套件/E2E装配112项相关实现和测试未变，复用首轮成功证据；结合为7文件297项有效单元证据，不宣称整轮重跑。此前PG63项正常Header输入与事务/状态/预算源码未变，成功证据复用；没有再次运行PG全组。

修复后重复以上11文件Ruff与5运行时mypy精确命令、git diff --check，全部exit0。

## 未运行与限制

无真实Provider/真实凭据/Browser Collector/Responses/stream/async。未运行上述2个Redis/Celery专用用例、完整Playwright/E2E、完整make verify、全仓unit/integration、生产镜像或部署门禁：当前变更由SDK/localHTTP/PG边界观察，不新增完整用户流程或Broker行为。真实兼容平台/生产HTTPS和镜像不由fake结果证明。测试装配文件额外mypy存在与初始相同的既有错误，正式运行时定向mypy通过。

## 工作区与清理

本轮 PostgreSQL 17 临时集群只监听随机回环64407，所有临时partsignal_*库测试结束后遗留数0，pg_ctl精确停止本轮data目录，端口释放。没有Redis/浏览器/容器；本机HTTP由context关闭线程/端口。初始源副本、PGdata/log、resources/hash/文档草稿均放本轮系统临时目录，最终交付前删除；安装依赖/共享缓存不删除。正式Task Brief/实现/复核证据与独立审计Bundle保留。


## 独立复核与审计

首轮 fresh critical_reviewer 确认1项P2 SDK控制Header问题，已在权威SDK配置边界修复并补10个先失败后通过的反例。第二位fresh critical_reviewer独立64个无落盘MockTransport场景exit0，确认阻断解除、未发现剩余定向阻断；不是重新执行完整PG/pytest的结论。详情见同目录review.md。

审计Bundle 20261013T120452Z-psr-003-82c2441e，当前任务两阶段plan/dispatch/execution/summary/SUBAGENT_EXECUTION_DIGEST均持久保存；audit-finalize与audit-verify通过、closed，2项报告验收、2次fresh独立复核、无异常。两次复核期间本轮与初始modified/untracked仓库文件SHA逐项不变，未观察到子代理写入；这种证据不替代行为验证。Agent模型/推理档位只来自TOML配置快照，不是运行时遥测。复核报告验收不代表首轮代码无问题，也不代表用户已人工接受PSR-003。


## 人工验收完成（2026-10-13）

用户在当前会话明确确认：“我已经人工审查并接受 PSR-003。”据此将维护 manifest 的 PSR-003 从 review 更新为 done，对应 Trellis task 从 review 更新为 completed，并记录 completedAt。

本轮只更新 PSR-003 状态及人工验收记录，复用已接受的实现、测试和独立复核证据；验证命令为 `git diff --check`，不重新运行实现测试。其他任务状态保持不变，不实施 PSR-004，不提交、推送、归档或部署。
