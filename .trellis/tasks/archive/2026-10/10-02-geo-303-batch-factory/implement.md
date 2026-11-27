# GEO-303 实施与验证证据

## 交付状态与范围

2026-10-02，当前分支 `geo/GEO-303`。manifest 与 Trellis 状态均为 **review**，仅表示实现与本地验证完成，待人工验收；没有标记done、提交、PR、部署或生产迁移。开始前GEO-302、GEO-207均为done且存在人工接受记录，GEO-303原planned允许进入R2。按用户要求先输出12项preflight，再建立Task Brief/design并更新in_progress；全部本地验证后更新review。

仅实现plan/临时配置冻结、Batch+根Runs原子创建与manual/schedule identity。未实施GEO-305/306/405/705或Collector、派发、分析、指标、机会、重测、调度循环、运行页面。

## 实现与公开合同

- `geo_batches.py`为事务owner：current User授权→创建身份锁→既有资源/Plan锁→锁后资格→首次引用锁存→完整快照→Batch/主体关联/根Runs→完整性约束→最小成功审计/手工身份→单次commit。失败统一rollback，未知错误显式失败。
- `geo_batch_snapshots.py`批量安全列读取，显式转换Prompt/Topic、Profile/Surface、主体及活动alias/domain。OWN_PRODUCT使用当前Product名称，不保存事实正文；adapter_version来自已注册元数据。输入分类固定INTERNAL，不构成外发授权，不接受客户端快照/分类。
- `geo_plan_configuration.py`提供两个真实调用者共享的配置集合规范化；资格错误由现有Plan策略权威共享，不维护第二套矩阵或费用公式。
- `POST /api/v1/geo/monitoring-plans/{plan_id}/run`从501改为201稳定创建回执；required expected_revision与Idempotency-Key。
- `POST /api/v1/geo/observation-batches`接受闭合source判别联合：PLAN(plan_id,expected_revision)或AD_HOC(configuration，仅MANUAL_ONLY/null cron)。201回执仅batch_id/requested_run_count/created_at，无可变状态。
- Root OpenAPI及generated类型同步；错误响应沿用标准ErrorResponse引用与请求ID元数据。增加5个组件：GeoPlanBatchCreate、GeoAdHocBatchConfiguration、GeoAdHocBatchCreate、GeoMonitoringPlanConfiguration、GeoBatchCreated；修改GeoPlanDeletion/GeoPlanRunEntry。
- R1页面仍无运行交互；run_entry明确UI_NOT_IMPLEMENTED，计划历史删除理由增加HAS_BATCH_HISTORY。无新路由、query key、URL状态或状态机。

## 数据库与迁移

新revision `0049_geo_batch_creation`，down_revision `0048_geo_batches_runs`：

1. geo_batch_creation_requests保存identity_hash/request_hash与Batch RESTRICT FK，真实PK/unique/check和MANUAL insert guard；不保存原始key。
2. geo_batch_subjects以Batch/Subject复合PK保存冻结role，RESTRICT保护历史主体身份，支持当前真实run引用统计。
3. 两表禁止UPDATE/DELETE；主体insert必须在PLANNED锁内与plan_snapshot的ID/role匹配；新Batch INSERT的延迟完整性触发器要求全部主体关系存在。
4. 非空0048前滚按既有plan_snapshot精确回填主体关系，Batch/Run JSON逐项保持不变；metadata对齐通过。旧GeoObservation和配置不迁移。
5. 缺失历史Subject由真实FK失败而安全停止，不跳过/猜测；未单独演练该缺失历史场景。增量迁移遵守PostgreSQL事务DDL。
6. 0049主动禁止降级，保留历史并前向修复；新head的降级安全停止测试已验证。仅在隔离测试数据库前滚，未操作生产数据库。

## 业务不变量、锁与错误

- 创建按既有0048规则先PLANNED/revision0，再插入全部根PENDING/revision0/attempt1/NOT_STARTED Runs，最后QUEUED/revision1。requested_run_count从GEO-207矩阵取得，主体不参与乘法；250行分块仅控制写入大小，不产生中间提交。费用/用量未知保持NULL。
- 初次Prompt/Surface历史引用锁存与revision+1在创建事务内完成，快照记录锁存后的revision。配置后续变化不改变已冻结的计划/规则/Run输入。
- 手工锁序User(FOR NO KEY UPDATE)→哈希身份advisory xact lock→AIChannel/AIModel→Product→品牌→Subject→QueryTopic→Prompt→Surface→Profile→Plan→Batch→Runs；调度省略User。READ COMMITTED锁后重读身份/revision/资格，复用既有修改锁协议。
- 手工身份按actor UUID+key作用域；规范请求摘要包括来源与完整命令。鉴权后优先查询已提交记录，同请求重放首次结果，异请求409 IDEMPOTENCY_CONFLICT；后续revision/停用/归档不改变重放，不重复审计。两计划创建端点共用命令身份。
- 调度内部入口要求aware时间，UTC固定微秒规范化；身份不含revision。同窗口先重放，首次新窗口才要求ACTIVE CRON及当前资格。没有HTTP系统权限入口。
- 创建23505只按uq_geo_batches_schedule_window/identity及pk_geo_batch_creation_requests精确映射；资源资格/预算/缺失、stale revision与ARCHIVED使用既有GEO_PLAN_*、REVISION_CONFLICT。其他数据库失败不误映射或吞掉。
- Subject/Profile/Plan/User删除预检和投影接入真实历史；数据库RESTRICT作最终防线。手工成功审计仅plan_id/requested_run_count/trigger_type，与所有创建数据同事务；系统创建created_by=NULL，不伪造用户。

## 安全、隐私与外部边界

ADMIN/ENGINEER、当前账号状态和CSRF全部保持；拒绝客户端actor、状态、调度/重测来源、快照及分类。资格读取只投影凭据存在布尔值，不加载密钥正文；快照不保存base URL、header、密钥、cookie或Product事实正文。审计不含名称、Prompt/回答正文、原key或原始异常。创建不访问外部AI/网站，不使用Redis，也不注册未实现Collector。

## 基线与实际命令

所有日志位于evidence/，exit code由实际exec/session完成返回确认；未把运行中进程或未执行命令视为通过。

| 命令 | 结果 | 证据 |
|---|---|---|
| `env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_contract.py backend/tests/unit/test_geo_run_matrix.py backend/tests/unit/test_geo_plan_management.py` | 基线95 passed | baseline-unit.log |
| `env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55453/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_runs.py backend/tests/integration/test_geo_run_migration.py backend/tests/integration/test_geo_plan_preview.py` | 基线36 passed | baseline-integration.log |
| `make contract-generate` | 通过 | contract-generate.log |
| `make contract-check` | 通过，runtime/root/generated一致 | contract-check-final.log |
| `make lint` | 后端ruff及前端eslint通过 | lint-final.log |
| `make typecheck` | 后端128文件及前端tsc通过 | typecheck-final.log |
| `make test-unit` | 后端2642 passed；前端111文件/1067 passed | test-unit-final.log |
| `make test-integration COMPOSE='docker compose -p partsignal-geo303-validation -f .trellis/tasks/10-02-geo-303-batch-factory/evidence/validation-compose.yaml'` | 667 passed，12项已存在SQLAlchemy metadata warnings | test-integration-final.log |
| `git diff --check` | 通过 | diff-check-final.log |

定向pytest统一使用上述APP_ENV/隔离PostgreSQL/UV_CACHE_DIR前缀：

- `pytest backend/tests/integration/test_geo_batch_creation.py backend/tests/integration/test_geo_plan_reads.py -x`：13 passed（factory-final.log）。
- `pytest backend/tests/integration/test_geo_plan_api.py -x`：7 passed（api-check.log）。
- 包含`test_geo_batch_creation_migration.py`的定向组：迁移及相关49项通过后遇到待同步静态操作计数；迁移最终也包含于667全量通过（targeted.log / test-integration-final.log）。
- `pytest backend/tests/integration/test_geo_batch_creation.py::test_1000_runs_without_partial_matrix -s`：1 passed，HTTP创建1000 runs **0.729秒**，满足文档<5秒验收（1000-runs.log）；这是隔离本机测量，不声称生产吞吐。
- `docker compose ... run --rm backend-test pytest tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent`：1 passed（migration-head-rerun.log）。

首轮失败及处理：新增操作使静态/运行时操作响应计数与标准ErrorResponse引用测试需同步，已同步后全部单元通过；完整集成首轮666 passed/1 failed是新head降级测试仍期待0048旧提示，0049实际正确安全停止，修正断言后定向及完整667项通过。不是掩盖业务故障或放宽约束。迁移metadata的12项warnings与基线一致，涉及既有表排序循环和dialect_options，不影响断言结果。

## 独立复核与差异证据

critical_reviewer独立fresh只读复核，未确认实现缺陷。报告、实际只读工具记录和commands位于evidence/read-only-review.md、reviewer-tools.json、reviewer-commands.json。实际17个exec/47个只读命令，无文件、Git、数据库或外部写入。主代理按复核验收条件接受本次报告，不冒充人工GEO-303验收。

持久化Audit Bundle `20261002T215936Z-geo-303-3fe30466`：plan/guard/summary/digest/finalize/verify通过；1次实际复核执行、1次复核验收、1次独立复核，无未执行ready task、活跃残留、写入或异常。模型/effort仅为Agent TOML配置证据。运行时未提供opaque runtime_ref，保持null/unknown，未从任务名或日志ID推断。

任务起点哈希与原文本在start-files.json/baseline/；final-candidate.patch按起点记录本任务diff，change-stat.md及changed-files.md列出本轮文件。无关预存脏文件保持；根Git diff含大量前序任务变更，不全部归因GEO-303。检查实际候选无秘密、无无关重排、无兼容回退或生成漂移。

## 未执行与已知边界

- 未运行`make verify`、build、浏览器E2E/矩阵：本任务没有新增页面旅程、依赖、打包或部署行为；指定完整门禁与真实HTTP+PostgreSQL集成已覆盖创建、认证、CSRF、跨请求重放和持久化。没有声称这些命令通过。
- 独立复核未单独实测工厂等待资源锁时资格变化交错、主体完整性守卫逐项SQL反例及历史Subject缺失前滚演练；已审查共用锁和SQL失败路径，无确认反例。
- 当前已注册的可执行配置仍只有MANUAL；工厂复用资格规则，不使未实现API/BROWSER Collector可执行。输入INTERNAL不是外发授权。
- 创建不派发、不提供运行/批次读模型或页面；系统来源追溯在Batch，不新增虚构系统User。生产数据库未迁移。

## 环境与状态收尾

开始时Docker Engine不可用，启动此前停止的Colima，在专属compose project/端口/卷运行PostgreSQL16、Redis及本地fake OSS。全部测试完成后删除本任务容器/网络/卷与临时镜像；确认无其他运行容器后停止Colima并恢复原default Docker context。清理日志evidence/cleanup.log。

Task Brief/design/implement、context jsonl与task.json保留；manifest planned→in_progress→review，仅GEO-303状态变化；文档导航、权威合同与SHA256SUMS同步。不归档或提交，待人工验收。

后续只登记：GEO-304回答证据、GEO-305派发、GEO-306读模型/API、GEO-307运行页面、GEO-402调度以及GEO-405/GEO-705，本任务不实施。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-303 的实现与测试证据。”据此将 manifest 的 GEO-303 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

上述实施章节与原始 evidence 保留验收前历史状态、实际验证结果和已知限制，不改写测试或复核审计快照。本次只记录 GEO-303 人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS 仅同步 manifest 对应条目。
