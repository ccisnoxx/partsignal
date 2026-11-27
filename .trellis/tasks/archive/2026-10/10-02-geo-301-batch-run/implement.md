# GEO-301 / R2 实施证据

## 交付和范围

依赖 GEO-208、GEO-002 经 manifest 与人工接受记录确认 done。工作分支已有 geo/GEO-301；本任务 planned→in_progress，全部本地验证完成，已更新 review，等待人工接受。未提交、推送、PR、发布或操作生产数据库；保持前序未提交成果。

新增独立回答级 `GeoObservationBatch` / `GeoObservationRun` 两表、21个 OpenAPI components、Pydantic 快照/状态/错误组件和 generated 类型。批次、运行、attempt、lease、dispatch、revision、错误、时间、provider、用量及费用元数据齐全；不接线 HTTP 运行命令、AnswerSnapshot、Collector、机器分析、指标或机会。

权威文件为 `contracts/openapi.yaml` 和 `contracts/database.md`。完整增量文件清单见 evidence/changed-files.json；evidence/geo301.patch 是相对开始时副本的实际增量（不是把前序 dirty tree 误算为本任务）。根合同和generated均纯追加组件，旧API paths与已存在components保留；其他旧文件改动仅模型登记、head测试预期、固定0047历史迁移测试、问题CRUD不创建执行记录断言和相关GEO文档。

## 业务不变量与公共合同

- 输入 snapshot version1 冻结实际 prompt/topic、profile/Surface、subjects/alias/domain、规则 revision、PUBLIC/INTERNAL/RESTRICTED；数据库拒绝改身份/快照、扩展秘密键或把标量替换成秘密对象。Pydantic 完整校验全部字段，SQL负责安全闭合外壳、核心配置和身份。
- cell 为稳定 prompt UUID × profile UUID × repeat(1..10)，生成 SHA256；batch/cell/attempt 唯一。后继恰好 +1、同 cell/Batch/完整输入，前序必须已存在且是采集阶段 FAILED/BUDGET_BLOCKED；唯一 previous 禁止分叉。
- 四种 Run 终态全行冻结，无实质变化更新保留revision；旧失败记录不删除。分析失败只重跑独立 AnalysisRevision，不创建采集后继。
- `requested_run_count` 计初始 attempt1 cell，提交时精确相等，后继不扩张该数量。Batch status/时间/revision 是可重建缓存，依赖完整runs和最新attempt，不是第二事实源；投影策略仍属于GEO-302。
- 调度唯一(plan_id,scheduled_for)与partial schedule_identity，均不依赖计划revision；历史 FK RESTRICT，无旧身份置空/级联。
- RUNNING/ANALYZING 的 lease 成对且必需，其他阶段无 lease；token仅内部，不在公共组件。已发送/未知外部调用不回 NOT_STARTED；费用/用量未知保持NULL，不补零。

## 0048 迁移和恢复

revision=`0048_geo_batches_runs`，down_revision=`0047_geo_monitoring_plans`。DDL与SQL冻结在版本文件和0048专属SQL，不导入运行时ORM。只expand新两表、索引、函数和触发器，零历史回填、零旧GeoObservation改造。空库前滚成功；定向测试从0047的非空真实旧观测前滚，逐行保持一致，两表metadata无差异；完整迁移测试验证current head和账号幂等。

生成列的固定UTF8/ASCII SHA256函数明确IMMUTABLE，避开PostgreSQL通用convert_to的STABLE标记。downgrade以55000明确拒绝删除历史；安全停止与恢复使用前向修复或迁移前备份。本次没有生产前滚。

## 事务、锁与错误边界

初始Batch和全部roots必须一个事务提交，deferred constraint检查总数；Run INSERT先锁Batch并同值UPDATE父行建立MVCC冲突，再锁前序KEY SHARE，以命名唯一键仲裁。RC/RR并发不能扩张已提交初始矩阵。未来Application Service必须沿现有资源→Plan→Batch→Run锁序接入创建、资格、历史锁存、审计与postcommit稳定ID投递；本任务没有Router事务/ORM写入。

实际可变字段更新revision恰好+1，终态/输入更改23514；unique23505。根合同列出未来精确错误映射，未知约束不能吞错或默认成功。命令Idempotency-Key持久化和完整状态动作留GEO-302/303；本任务只提供调度/采样/后继数据库唯一边界，没有假装实现HTTP错误映射。

## 安全、前端和后续接线

没有外部AI/网络采集、秘密配置、新权限体系或安全边界放宽。created_by是共享单租户业务历史追溯，不代表私有归属。明确分级不授予外发许可。summary只用于批准的静态非敏感错误，未来执行端必须继续脱敏供应商异常/正文。

前端只更新generated OpenAPI，路由、query key、URL状态、页面交互均无本任务变更。现有Plan run-now仍501、没有可用RUN_NOW动作。

GEO-303仍需装配实际快照并接线资源历史锁存/引用投影、角色/资格/审计；source_opportunity_id仅稳定UUID，GEO-702建立实体后追加FK，RETEST命令尚不可用。GEO-302拥有状态纯策略/动作，GEO-304拥有答案/引用/文件，GEO-401拥有Collector协议；没有提前实施它们。

## 实际验证

基线（编码前）：

| 精确命令（UV_CACHE_DIR=.cache/uv） | 结果 |
|---|---|
| uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py backend/tests/unit/test_geo_run_matrix.py backend/tests/unit/test_geo_surface_contract.py | 162 passed |
| APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55451/partsignal uv run --project backend pytest backend/tests/integration/test_geo_monitoring_plans.py backend/tests/integration/test_geo_surfaces_profiles.py | 73 passed，4个既有SQLAlchemy warning |

最终门禁：

| 命令 | 实际结果 / 日志 |
|---|---|
| git diff --check | 通过；diff-check.log。新增文件另检查实际增量patch空白 |
| make contract-check | 通过；运行时合同检查及generated一致，contract-check.log |
| make lint | 通过；backend Ruff与frontend ESLint，lint-final.log |
| make typecheck | 修复枚举间接导入后通过，119 Python源文件及frontend tsc，typecheck-fixed.log |
| make test-unit | 退出0；backend 1281 passed。最初frontend只启动行无汇总，后补结构化真实证据，见下行 |
| npm --prefix frontend test -- --maxWorkers=4 --reporter=json --outputFile=/Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-02-geo-301-batch-run/evidence/frontend-unit.json | success=true；1067 passed、0 failed，frontend-unit.json/log |
| make test-integration COMPOSE='docker compose -p partsignal-geo301-validation -f /Users/sc/PycharmProjects/partsignal/.trellis/tasks/10-02-geo-301-batch-run/evidence/validation-compose.yaml' | 656 passed、10个既有SQLAlchemy metadata warning；test-integration-fixed.log |
| APP_ENV=test DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55451/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head | 通过，最终隔离空库0→0048；alembic-final-upgrade.log |
| APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55451/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_runs.py backend/tests/integration/test_geo_run_migration.py backend/tests/unit/test_geo_run_contract.py | 65 passed、2个既有metadata SQLAlchemy warning；run-final-targeted-fixed.log |

没有运行真实provider、浏览器矩阵、E2E或生产迁移：本次没有新增可运行HTTP旅程、页面或外部集成，不以这些未运行项宣称通过。用户最低命令均已实际执行，默认开发Compose未用于集成，使用本任务专用服务避免触及既有数据。

## 失败诊断与收敛

- 初次0048生成列拒绝非immutable convert_to：确认PG SQLSTATE后限定固定ASCII输入/UTF8函数，新的空库前滚与metadata通过。
- 初始deferred trigger用CASE访问不同NEW record结构报UndefinedColumn：改独立IF分支；原子commit反例通过。
- 初始测试把不可变repeat/attempt通过UPDATE送入CHECK，先被immutable正确拒绝：改INSERT验证数值边界；不是放宽守卫。
- 独立审查确认 child-first bulk插入漏洞；先运行回归得到DID NOT RAISE，再改不存在即拒绝，修复后通过。
- 独立审查确认JSON叶子/集合项秘密对象；补标量/UUID与确切keys，三模式正例和具名CHECK负例通过。
- 合法Product最长展示名321被新快照误限240：修正321并以真实payload验证，与OpenAPI/generated同步。
- 作者阶段工具脚本误用系统Python缺yaml、字节/字符offset造成fixture语法错误及组件追加锚点导致重复YAML key：使用项目解释器、恢复最小fixture并按完整原前缀追加；contract-check/完整tests/lint/typecheck验证最终来源。
- 首次集成Compose漏-p导致另一项目争用56391：清理仅本次误建项目，统一显式项目名后运行；没有复用或破坏前序数据库。

## 独立复核与Trellis

一名fresh critical_reviewer只读复核公共合同、持久化、attempt、JSON、锁与deferred count。报告3项有效发现均由主代理修复并实际验证；审查自身不执行写入/迁移/并发测试。完整工具读取证据与处置见evidence/read-only-review.md、reviewer-tools.json；最终digest与audit-verify通过，audit_id=`20261002T204716Z-geo-301-1cd3cb74`。验收的是只读报告交付，不是人工业务done。

Task Brief为prd.md，设计为design.md，必要spec/ADR索引为implement/check.jsonl；基线、增量diff、全部实际命令和失败日志均在evidence。task.json与manifest在所有门禁完成后仅更新review，不归档、不清除当前任务、不影响其他任务状态。

隔离环境：Colima从停止状态启动，PG16:55451、Redis:56391、fakeOSS:19011，专用project/volumes；本次专用project与volume已清理，恢复Colima停止/default Docker context；精确结果见evidence/infra-cleanup.log与colima-stop.log。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-301 的实现与测试证据。”据此仅将manifest的GEO-301从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节和原始evidence保留人工验收前的历史状态、实际测试结果与已知限制，不将未运行检查改写为通过。本次只记录GEO-301验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
