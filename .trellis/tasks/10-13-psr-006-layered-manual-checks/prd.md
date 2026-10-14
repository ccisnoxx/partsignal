# PSR-006 Task Brief

## 目标、依赖与授权

建立快速、领域、发布三层手工验证，删除未使用的 GitHub Actions。PSR-005 在维护 manifest 为 done、Trellis 为 completed，人工接受记录已核实。当前分支 build/PSR-006-layered-manual-checks，HEAD 9b588544；工作区有前序 SDK、Browser 默认入口治理与部署修改，本轮保护其全部内容。不提交、推送、部署、调用真实 Provider 或实施 PSR-007。

质量验证由开发者手工选择，GitHub 只用于代码备份与服务器拉取；不增加 CI、required checks、分支保护、Release/tag 或 diff 自动推断系统。部署指定 commit 前保留完整验证入口，完整执行归 PSR-007。

## 开始证据与现有依赖图

已读取根 AGENTS、RTK、Trellis workflow、infra/后端/前端质量规范、PSR-005 PRD/implement/人工接受记录、Makefile、workflow、测试与开发文档。扫描 deploy/scripts 全部维护脚本完整内容、入口结构、外部调用与依赖；清单见 evidence/scripts-inventory.json。相关 pytest 的 PostgreSQL/fake-provider fixture 与 npm 权威脚本已检查。

| 当前目标 | Make 依赖 / 运行边界 |
| --- | --- |
| bootstrap、contract-generate、contract-check | 无前置；uv/npm 安装、API 生成/漂移检查 |
| lint、typecheck、test-unit | 无前置；双语言静态检查和 unit |
| dev、dev-infra、migrate、initialize-accounts、down | 无前置；开发 Compose 服务/数据库/账号操作 |
| test-integration | 容器内全 integration，recipe 调用 test-geo-recovery-integration |
| test-geo-recovery-integration | 开发 PG/Redis 与显式 PG16 工具 |
| build | build-frontend，之后 backend Docker build |
| build-frontend | canonical frontend Docker build |
| test-frontend-container | build-frontend，之后真实容器 smoke |
| e2e | 本地真实栈、API GEO 三阶段、canonical Playwright |
| test-deploy-scripts | test-frontend-container、test-geo-recovery；recipe 调用 test-upgrade-recovery |
| verify | contract-check lint typecheck test-unit test-integration test-geo-performance build e2e test-deploy-scripts；Dev/Prod Compose config |
| test-geo-fixtures、test-geo-collector-contract | 无前置；离线 fixture / 本机 HTTP Collector 与 secret scan |
| test-geo-performance、test-geo-capacity | 无前置；容器内专项 PostgreSQL 数据集/性能 |
| test-geo-recovery | 无前置；恢复单元与脚本 Ruff |
| test-upgrade-recovery、test-upgrade-recovery-compose、test-production-routine | 无前置；部署/恢复专项，其中 Compose 入口操作真实 Engine |
| staging-redeploy-fast、production-check/prepare/activate/smoke/restart | 无前置；真实部署操作，保持原行为 |
| check-browser-experimental | 独立历史 Browser 包/配置；recipe 调用 test-geo-browser-contract |
| test-geo-browser、test-geo-browser-contract | 无前置；显式历史实验，不被默认目标依赖 |

成本来源为全 PostgreSQL 迁移/集成、Docker 镜像、真实栈与 Playwright；不为测时运行全量。Docker daemon 不可用；本轮领域检查使用已安装 Homebrew PostgreSQL 17 临时回环实例，不冒充 PG16 发布证据。

## 新目标与兼容设计

- check-backend-fast：现有 Ruff 全 backend、mypy backend/app、backend/tests/unit。
- check-frontend-fast：现有 frontend lint/typecheck/test；check-fast 依赖两个快速目标，无 integration/build/E2E。
- check-ai：SDK Adapter/边界、生成/自然化/dispatch/运行模式 unit；现有 AI 配置与生成 HTTP fake + PG 集成；相关 configuration 与 content AI frontend unit。
- check-geo：复用 test-geo-fixtures/test-geo-collector-contract；其余当前 GEO unit；SDK/Profile/at-most-once/人工录入/分析代表 PG 集成；新 GEO 与原人工观测 frontend unit。排除 Browser 专属文件，不接入性能、容量、恢复或完整 E2E。人工评估的 unit/frontend 保留，需要 /contracts 容器挂载的评估集成文件留在发布层。
- 领域命令要求显式 PARTSIGNAL_TEST_DATABASE_URL，缺失直接非零，不让 fixture 的 skip 冒充通过。不隐式启动 Docker、不推断 diff，不新增重复脚本。
- GEO 人工录入要求已启动的本地开发对象存储与显式 OBJECT_STORAGE_ENDPOINT；集成命令固定 development 和连接级 PGTZ=UTC，维持容器的真实文件与 UTC 表达合同，不改全局配置或业务代码。首轮检查后的环境证据与选集调整见 implement.md。
- verify-release 原样保留现有 verify 前置及两项 Compose recipe；verify 为直接依赖别名，其余旧入口保持。
- 未预设新的内容/发布/认证 aggregate；文档给出已有真实路径的手工过滤示例。

## 删除与文档

删除 .github/workflows/ci.yml、仅服务它的 infra/ci-execution.md；新增手工验证规范并更新索引/测试文档链接。当前文档移除 checks_group、手动 Actions 使用教程与失效说明。未发现 badge/required checks 配置；历史迁移、Trellis、GEO 交付证据不重写。保留本地 Make/Docker/Compose/PostgreSQL/Redis/Playwright/deploy 资产，无替代 CI。

计划修改 Makefile、workflow、README、docs/testing.md、docs/development.md、Hostdzire Runbook 当前说明、infra 规范及索引、GEO 当前测试说明/CHANGELOG/SHA256SUMS、维护 README/manifest、两处本地脚本过期 CI 注释，以及本任务记录。业务代码、公共 OpenAPI、数据库合同、ORM/Alembic 均不改。

## 验收、风险与停止条件

执行 git diff --check；make -n check-backend-fast check-frontend-fast check-fast check-ai check-geo verify-release verify；实际执行四个快速/领域目标；确认所有选定文件存在、无 Browser 专属依赖、verify 与 verify-release 展开相同且发布内容与基线完全一致；搜索当前 Actions 教程/链接/字段残留，并分类历史事实。必要时以隔离命令替身验证失败传播，不创建业务新测试。

重点防止领域漏选、缺 PG 后全部跳过、发布依赖或 recipe 丢失、覆盖前序 work。必须修改业务/数据库合同、无法保护前序修改、依赖不再 done 时停止并 blocked。检查失败先诊断，相关输入或证据未变不重跑；环境限制与未执行不写成通过。完整 verify-release 执行属于 PSR-007。

完成维护 manifest 与 Trellis 置 review，记录实际命令/结果/复用/未执行/限制。临时基线、PG data/log 与进程精确清理；正式审查证据保留在本 task。
