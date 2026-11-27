# GEO-208 实施与验证记录

## 交付状态

依赖GEO-207在manifest与人工验收Trellis记录均为done；开始前读取指定文档和权威Plan/资格/锁/触发器合同，创建19节Task Brief及设计。分支geo/GEO-208，GEO-208从planned更新in_progress。实现和本地验证完成后已更新manifest/Trellis为review，completedAt=null，等待人工验收，不自行done。大量前序未提交变化保留；evidence/baseline与starting-status.txt记录起点，candidate.diff只显示本任务增量。

## 实现与公开合同

新增12个文档操作：列表、创建、详情、完整配置PATCH、只读preview、activate/pause/resume/archive/copy/DELETE、run-now占位。根OpenAPI先定义路径与Detail/list/copy/stage/primary/action/deletion/run-entry组件，runtime检查后生成frontend类型。既有paths/schemas逐项对比原值未改变；全仓operation数197→209，精确响应签名更新而不削弱request ID/错误信封检查。Router无事务、行锁或ORM写。

新建/复制为DISABLED/revision0；客户端不可设置身份、状态或追溯。配置按集合规范顺序比较，no-op不改版本/时间/审计；实际变化恰好+1且服务器设置updater。严格四态转换；ACTIVE归档同事务pause→archive，仅一次版本与审计。ARCHIVED只读/copy，DELETE仅DISABLED、级联其关系且审计tombstone保留。资源已有FK阻止消失；结构完整但停用/暂不可运行选择可保存DISABLED/PAUSED，激活/恢复/ACTIVE实际修改才要求全部资格。Builder和204资格是唯一owner，费用默认unknown/null，无补零或猜测。

详情共用完整配置+preview和typed投影；列表q字面名称子串、status/schedule_kind闭合筛选、稳定UPDATED_DESC/NAME_ASC+UUID、page_size10/20/50。read_snapshot在认证前RR禁autoflush；计数/页/关系/资格一致快照，非空页8次、详情7次应用查询，空页2次，不逐Plan查询、不加载凭据正文。

/run要求expected_revision、Idempotency-Key，先裁决当前身份/锁/revision/ARCHIVED，再501 NOT_IMPLEMENTED标准错误。没有成功响应、Batch/Run、dispatch、命令/幂等结果或成功审计；相同key重复仍501。run_entry固定false/NOT_IMPLEMENTED，不投影RUN_NOW。

## 事务、并发与错误边界

命令RC，舍弃认证last_seen_at pending write后锁当前User FOR NO KEY UPDATE，重验账号启用/改密/角色。锁序User→Channel→Model→Product→品牌Subject→Subject→QueryTopic→Variant→Surface→Profile→Plan；旧/新集合并集按各组UUID排序。锁后重验Subject父身份、Variant主题、Profile绑定/revision及Plan初读revision/完整配置，漂移409 REVISION_CONFLICT，不扩大锁集或重试。

业务flush与4项Plan完整性SET CONSTRAINTS … IMMEDIATE先于audit；追加八个CONFIGURATION永久成功动作，只存status/revision和稳定元数据。审计不复制name/description/prompt/settings/秘密。业务与audit同事务；任何异常回滚。仅精确归档23514→GEO_PLAN_ARCHIVED、3个required约束→GEO_PLAN_EMPTY、3个资源FK23503→GEO_PLAN_REFERENCE_INVALID；未知异常继续失败，不误映射为领域错误。非法转换/资格/非DISABLED删除分别INVALID_STATE_TRANSITION/GEO_PLAN_PROFILE_INELIGIBLE/GEO_PLAN_IN_USE；明确预算超出有专用码。审计详情登记AVAILABLE/MISSING，删除后安全回看。

## 数据库与迁移

无新DDL/ORM/Alembic revision，head仍0047_geo_monitoring_plans。基线32项真实PG包含0046含旧数据前滚0047、metadata、直接SQL归档/非空/版本并发证据；新API各模块空隔离库alembic upgrade head成功。没有历史数据迁移或生产操作；0047既有拒绝有损downgrade，恢复用前向修复/迁移前备份。新命令仅改Plan四表与审计，不设置Prompt/Surface历史首次引用。不构造不存在的Batch快照证明；已创建Batch冻结由GEO-303独立实现与验收。

## 安全与前端

ADMIN/ENGINEER管理内部单租户共享Plan，created_by/updater为追溯。沿用真实session、CSRF、密码更改与账号停用边界，available_actions不是授权凭证。测试全部虚构数据；没有外部AI、网络采集或新依赖。资格loader仅凭据存在布尔投影，不读秘密正文，校验错误不回显敏感值。前端仅generated schema.d.ts；没有新路由/query key/URL状态/页面，Plan工作台及完整页面状态归GEO-209。

## 实际验证

| 命令/证据 | 结果 |
|---|---|
| env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py backend/tests/unit/test_geo_run_matrix.py backend/tests/unit/test_geo_plan_preview_contract.py | 基线108passed |
| env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55448/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_monitoring_plans.py backend/tests/integration/test_geo_plan_preview.py | 基线32passed，2个既有SQLAlchemy warning |
| make contract-generate / make contract-check | 通过，runtime全合同/generated一致 |
| 定向Plan管理+206/207单元pytest（targeted-unit.log） | 133passed |
| 定向4个新增Plan PostgreSQL文件pytest（targeted-postgresql.log） | 首轮19passed；最终完整门禁覆盖20个GEO-208用例（含追加审计关联和关系替换） |
| pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py | 修正枚举后406passed |
| make lint | 通过，ruff+frontend eslint；修改冻结枚举后另跑metadata-lint通过 |
| make typecheck | 通过，mypy117source无问题+frontend tsc |
| make test-unit | 最终后端1247passed、前端106文件993passed |
| make test-integration COMPOSE='docker compose -p partsignal-geo208-validation -f .trellis/tasks/10-02-geo-208-plan-api/evidence/validation-compose.yaml' | 通过：625passed、8个既有SQLAlchemy warning，352.90s |
| make build | frontend+backend镜像构建通过 |
| git diff --check；新增文件git diff --no-index --check | 通过，最终状态记录见git-diff-check.log/scoped-diff-check.log |

首次完整unit有4个失败：已新增12operation但既有精确数量/响应枚举未更新。保留逐操作冻结规则，追加新签名及准确总数，经406定向后重跑完整门禁通过。首次合同检查发现Detail nullable字段FastAPI省略default:null，根合同对应2字段按运行时公开形状修正，contract-check通过。新API测试编写阶段曾因模拟Profile停用忘记revision和测试提前pause造成stale断言失败；按现有数据库硬边界修正测试，没有放宽守卫。

## 独立复核与环境

fresh critical_reviewer只读复核锁序/具体交错、资格、不可变、原子审计、RR/秘密和占位，未确认缺陷；其未运行测试，不冒充最终PG结果。审计Bundle audit_id=20261002T193252Z-geo-208-plan-api-6ca03c43，plan/dispatch/execution/digest/finalize/verify均通过；evidence保存renderer原始Digest与复核证据。配置证据不是运行时模型遥测。

开始时Colima停止、Docker default context，已在授权本地验证内启动Colima并只开geo208专用PG/Redis/fake-OSS与专用test镜像，不使用或删除其他项目数据。完整门禁后已删除geo208专用容器/网络/两个卷/专用test镜像，确认没有其他运行容器后停止Colima并恢复Docker default context；environment-cleanup.log记录成功清理和colima未运行的预期状态。make build产生的通用test镜像保留为本地构建缓存。

## 未运行与限制

make e2e未运行：GEO-208没有Plan页面/路由，当前浏览器套件不能验收新Plan页面（GEO-209）；实际Plan跨请求生命周期由真实会话+PostgreSQL API集成覆盖。未运行make verify/发布部署/真实provider/Worker运行链、全浏览器矩阵、性能基准或GEO-209/301/303测试：分别属于发布阶段总门禁、明确范围外或尚不存在的能力。当前没有Batch表，DELETE不得宣称历史计数为零能证明未来安全；GEO-303须接入真实历史引用、冻结和run-now幂等存储。默认Registry只有manual，生产估价未实现。

## 本任务修改文件

- contracts/openapi.yaml
- contracts/database.md
- backend/app/main.py
- backend/app/audit_types.py
- backend/app/services/audit_logs.py
- backend/app/services/geo_plans.py
- backend/tests/unit/test_geo_monitoring_plan_contract.py
- backend/tests/unit/test_geo_plan_preview_contract.py
- frontend/src/shared/api/generated/schema.d.ts
- docs/geo-monitoring/README.md
- docs/geo-monitoring/CHANGELOG.md
- docs/geo-monitoring/SHA256SUMS
- docs/geo-monitoring/02-business/02-domain-model.md
- docs/geo-monitoring/02-business/03-workflows-and-state-machines.md
- docs/geo-monitoring/03-technical/03-api-contract-design.md
- docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md
- docs/geo-monitoring/04-delivery/task-manifest.yaml
- backend/tests/unit/test_contract.py
- backend/tests/unit/test_runtime_response_metadata.py
- backend/app/routers/geo_monitoring_plans.py
- backend/app/schemas/geo_plan_management.py
- backend/app/services/geo_plan_commands.py
- backend/app/services/geo_plan_locks.py
- backend/app/services/geo_plan_policy.py
- backend/app/services/geo_plan_queries.py
- backend/tests/integration/geo_plans_support.py
- backend/tests/integration/test_geo_plan_api.py
- backend/tests/integration/test_geo_plan_transactions.py
- backend/tests/integration/test_geo_plan_reads.py
- backend/tests/integration/test_geo_plan_concurrency.py
- backend/tests/unit/test_geo_plan_management.py

此外新增本Task Brief/design/implement、implement/check jsonl、task.json与evidence；SHA256SUMS已同步且全清单校验通过。后续GEO-209、GEO-301、GEO-303未实施。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-208 的实现与测试证据。”据此仅将manifest的GEO-208从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节和原始evidence保留人工验收前的历史状态、实际测试结果与已知限制，不将未运行检查改写为通过。本次只记录GEO-208验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
