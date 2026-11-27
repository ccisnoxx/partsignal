# GEO-906 实施与验收证据

## 1. 状态和授权

2026-10-05，入场已在geo/GEO-906；未创建分支、提交、推送或归档。
903/904/905 manifest均done，有人工接受记录，允许906进入；904现场与905目标容量限制保留。
已读取必读文档/合同相关单元/适用spec及任务记录，先输出12项preflight再实施。
Task Brief见[prd.md](./prd.md)，阶段所有权与取舍见[design.md](./design.md)。
原工作树已有大量前序GEO改动；只将evidence/before相对增量与本任务新文件归为906，不覆盖他人修改。

生产入口、candidate、阶段批准、试用/观察期/容量输入的异步问题尚无答复。
本次未访问生产、未expand/deploy/enable，运行配置未写入；生产NOT_STARTED/NOT_VERIFIED。
必需生产输入/人工批准缺失后manifest/Trellis均planned→in_progress→blocked；未进入review/done。已完成本地发布准备与下列验证，精确最终结果写入evidence/validation-results.json。
缺失必要外部输入/人工批准是用户规定的blocked条件，不来自skill的额外审批要求。

## 2. 实现范围

新增核心rollout runbook、低敏release记录模板与最终验收矩阵；更新当前索引/roadmap/追踪/ops/CHANGELOG/SHA256。
配置检查的旧“无任何partsignal.geo_任务”基线与已验收901冲突，dev/omitted失败。
最小修正只准确允许geo_cleanup_artifacts的注册/声明调度，继续拒绝其他未知入口；保留18场景、共享Settings和启动网络审计。
不执行清理任务，不新增自动批准、发布框架或业务能力。

生产所有者保持现有candidate producer/deploy/activate/prepare-production-data；dirty分支不能产正式candidate。
expand/deploy合并执行须两阶段批准；enable批准须覆盖配置切换、UPGRADE_PREPARED同manifest再次deploy重建API后activate。
activate仅启动Worker/Scheduler，不能仅改env就认为API已重建。initialized同candidate不可重入；恢复须新release身份与批准。
frontend rollback只支持initialized；prepared/deploying的artifact失败没有当前可执行恢复路径，保持维护并要求发布所有者的获批阶段恢复方案，不假称可换candidate。

## 3. 契约、迁移及业务边界

本任务无OpenAPI/generated/database/ORM/Alembic变化，head0065_geo_observability；无回填/历史迁移或生产前滚。
本地恢复及E2E的实际前滚结果以各自日志为准，不能作为目标前滚证明。
Router/Application Service、事务/锁序/revision/状态机/lease/预算/幂等和错误映射未改。
PG是权威；队列只稳定ID，停止/恢复不重放Redis/Beat、不重置终态或重发SENT/UNKNOWN。
指标、MANUAL/API分母与不可变Answer/Analysis/Review/Publishing/审计保持，AI仅草稿。
前端路由/query key/URL状态/页面/generated无改；当前action/retest创建经公共API，不假称UI接线完整。

## 4. 安全与现场限制

权限/CSRF/SSRF/TLS/凭据/审计边界未放宽，普通测试使用本地虚构资料/fake服务，无真实外部AI。
Browser期望false与现场观察null分离；三进程实际值、服务/profile/overlay/mount、PG全部会话行数与材料库存均需同目标负证据。
当前生产Browser仍NOT_VERIFIED，清理/会话恢复NOT_DETERMINED，不把开发默认false或新建来源零材料标生产N/A。
核心API保持false，未批准factory不作MANUAL兜底；全应用真实AI/OSS activation Gate仍需MET。
不保存env/DSN/秘密/会话正文；证据仅稳定ID、计数、摘要和受保护材料引用。恢复runner只读取已有本地连接身份，日志脱敏。
新retention dry-run、并发默认1，未授权实际删除/提升并发或clean-init/quarantine。
R7 804～807仍deferred/post-core，无新真实Adapter、截图或登录探针。
Plan cron批次扫描与自动opportunity evaluator未接线，ADR006未延期这两项，验收NOT_MET不补功能。

## 5. 验证记录

所有实际命令、退出码、分类和日志以evidence/validation-results.json为准。
初始配置入口exit1；最小修正后18场景exit0，启动外部调用0。
基线配置/Worker/health选定单元通过；make lint/typecheck/test-deploy-scripts通过。
显式本地PG16容器工具的隔离恢复6 passed，15.81s，含对象缺失、错误master/配对密钥与SIGTERM资源清理。
make verify退出2：contract/lint/typecheck/unit阶段通过（后端3783、前端1285），集成54 failed/1116 passed/6 setup errors，608.48s。54项所在七文件在fake OSS未启动时名称解析/StorageUnavailable；启动现有本地替身后这七文件82 passed/15.28s。6项恢复setup要求显式PG工具，显式工具6 passed/15.81s已补验证。完整原命令仍失败，不把82+6改写为完整verify通过；后续performance/build/E2E/deploy子阶段未到达。

canonical MANUAL E2E用tests/e2e/geo-(loop|review)-real-stack.spec.ts筛选，两项2 passed/1.3m；包含追加式严重声明复核、五次人工观测→内容行动→五次严格复测→显式解决及历史/审计保留。首次DB14非空preflight拒绝exit1，不删未知键；只读发现DB13空且无外部客户端后改用13，exit0。secret scan clean；临时owned数据库、DB13队列、端口及目录cleanup成功。该runner临时虚构Browser公钥/目录只为本地测试，Browser采集始终false，不证明生产N/A。

只收回本任务启动的既有fake-oss（入场Exited，最终stop回原态），保留原PG/Redis与未知DB14；没有生产目标操作。git diff --check/任务context validate通过，文档hash/链接/状态检查详见final-record-checks.json。
生产smoke、目标停止/恢复、正式MANUAL/internal trial/监控观察期未执行，缺目标与批准。

## 6. 独立复核

fresh critical_reviewer只读复核确认API配置重建和frontend回滚阶段两项问题，主代理修正runbook声明及停止条件。
最终可作为blocked发布准备交付，不放行生产。P1初始化前artifact失败恢复能力缺口明确保留，未为此重写发布状态机。
复核未运行测试/DB/生产，也不把make verify失败标通过，详情见[evidence/independent-review.md](./evidence/independent-review.md)。
声明范围hash与复核返回匹配，已知文档/design变化由主代理；未观察代理写入，不构成全仓归因证明。
Audit Bundle 20261005T210318Z-geo-906-0861dd60：plan/guard/summary/digest/finalize/verify通过，1尝试/1报告验收/1独立复核，无异常或活跃worker。
模型/推理档位为Agent TOML配置证据，非运行时遥测；见[evidence/SUBAGENT_EXECUTION_DIGEST.md](./evidence/SUBAGENT_EXECUTION_DIGEST.md)。

## 7. 恢复输入与后续

补齐同一目标入口或脱敏现场报告、clean main固定candidate、expand/deploy/enable等精确批准、负责人、试用范围/访问控制、容量/观察期和停止阈值。
初始化前artifact失败还须发布所有者受支持且可验证的阶段恢复方案；不修改状态文件或先activate解锁。
保留cron/自动evaluator需求缺口，后续实现或已接受产品范围决定须另有授权；本任务不提前实现。
恢复906同一任务后逐阶段现场取证，通过才review，done只人工接受。

## 8. 人工验收 — 2026-10-05

用户明确表示：“我已经人工审查并接受 GEO-906 的实现与测试证据。”
依据本次明确接受指示，将manifest实际blocked状态更新为done，Trellis标记completed，完成日期为2026-10-05；不虚构review过渡。

本次仅记录人工验收完成，保留上述实施时的阻断历史、原验证结果、生产NOT_STARTED/NOT_VERIFIED、初始化前artifact失败恢复限制及cron/自动evaluator缺口。
原完整make verify失败不改写为通过，本地补验证不改写为生产smoke、目标停止/恢复、正式试用或观察期验收，也不补造生产Browser关闭/无会话证据。
不修改其他任务状态，不实施后续任务，不提交、推送、归档或部署。
收尾仅更新manifest、对应SHA256、Task Brief、任务元数据与本验收记录；运行git diff --check，结果在本次交付回复中报告。

## 9. 后续本地入口修复与完整复验 — 2026-10-05

用户另行要求“修正入口后重新验证”。本次补齐 fake OSS 健康依赖，将真实恢复文件接入同一个完整 Make 入口的必跑宿主机 PG16 工具链；独立记录在[后续任务](../10-05-verify-entrypoint/implement.md)及[验证结果](../10-05-verify-entrypoint/validation-results.json)。

新完整 `make verify` 退出 0：普通集成 1170 passed、恢复 6 passed；后端单元 3783、前端单元 1285、10 万样本性能、构建、真实栈 32 场景、GEO API 三模式、前端 fixture 和部署脚本均完成。GEO API 共 3 passed / 3 既有模式 skipped，前端 fixture 498 passed / 74 既有条件 skipped；未增加 skip 或调整断言/阈值。指定的独立 lint、typecheck、test-deploy-scripts 与 diff 检查均退出 0。

这是新一轮本地证据，不替换原始失败记录，也不等同生产验收。GEO-906 继续保持人工接受后的 done/completed；后续修复任务进入 review。生产未执行、阶段批准与目标输入缺失，以及上述恢复和产品能力限制继续保留。

## 10. 补充人工验收 — 2026-10-05

用户再次明确表示：“我已经人工审查并接受 GEO-906 的实现与测试证据。”并要求仅完成 GEO-906 状态和 Trellis 验收记录收尾。

本次入场时 manifest 已为 `done`，Trellis 已为 `completed`；保持该终态，补记对第9节入口修正及最新完整本地复验的人工接受，不虚构 `review→done` 过渡。最新完整 `make verify` 退出0及其他指定命令的实际结果见[验证记录](../10-05-verify-entrypoint/validation-results.json)。原失败运行作为历史证据保留，不改写为通过。

本次仅更新 GEO-906 验收记录、任务元数据、manifest 验收说明和对应文档哈希。其他任务状态保持不变，`10-05-verify-entrypoint` 仍为 `review`；不实施后续任务，不提交、推送、归档或部署。生产 `NOT_STARTED/NOT_VERIFIED`、缺失的现场输入与阶段批准及既有恢复/功能限制继续保留。

收尾验证仅运行 `git diff --check`，实际结果在本次交付回复中报告；不重复运行实现测试。
