# PSR-001 实现与验证记录

## 交付状态

用户已人工审查并接受实现和测试证据，工作流状态为 done，Trellis 状态为 completed；不提交、不推送、不归档、不部署。分支为 refactor/PSR-001-openai-sdk-adapter。

## 实现与修改文件

- backend/pyproject.toml、backend/uv.lock：运行时新增 openai>=3.29,<4，锁定 openai 3.29.0；新增 jiter 0.17.0、sniffio 1.3.1，httpx2/httpcore2 升级 2.9.1→2.13.1。httpx2-jsfetch 1.0 仅作为 Emscripten 条件锁依赖，不安装到本机；旧 httpx 保留。
- backend/app/services/ai_provider.py：同步 OpenAI 生命周期、Models list、Chat Completions hi 测试、可复用文本调用入口、固定 AppError 与 request ID/可空 usage 投影。max_retries=0、禁止重定向、关闭环境代理；无 DNS、IP 分类、Socket、TLS、手工 HTTP 或私有 SDK API。
- backend/app/services/ai_configuration.py：改用 SDK 入口及轻量 URL owner；只有 import 和两个外部调用入口变化，事务、锁、revision、状态和 CredentialCipher 不变。
- backend/tests/unit/test_ai_provider.py、backend/tests/unit/test_contract.py：实际 SDK 序列化与边界反例、现有配置 service 错误投影注入点更新。
- backend/tests/ai_provider_support.py、backend/tests/integration/test_ai_provider_configuration.py、backend/tests/integration/test_ai_channel_management.py：本机真实 HTTP fake、PostgreSQL 持久状态/并发反例、Bootstrap SDK Header 序列化与原事务保证。
- backend/tests/geo_e2e_runtime.py：仅把 AI 配置诊断接到 SDK，并保留 fake 必需的独立诊断 UUID；GEO Profile/Collector 不迁移。
- docs/architecture.md、docs/operations.md、docs/testing.md、.trellis/spec/backend/ai-configuration-guidelines.md、quality-guidelines.md：区分 SDK 配置路径与旧生成/GEO 固定传输保证。
- docs/maintenance/openai-sdk-refactor/README.md、task-manifest.yaml：确认工作流范围与 PSR-001～007 状态，PSR-002～007 仅 planned 占位、范围待定义。
- 当前 task 的 prd.md、review.md、implement.md、task.json：Task Brief、独立复核、实际证据与 review 状态。

OpenAPI、数据库合同、ORM、Alembic、CredentialCipher、config.py、旧 openai_client.py/pinned_http.py 和 GEO task manifest 均未修改。创建/更新 URL 不再执行 DNS/IP 校验；生产 HTTPS 与 development/test 显式本机 HTTP 保留。SDK 路径不承诺旧固定 peer/SSRF 或响应字节上限，生成/自然化/GEO 继续旧栈。

## 锁、状态、错误与敏感数据

- 调用前按 channel→model 加锁并复核 revision，复制调用参数和边界解密后的凭据，然后 commit 释放事务；外部请求后 expire_all、重新加锁并比较 channel/model revision。
- SDK 成功/失败都只回写模型测试状态、固定摘要、时间和 revision，并保持停用。revision 漂移先返回冲突，不覆盖并发 UNTESTED 状态；发现仅返回临时 ID，不创建模型、不计 Usage、不追加永久审计。
- 已有 production bootstrap 明确的 T1/T2/T3 不变，T3 在测试成功后原子启用是原 maintenance 授权行为，不代表管理员测试自动启用。
- 保留 AES-256-GCM 密文和关联数据；普通/敏感 Header 与 API Key 只在请求边界使用。保留既有可打印 Latin-1 范围，公开 HTTP hook 设置真实 Authorization/额外 Header；SDK 默认 Authorization 为空，避免 ASCII 编码回归。
- SDK 非空 OPENAI_CUSTOM_HEADERS 在零发送时固定 INVALID_HEADER，禁止隐式进程 Header 绕过数据库权威。organization/project 不继承环境值，代理关闭，不修改全局 os.environ。
- timeout→AI_PROVIDER_TIMEOUT/504，网络错误→AI_PROVIDER_UNAVAILABLE/502，3xx→AI_REDIRECT_FORBIDDEN/502，其余供应商 HTTP 错误→AI_PROVIDER_ERROR/502，响应结构/JSON/UTF-8 解码→AI_RESPONSE_INVALID/502。只暴露固定消息/状态码，不保留正文到错误摘要；SDK/HTTP 传输日志不传播到应用日志，序列化 warnings 关闭以免泄漏原始值。

## 精确命令与结果

所有命令从 /Users/sc/PycharmProjects/partsignal 执行。PostgreSQL 命令由 Python subprocess.call 启动，仅补本轮隔离环境 PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr001@127.0.0.1:51390/postgres，无密码，随机回环实例；下面展示同一实际 argv/env。

### 基线

```bash
uv run --project backend pytest backend/tests/unit/test_ai_boundaries.py backend/tests/unit/test_contract.py -k 'ai_channel or ai_model or connection or credential or header or snapshot or generated_draft or url_validation or chat_completions or provider_timeout or redirect'
```

exit 0：21 passed，56 deselected，2.16s。

```bash
uv run --project backend pytest backend/tests/integration/test_ai_channel_management.py
```

exit 0：18 skipped，0.89s。原因：未设置 PostgreSQL 测试连接；不能记为通过。docker ps 显示 Docker daemon 不可用，随后安装 Homebrew PostgreSQL 17.11 并启动临时集群，未触碰业务库。

### 依赖

```bash
uv lock --project backend
uv sync --project backend --all-extras
uv run --project backend python -c "import openai; print(openai.__version__)"
uv lock --project backend --check
```

全部 exit 0：锁解析 92 个 package；sync 完成；import 输出 3.29.0；lock check 通过。其后依赖及锁文件未变，这些成功证据复用。

### 最终静态检查

```bash
uv run --project backend ruff check backend/app/services/ai_provider.py backend/app/services/ai_configuration.py backend/tests/ai_provider_support.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_contract.py backend/tests/integration/test_ai_provider_configuration.py backend/tests/integration/test_ai_channel_management.py backend/tests/geo_e2e_runtime.py
uv run --project backend mypy --config-file backend/pyproject.toml backend/app/services/ai_provider.py backend/app/services/ai_configuration.py
```

全部 exit 0：All checks passed!；Success: no issues found in 2 source files。

mypy 最初把测试文件也作为 target 的命令：

```bash
uv run --project backend mypy --config-file backend/pyproject.toml backend/app/services/ai_provider.py backend/app/services/ai_configuration.py backend/tests/ai_provider_support.py backend/tests/unit/test_ai_provider.py backend/tests/unit/test_contract.py backend/tests/integration/test_ai_provider_configuration.py backend/tests/integration/test_ai_channel_management.py
```

exit 2，Source file found twice under test_ai_channel_management 与 tests.integration.test_ai_channel_management，未进入类型检查。仓库 Makefile 的 mypy 正式边界为 backend/app，既有测试含动态/未标注 fixture；最终对两个修改的运行时文件定向检查，不扩大到全仓。全部修改的测试文件另以 Ruff 和 pytest 验证。首次 Ruff import 顺序/单行长度错误修正后定向重验，未重新格式化旧大文件。

### 单元与迭代证据

```bash
uv run --project backend pytest backend/tests/unit/test_ai_provider.py backend/tests/unit/test_ai_boundaries.py backend/tests/unit/test_contract.py -k 'ai_channel or ai_model or connection or credential or header or snapshot or generated_draft or url_validation or chat_completions or provider_timeout or redirect or sdk or model_list or chat_completion or invalid_model or url_input'
```

首次 exit 1：3 failed，67 passed，58 deselected；问题为 Latin-1 Header 断言需比较 wire bytes、SDK 非对象模型列表抛结构异常、Pydantic 规范化空 username。修复后同命令 exit 0：70 passed，58 deselected，2.67s。其中21个旧边界/配置投影用例的相关实现、测试和 mock 合同未再改变，复用证据；SDK 部分此后完整复验。

```bash
uv run --project backend pytest backend/tests/unit/test_ai_provider.py
```

补接 GEO E2E 配置诊断后 exit 0：52 passed，0.33s。独立审查三项问题修复后的最终 exit 0：58 passed，0.45s；覆盖 Models/Chat 公开 SDK 路径、参数、Header、Latin-1 Key、环境 Header 零发送、usage nullable、SDK异常、安全日志、禁重试、禁重定向、无DNS URL 输入及非法 UTF-8。

### PostgreSQL 与本机 HTTP

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr001@127.0.0.1:51390/postgres uv run --project backend pytest backend/tests/integration/test_ai_channel_management.py backend/tests/integration/test_ai_provider_configuration.py
```

首次 collecting 因新测试误导入 app.auth 而 exit 2，修为 app.security 后重跑。随后 exit 1：18 passed，5 failed；既有管理/Bootstrap18项通过，新 fixture 缺必填 description。修复后：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr001@127.0.0.1:51390/postgres uv run --project backend pytest backend/tests/integration/test_ai_provider_configuration.py --tb=short
```

exit 1：4 passed，1 failed；四个在途 revision 反例通过，HTTP Header 断言忽略了大小写。修复断言后只复验失败项：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr001@127.0.0.1:51390/postgres uv run --project backend pytest backend/tests/integration/test_ai_provider_configuration.py::test_sdk_configuration_http_flow_keeps_secrets_and_test_state_safe --tb=short
```

exit 0：1 passed，2.21s。

独立审查三项修复后对直接受影响范围复验：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql://psr001@127.0.0.1:51390/postgres uv run --project backend pytest backend/tests/integration/test_ai_provider_configuration.py backend/tests/integration/test_ai_channel_management.py -k 'sdk or invalid_utf8 or commits_three_phases' --tb=short
```

最终 exit 0：11 passed，15 deselected，12.11s；包含8个新 SDK HTTP/PG 用例及3个 Bootstrap 可选 Header 实序列化用例。前次既有管理其余15项的 service/数据库/测试/mock 相关输入未变化，成功证据复用；不宣称执行了全量门禁。

```bash
git diff --check
```

多次退出0，最终文档/状态收尾后再执行一次。未生成截图、trace、video 或 report。

## 未执行与限制

- 没有真实 Provider、真实凭据或 production 请求；真实兼容服务行为不由 fake 替身结果证明。
- 未运行完整 make verify、全部单元/集成/E2E、浏览器矩阵、安全扫描或部署门禁：不属于该维护切片，已选检查直接覆盖当前风险。
- 未重建 backend-test Docker 镜像：Docker daemon 不可用；新增依赖的 Linux/production 镜像构建尚未验证。无生产部署或运行 session 重载结论。
- 不改变生成、自然化或 GEO 的旧协议/网络实现；配置测试成功不替代正式生成资格/业务解析，也不授予新出站权限。
- PSR-002～007 的范围与验收仍待用户后续任务定义，仅登记 planned，不实施后继任务。

## 工作区与清理

保留任务开始前的部署/infra/AGENTS/GEO 文档修改；operations.md 原始 patch 在隔离 scratch 重放，逆除本任务两处变化后逐字节等于初始文件。GEO task manifest、根合同、ORM/Alembic 与旧客户端零 diff。

临时 PostgreSQL 启动于随机回环端口51390，每个测试使用随机 partsignal_ai_* 库。结束时查询遗留数0，pg_ctl精确停止本轮data目录并删除数据/日志/scratch；HTTP fake server context 已关闭线程和端口。最终再检查工作区及监听。Homebrew PostgreSQL与可复用依赖缓存保留，不安装后台服务；任务草稿/运行状态文件在最终交付前删除。

## 独立复核与审计

详见同目录 review.md。首轮 fresh 只读复核确认3项问题，按具体合同修复并补反例；修复候选第二轮 fresh 定向复核未发现剩余确认问题，14个独立 MockTransport 场景及范围内 diff check通过。多代理审计 Bundle：20261013T053328Z-psr-001-9b336639，最终 SUBAGENT_EXECUTION_DIGEST 已生成并通过 audit-finalize/audit-verify：2次派发、2项报告验收、2次独立复核、无异常，不从运行状态推算验收。

## 人工验收完成（2026-10-12）

用户在当前会话明确确认：“我已经人工审查并接受 PSR-001 的实现和测试证据。”据此将维护 manifest 的 PSR-001 从 review 更新为 done，同一 Trellis task 从 review 更新为 completed 并记录 completedAt。

本轮仅更新 PSR-001 状态与人工验收记录，复用已经接受的实现、测试和独立复核证据；验证命令为 `git diff --check`，不重新运行实现测试。PSR-002～007 与其他任务状态保持不变，没有后续实现、提交、推送、归档或部署。
