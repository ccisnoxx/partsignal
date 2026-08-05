# 昨日改动全站回归测试报告

> 状态：已完成。本文只记录实际观察结果。

## 1. 基线

- 目标功能提交：`e426d7b`、`949dc98`。
- 分支：`main`，任务创建前工作目录干净；当前预期改动仅为本任务 Trellis 文件。
- 功能差异：数据库迁移、后端模型/Schema/路由/服务、OpenAPI/数据库合同、前端 25 张业务表、共享删除引导、单元/集成/E2E 测试。
- 原任务记录：Session 72 摘要声称 `make verify` 通过，但 Testing 段没有保存命令、通过数、失败数或耗时，因此不作为本次通过证据。

## 2. 检查台账

| 层级 | 检查 | 状态 | 结果与归因 |
| --- | --- | --- | --- |
| 合同 | `make contract-check` | 通过 | FastAPI/OpenAPI 递归 Schema 语义一致；生成 TypeScript 与冻结契约一致。 |
| 静态 | `make lint` | 通过 | Ruff、ESLint、主题颜色检查均通过。 |
| 类型 | `make typecheck` | 通过 | mypy 68 个源文件无问题；TypeScript build check 通过。 |
| 后端定向 | 工作流/平台/AI/GEO/发布单元测试 | 通过 | 55 项通过，耗时 1.19 秒。 |
| 前端定向 | 昨日触及页面与共享删除组件 Vitest | 通过 | 13 个文件、129 项通过，耗时 235.61 秒；出现 jsdom CSS 解析提示但无断言失败，布局由后续真实浏览器检查证明。 |
| 集成 | 迁移/发布/身份/AI 渠道 | 通过 | 45 项通过，耗时 68.72 秒；Compose 测试容器正常退出。 |
| 浏览器 | 核心业务、AI、工作台、25 表 Playwright | 通过 | 独立 Redis DB 下 14 项全部通过，耗时 3.7 分钟；覆盖共享数据、AI 渠道、MVP 主链、25 表、桌面/移动、200% 缩放、键盘和 reduced-motion。首次共享 broker 失败归因见 4.1。 |
| 全量 | `make verify` | 通过 | 合同、lint、typecheck、154 项后端单元测试、185 项前端测试、24 项视觉合同测试、53 项后端集成测试、前后端镜像构建、52 项 E2E（4.9 分钟）及开发/生产 Compose 配置检查全部通过。全量 E2E 使用独立 Redis DB 7。 |

## 3. 已报告现象

### 3.1 新增平台 422

- 当前结论：后端合同正确拒绝了不合法的 `allowed_domains`；前端校验和错误位置不足，导致用户只看到“请求数据不符合接口契约”。
- 有效输入是纯主机名，例如 `example.com`；`https://example.com`、`example.com:443`、`*.example.com`、带路径的值或规范化后重复值均返回 422。
- 证据：`backend/app/schemas/configuration.py:26` 的权威规范化器明确拒绝协议、路径、端口和通配符；后端定向测试同时验证合法域名规范化与五类歧义输入拒绝。`frontend/src/features/configuration/PlatformsPage.tsx:413` 的 `Select mode="tags"` 只校验必填，创建错误则显示在页面顶部 `frontend/src/features/configuration/PlatformsPage.tsx:329`，而非“新增平台”弹窗内。
- 归因：表单、payload 与域名规范化器分别从 7 月 28 日和 7 月 23 日保持至今，昨日两次提交没有改变这条链路，因此不纳入本次代码修复。
- 严重度与影响：P3，既有可用性问题；合法纯主机名可正常创建，不影响服务端合同或数据完整性。

### 3.2 AI 渠道获取模型失败

- 当前结论：应用链路与用户提供的 `/v1` 基础地址格式无误；`backend/app/services/openai_client.py:124` 会请求相对路径 `models`、发送 Bearer，并严格读取 `data[].id`。线上持续转圈的直接原因已确认是 Hostdzire API 容器无法通过 TCP 443 回连该供应商域名，并非前端模型解析或密钥校验卡死。
- 本地 OpenAI 兼容假服务的集成与真实浏览器检查均通过：模型发现、已配置标记、添加、测试、启用、权限和错误显示有效。
- 线上审计记录 4 次 `ai_channel.models_discovered` 失败，错误码均为 `AI_PROVIDER_TIMEOUT`；Nginx 对应请求全部在 `rt=60.000` 时返回 504，并记录 `upstream timed out while reading response header from upstream`。渠道配置的 `timeout_seconds` 正好是 60，因此前端在这 60 秒内持续显示 `discover.isPending`。
- 本机和 Hostdzire 宿主机无凭据访问 `/v1/models` 分别约 0.48 秒和 0.07 秒返回 401；同一请求从 staging API 容器执行则 TCP 连接超时。容器可正常连接其他公网 443，仅目标地址失败。
- 根因：该域名在 Hostdzire 所在地区解析为宿主机自己的公网 IP `23.80.89.175`；API 容器经 `partsignal-staging-egress` 网桥回连宿主机 443 时进入 INPUT 链。宿主机 INPUT 默认 `DROP`，现有持久规则只允许 `ens3` 和 WireGuard 进入 443，没有允许 egress 网桥的精确 hairpin 流量，因此 SYN 被丢弃。
- 归因：昨日修改 typed 发现结果和弹窗展示，未改出站路径、Bearer 或严格响应解析；现有回归全部通过，不构成昨日代码缺陷。
- 严重度与影响：P1 线上基础设施缺陷；当前地理解析到 Hostdzire 本机的该供应商域名此前不可从 Docker 容器访问，所有依赖该路径的模型发现和真实模型调用都会超时。已按用户批准范围，在 Hostdzire 持久防火墙中允许 `docker0` 和所有 `br-*` Docker 网桥访问宿主机公网 IP 的 TCP 443；其他目标端口仍由 INPUT 默认策略拒绝。

#### 线上修复与复验

- 用户批准把放行范围扩展到 Hostdzire 的所有 Docker 项目。运行时 INPUT 与 `/etc/iptables/rules.v4` 已增加两条精确规则：`docker0` 和 `br+` 只能访问宿主机自身公网 IP 的 TCP 443；修改前备份为 `/etc/iptables/rules.v4.bak-20260805-133453`。
- 持久文件通过 `iptables-restore --test`，`netfilter-persistent` 保持 active。PartSignal API 容器到目标 TCP 443 从超时恢复为约 0.03 秒，固定 DNS HTTP 客户端使用无效诊断凭据在约 0.04 秒得到 401。
- 跨项目抽样：`sub2api`、`vaultwarden`、`md2word-p0`、`cliproxyapi` 和 `partsignal-staging` 五个不同 bridge 均在 0.03—0.11 秒得到 401。容器到宿主机 22/80 继续超时，443 可达；规则没有扩大其他宿主机端口。
- 公网 smoke、API ready、PostgreSQL、Redis、Nginx 配置和全部 PartSignal 容器健康检查通过。没有重启服务、修改业务数据或使用已公开的真实 API Key。
- 线上真实模型列表仍需用户先吊销旧密钥并在页面重新配置新密钥后复验；本次已经证明导致 60 秒转圈的基础设施根因消除。

### 3.3 批准内容点击“开始发布”后没有后续

- 当前结论：这是 `e426d7b` 引入的前端产品回归。目标内容版本 `fa4d5cde-4a9d-4251-96ef-a7c0146f412e` 在线上数据库中为当前 `APPROVED` 版本，来源任务仍为 `OPEN`，且没有任何 `publication_work`；点击并未发起发布命令。
- 根因：`ContentTasksPage.tsx` 在昨日开始消费 typed `primary_task` 作为按钮文案，但任务行目标仍固定为 `/tasks/<id>`，内容版本行目标仍固定为 `/content/<id>`。因此“开始发布”只会重新进入审核详情，而该页面在批准后没有发布入口，形成死路。
- 修复：内容任务 feature 按 `START_PUBLICATION`、`CONTINUE_PUBLICATION` 和 `VIEW_PUBLICATION_RESULT` 进入发布工作台；开始发布携带精确 `content_version_id`，发布工作台从服务端待开始投影恢复该版本并打开原有确认表单。没有复制表单、写命令、权限或状态判断。
- 验证：修复后的两条精确回归测试通过；两个受影响测试文件共 30 项通过；前端完整 Vitest 27 个文件、187 项通过；TypeScript 和相关 ESLint 通过。
- 严重度与影响：P1，所有从内容任务/版本主动作进入发布的用户都可能被错误导航阻断；服务端状态和历史没有损坏。

## 4. 缺陷台账

### 4.1 E2E broker 未隔离（既有测试环境问题）

- 现象：`shared-data.setup.ts:169` 轮询生成作业 30 秒，状态始终为 `PENDING`。
- 根因：`deploy/scripts/e2e-local.sh:4` 要求并直接复用调用方 `REDIS_URL`，只在 `deploy/scripts/e2e-local.sh:68` 后隔离 PostgreSQL 和对象存储；脚本于 `deploy/scripts/e2e-local.sh:89` 启动默认队列 worker。E2E worker 与常驻开发 worker 因此会消费同一个 `celery` 队列；开发 worker 抢到只含 UUID 的消息后会在开发数据库查不到 E2E 作业并返回，E2E 数据库中的记录永久停留在 `PENDING`。
- 旁证：运行时出现来自另一 Celery worker 的 28800 秒 heartbeat drift；该警告本身不影响任务执行，只证明共享 broker 中存在不同时钟环境的事件源。
- 归因：`e426d7b` 和 `949dc98` 均未修改 worker、broker 或 E2E 启动脚本；该隔离缺口早于昨日改动。首次失败不计为产品回归，也不通过放宽 30 秒超时掩盖。
- 处置：不修改产品代码；改用未占用的独立 Redis DB 后 14 项通过。临时数据库和存储已删除，开发前端已恢复并返回 HTTP 200。
- 严重度与影响：P2，既有本地测试隔离问题；可能造成并行 E2E 假失败，但不影响产品运行时。

## 5. 安全与隔离

- 不使用、记录或回显已公开的第三方 API Key。
- 集成与 E2E 使用隔离数据库/临时存储；不清扫共享开发或预发布数据。
- 未部署应用、执行远端迁移、提交或推送；远端变更仅为用户明确批准的 Hostdzire 防火墙规则。

## 6. 最终结论与剩余风险

- 已确认并修复 `e426d7b` 引入的发布主动作路由回归；服务端投影、发布命令、公共 API 和数据库合同均无需修改。
- 修复前 `make verify` 在独立 Redis DB 下完整通过，说明原测试漏掉了跨 feature 主动作目标；修复后前端完整 Vitest、精确回归、类型和 lint 均通过。
- 新增平台的前端校验/错误位置与 E2E broker 隔离是昨日提交前已存在的问题；本任务记录证据，不越权扩展修复。前者可在独立 UX 任务中让前端规则与后端域名合同对齐，后者可在独立测试基础设施任务中隔离 Redis DB 或 Celery 队列。
- Hostdzire 防火墙 hairpin 缺口已经修复并完成跨 Docker 项目复验；剩余动作只有用户吊销旧密钥、录入新密钥后执行一次真实模型发现。对话中已经公开的旧密钥不能继续使用。
- 公共合同和数据库未改变，因此无需更新 OpenAPI 或数据库合同；现有 frontend spec 已明确要求 `primary_task` 决定导航/确认流程，本次是恢复既有约束而非新增规范。Hostdzire Runbook 与 infra spec 已同步基础设施边界；没有 Python 改动，TypeScript 文件职责注释和开发者可见文本保持不变。
