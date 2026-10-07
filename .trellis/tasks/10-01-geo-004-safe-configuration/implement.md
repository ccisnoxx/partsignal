# GEO-004 实施与验证证据

## 交付状态与依赖

GEO-004 / R0：`planned → in_progress → review`，未标记 done；Task Brief 为 [prd.md](./prd.md)。唯一依赖 GEO-003 在初始 manifest 已为 done，其 Trellis completed 记录含用户 2026-10-01 接受依据；五份 ADR 为 Accepted。继续使用已存在的 `geo/GEO-004`，基线 HEAD 为 `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814`。未提交、推送、发布、交付真实配置或归档。

开始前已读取指定 GEO 文档、适用 AGENTS/spec、相关合同、迁移、完整 Settings 与进程/部署入口、生产预检和既有测试，并输出 12 项 preflight。实施前工作区没有 tracked 修改，但已有未跟踪 GEO 文档及 GEO-002/003 task；保留这些内容，只更新本任务实际涉及的记录。初始状态和文件指纹见 evidence/initial-status.txt、initial-source-hashes.json、initial-manifest.yaml。

## 实际行为与设计

| 配置键 | 默认 | 显式启用要求 |
|---|---|---|
| `GEO_MONITORING_ENABLED` | false | 总开关可单独启用 |
| `GEO_API_COLLECTION_ENABLED` | false | 总开关为 true |
| `GEO_BROWSER_COLLECTION_ENABLED` | false | 总开关为 true；不依赖 API 子开关 |
| `GEO_OPPORTUNITY_EVALUATION_ENABLED` | false | 总开关为 true |

Settings 唯一拥有默认值、布尔类型和跨字段校验。空/非法值或父子冲突明确失败，不静默纠正。生产 host 预检仅允许省略这四项；原 35 项仍需完整，unknown、空必填、secret/literal/身份与生产固定边界继续拒绝，真实 backend 配置预检保留环境与 cwd 隔离。模板共 39 键，不代表线上配置文件已更新。

API/main、Worker、Beat 已共用 `app.config.settings`；三套 Compose 的 backend anchor 已共用 env_file，无需新增配置来源或修改 Compose YAML。配置是启动快照，运行环境更新应统一重建三个进程。本轮不进行部署、热重载或运行进程改动。

R0 仅增加配置，不创建 Collector、Run、调度、机会业务、外部调用或新 Celery task。配置开启不替代服务端权限、平台合规、凭据、预算或外发资格。现有人工文章关系 GEO、洞察、优化任务与历史读取不受新开关阻断。

## 修改文件

- `backend/app/config.py`：四项默认 false 和父子校验。
- `.env.example`、`.env.production.example`：安全示例与统一重载说明。
- `deploy/scripts/check-production-inputs.py`：仅四项新增键可省略，复用真实 Settings。
- `backend/tests/unit/test_geo_configuration.py`：45 项配置与真实生产检查器测试。
- `deploy/scripts/test-geo-configuration.py`、`Makefile`：三套 Compose × 六组配置，接入现有 test-deploy-scripts 目标。
- `docs/production-configuration.md`：配置权威说明与旧 runtime 兼容规则。
- GEO 技术架构、部署运维、README、CHANGELOG、manifest、SHA256SUMS：标识已实现 R0 配置及验证限制。
- 本 task 的 prd、implement、task.json、jsonl 上下文和 evidence：实施及独立复核记录。

## 合同、迁移与业务边界

OpenAPI 和数据库合同未改变，generated types、实体、Router/Application Service 和 Alembic 源码未改。无新 revision、前滚或数据回填；在 backend 目录运行 `uv run alembic heads` 确认唯一源码 head 为 `0043_geo_platform_identity`。没有运行数据库迁移，也不将源码 head 当作数据库已前滚证据。

无事务、行锁、锁顺序、业务 revision、状态机、幂等键或并发保证变化；PostgreSQL 状态权威、Redis 稳定 ID、证据不可变与服务端裁决保持。配置错误仍为启动/host 预检错误，不新增 API error mapping；非法布尔值和父子冲突通过既有 `BACKEND_CONFIG_OR_AI_SCHEMA_INVALID` 脱敏输出。没有新增外部网络、敏感数据、凭据存储或日志；测试只用虚构配置。

前端不变：无页面、route、query key、URL、页面状态或生成类型变化。不实现 GEO-203/405 及其他后续任务，也没有新增未来容量/预算/Session 参数。

## 实际验证

原始日志与退出码位于 [evidence/checks](./evidence/checks/)。相对命令从仓库根运行，Alembic 标明例外目录。

| 命令 | 结果 | 直接证据/范围 |
|---|---|---|
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation_runtime_mode.py backend/tests/unit/test_security_and_publication.py backend/tests/unit/test_geo_insights.py` | exit 0；49 passed | 实施前当前配置/安全/人工 GEO 基线 |
| Dev/Staging/Production `docker compose … config --quiet` | 各 exit 0 | 精确命令见 baseline-compose.json；初始 staging 用 `--no-env-resolution`，最终定向脚本已完整解析虚构 env |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_configuration.py` | exit 0；45 passed | 所有环境缺省、16 组组合、非法值、启动快照、12 项生产 checker 子进程场景 |
| `UV_CACHE_DIR=.cache/uv uv run --project backend python deploy/scripts/test-geo-configuration.py` | exit 0；18 组通过 | 真实 Compose JSON 中三个服务配置一致，真实 Settings 与入口初始化无网络访问 |
| `make contract-check` | exit 0 | Runtime OpenAPI 与 generated types 一致 |
| `make lint` | exit 0 | Backend Ruff 与 frontend ESLint |
| `make typecheck` | exit 0 | mypy：80 文件；frontend TypeScript |
| `make test-unit` | exit 0 | Backend 794 passed；frontend 91 files / 861 passed |
| `make test-deploy-scripts` | exit 2；环境阻断 | 前置 frontend Docker build 无法连接 `/var/run/docker.sock`；未执行该目标后续测试 |
| `UV_CACHE_DIR=.cache/uv uv run --project backend ruff check deploy/scripts/test-geo-configuration.py deploy/scripts/check-production-inputs.py` | exit 0 | Deploy Python 不在常规 make lint 范围，单独检查 |
| `UV_CACHE_DIR=/Users/sc/PycharmProjects/partsignal/.cache/uv uv run alembic heads`（cwd=backend） | exit 0 | `0043_geo_platform_identity (head)`，只检查源码 |
| `git diff --check` 与包含新增文件的临时索引检查 | 各 exit 0 | 不修改真实 Git index；检查新增源码、文档和任务文字 |

Compose 探针在临时、虚构、0600 env 上运行；捕获 JSON，不输出 env。Python audit hook 对 `socket.connect`/`socket.getaddrinfo` 记录并拒绝访问，即使错误被应用吞掉也会断言失败。探针覆盖真实 config/main/worker 导入、Celery app 与 Beat schedule 注册、TestClient health/live；检查 settings 为同一对象、无 GEO task/job。它没有启动真实 Worker/Beat 进程。

初次探针因测试误把既有 HealthResponse.checks 的 null 写成 {} 失败，按真实 schema 修正后通过；初次 Ruff E501 已拆行，后续 lint 通过。第一次从根目录执行 Alembic 因缺少 script_location 返回 255，检查 backend/alembic.ini 后在正确目录通过。诊断、修复及退出码均保留，没有把初次失败当作应用缺陷或盲目重试。

## 未完成验证与限制

Docker Engine socket 不存在，完整部署脚本门禁、真实容器与 Worker/Beat 进程未验证。本轮已实际运行要求的 make test-deploy-scripts，不能报告通过；单独的 GEO Compose 检查无需 Engine，已通过。未实施/验证真实生产文件交付、在运行三个进程的统一重建或外部平台。

无数据路径、权限/导航/持久化或新任务行为变化，因此未新增/执行 Postgres 集成、Redis Worker 执行、Collector 或专项 E2E；指定 make test-unit 自带 frontend 单测已运行。未运行完整 make verify，其额外集成/构建/E2E 不用于证明本配置变更；缺少 Engine 也阻断容器前提。

开关为静态配置，不能撤回已发出的请求。未来 Collector/调度/机会业务须在自身调用边界使用这些开关，并分别满足权限、合规与预算规则，不能以本轮 no-egress 探针代替未来运行时 gate。

## 独立复核与最终证据

独立 [critical_reviewer 报告](./evidence/independent-review.md) 未确认代码级阻断问题，准确指出 no-egress 和 Docker 覆盖限制；没有重复成功检查。复核的写入自报与主代理哈希对账一致。生成并验证 [SUBAGENT_EXECUTION_DIGEST](./evidence/SUBAGENT_EXECUTION_DIGEST.md)；Audit ID `20261001T210943Z-geo-004-ed6dacba`，关闭及 audit-verify 均通过，无异常。

最终范围/保护文件/manifest 差异、文档链接与 SHA256SUMS、Git diff 检查见 evidence/final-audit.json：113 项文档哈希、68 条修改文档链接均通过。GEO-004 与 task.json 均为 review，其他任务依赖和状态保持初始值；SHA 清单不改写 GEO-003 冻结快照。

## 后续与安全恢复

等待人工验收。Docker Engine 可用后先运行已阻断的 `make test-deploy-scripts`，再按实际交付需求处理容器/配置重建验证。本轮不启用任何自动能力。

GEO-203（后续调度）和 GEO-405（后续机会业务）仍由各自 task、依赖和验收管理；Collector 资格等由 GEO-204 及相应业务任务负责，本轮不实施。无 schema 迁移需要回滚；若撤销本配置变更，保留旧 secret/数据库身份，并让三个进程统一关闭/恢复对应启动配置，不针对单一进程制造漂移。

## 人工验收完成 — 2026-10-01

本会话用户明确表示：“我已经人工审查并接受 GEO-004 的实现与测试证据。”据此将 manifest 的 GEO-004 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，记录完成日期、接受范围和依据，并同步 Task Brief 当前状态。

以上实施记录、review_note 和 evidence 中的 review 状态保留为提交人工验收时的历史记录。人工接受不将 Docker 环境阻断、未运行的部署脚本测试或真实 Worker/Beat 进程验证改写为通过。本次只记录 GEO-004 验收，不修改其他任务状态、不实施后续任务、不提交或归档；SHA256SUMS 仅同步 manifest 条目。

本次收尾验证：git diff --check 通过（exit 0）；五个收尾文件的独立临时 Git index 差异检查也通过（exit 0），未修改真实 index。manifest 仅 GEO-004.status 从 review 改为 done，其他任务和字段保持原样；文档哈希一致，本轮仅修改 manifest、SHA256SUMS 和本任务 task.json、prd.md、implement.md。
