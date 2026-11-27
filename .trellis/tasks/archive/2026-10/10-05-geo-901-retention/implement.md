# GEO-901 实施与交付证据

状态review；当前分支geo/GEO-901；GEO-707 done及人工接受已核对。仅GEO-901，无提交、推送、PR或生产操作。

## 实现与合同

复用FileRecord权威服务。全部七项真实FK在SQL LIMIT前排除、File SKIP LOCKED后重验，保护所有引用证据与元数据并避免扫描饥饿。新期限只作用于cleanup_after为空的VERIFIED未引用文件；EVIDENCE/text/plain保守当作raw，其余当作孤立文件，截止<=verified_at对应批准期限。既有显式期限/上传未完成/失败/中止及DELETING继续原权威生命周期。

终态MANUAL、NOT_STARTED、无Answer且到期的FAILED/CANCELLED/BUDGET_BLOCKED草稿才能清理；PENDING/新鲜草稿保持，正式回答历史不清理。每Run独立事务，Run→Draft→Files按UUID锁序，墓碑+草稿删除+最后引用解除的七天期限原子提交。Run状态与revision不变，draft_revision写墓碑，无新状态机或ABA重置。

File先提交DELETING，事务外幂等storage.delete，再完成DELETED；StorageUnavailable只记录ID/数量并保留重试。存储删除成功但DB完成失败同样保留DELETING；下轮缺失对象删除幂等。相同墓碑被并发重试时已DELETED接受完成事实；未知DB失败继续上抛，不吞错或假成功。没有新增HTTP错误映射或授权入口。

dry-run在RR快照只读，不写墓碑/期限/状态、不创建storage adapter、不调用对象存储。每类batch1..1000，默认100，周期3600秒；Redis无正文、路径或策略payload。默认新任务dry-run=true，三项保留天数默认None，必须先由数据负责人批准再由管理员启用；raw90..180、终态草稿1..3650、孤立7..3650天。生产输入五项明确可选白名单，旧runtime兼容，未知/非法仍失败。原cleanup_platform_logo_files实际到期清理不受新dry-run影响，预览不能暂停该旧任务。

OpenAPI及generated类型与初始SHA相同，前端路由/query key/URL/页面状态均无修改。Database增加geo_manual_draft_tombstones（run_id PK/RESTRICT FK、draft_revision、draft_updated_at、retention_days、DB purged_at），只留低敏metadata，不存正文/URL/文件内容。插入守卫锁Run/Draft验证真实过期；延迟守卫要求同事务删草稿；UPDATE/DELETE/TRUNCATE禁止。两项新增索引与ORM一致。

## Alembic与安全停止

0064_geo_retention接0063；冻结SQL，不编辑旧migration。空库head及0063非空答案前滚均实测，答案逐行保持、无回填/历史迁移或生产DDL。lock_timeout=5s、statement_timeout=120s，DDL事务超时原子失败。downgrade以55000拒绝破坏墓碑；实测版本仍0064。恢复新任务dry-run或停止Beat/Worker、保留schema与历史并前向修复；已删除临时字节无法靠downgrade恢复。备份/恢复演练属于903，未实施。

## 业务、安全与Browser边界

未改变MANUAL/API指标公式、资格、Answer/引用/analysis/review/current/cost/opportunity/retest数据、安全守卫、CSRF/SSRF/TLS/凭据或内容不可变合同。Router无事务/写入变更，无真实AI平台调用；测试使用本地字节存储与隔离PG/fake OSS，runtime检查仅虚构输入。日志不打印object key、正文、URL、底层存储异常或凭据；墓碑仅UUID/revision/时间/期限。

本机实际Settings：Browser=false，session root/公钥/服务能力均未配置；Docker无运行Browser服务、无Browser匹配volume；显式localhost:55432开发库to_regclass无geo_browser_sessions。隔离测试材料在测试容器/临时DB创建并清理，未挂载运营会话卷。依据browser-materials.json与browser-volume-names.log；rg无匹配退出1仅表示无匹配卷名，不能当作命令成功输出。Browser临时清理本轮N/A仅适用于已检查开发环境，不能推断生产或其他环境无材料。实际部署/材料存在时须重新检查并执行802保护/撤销/PURGE，ADR-006不豁免；生产false/无会话由904/906实测。

## 实际验证（精确argv/exit/耗时见同名evidence/*.json与*.log）

| 命令 | 实际结果 | 证据 |
|---|---|---|
| git diff --check | exit0 | diff-check.json/log |
| make contract-check | exit0 | contract.json/log |
| make lint | 最终exit0；后加Schema测试一次103列失败，纯换行后通过 | lint-candidate-fixed.json/log，之前失败保留 |
| make typecheck | exit0（修正引用预过滤后的最终app） | typecheck-final.json/log |
| make test-unit | exit0：Browser13、backend3736、frontend1285；时间点在独立复核三项修正前 | unit.json/log |
| uv run --project backend pytest backend/tests/unit/test_geo_configuration.py backend/tests/unit/test_geo_retention.py backend/tests/unit/test_platform_logo_cleanup.py | 修正后三类相关66通过 | configuration-after.json/log |
| make COMPOSE='docker compose -f .trellis/tasks/10-05-geo-901-retention/evidence/compose.yaml' test-integration | 完整首次1146通过、8失败，exit2；非全绿 | integration.json/log |
| 同隔离compose run --rm backend-test pytest（最终9个定向选择见integration-repaired.json） | 48通过，exit0；覆盖完整8失败节点和11个新保留用例、29旧引用/人工采集用例 | integration-repaired.json/log |

基线精确命令：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_platform_logo_cleanup.py backend/tests/unit/test_geo_manual_collection_contract.py backend/tests/unit/test_geo_answer_contract.py`，69通过；同compose `run --rm backend-test pytest tests/integration/test_geo_answer_files.py tests/integration/test_geo_manual_collection.py`，29通过。首次错误文件test_geo_answer_evidence.py不存在，exit4/no tests，已纠正而不隐去。

新合同定向：raw截止前1µs/截止相等、dry-run文件/草稿/存储完全不变；正式Answer raw/screenshots及active草稿保护；终态删除低敏墓碑+共享文件保护/最后解绑7天；PG直接SQL禁止pending/fresh/独立墓碑提交/无墓碑删除/墓碑删除或TRUNCATE；限批、SKIP LOCKED和老引用不能饿死较新孤立raw；存储失败与删除成功/完成事务失败后重试；实际配置入口采集关闭仍可预览及清理；新增Schema/索引对账。

完整8失败逐项原因：admission/answer/browser(empty和nonempty)/decision(empty和nonempty)/fresh-head测试硬编码0063 head或降级消息；manual migration在0052时比较新增0064索引的当前ORM。仅更新最新head/首个降级拒绝信息；manual先保留0052原非空数据断言，再前滚head对账。未放宽原历史、不可变或安全断言。全部八节点在最终48选择实际通过。未重跑整个1154项PG套件：1146成功证据和失败节点/直接影响边界的修正后证据可复用，无额外未决风险需要重复十分钟套件；不宣称全量修正后通过。

新Schema对账曾暴露FileRecord既有cleanup索引及default未完整ORM映射（旧历史缺口）；只比较本任务新增file索引以及完整draft/tombstone表，不扩大无关重构。SQLAlchemy既有循环FK/dialect_options warnings不改变测试结果，原日志保留。首次raw哈希测试索引断言错误、一次E501/mypy查询布尔类型及上述有意回归红灯均记录并修正，未隐去失败。

## 独立复核、证据与覆盖缺口

fresh critical_reviewer实际只读复核确认三个问题，主代理真实反例重现并修正：LIMIT前引用过滤、墓碑TRUNCATE、生产可选配置键。详见evidence/independent-review.md。审计Bundle audit_id=20261005T142734Z-geo-901-004ba151已关闭、audit-verify passed；SUBAGENT_EXECUTION_DIGEST由本机工具生成/渲染，复核任务accepted不等于GEO-901 done。没有第二轮独立复核的主张。

未运行make verify/构建/前端E2E/浏览器矩阵/性能/903恢复/生产OSS和真实Celery周期：没有前端旅程/生产或性能合同变化，相关下层PG/配置入口/Worker接线有直接证据；生产删除与周期运维仍需上线时实测。未启用或变更生产保留策略，没有获得实际保留天数批准；默认安全配置不要求阻断本轮实现。

隔离PG16/Redis7.4/fake OSS项目geo901-validation，本机端口55491/56491，不用共享开发库执行迁移/清理。测试fixture每轮随机数据库。已docker compose down --volumes --remove-orphans（只限该project），cleanup-resources exit0；共享dev PG/Redis仍运行。

## 状态与修改文件

manifest：GEO-901 planned→in_progress→review；GEO-707仍done，903等状态不变。Trellis Task Brief/design/implement/task.json及evidence，当前task保持review，不归档、不completed、不done；等人工接受。SHA256SUMS仅更新本任务实际变更文档，初始文件hash追踪确保前序脏工作保留；OpenAPI/generated/旧迁移/其他任务记录相同。

仓库维护文件清单（不含本任务记录/evidence目录）：

- `.env.example`
- `.env.production.example`
- `backend/alembic/sql/0064_geo_retention.sql`
- `backend/alembic/versions/0064_geo_retention.py`
- `backend/app/config.py`
- `backend/app/models/__init__.py`
- `backend/app/models/geo_files.py`
- `backend/app/models/geo_manual_collection.py`
- `backend/app/models/geo_retention.py`
- `backend/app/services/file_records.py`
- `backend/app/services/geo_retention.py`
- `backend/app/worker.py`
- `backend/tests/integration/test_geo_admission_migration.py`
- `backend/tests/integration/test_geo_answer_migration.py`
- `backend/tests/integration/test_geo_browser_session_migration.py`
- `backend/tests/integration/test_geo_decision_migration.py`
- `backend/tests/integration/test_geo_manual_migration.py`
- `backend/tests/integration/test_geo_retention.py`
- `backend/tests/integration/test_migrations.py`
- `backend/tests/unit/test_geo_configuration.py`
- `backend/tests/unit/test_geo_retention.py`
- `contracts/database.md`
- `deploy/scripts/check-production-inputs.py`
- `docs/geo-monitoring/01-product/02-geo-core-prd.md`
- `docs/geo-monitoring/02-business/02-domain-model.md`
- `docs/geo-monitoring/02-business/03-workflows-and-state-machines.md`
- `docs/geo-monitoring/03-technical/02-data-architecture.md`
- `docs/geo-monitoring/03-technical/06-security-and-compliance.md`
- `docs/geo-monitoring/03-technical/07-testing-and-quality.md`
- `docs/geo-monitoring/03-technical/08-deployment-and-operations.md`
- `docs/geo-monitoring/04-delivery/task-manifest.yaml`
- `docs/geo-monitoring/CHANGELOG.md`
- `docs/geo-monitoring/README.md`
- `docs/geo-monitoring/SHA256SUMS`
- `docs/production-configuration.md`

本任务Task目录新增prd.md/design.md/implement.md/task.json/evidence。实际35项维护路径、前后hash见scope-check.json；核心before→after diff见source-increment.patch。无新增依赖/全仓重构。

## 后续任务

GEO-902可观察性、GEO-903备份恢复、GEO-904安全/生产Browser核实、GEO-905容量、GEO-906上线/开关/会话验收；均未实现。R7 deferred不作为本轮前置；未批准生产期限由数据负责人/管理员按运维说明处理。


## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-901 的实现与测试证据。”据此记录manifest=done、Trellis=completed，完成日期为2026-10-05。既有review阶段实现、测试结果、首次失败与覆盖限制保留为验收前历史，不改写已有验证结论，不重复运行功能测试。

本次只收尾GEO-901，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS只同步manifest条目。验收前状态保存于evidence/acceptance-before.json；收尾git diff --check精确命令与结果保存于evidence/acceptance-diff-check.json/log。
