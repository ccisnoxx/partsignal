# GEO-204 实施与证据

## 当前状态

completed（manifest=done），2026-10-02 本会话用户已人工审查并接受实现与测试证据。分支geo/GEO-204。依赖GEO-203=done/人工已接受。Task Brief/design/12项preflight已完成；无commit/PR/生产变更。本次验收完成，completedAt=2026-10-02，不提交或归档。工作树先前改动保留，初始文件哈希/状态和本次补丁见evidence。

## 实现

Registry只保存不可变元数据，默认manual；未知key拒绝，不按provider或名称回退。validate_profile复用闭合Schema，结果不回显配置。evaluate_profile共用配置资格，所需能力与Surface/adapter交集比较，自动模式受批准、合规、测试、环境及开关控制；绑定型API要求精确当前模型，adapter-only必须明确登记且无模型引用。

一次非敏感列查询绕过ORM缓存并禁止autoflush；凭据仅在SQL内判存在性，无返回正文/密文/Header/URL/参数。无事务提交、锁、写入、revision/状态机/幂等变化，无缓存资格。无OpenAPI/数据库Schema/Alembic变化，head仍0046；此结果不能替代发送边界的权限、分级、budget、browser session、lease、SSRF/TLS检查。

## 验证结果

- 基线：161项Surface/Settings/contract单元，46项Surface/Profile PostgreSQL通过（2条既有metadata warning）。
- 新增定向：54项单元contract、5项真实PG通过。模型/channel删除成对SET NULL后旧PASSED/ORM实例不能放行；单查询无写/无秘密正文成立。
- 初次检查发现测试别名替换误改原类名与TypeAdapter缺显式注解，已按诊断修正；保存原始失败及修后结果，没有无变化重试。
- `make contract-check`：exit 0，runtime OpenAPI与generated类型一致。
- `make lint`：exit 0，后端Ruff与前端ESLint通过。
- `make typecheck`：exit 0，后端Mypy（101个源文件）与前端TypeScript通过。
- `make test-unit`：exit 0，1096项后端单元、940项前端测试通过。
- `make test-integration COMPOSE='docker compose -p partsignal-geo204-validation -f .trellis/tasks/10-02-geo-204-collector-registry/evidence/validation-compose.yaml'`：exit 0，546项PG集成通过。6条既有SQLAlchemy metadata warning来自catalog、prompt variant、Surface/Profile迁移检查，与新Registry代码无关，原始日志保留。
- `git diff --check`：exit 0；6个新增未跟踪源码/测试另做no-index空白检查，无空白错误（exit 1表示存在新增diff）。文档SHA校验exit 0；记录见evidence/diff-check.json、new-file-whitespace.json及docs-checksums.json（cwd=docs/geo-monitoring）。

精确基线和定向命令：

```sh
env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_surface_contract.py backend/tests/unit/test_geo_configuration.py backend/tests/unit/test_contract.py
env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55444/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_surfaces_profiles.py
env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_registry.py
env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55444/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_profile_eligibility.py
```

连接地址只用于本任务独立验证数据库，凭据是合成开发值。无真实provider请求。未运行E2E、browser matrix、build/performance、未来发送并发专项：没有新增UI/用户发送流程或相应性能合同，现有单元/PG及指定门禁覆盖本次配置资格边界。PG反例是单Session已flush的真实数据库变化，不证明两个并发事务的发送隔离。

## 独立复核与范围检查

fresh critical_reviewer复核无确认阻断，具体不变量与覆盖缺口见evidence/independent-review.md。删除prd自动生成的TBD模板，保留完整Task Brief。源码与测试在复核后未改变。

审计Bundle：20261002T160351Z-geo-204-independent-review-15c3d044，summary/digest/audit-finalize/audit-verify均通过；1次执行、1次验收、1次独立复核，确认无写入，无残留活跃Worker。读取范围19个文件哈希复核期间未变；Digest副本在evidence。

本次新增源码：collectors/__init__.py、collectors/registry.py、services/geo_collector_eligibility.py、services/geo_collection_profiles.py；新增测试：test_geo_collector_registry.py、test_geo_profile_eligibility.py。文档更新README、Worker/Collector当前架构段、requirement traceability、CHANGELOG、manifest、SHA256SUMS及当前Trellis任务。已比对3579个初始文件：仅上述6份文档变化，其余初始文件哈希不变；任务目录外只有6个授权新增文件，范围证据见evidence/task-changes.json/patch。实际patch已逐项检查，无越界改动、秘密正文、隐藏回退或generated drift。

## 数据、错误与环境

无新Alembic revision、回填、seed或破坏性数据迁移，head仍0046。PG测试复用既有0046前滚与约束，46项基线包括0045→0046保留存量行及阻断降级的既有合同。没有生产数据库操作或历史记录修改。

未知adapter显式UnknownCollectorAdapter；纯策略返回内部ProfileBlocker，require_eligible抛ProfileIneligible；缺少Profile仍用既有404 NOT_FOUND。没有新增HTTP错误码或Router。快照带revision仅供调用方识别当前配置；不写revision，不引入事务、锁、状态迁移、幂等记录或资格缓存。未来发送必须在其事务/锁及授权边界重读，结果不构成发送许可。

初始Docker context=default、Colima停止。为验证启动Colima并建立专用project/container/volume，未使用共享数据库。验证完成后仅删除partsignal-geo204-validation专用资源，停止Colima并恢复default context；实际清理记录在infra-down/colima-stop/context-restore/environment-final。保留本次测试镜像作为构建缓存。

## 后续与限制

GEO-205/GEO-207/GEO-401及采集任务尚未实施；没有Plan/Worker/provider调用。测试自动注册项是明确的无I/O元数据，未注册到默认runtime。Plan preview和Worker可调用同一profile_eligibility/evaluate_profile/require_eligible，但本任务不创建消费者。后续接入仍须补发送权限、数据分级、预算、Browser session、lease及SSRF/TLS等相应边界。manifest与Trellis状态planned→in_progress→review，待人工接受，依赖任务和其他任务状态不改。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-204 的实现与测试证据。”据此仅将 manifest 的 GEO-204 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

以上实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果及已知限制，不将未运行检查改写为通过。本次只记录 GEO-204 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
