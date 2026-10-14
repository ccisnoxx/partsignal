# PartSignal 测试策略

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

## 验证选择与证据复用

本节管理开发阶段的验证选择；部署现场检查、候选与镜像身份、迁移及恢复条件以 [Hostdzire 验证选择合同](./Hostdzire部署上线流程.md#验证选择合同) 为准。下文的测试层级、领域覆盖和命令是可用能力与合同，不要求每个任务累加执行。

- 根据实际变化、受影响调用者与合同，选择最低成本且能直接观察或反证风险的检查。文档、文案或样式小改可使用 diff、链接或页面检查；不自动添加全量测试、E2E、镜像构建或安全扫描。
- 完整用户流程、认证/授权、导航、跨请求持久化或跨服务行为发生实质变化时，选择对应定向 E2E；迁移、并发、权限等边界选择直接覆盖其保证的数据库、集成或专项验证。高风险边界不自动要求测试所有无关模块。
- 小任务与功能切片按下面的手工分层命令选择检查，不每次执行完整发布验证。准备部署指定 commit 时保留并使用 `make verify-release` 完整入口；部署现场仍按 Hostdzire 合同消费有效证据并验证实际变化，重启同一已验证候选不机械重跑全套。历史一次性门禁不自动成为日常开发要求。
- 复用已成功且相关输入未变的证据；代码、测试配置、依赖、构建或环境输入变化，仅使依赖该输入的证据失效。可组合已验证基线与增量验证，但不得把旧 SHA 的全套结果记为新 SHA 已重新全套通过。
- 失败先诊断，相关修复或新证据出现后先重跑失败项与直接受影响范围；不因一次失败或生成新候选从头重跑全套。修复导致新的具体风险时再扩大范围。
- 镜像按构建输入变化重建；安全专项检查按相关安全合同变化选择。明确要求的交付门禁保留，日常任务不额外启动无关扫描。
- 完成记录说明实际变更、已执行命令与结果、复用来源及输入未变依据、有实质意义的未验证范围和残余风险；未执行、跳过或不适用不写成通过。

## 层级

- 后端单元测试覆盖状态机、账号类型、凭据加密、URL/Header 输入边界、严格模型响应、快照、生成质量规则、指标和文件校验。
- 后端集成测试使用 PostgreSQL 和 Redis，不使用 SQLite 替代数据库约束。
- 前端使用 Vitest 和 Testing Library 覆盖表单、权限、错误和状态交互。
- Playwright 覆盖批准事实到发布登记、GEO 观测、GEO 分析洞察和 AI 渠道管理主流程，并通过 Redis、真实 Celery Worker 与本机 OpenAI-compatible HTTP 替身执行生成。AI 渠道页面在 1572×999 桌面视口保存三栏验收产物，覆盖创建/编辑、换 Key、Header、模型发现、成功与失败测试、启停、筛选排序分页、统计审计、复制脱敏和删除；GEO 主流程在 1582×995 保存观测列表、详情和分析洞察产物，洞察还覆盖筛选折叠、趋势 Tooltip 与携带同一筛选的打印视图。不得用 `page.route` 固定响应替代真实 API。
- 契约检查比较提交 OpenAPI、FastAPI 运行时 Schema 和前端生成类型。
- 结构重构还需比较 ORM metadata 表集合、mapper 数、Alembic head、迁移历史和生产 preflight 输出，证明物理移动未改变数据库语义。

## 手工分层命令

默认 `bootstrap`、`lint`、`typecheck`、`test-unit`、`e2e`、`verify-release`/`verify` 不安装或执行独立 Browser 包/合同。普通前端 Playwright 与 API GEO 验收保留；Browser 专属历史测试保留为隔离资产，只有显式实验入口才执行，不构成当前质量门禁。

推荐流程：

```text
小任务完成 → check-fast 或对应语言快速检查
功能切片完成 → check-ai / check-geo / 手工选择其他领域测试
准备部署指定 commit → verify-release
```

| 层级 | 命令 | 实际范围与成本 |
| --- | --- | --- |
| 快速后端 | `make check-backend-fast` | Ruff、全 backend/app mypy、backend/tests/unit；不启动 Docker/PG/Playwright |
| 快速前端 | `make check-frontend-fast` | canonical frontend lint、typecheck、Vitest；不构建镜像或执行 Playwright |
| 快速组合 | `make check-fast` | 只组合上面两个目标，不执行 integration/E2E/build |
| AI 领域 | `make check-ai` | 官方 SDK/凭据边界、生成/自然化/dispatch/运行模式 unit；AI 配置管理与生成本机 HTTP fake + PG 集成；AI 渠道/Prompt/内容 AI 前端 unit |
| GEO 领域 | `make check-geo` | fixture 校验、Collector HTTP 合同及 secret scan、当前 GEO unit；SDK/Profile/Worker/不可重放/人工录入与分析代表 PG 集成；新 GEO 与原人工观测前端 unit。不执行 Browser、性能数据集、恢复集成或 Playwright |
| 发布 | `make verify-release` | 原完整合同、lint/typecheck/unit、全部 PG integration、GEO performance、Docker 镜像、真实栈/Playwright、部署脚本与 Dev/Prod Compose 配置检查 |

快速层仍执行现有全后端/全前端单元集合；其中后端历史 Browser 安全边界断言只验证禁用/数据合同，不启动独立 Browser Collector。领域选集以根 Makefile 为权威，开发者显式选择，不自动分析 Git diff。领域检查是代表性回归，不能替代完整发布验证。

GitHub 只用于代码备份与服务器拉取；仓库没有 GitHub Actions 工作流、CI badge、required checks 或分支保护要求，也不提供替代 CI。Docker 交付可用 commit SHA 追踪，不要求 GitHub Release 或 Git tag；镜像标签、image ID、RepoDigest 与 manifest 的不可变身份仍按部署合同核对。命令合同见 [手工验证规范](../.trellis/spec/infra/manual-quality-checks.md)。

### 领域检查前置条件

先执行 `make bootstrap` 安装测试依赖。`check-ai` 与 `check-geo` 不隐式启动数据库或完整 Compose；要求显式提供具有 CREATE/DROP DATABASE 权限的专用测试 PostgreSQL。每个现有 fixture 创建随机测试库、执行迁移并清理，不使用 SQLite 或业务库。缺少连接时 Make 明确非零；数据库不可用/权限不足时测试失败，不以 skip 冒充通过。仅使用本机 HTTP fake 和虚构凭据，不需要真实 Provider Key。

例如已有开发 PostgreSQL 监听 55432、开发对象存储监听 19001 时：

```bash
export PARTSIGNAL_TEST_DATABASE_URL='postgresql://partsignal:partsignal_dev@127.0.0.1:55432/partsignal'
make check-ai
export OBJECT_STORAGE_ENDPOINT='http://127.0.0.1:19001'
make check-geo
```

没有本地 PostgreSQL 时，可先单独启动开发 Compose 的 postgres 服务。GEO 人工录入集成必须使用实际保存字节并校验 HEAD 的开发对象存储，需显式设置 `OBJECT_STORAGE_ENDPOINT`；Make 固定这些集成使用 development 适配器，缺端点直接非零。可单独启动开发 Compose 的 fake-oss，或在另一个终端复用现有应用入口启动本地服务：

```bash
psr_geo_storage_dir=$(mktemp -d)
OBJECT_STORAGE_BACKEND=development OBJECT_STORAGE_PATH="$psr_geo_storage_dir" \
  uv run --project backend uvicorn app.dev_storage:app --host 127.0.0.1 --port 19001
```

测试进程与对象存储服务必须使用相同的 `UPLOAD_SIGNING_SECRET`；不传时沿用本地开发配置。结束后停止本次对象存储进程，并精确删除上述临时目录。不得连接生产 Bucket 或清理共享卷；使用共享开发 fake-oss 时按对象归属清理。GEO 集成命令显式设置 `PGTZ=UTC`，保持现有 PG16 容器的时间投影，使提交响应与持久化重放使用相同 UTC 表达，不修改宿主机或数据库全局时区。两个领域选集不依赖 Redis 或 Worker/Beat 进程；AI 不需要对象存储。快速层无这些前置条件。发布层仍使用既有 PG16/Redis/对象存储与完整真实栈约束。

需要容器 `/contracts` 挂载的评估/洞察合同用例留在完整集成入口，GEO 领域层使用可在宿主机执行的已有测试；人工评估的 unit/前端行为仍在选集内。

### 其他领域与旧入口

内容、发布、认证等切片直接选择现有测试文件；以下是独立示例，不要求全部执行。集成示例沿用上面的专用测试连接，涉及完整用户旅程时再选对应 Playwright spec。

```bash
uv run --project backend pytest backend/tests/integration/test_content_review.py
uv run --project backend pytest backend/tests/integration/test_publication_workflow.py
uv run --project backend pytest backend/tests/integration/test_identity_management.py
npm --prefix frontend run test -- src/domains/content/
npm --prefix frontend run test -- src/domains/publication/
```

旧 `verify` 是 `verify-release` 的直接兼容别名，仍执行完整发布集合。现有独立检查继续可用；选用完整入口时保留其全部既定流程和失败语义：

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make e2e
make build
make verify-release  # make verify 保持相同完整范围
```

测试替身必须显式配置，不能补充输入事实中不存在的参数。`deterministic` 关闭正式 AI 业务，不提供成功替身；需验证生成成功时使用本机 HTTP fake 与虚构凭据。GEO API fake provider 通过官方同步 SDK 的固定 Chat Completions 路径及原始字节严格业务解析验证；授权回调失败 SDK 不启动，成功后 timeout/connection 为 UNKNOWN、明确 HTTP 状态为 COMPLETED、同 attempt 不重放，response size 在完整接收后检查；AI 配置管理、正式生成与自然化通过官方同步 SDK 与本机 HTTP fake provider 验证 Models/Chat Completions 路径、Header、参数、零重试、错误脱敏、严格草稿/可空指标和 PostgreSQL 资格/并发复核，Profile 连接诊断同样通过官方 SDK 与本机 HTTP fake 验证权限、错误脱敏、零重试、参数及调用后依赖 revision 复核。开发对象存储必须实际保存上传字节并执行 HEAD 元数据校验。

AI 渠道管理测试必须区分协议和品牌：当前所有受控品牌都只允许登记 OpenAI-compatible 协议，品牌不能改变请求路径。PostgreSQL 集成测试覆盖旧渠道回填 `CUSTOM`、品牌—协议组合校验、服务端列表与分类数量、最近测试、正式业务作业统计和渠道审计；API Key 与敏感 Header 必须在响应、审计、复制结果、React Query mutation state、浏览器存储和截图中均不可恢复。连接测试发送后不自动重试，成功或失败都使具体模型保持停用并由管理员显式重新启用。

自然化测试不得使用原文直返或固定“成功”适配器绕过供应商边界。PostgreSQL 集成测试必须让原始生成和自然化都经过本机 OpenAI-compatible HTTP 替身，断言每个作业至多一次调用、源版本不变、新版本 `source_job_id/based_on_id` 正确、成功结果可再次自然化、重复消息不重复落库，以及调用期间源资格失效时迟到结果不能提交。迁移测试还需覆盖 Prompt 初始空表、历史 `GENERATE` 回填、类型/来源成对检查、同源活动部分唯一索引和存在 `HUMANIZE` 历史后的禁止降级。

本地 E2E 对象存储替身默认监听专用端口 `19009`，可通过 `PARTSIGNAL_E2E_STORAGE_PORT` 覆盖；API 与浏览器上传地址必须使用同一端口，避免复用代理工具常见的 `9000` 端口。

前端组件测试覆盖管理员首次保存/按 revision 更新自然化 Prompt、未配置提示、版本资格、模型选择、活动作业禁用、原快照重试和审核完整 AI 追溯。Playwright 主流程应通过 UI 完成首次配置、原始生成、自然化、新版本比较和审核；不使用 `page.request`、eager 模式或 AIGC 检测器代替被验收步骤。

第三方模型测试数据必须把绑定事实快照显式标记为 `PUBLIC`。迁移测试必须证明历史任务仍为未分级，创建、重试和 Worker 防御校验必须覆盖 `AI_DATA_CLASSIFICATION_FORBIDDEN`，不得在 fixture 中用默认值绕过门禁。

阶段二 PostgreSQL 集成测试必须同时覆盖 API 与数据库平台一致性、同平台不同账号、任务取消在途门禁、两条发布并发验证只完成任务一次、重复验证拒绝、并发发布失效唯一待办、修复上下文固定与候选复核、显式解决以及 `0013` 前滚策略。数据库反例还必须证明待办不能直接以 `RESOLVED` 插入或删除。审核测试覆盖事实/内容提交、退回、重新提交、批准的追加式历史，事实与内容的空退回意见、不可变 Markdown 快照和版本差异；阻断质量问题只属于内容审核。前端组件测试消费生成类型，验证匹配账号、服务端 `available_actions`、冻结审核上下文、显式批准和非空异常处置；不得用页面本地状态机替代服务端。

上线门禁测试在 `0012` 历史 Schema 上运行 `python -m app.cli preflight-integrity`，断言稳定 ID、原因码和非零退出；随后证明 `0013` 迁移本身同样阻断，且不产生部分表或版本前进。合法历史必须按追加式 `VERIFIED` 状态事件识别：发布后来移除时任务仍可保持完成；已显式进入拒绝、移除或验证失败的旧错绑保留历史但不再阻断。

`make e2e` 需要本机已有 PostgreSQL、Redis 和 Playwright Chromium。使用开发 Compose 基础设施时先执行 `make dev-infra`，再显式传入宿主机连接：

```bash
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/14 make e2e
```

真实栈必须独占启动前为空的非 0 Redis logical DB；DB 0、未知残留键、同库外部客户端或固定端口占用都会在创建测试数据库前失败。脚本退出时先停止并等待本次进程，只删除枚举后确认属于 Celery/Kombu 的精确键，再证明 Redis 为空、端口释放、数据库已 drop、临时存储已移除。

canonical frontend real-stack 运行统一关闭 Playwright trace，避免 API Key、密码或敏感 Header 进入失败产物；fixture-based production-artifact suite 继续保留 `retain-on-failure`。HTML report、附件、console 与运行日志同样不得包含 credential 明文。

真实 OSS、真实模型和生产网络不属于普通测试门禁。可选真实模型 smoke test 必须使用专用低权限 Key，缺少 Key 时明确跳过，不能把固定成功替身表述为真实云端成功。

行为保持重构先确认可用基线；已有成功且输入未变的证据可复用，缺少相关证据时再补充基线检查。按独立切片执行直接覆盖受影响行为的回归，最终核对证据与 diff；不因“重构完成”累加完整契约、静态检查、单元、集成、构建和 Playwright。涉及 Router、Schema/ORM 或 React Query 所有权时，分别确认无事务/实体写入、调用方直接导入权威领域模块、query key 无页面内第二来源；涉及数据库或公共契约时核对相对基线未产生未经授权的变化。完整门禁仍按本节触发条件选择。
