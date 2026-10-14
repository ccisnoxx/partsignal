# PSR-002 实现与验证记录

## 交付

用户已人工审查并接受实现和测试证据，维护 manifest 状态为 done，Trellis task 状态为 completed。依赖 PSR-001 已 done。分支 refactor/PSR-002-generation-sdk；没有提交、推送或部署，没有真实供应商请求。

## 实现增量

- backend/app/services/generation.py：正式 GENERATE/HUMANIZE 共用 AIProvider.chat_completion，原样发送快照的 system/user；业务服务拥有 json.loads + GeneratedDraft 校验，错误固定且 from None 不透传供应商内容。异常收尾 rollback 后重新锁定 Job，仅 RUNNING 可写失败，保护回收器已提交的终态。
- backend/app/services/ai_provider.py：ChatCompletionResult 新增 duration_ms，以 monotonic 对公开 SDK Chat Completions 请求计时，非负整数；不解析业务草稿或拥有 Job 状态。
- backend/tests/unit/test_ai_provider.py：增加 duration 投影断言。
- backend/tests/unit/test_generation_provider.py：实际 SDK MockTransport 验证两类消息、参数、指标、严格业务输出、非 PUBLIC 零发送与 timeout/connection 无重试错误。
- backend/tests/integration/test_generation_provider.py：本机 HTTP fake + PostgreSQL 验证 snapshot 不变、指标/NULL、源不可变、重复消息、非法输出/HTTP错误安全失败、在途 fact/task/source/mainline 失效和迟到异常终态保护。
- docs/architecture.md、operations.md、testing.md、maintenance/openai-sdk-refactor/README.md 与 AI spec：明确生成/自然化 SDK 网络边界及业务校验 owner。manifest 和本任务记录完成状态/证据。

OpenAPI、数据库合同、ORM、Alembic、worker.py、generation_dispatch.py、CredentialCipher、依赖/锁文件没有本轮修改。geo_e2e_runtime.py 是前置 PSR-001 修改，本轮未改；没有必要修改 E2E 替身。旧客户端/传输和 GEO/Browser Collector 不迁移或删除。

## 保证与已确认缺口修复

PENDING→RUNNING 声明先提交，attempt 与 lease(timeout+grace) 不变；非 PENDING 吸收重复消息，SDK max_retries=0，Redis/Celery 仍 UUID。成功返回后 expire_all，锁 Job→Task→自然化源，重验事实/产品/源身份正文哈希、主线资格；成功草稿、主线、指标同事务提交，失败全部回滚。source_job_id 唯一及任务锁控制一作业一个 ContentVersion。

原异常收尾未经状态复验可覆盖 FAILED/WORKER_LOST。新测试先让本机 HTTP 已接收后按 lease 回收，再返回非法业务正文或 HTTP503，修复前 GENERATE/HUMANIZE 两类四个反例都失败；修复后四个反例验证整个 generation_jobs row 未被改写且无 ContentVersion。异常 Job 锁和 RUNNING 复验是本轮必要修复，不改变成功锁序或引入自动重试。

快照版本、FactVersion/Channel/Model/Prompt/参数与普通Header/敏感名称保持原合同；Key及快照所列敏感Header仅在调用边界解密，不进入快照或队列。当前 Fact 和快照 PUBLIC 门禁、业务关闭零发送、APP_ENV=test 注入限制保持。当前读取事务可在 I/O 期间打开，但不持有 Job/Task 行锁，不将其误述为全流程事务外 I/O。

错误映射：timeout→AI_PROVIDER_TIMEOUT/504；connection→AI_PROVIDER_UNAVAILABLE/502；非成功HTTP→AI_PROVIDER_ERROR/502，重定向保留AI_REDIRECT_FORBIDDEN/502；SDK外层结构/JSON/UTF8、业务JSON/Schema/空白正文→AI_RESPONSE_INVALID/502；配置/事实/快照既有4xx/409保留。原始错误、供应商正文、Prompt、Key或敏感Header不进入业务错误摘要/日志。

## 精确验证命令及结果

除标注外 cwd=/Users/sc/PycharmProjects/partsignal。集成命令均由 Python subprocess.run 启动，下面记录完全相同的 argv/env；测试仅使用虚构凭据。本轮独立PostgreSQL为 postgresql://psr002@127.0.0.1:58879/postgres、Redis为 redis://127.0.0.1:59328/14，无密码，随机回环端口。

### 基线

```bash
uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py backend/tests/unit/test_generation_runtime_mode.py
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_generation_runtime_mode.py
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres REDIS_URL=redis://127.0.0.1:59328/14 uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_generation_runtime_mode.py -k 'accepted_broker_message or real_celery_duplicate'
```

分别 exit0/59passed(1.02s)、exit1/32passed+3failed(50.42s)、exit0/3passed+32deselected(9.69s)。三项失败原因是默认redis:6379无法解析，安装并启动本轮隔离Redis后只重验失败项，未改业务代码。

### 迁移验证

```bash
uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_generation_dispatch.py backend/tests/unit/test_generation_runtime_mode.py backend/tests/unit/test_generation_provider.py backend/tests/unit/test_ai_provider.py
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres REDIS_URL=redis://127.0.0.1:59328/14 uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_generation_runtime_mode.py backend/tests/integration/test_generation_provider.py
```

exit0/143passed(0.86s)；exit0/58passed(65.82s)。第二项当时尚未增加四个迟到异常测试，不记为最终候选完整62测试一次执行。实际包含 PostgreSQL、本机真实HTTP、真实Celery UUID重复消息与Beat补投递、模式关闭、不重复外发、自然化可重复与lease迟到成功等。

### 迟到异常反例及修复

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres REDIS_URL=redis://127.0.0.1:59328/14 uv run --project backend pytest backend/tests/integration/test_generation_provider.py -k late_sdk_failure
```

同命令修复前exit1/4failed+23deselected(5.70s)，失败因为WORKER_LOST被AI_RESPONSE_INVALID/AI_PROVIDER_ERROR覆盖；重新锁Job/RUNNING复验后exit0/4passed+23deselected(5.77s)。

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr002@127.0.0.1:58879/postgres REDIS_URL=redis://127.0.0.1:59328/14 uv run --project backend pytest backend/tests/integration/test_generation_reliability.py backend/tests/integration/test_generation_runtime_mode.py backend/tests/integration/test_generation_provider.py -k 'worker_source_identity_violation or worker_late_final_failure or max_timeout or provider_failure or sdk_success_with_invalid_output or retryable_sdk_http_errors or sdk_inflight_invalidation or explicit_test_generator'
```

exit0/25passed+37deselected(29.29s)。修改异常收尾后仅重验直接影响的失败/回滚与上下文范围；其余成功、消息、模式、SDK消息/metadata证据输入未变而复用。当前62个集成用例的有效证据是组合证据，不声称单次重跑62通过。

### 静态检查

```bash
git diff --check
uv run --project backend ruff check backend/app/services/generation.py backend/app/services/ai_provider.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_generation_provider.py backend/tests/integration/test_generation_provider.py
uv run --project backend mypy --config-file backend/pyproject.toml backend/app/services/generation.py backend/app/services/ai_provider.py
```

全部exit0；Ruff All checks passed，普通mypy2sourcefiles通过。

cwd=/Users/sc/PycharmProjects/partsignal/backend：

```bash
uv run mypy --config-file pyproject.toml --explicit-package-bases --follow-imports=silent app/services/generation.py app/services/ai_provider.py tests/unit/test_ai_provider.py tests/unit/test_generation_provider.py tests/integration/test_generation_provider.py
```

exit0，五个修改文件通过；silent仅抑制导入的旧测试辅助模块错误，直接target均按strict检查。最初在根目录同一mypy invocation传五文件因unit/integration同名test_generation_provider被视为重复模块而exit2；改cwd/explicit-package-bases后发现新测试裸tuple类型并修复为tuple[Any,...]，最终通过。常规生产mypy单独正常检查，不依赖silent。

## 复用、未执行和限制

PSR-001已接受的SDK3.29.0依赖/lock/import证据仍有效，依赖输入未变，本轮不重复升级或lock/sync。第一次143单元及未受异常收尾影响的集成证据复用；实际失败分支按上述25+4补验，未执行额外全仓门禁。

未运行真实供应商、前端/完整浏览器E2E、全仓make verify、镜像/部署/生产HTTPS验收、GEO/Browser Collector套件。API/DB/依赖无本轮变化，未执行额外contract-check/迁移专项（所有PostgreSQL隔离数据库的existing Alembic upgrade head在fixture内确实执行）。SDK仅做URL结构校验，不提供DNS/IP/peer固定或旧响应上限，这是继承PSR-001且本次明确迁移的边界；生产保持HTTPS，不描述为旧SSRF固定地址保证。

后续：人工接受后方可将PSR-002置done；PSR-003迁移GEO API Collector，PSR-004处理旧客户端/传输删除，本轮不提前执行。

## 独立复核与审计

fresh critical_reviewer 对本轮五文件增量及直接合同只读复核，未确认 SDK 调用、并发收尾或终态保护方面的阻断。审查者检查原始HTTP/PostgreSQL日志及新反例实现，未独立重跑PG/Redis；另用实际SDK+MockTransport对12种异常外层结构×GENERATE/HUMANIZE共24反例执行无落盘python -B验证，全部安全AI_RESPONSE_INVALID、一次请求且无正文泄漏。详见review.md。

审计Bundle 20261013T094005Z-psr-002-generation-sdk-80db26da 已closed，SUBAGENT_EXECUTION_DIGEST及audit-finalize/audit-verify均passed：1次实际派发、1项报告验收、1次独立复核，无异常、无残留活跃代理。复核期间已修改/未跟踪源码SHA未变，未观察到源码写入；该证据不替代行为测试。Agent TOML仅为配置证据，不是runtime模型遥测。保留实际完整派发提示词的额外audit artifact prompt.txt产生一条unclassified-artifact分类提示，不影响校验且不是执行异常。

## 清理与最终状态检查

本轮临时PostgreSQL/Redis已停止；停止前pg_database只有postgres/template0/template1，未残留测试库。随机HTTP fake和Celery Worker均由测试context退出。58879/59328端口停止后无监听。本轮一次性before副本、原始测试日志、审计前源码SHA快照、文档草稿、PG集群目录与runtime指针已精确删除；测试产生的六个Celery日志及已空目录已删除，没有清理其他pytest目录。保留Homebrew PostgreSQL/Redis安装、依赖/cache（可复用工具，不属于临时产物）；正式证据保存在本task与已验证审计Bundle。

最终git diff --check通过；git status --short逐项核对本轮文件和前置脏工作区，无暂存/提交/推送/部署。未清理前置PSR-001/部署task、untracked源码/合同或用户本地配置。

## 人工验收完成（2026-10-13）

用户在当前会话明确确认：“我已经人工审查并接受 PSR-002 的实现和测试证据。”据此将维护 manifest 的 PSR-002 从 review 更新为 done，同一 Trellis task 从 review 更新为 completed，记录 completedAt、human_acceptance=accepted 和 human_accepted_at。

本轮仅更新 PSR-002 状态与人工验收记录，复用已经接受的实现、测试和独立复核证据；验证命令为 `git diff --check`，不重新运行实现测试。其他任务状态保持不变，不实现 PSR-003/PSR-004，没有提交、推送、归档或部署。
