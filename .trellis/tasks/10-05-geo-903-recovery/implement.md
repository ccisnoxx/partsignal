# GEO-903 实施与验证

## 1. 交付与状态

GEO-903 / R8；当前分支 geo/GEO-903。GEO-901、GEO-902在manifest均done，已核对对应Trellis人工接受记录。按Accepted ADR-006核心R6→R8执行，804～807延期不作依赖。Task Brief见prd.md；设计见design.md；本任务in_progress→review，等待人工接受，不标done/completed，不提交、推送、发布或归档。

成套加密备份、数据库/对象/适用密钥库存与扫描、隔离恢复及恢复/停止runbook已交付；本地真实恢复通过。make test-deploy-scripts仍有901/902已记录的旧配置断言失败，完整gate不是通过。

## 2. 当前差异与实现

旧backup只有SQL gzip；旧restore接受任意VERIFY_DATABASE_URL，无法保证隔离且仅计表数。新shell只调用受控Python编排，旧调用者/说明已核对并更新，不保留无调用者shim或旧目标回退。

backup同一个只读REPEATABLE READ事务完成完整public库存、schema清单与pg_export_snapshot；pg_dump custom使用仍存活snapshot。运维必须声明并证明静默窗口，保护跨PG/对象的一致性，不机械扩大业务事务或改写状态。所有非DELETED FileRecord真实签名GET读取字节，核对size/SHA256；DELETED保留墓碑，MISSING/CORRUPT/UNAVAILABLE明确非完整成功。

所有artifact和manifest用独立32字节backup key流式AES-256-GCM加密，AAD绑定set_id/逻辑文件名。key不进入集合；secrets JSON包含AI主密钥/Session/Upload签名key，备份与当前Settings恒时配对，恢复用manifest加密proof再校验并实际使用包内值。production来源另要求release/runtime env/Nginx文件，只加密读取，不执行配置。

## 3. 数据库、事务与恢复隔离

恢复先认证全部声明artifact与摘要，才新建受控partsignal_e2e_date_random库，校验随机owner comment及空public。管理连接必须显式回环host，拒绝现成VERIFY_DATABASE_URL、URL query/fragment及继承PG*覆盖。lifecycle、SQLAlchemy、PG CLI连接合同保持同一集群。对象只复制到本次0700临时开发树，不对生产OSS PUT/DELETE。

真实PG演练发现既有SQL-string函数在pg_restore空search_path下内联失败。restore_archive导出原始SQL，只精确替换唯一空search_path语句为pg_catalog,public，其余DDL保持，用psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1导入。未改函数/历史迁移，不禁用trigger/constraint；格式不符停止。这只适用于已认证集合与已校验owner/空库的本次临时目标。

数据表按完整行排序核对count/SHA256；函数/trigger逐字与启用属性核对，约束/索引按归属、类型、列名及唯一/延迟/验证等属性核对。CHECK/索引表达式经PG重解析有等价cast/括号变化，不创建通用SQL语义归一化；历史DROP COLUMN留孔，结构库存用列名而非attnum。认证dump中的原始DDL始终导入；隔离测试实际证明Answer同值UPDATE触发23514 ck_geo_answers_immutable并回滚。

create确认丢失也执行精确owner drop；不匹配不删除他人库，报告低敏name与cleanup失败。普通异常、SIGINT/SIGTERM关闭/kill/wait子进程，dispose连接、清理明文目录和owner库。SIGKILL/断电不能运行finally，须按精确name+marker安全人工核对。删除未确认owner或不可达PG时不伪造cleanup成功。

## 4. 公共合同、迁移、前端

本任务未编辑contracts/openapi.yaml、contracts/database.md、Alembic或generated OpenAPI。既有schema/head仍0065_geo_observability；每个新建来源从空库通过现有revision前滚至0065后dump，再恢复到另一个空库，head与历史表保持。无本任务revision、存量迁移、回填、降级、生产DDL。

Router/Application Service、锁顺序、revision、状态机和MANUAL/API公式不变。前端路由/query key/URL/页面状态均N/A。

## 5. 幂等、并发与错误

不启动Worker/Beat，不恢复Redis为事实源，不重放外部发送；保留SENT/UNKNOWN、attempt/lease及全部历史。Run Detail和Overview调用既有只读领域投影，仅剔除本次as_of/临时download capability，不剔除业务hash/revision/指标字段。恢复后两个并发旧(plan_id,scheduled_for)回放实际返回同一原回执，PG窗口仍1条；不增加新调度算法或生产cron。

CLI错误输出固定码，complete=false非零。对象缺失按稳定File UUID逐项报告，不删Run/引用/hash，不伪造字节。认证失败不得使用部分明文或建库，cleanup失败保留原失败及明确低敏清理状态。

## 6. 安全与条件性Browser

PG唯一业务状态；只读取来源对象，不访问真实AI/Browser平台。所有材料为隔离虚构资料。backup文件/秘密输入0600/0400、集合/临时目录0700；报告不含正文、明文凭据、DSN、object_key/签名URL；诊断日志连接串已脱敏。源秘密/临时dump/对象/key均不保存在仓库证据，早期失败夹具也按本任务deployment身份精确清理。

Browser N/A仅适用于GEO-903-owned-test-source：新建隔离来源，无R7服务/profile/挂载，collection_enabled=false，Session root/key/service配置为空，真实geo_browser_sessions=0，已扫描1个新建私有材料根，entries=0，带实际checked_at。证明见isolated-restore.json。声明证据只覆盖这一环境，不从默认配置推断生产无材料。

任何部署/配置/PG会话行/材料存在都会输出BROWSER_RECOVERY_REQUIRED，不生成core N/A成功。Runbook列明802独立密文卷/私钥/能力文件的保护、恢复、撤销/PURGE与审计；本次没有适用材料，未执行该条件分支。生产Browser false/未启动/无会话须904/906在目标环境再实测，未提前实施。

## 7. 实际验证

命令及受保护环境来源见evidence/commands.json，未导出DSN/秘密。下面是实际执行结果，不把历史/未执行检查当本次通过。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_metrics.py backend/tests/unit/test_geo_worker_configuration.py backend/tests/unit/test_geo_browser_session_vault.py backend/tests/integration/test_geo_batch_creation.py::test_schedule_concurrent_window_identity_ignores_revision | 基线138 passed | baseline.log |
| backend/.venv/bin/python -m pytest backend/tests/unit/test_geo_recovery_boundaries.py backend/tests/integration/test_geo_recovery.py -x | 最终23 passed in 18.91s；17边界+6真实来源场景 | real-restore-final.log |
| git diff --check | exit0，通过 | git-diff-check.log |
| make lint | exit0，Browser/backend/frontend通过 | make-lint.log |
| make typecheck | exit0，Browser、249个backend源文件与frontend通过 | make-typecheck.log |
| make test-deploy-scripts | exit2，未通过；frontend镜像/容器、当时候选recovery18边界、194 collector/secret合同和fixtures已通过；旧configuration断言停止 | make-test-deploy-scripts.log |
| make test-geo-recovery | 最终17边界通过，三份恢复脚本ruff通过 | make-test-geo-recovery.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app/tools/geo_recovery_scan.py | final scanner 1 source通过 | final-scanner-typecheck.log |

补充：`sh -n deploy/scripts/backup.sh`与`sh -n deploy/scripts/restore-verify.sh`均exit0；YAML只变更GEO-903，两个依赖仍done；122份文档哈希校验通过，见delivery-integrity.json。

真实恢复环境是运行中的独立开发PG16.15（只管理自己新建来源/目标），随机回环HTTP对象服务；显式GEO_RECOVERY_PG_CONTAINER验证映射端口后在该容器使用PG16 pg_dump/pg_restore/psql，没有升级依赖。来源现有管理连接从受保护Settings替换host127.0.0.1/port55432，Redis只测试14号库；不输出连接秘密。每场景前滚现有迁移并创建不同来源库，恢复库始终再独立创建且销毁。

isolated-restore.json证明4个Run Detail（1 COMPLETED、3 PENDING）、全部表与结构清单相等、Overview相等、2个凭据真实解密、2个对象真实GET/HEAD/hash、Session token_hash使用包内key、Answer不可变拒绝、2个并发同窗口重放仍1条batch、目标库消失。missing-object-restore.json证明缺失File明确MISSING、complete=false、4个Run和数据指纹继续保留。cancelled-restore.json证明真实CLI SIGTERM非零2、owner库/明文目录/PG工具子进程均消失。

## 8. 失败诊断与未运行检查

首次夹具停在NEEDS_REVIEW，改用既有人工作业确认API（201）后形成COMPLETED，不放宽指标资格；曾误用settings.app_env，改为现有environment。宿主libpq18.4连接PG16时生成不支持transaction_timeout，后显式用同版本PG16工具。随后真实恢复暴露SQL函数空search_path内联失败，采用上述隔离执行修复。结构文本与内部attnum的差异分别由schema-diagnostic/catalog-diagnostic定位；收敛为结构清单和列名。每次重跑前都有相关代码/环境或新诊断变化，没有盲重试；中间失败不写成通过。

make test-deploy-scripts在test-geo-configuration.py dev/omitted停止。其STARTUP_PROBE要求无partsignal.geo_任务；901已有partsignal.geo_cleanup_artifacts，902已记录同样失败并由用户人工接受依赖任务。本任务不修改旧断言放宽启动/安全门禁。停止后的test-e2e-run-lifecycle、test-e2e-database-lifecycle、secret-artifact-post-run、deploy-staging、production-cleanup、deploy-production六脚本本任务没有运行，不宣称通过；本次所需恢复边界有更直接的23项证据。

未运行make verify、全产品E2E、性能/浏览器矩阵、生产smoke、生产/远程OSS恢复、异地拷贝和适用Browser真实材料恢复：没有本任务变更或授权要求它们，全量上线/安全/容量由后续任务负责。本地集合与fixture不是生产灾难切换或异地保管验收。

## 9. 独立复核与审计

两次fresh critical_reviewer独立只读复核，共提出5项具体问题：PG环境路由、秘密配对、建库确认丢失、SIGTERM清理、没有断言的不可变证据。主代理修正后以上均有定向证据；接受的是复核报告交付，不是GEO-903人工验收，也没有宣称审查者再次通过最终修正候选。

本轮SUBAGENT_EXECUTION_DIGEST已生成并audit-finalize/audit-verify passed，audit_id=20261005T171548Z-geo-903-59bdc0fc。2计划/2尝试/2复核交付接受/2独立只读复核，无未执行ready task/活跃worker/未知写入；模型effort来自Agent TOML配置快照，不等于运行时单独确认。审计有3个报告/写入说明artifact分类warning，校验无error且无异常；原始report和renderer摘要存于evidence。

## 10. 修改文件

- Makefile
- deploy/scripts/backup.sh
- deploy/scripts/restore-verify.sh
- deploy/scripts/geo-recovery.py
- deploy/scripts/geo_recovery_bundle.py
- deploy/scripts/geo_recovery_environment.py
- backend/app/tools/geo_recovery_scan.py
- backend/tests/unit/test_geo_recovery_boundaries.py
- backend/tests/integration/geo_recovery_support.py
- backend/tests/integration/test_geo_recovery.py
- docs/operations.md
- docs/geo-monitoring/README.md
- docs/geo-monitoring/CHANGELOG.md
- docs/geo-monitoring/SHA256SUMS
- docs/geo-monitoring/03-technical/07-testing-and-quality.md
- docs/geo-monitoring/03-technical/08-deployment-and-operations.md
- docs/geo-monitoring/03-technical/09-backup-recovery-runbook.md
- docs/geo-monitoring/04-delivery/task-manifest.yaml

另有本Task的prd.md、design.md、implement.md、task.json及evidence记录。before为入场时相关既有文件副本；implementation-worktree-snapshot是实施阶段工作树，不冒称入场瞬间。geo903-incremental.diff按before对比，避免把此前全仓大量GEO改动归给903。最终检查diff、工作树、source所有权和秘密边界；保留无关修改。

## 11. 已知限制与安全停止

当前只验证PG16/release及本地开发对象适配器；真实生产/OSS/Browser外部资料不在本轮覆盖。来源生产秘密、静默/部署现场证据及异地位置仍由相应环境负责人提供。core-only工具在发现Browser材料时明确失败，不能用当前N/A覆盖其它环境。

强制SIGKILL/断电/PG失联无法保证清理；owner未提交/不匹配的残留不自动删除，须按精确标识安全核查。所有非DELETED对象都要求hash/size字节存在，未完成上传也保守报告缺失。CHECK/索引表达式不做通用语义证明，保持原认证DDL导入并核对结构清单/真实保护行为。

只读导出snapshot解决PG内部一致性，跨对象/密钥一致性仍需要实际维护静默窗口；backup点之后的外部发送不在dump中，生产放开consumer前必须对账，不能重发SENT/UNKNOWN或以旧NOT_STARTED保证没有外发。

## 12. 后续

等待用户人工接受903；904安全与目标环境Browser核查、905容量、906最终上线/恢复停止演练由对应任务实施。本轮未实施任何后续任务，未生产部署。

## 13. 人工验收 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-903 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为 2026-10-05。既有 review 阶段实现、测试结果和覆盖限制保留为验收前历史；`make test-deploy-scripts` 的既有断言失败不改写为通过，不重复运行功能门禁。

本次仅更新 GEO-903 的验收状态、Task Brief、任务元数据、验收记录及 manifest 对应文档哈希；不修改其他任务状态，不实施 GEO-904/GEO-906 或其他后续任务，不提交、推送或归档。收尾验证为 `git diff --check`，结果在本次交付回复中报告。
