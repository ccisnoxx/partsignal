# GEO-304 实施与验收证据

## 结果及状态

依赖GEO-301在开始时逐项核实为done，记录来自manifest及人工接受的任务文件。GEO-304自身planned→in_progress→review；未标记done，未提交/推送/发布/生产迁移。沿用已存在geo/GEO-304分支；完整初始dirty清单和修改前文件见evidence/initial-status.txt、baseline/、baseline-files.json，前序任务成果保留。最终本任务增量仅以final.diff判定，不能用整个git diff代替。

## 实现及公共合同

新增GeoAnswerSnapshot和GeoAnswerCitation两表；原文完整保留空格、换行和Unicode，数据库generated SHA-256固定UTF-8。每Run唯一快照，prompt与冻结Run输入相等；未知平台/模型/版本/搜索观测为NULL。Citation按规范URL去重，保留首次原URL/标题/来源和全部实际occurrences；不同引用位置不能重叠。URL只允许HTTP(S)，处理IDNA、host大小写、默认port、空path及fragment；没有获批tracking参数清单，保留全部query，不请求目标。

根OpenAPI新增GeoRawPayloadSummary、GeoAnswerSnapshotOut、GeoAnswerCitationInput、GeoAnswerCitationOut四个闭合组件，无HTTP operation。frontend仅由make contract-generate同步generated schema.d.ts，无路由、query key、URL或页面流程变化。精确字段/约束/锁与错误以contracts/database.md为权威。

summary v1完整四键schema_version/payload_format/payload_bytes/finish_reason；仅固定枚举/整数/null，不接受任意body/Header/Cookie/Authorization、secret键或字符串叶子。schema_version布尔值拒绝，避免Pydantic Literal将True变为1；OpenAPI/Pydantic/数据库保持同一整数边界。大对象采用受控FileRecord，raw=EVIDENCE/text/plain≤50MiB，截图=OPERATION_SCREENSHOT/image/png/jpeg/webp≤10MiB；需VERIFIED、INTERNAL/RESTRICTED、verified_at和完整SHA。HEAD必须匹配实际已存size/hash/type，服务函数检查上传者，不生成公开下载链接。

## 不可变、事务与并发

Answer/Citation数据库BEFORE UPDATE/DELETE无条件拒绝，包括no-op；提交后不能追加Citation。快照/引用/Run采集事实必须同事务完整，deferred constraint检查唯一快照、prompt/collected_at、citation_count和全部位置一致；不能伪造COLLECTED或留下PENDING snapshot。采集后分析失败保留证据；自动API/BROWSER写入窗口只建立存储约束，不接Collector。

锁Run→FileRecord UUID升序，不反向锁Batch；未来Application Service持Run锁并拥有提交事务。内部文件函数无commit/状态推进，Run已有revision规则不改变，原始证据无可编辑revision。uq_geo_answers_run仲裁重复快照；本次不引入submit幂等、lease决策或Redis消息，后续GEO-305/Worker接线。

文件FK RESTRICT，非草案SET NULL/CASCADE；已引用文件身份/哈希/大小/类型/访问级别/上传者/验证时间与状态冻结。file_is_referenced新增两项实际FK；GC先锁文件、检查引用并提交DELETING再删对象，关联重新检查资格。关联先锁→GC SKIP LOCKED/随后保留；GC先声明→关联拒绝。关联同值写cleanup_after=NULL建立MVCC冲突，RR陈旧快照不能复活已被清理对象。无自动无界重试。

AppError：文件/HEAD资格422 FILE_INTEGRITY_FAILED，非上传者403 PERMISSION_DENIED，存储不可用503 DEPENDENCY_UNAVAILABLE。数据库具名23514/23505由未来命令精确映射；既有FileRecord元数据guard的55000继续保留，没有为通过测试改弱防线。Router本次未变。

## Alembic与历史

revision=0050_geo_answer_evidence，down_revision=0049_geo_batch_creation。冻结DDL/SQL在维护源中，不导入runtime ORM。先持Run表SHARE ROW EXCLUSIVE到事务结束，等待旧写事务后再预检，阻止预检/守卫安装间采集穿越。

仅加法，无旧GeoObservation回填或改写，已有冻结输入不变。旧collected_at/成功采集但无可证明原始证据时55000原子停止，禁止补空回答；真实测试模拟旧写事务验证等待锁→写提交→55000拒绝，版本仍0049且新表不存在。downgrade55000安全拒绝删证据；恢复采用前向修复/一致备份。专用空库geo304_final_head执行用户指定前滚命令成功从0001到0050，见migration-final-head.log；非空旧数据/ORM metadata与降级由集成专项验证。无生产迁移。

## 实际验证

所有命令和结果机器记录见evidence/validation-results.json。宿主命令通过UV_CACHE_DIR=.cache/uv运行；PG为专用Compose项目partsignal-geo304-validation的127.0.0.1:55454，Redis56394、fake-OSS19014，避免共用开发数据库/卷。测试使用真实PostgreSQL16和本地fake-OSS实际PUT/HEAD，无真实AI平台。

| 命令 | 结果 | 日志 |
|---|---|---|
| git diff --check | exit0 | diff-check.log |
| make contract-check | exit0，根运行时合同及generated逐字一致 | contract-check.log |
| make lint | exit0，ruff/eslint | lint-final.log |
| make typecheck | exit0，133 Python模块及tsc | typecheck-final.log |
| make test-unit | exit0，后端2686；前端1067/111 files | test-unit-latest.log |
| make test-integration COMPOSE=专用项目 | exit0，713 passed，14 SQLAlchemy warnings | test-integration.log |
| uv run --project backend alembic -c backend/alembic.ini upgrade head | exit0，空库到0050 | migration-final-head.log |
| pytest test_geo_answer_contract.py + test_geo_answer*.py | 91 passed，2 warnings | targeted-answers-final.log |
| pytest test_geo_answer_migration_precheck.py | 锁修正后1 passed | targeted-migration-lock.log |
| pytest test_geo_answer_contract.py | 摘要整数边界修正后44 passed | targeted-contract-final.log |
| pytest test_geo_answer_files.py | 实际HEAD/资格/GC 8 passed | targeted-files-final.log |
| pytest test_platform_logo_cleanup.py | 7 passed | targeted-cleanup.log |
| task.py validate 当前task | implement/check context路径有效 | trellis-context-check.log |

完整集成开始后添加/修正的合法URL和迁移锁由对应最终定向测试复验；没有重复其余未变套件。14条SQLAlchemy告警涉及既有全局metadata循环与dialect_options；同类型告警在GEO-301当前基线已出现，本次不屏蔽或扩展重构。

开始前基线：指定Run/policy/upload/storage unit662 passed；真实PG Run/migration31 passed，分别baseline-unit.log、baseline-integration.log。首次0050执行遇SQLAlchemy将SQL正则:80/:443误当bind，修改为[:]后前滚通过。原始immutable文件测试首轮预期23514，但既有metadata guard先返回55000，修正测试而不改guard。首次真实HEAD宿主fake-OSS403为本地上传签名配置与容器不同；使用相同明确的测试签名配置后通过。完整unit首轮2678 passed/5 failed是旧mock只安排三个FK查询，补齐新增两项并保留真实PG引用验证后最终2686 passed。lint首轮导入排序/超长测试SQL已修正。失败日志留档，未将首轮失败写成通过。

## 独立复核与审计

fresh critical_reviewer、fork_turns=none、只读完成复核。三项P2（SQL拒合法URL、迁移旧写穿越、冻结起点generated缺组件）均修正；复核补读最终源码与实测日志后无新增确认未修复问题。详细记录evidence/review.md；实际custom tool events来自该子代理会话metadata并逐条检查，见review-tool-evidence.json，写入证据不是自报推断。

Audit ID：20261003T024212Z-geo-304-8f3b0c4d。WorkPlan/summary/digest/audit-finalize/audit-verify均exit0；SUBAGENT_EXECUTION_DIGEST有效，1次独立复核验收通过，无残留活跃worker、未知写入或异常。模型/effort是Agent TOML配置快照，不冒充运行时遥测。

## 未运行项、限制及后续

E2E未运行：本次没有新增HTTP命令/浏览器旅程，持久化、迁移和GC在真实边界验证。真实AI、真实阿里云OSS、自动API/BROWSER提交流程和生产迁移未运行；本任务不接真实外部平台。自动写入窗口及采集后FAILED约束由源码核对，未来接线仍需要工作流验证。raw文件内容清理与截图敏感裁剪由后续信任边界实现，本次只保证闭合raw summary和受控引用，不伪装通用secret扫描器。

GEO-305人工提交/草稿/幂等，GEO-501分析，GEO-504派生分类/匹配，GEO-805浏览器截图与裁剪均未实现；GEO-306详情读模型和GEO-901保留/清除也留在后续。临时验证容器、项目网络及两项独立卷已清理，Colima恢复原先stopped状态，Docker context恢复default；对应日志见infra-cleanup.log、colima-stop.log、docker-context-restored.log。没有删除已有仓库或开发数据。

最终scope检查确认manifest只改变GEO-304、GEO-301仍done，OpenAPI只新增四组件、既有paths/schemas不变；SHA256SUMS所有条目匹配，新增源文件无尾随空白，完整git diff --check exit0。证据见final-scope-check.json、final.diff和final-status.txt。

## 修改文件列表

- [openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml) — `contracts/openapi.yaml`
- [database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md) — `contracts/database.md`
- [__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py) — `backend/app/models/__init__.py`
- [storage.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/storage.py) — `backend/app/services/storage.py`
- [file_records.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/file_records.py) — `backend/app/services/file_records.py`
- [test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py) — `backend/tests/integration/test_migrations.py`
- [schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts) — `frontend/src/shared/api/generated/schema.d.ts`
- [README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md) — `docs/geo-monitoring/README.md`
- [02-geo-core-prd.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/01-product/02-geo-core-prd.md) — `docs/geo-monitoring/01-product/02-geo-core-prd.md`
- [02-domain-model.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/02-business/02-domain-model.md) — `docs/geo-monitoring/02-business/02-domain-model.md`
- [02-data-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/02-data-architecture.md) — `docs/geo-monitoring/03-technical/02-data-architecture.md`
- [03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md) — `docs/geo-monitoring/03-technical/03-api-contract-design.md`
- [07-testing-and-quality.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/07-testing-and-quality.md) — `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
- [task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml) — `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- [CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md) — `docs/geo-monitoring/CHANGELOG.md`
- [SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS) — `docs/geo-monitoring/SHA256SUMS`
- [test_geo_batch_creation_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_batch_creation_migration.py) — `backend/tests/integration/test_geo_batch_creation_migration.py`
- [geo_citation_urls.py](/Users/sc/PycharmProjects/partsignal/backend/app/geo_citation_urls.py) — `backend/app/geo_citation_urls.py`
- [geo_answers.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_answers.py) — `backend/app/models/geo_answers.py`
- [geo_answers.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_answers.py) — `backend/app/schemas/geo_answers.py`
- [geo_answer_citations.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_answer_citations.py) — `backend/app/services/geo_answer_citations.py`
- [geo_answer_files.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_answer_files.py) — `backend/app/services/geo_answer_files.py`
- [0050_geo_answer_evidence.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0050_geo_answer_evidence.py) — `backend/alembic/versions/0050_geo_answer_evidence.py`
- [0050_geo_answer_functions.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0050_geo_answer_functions.sql) — `backend/alembic/sql/0050_geo_answer_functions.sql`
- [0050_geo_answer_guards.sql](/Users/sc/PycharmProjects/partsignal/backend/alembic/sql/0050_geo_answer_guards.sql) — `backend/alembic/sql/0050_geo_answer_guards.sql`
- [geo_answers_support.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/geo_answers_support.py) — `backend/tests/integration/geo_answers_support.py`
- [test_geo_answers.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answers.py) — `backend/tests/integration/test_geo_answers.py`
- [test_geo_answer_files.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_files.py) — `backend/tests/integration/test_geo_answer_files.py`
- [test_geo_answer_migration.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration.py) — `backend/tests/integration/test_geo_answer_migration.py`
- [test_geo_answer_migration_precheck.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_answer_migration_precheck.py) — `backend/tests/integration/test_geo_answer_migration_precheck.py`
- [test_geo_answer_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_answer_contract.py) — `backend/tests/unit/test_geo_answer_contract.py`
- [test_platform_logo_cleanup.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_platform_logo_cleanup.py) — `backend/tests/unit/test_platform_logo_cleanup.py`

任务自身：prd.md、design.md、implement.md、task.json、implement/check.jsonl 和 evidence/；原有其它dirty变更保留。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-304 的实现与测试证据。”据此仅将manifest的GEO-304从review更新为done，Trellis task.json从review更新为completed，completedAt=2026-10-02，记录接受者、范围与依据；Task Brief当前状态同步更新。

上述实施章节、原始evidence及独立复核审计保留验收前历史状态、实际验证与已知限制，不改写测试结果。本次仅记录GEO-304人工验收，不修改其他任务状态，不实现后续任务，不提交、归档或清除会话指针。SHA256SUMS仅同步manifest对应条目。

本次收尾运行git diff --check，实际结果见本轮最终报告；未重跑实现阶段测试。
