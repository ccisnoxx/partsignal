# GEO-702 实施与验证记录

## 交付

仅GEO-702：Opportunity、sources、actions及追加evaluations，确定性identity、十条初始规则、批量应用服务。未提交或发布；702完成本地验证后仅review，701/603/604保持done，703及后续不实施。

规则由701冻结一次，指标资格和公式复用601/603/604；两期半开窗口、有效current analysis及其中latest Review、全表排除旧attempt、完整异质cell及竞争集合。低样本/无分母/不可比/阈值未配置只保存不可用结果，不创建机会。规则输出保留实际完整配置、值、阈值、分子/分母、来源及不可用原因；严重与重复错误保存完整合格分母来源。

identity为canonical UTC窗口+rule+subject/topic/prompt/profile/surface/batch及完整冻结环境的SHA256；不含本次阈值revision、评估时间或随机UUID。开放态永远复用；同周期关闭后的dedup窗口内抑制，到期新世代可创建且终态历史不重开。首次trigger不覆盖；不同有效analysis/review追加来源，相同结果SHA重放无副作用。

## 合同与迁移

根OpenAPI只追加7个数据组件，没有新operation；前端仅重生成类型。已用原始前缀SHA确认原OpenAPI字节保持。原机会占位、CSV 501、前端路由/query key/URL状态保持当前合同，公开工作台为703。

0059_geo_opportunities，down_revision=0058_geo_rule_configuration。四表及开放partial unique、来源NULLS NOT DISTINCT、RESTRICT FK、追加历史不可变、状态/revision/装配guard和Batch真实机会来源FK。加法前滚，无历史回填或数据重写。独占测试空库前滚成功，非空0058历史逐行对账保持；合成旧悬空机会来源导致FK失败，事务回滚后仍0058且无部分DDL。downgrade安全停止，恢复依赖迁移前备份或前向修复；未运行生产迁移。

DDL lock_timeout=5s、statement_timeout=120s。首次迁移调用遇psycopg把SQL format百分号当参数，改为明确触发器声明后实际前滚成功，未绕过约束。

## 事务、并发与生命周期

应用服务先按现有User owner重验ADMIN/ENGINEER、启用及改密门禁，保留User NO KEY UPDATE锁；独立RR禁autoflush捕获一次规则及一致观测。业务筛选只选择待评估batch/profile，另在同一RR取当前窗口完整治理候选，成功运行或环境变化不能被筛掉而接回旧失败。

RC写入锁序User→Product→品牌→Subject→排序identity事务advisory→Opportunity FOR UPDATE。锁后populate_existing刷新cached ORM，更新时间在锁后取clock_timestamp且不小于历史时间。开放identity partial unique为未遵守advisory写者的最终防线，仅对精确index ON CONFLICT重读实际获胜行，不吞未知FK/装配/不可变错误；任何来源/评估写入失败整体rollback。

revision初始1，真实更新严格+1；OPEN→ACKNOWLEDGED/DISMISSED、ACKNOWLEDGED→IN_PROGRESS/DISMISSED、IN_PROGRESS→RESOLVED/DISMISSED，终态不回退；关闭需actor/时间和非空code/comment。状态策略和数据库防线存在，但702没有公开状态命令或自动关闭。

资源删除owner计数包括已关闭Opportunity；User业务引用计数加入ack/resolve/actions/evaluation创建者。sources验证analysis/review属于该Run，首次trigger全部sources须同事务装配。actions目前只是不可变关系结构；704须通过目标领域验证多态target及接删除owner。

## 安全与范围

默认评估开关保持关闭；不新建Router、CSRF或外部调用入口，不改SSRF/TLS/凭据边界。只读已保存证据，不访问AI/URL/OSS HEAD。结果details只保留指标/维度/ID/指纹，不保存回答、事实正文、解释或引用URL/标题；错误声明只保存规范化SHA。人工复核、批准事实、Run/analysis/review与历史不可变防线保持。

## 实际验证与首轮修正

逐命令argv/exit_code/时间及原始stdout均在evidence同名JSON/log；未执行命令不记通过。

- 基线baseline-unit：164通过；baseline-integration-built：30 PG通过。首次生产runtime镜像无pytest，按已有Dockerfile test target构建后运行；不是服务或业务失败。
- policy-unit-fixed：30通过；纯规则14通过，新增完整分母基线2通过，合计46定向unit。最初合同断言误把既有opportunities CSV路由算入703，改为准确的702范围检查。
- opportunities-integration-corrected：11 PG通过（并发最终唯一、重放、有效Review追加、配置快照、周期/关闭抑制/到期世代、样本不足、来源归属、不可变/状态、失败回滚、metadata、治理完整序列、非空前滚和悬空旧引用停止）。新增夹具最初漏BatchSubject或误用了analysis input作为Run input，按既有冻结装配修正后通过，没有放宽guard。
- 首轮make test-integration：1032通过、4失败。三处head/不可逆downgrade仍断言0058，0048冻结revision的metadata未排除0059后加FK；已精确更新对应断言，stale-session-regression连同这四处共5项通过。
- 独立复核3项P2均修正：stale Session revision、unique fallback较早时钟、错误机会完整分母来源。review-regressions-before-fix两项真实23514失败；修复后两PG通过。baseline-contract-before-fix两项缺非错误来源失败；修复后连同规则16通过。baseline-pg-corrected首次1/2保存两真实来源，后续Review改变保持首次snapshot并追加到3，通过。
- lint-candidate、typecheck-candidate、contract-final均退出0。
- unit-candidate：make test-unit，3623后端和1222前端通过。
- migration-forward-fixed与migration-candidate：实际uv run --project backend alembic -c backend/alembic.ini upgrade head退出0，后者验证重复前滚无副作用。
- diff-check：git diff --check退出0；新增未跟踪源码另查空白和实际范围。

完整集成integration-final：make test-integration COMPOSE=独占配置，1038通过、31条既有SQLAlchemy警告、exit0。完整分母PG在全量运行开始后加入，不冒计到全量收集数；当前702全部四个集成文件另执行geo702-final-targeted：14通过、exit0，覆盖最终规则和并发修正。702最终scope验证和文档SHA在evidence/final-audit.json；manifest及task.json由in_progress更新review，不done，不提交/归档。

## 独立复核与审计

fresh critical_reviewer只读代码/合同及原始验证日志，三项确认问题已解除，无其他确认阻断；未修改源码、Git或重复全量门禁。报告在evidence/independent-review.md。SUBAGENT_EXECUTION_DIGEST由work-plan生成并验证；audit_id=20261004T161117Z-geo-702-47a1c0ec，Bundle closed/verified，3次执行与验收、1次独立复核，无残留活跃/未执行ready/未知写入。模型档位为Agent TOML配置证据。

## 未运行与限制

未运行703–707用户闭环E2E、浏览器矩阵、生产迁移/部署、真实外部AI、Browser或生产保留任务：本次无HTTP/页面用户旅程变更，且属于明确范围外。未重跑性能fixture/全仓make verify；用户指定门禁与新增定向证据直接覆盖702风险，没有新性能宣称。

质量及连续失败阈值初始null，记录THRESHOLD_NOT_CONFIGURED；当前无引用不等于可观察零引用，OWN_CITATION_LOST在该证据缺口下不可用。动作写入、多态target验证、自动调度、公开API/权限命令、复测与解决仍由703–706交付。SQLAlchemy已存在循环表/dialect_options警告保留原样，不扩大为无关重构。

## 最终范围与环境清理

按开始时3372个路径SHA核对，19个既有路径均在702范围，16个实现/测试新文件已逐项列在changed-files.md，其他任务manifest字节保持。OpenAPI旧前缀哈希保持，全部702源码/SQL/合同空白检查通过。identity无关格式恢复到开始时基线且AST一致，定向ruff通过；最终git diff --check退出0。独占geo702-validation的三个容器和网络全部移除，残留该project容器为0；不清理用户服务或其他任务环境。最终核对证据见evidence/final-audit.json。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-702 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次不重新实现或重复运行功能门禁。

本次仅收尾GEO-702，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
