# I04-1R 设计

## 决策

采用“deploy 状态 owner 内新增 bootstrap 子命令 + backend maintenance orchestration”。不新增 migration、HTTP endpoint、临时公网入口、seed password handoff 或独立 host script。`deploy/scripts/prepare-production-data.py` 继续是部署阶段、候选身份、维护锁和持久 attempt 的唯一 owner；backend 只拥有 AI 配置业务事实。

## 状态所有权

`PRODUCTION_PREPARED` 属于 `deploy/scripts/prepare-production-data.py` 的持久状态文件与候选绑定，不迁入 backend。host-side `bootstrap-ai` command 在整个交互、backend 调用和结果落盘期间持续持有既有 maintenance lock，验证 run ID、manifest/candidate identity、phase 与实际运行 API 容器身份。backend command 不接受 phase flag 或“已验证”布尔值。

目标 API 容器按完整 container ID 执行 `docker exec -i`，不分配容器 TTY，不启动 one-off service，也不执行 `run/up/pull`。只读取安全 Docker metadata：固定 Compose project/service label、running 状态、实际 `.Image` 与 candidate backend image ID，以及不存在覆盖应用代码的异常 bind mount；禁止读取或输出 `.Config.Env`。

cutover state 新增无 secret 的 `ai_bootstrap_attempt`：host 生成固定格式 `production-bootstrap-<uuid>` request ID，在 backend 启动前原子写入 `STARTED`。任何已有 attempt 都拒绝再次执行；收到完整、合法且成功退出的结果才写 `SUCCEEDED`，明确失败写 `FAILED`，未知结果保持 `STARTED`。`verify-prepared`/activation 拒绝 `STARTED` 或 `FAILED`，且不提供 force-clear。该字段只控制部署重入，PostgreSQL 仍是 AI 配置事实 owner。

## Secret boundary

credential owner 在 Hostdzire 交互式终端由 host-side command 使用 `getpass` no-echo 输入。必须存在真实 TTY，任何 echo fallback warning、EOF、Ctrl-C 或读取失败均拒绝继续并恢复终端状态。secret 允许经过 host 进程内存、内核 pipe、Docker exec transport、backend/provider buffer，最终仅以 `CredentialCipher` 产生的密文持久化；禁止 argv/env/file/log/JSON output 携带值。两层 command 都不得输出完整 validation/SQL/subprocess exception、traceback、provider response body 或 payload repr。测试通过注入 reader/pipe，不放宽 Production CLI。

backend stdin 使用有长度上限、严格键集合且要求完整 EOF 的结构化 envelope。第一版不支持自定义 Header，避免扩大 secret 输入面。非 secret 输入显式包含 channel name/description/protocol/brand/base URL/timeout 与 model display name/exact model ID/request parameters；复用现有 schema，并继续拒绝保留 request parameter。

## AI bootstrap transaction

实现必须复用 `AIChannelCreate`、`AIModelCreate` 和 `app.services.ai_configuration` 的现有校验、加密、审计、测试及 enable 门禁。fresh 的定义是账号和迁移已经初始化、全局 AI channel/model/header 空集；任一既有 AI 配置都 fail closed。

当前 create/enable service 各自提交，不能直接串联。实现提取不提交的内部事务参与函数，并由既有 HTTP wrappers 保持原提交行为。bootstrap 固定为：

1. T1 创建事务：锁定并验证固定 `username=admin` actor（ADMIN、active、非异常强制改密状态），确认全局 AI 配置空集，创建 disabled channel 与 disabled/UNTESTED model，追加两条既有 SUCCESS audit，一次提交。
2. T2 外部测试：调用现有 `test_ai_model`，保持 provider 网络调用在数据库事务之外、at-most-once 和 revision 冲突检查；结果持久为 PASSED 或 FAILED，model 仍 disabled。
3. T3 启用事务：要求 T2 返回 PASSED，以冻结 revision 同时启用 model/channel 并追加两条既有 SUCCESS audit，一次提交；任一步失败全部回滚。

固定 admin 只是 host root maintenance 操作的业务审计归属，不表示浏览器认证，也不读取其 seed password。connection test 和失败不进入永久业务审计；model test state 用于调查。

provider 明确失败后保留 disabled 配置与 FAILED 状态，host attempt 为 FAILED；进程中断可能留下 UNTESTED 与 STARTED；revision 漂移保留并发事实并拒绝继续；T3 已提交但 host 未收到输出时仍视为 operator 未确认，禁止 activation 与重试，只能只读核对或恢复。

## Evidence provenance

原始 session JSONL 保持只读。任务 evidence 保存实际 custom tool call input/output 的字节内容、call ID、session file identity/SHA-256 和逐文件 SHA-256；另做真实本地 OSS 值 equality scan，只输出匹配计数。证据文件不作为可执行部署工具，也不重跑远端写操作。

## Stop boundary

任何实现若需要公共 HTTP API、migration、直接 SQL、seed password 导出、credential 文件或 env 注入，必须停止并重新评审。本任务不执行远端 bootstrap/cutover。

## 输出合同

host 与 backend 只允许固定 status 枚举，以及 request ID、channel/model UUID、revision、test status、enabled/configured 布尔值。禁止名称、URL、model ID、request parameters、Header、credential 长度/摘要/片段以及 provider body。host 不原样透传 backend stderr。

bootstrap connection test 只证明该 model 在隔离实现路径中的真实连接测试能力；它不自动证明正式生成链路、OSS 或浏览器验收，也不把完整 External Services Gate 标记为 `MET`。

## CLI signatures

Host entry：

```text
PARTSIGNAL_VERSION=<manifest-release-id>
PARTSIGNAL_BACKEND_IMAGE=<manifest-backend-image-repository>
PARTSIGNAL_FRONTEND_IMAGE=<manifest-frontend-image-repository>
python3 deploy/scripts/prepare-production-data.py bootstrap-ai <run_id> <absolute_manifest>
  --channel-name <name>
  --channel-description <description>
  --protocol-type openai-compatible-chat-completions
  --provider-brand <OPENAI|ANTHROPIC|GOOGLE|AZURE_OPENAI|ZHIPU|QWEN|CUSTOM>
  --base-url <https-url>
  --timeout-seconds <10..600>
  --model-display-name <name>
  --model-id <exact-id>
  --request-parameters-json <JSON-object>
```

三个 `PARTSIGNAL_*` 环境变量也是显式非 secret 候选身份：`PARTSIGNAL_VERSION` 必须等于 manifest release ID，`${PARTSIGNAL_BACKEND_IMAGE}:${PARTSIGNAL_VERSION}` 与 `${PARTSIGNAL_FRONTEND_IMAGE}:${PARTSIGNAL_VERSION}` 必须分别等于 manifest 的完整 backend/frontend image reference。两个 `*_IMAGE` 变量本身填写不带 tag 的 image repository；每次 invocation 都显式提供，不依赖上一条 `clean-init` 命令的临时环境。其余参数均为显式非 secret 配置；API Key 不存在参数或环境变量入口，只能由 `getpass` 读取。container entry 固定为 `python -m app.cli bootstrap-production-ai`，只从严格 stdin JSON envelope 读取。

## 最小变更面

- `deploy/scripts/prepare-production-data.py`：host 入口、持锁、attempt、容器身份、TTY/pipe 与输出投影。
- `backend/app/cli.py`：严格 stdin 协议、Production 配置加载与脱敏输出。
- `backend/app/services/ai_configuration.py`：可组合事务参与函数与 bootstrap 编排。
- backend/deploy unit、PostgreSQL integration、PTY/no-disclosure 与 deploy regression tests。
- Hostdzire runbook、AI/Production delivery spec 与 I04/I04-1/I04-1R 任务记录。

不修改 Compose、ORM、CredentialCipher、HTTP client、OpenAPI 或 migration；若实现需要这些边界，立即停止并重新评审。
