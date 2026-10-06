# GEO-501 Task Brief：分析与复核契约和表

## 1. 基本信息
GEO-501 / R4；主代理负责；分支 geo/GEO-501。开始 planned，依赖 GEO-304、GEO-005=done。2026-10-03 本会话用户已人工审查并接受实现与测试证据，manifest 状态 done，Trellis 为 completed；无 commit、PR、部署或归档。

## 2. 目标
原始回答、机器分析和人工复核分开保存；输入、旧 revision 和当前有效结果可追溯。

## 3. 关联需求
WBS GEO-501 完整行、PRD 分析/复核要求、Accepted ADR-002/003。WBS 未分配独立 CAP/REQ，不虚构编号。

## 4. 必读文档
已读用户指定 GEO README、路线图、WBS、执行指南、模板、manifest、PRD、领域模型、状态机、方法论、七份技术文档和 ADR-002/003；根/后端 AGENTS、Trellis workflow/spec、304/005记录；当前根合同相关完整单位、0048及0050～0053迁移、ORM/schema/services/tests。技能：trellis-before-dev、clean-code-design、structured-response；候选持久化/并发合同需 multi-agent-orchestration 独立只读复核。

## 5. 当前行为
Run 和不可变 Answer/Citation 已实现；head0053。无分析/review表或指针；详情分析区显式 NOT_IMPLEMENTED。已有其他任务 dirty 工作以 initial-status/initial-sha256/before 保存，不覆盖。

## 6. 目标行为
闭合输入覆盖答案哈希、对象/别名/域名、每产品 APPROVED 非空事实、分析器/模型/提示/参数/规则。子结果与review关系正确；指针前进且失败不清空，旧review保留历史。

## 7. 范围内
根 components/数据库合同、Pydantic/ORM、0054 SQL/Alembic、Run指针、必要删除引用检查、generated类型、定向测试、文档证据。

## 8. 范围外
502/503/504/505算法、506Worker、507API、508复核流程UI；指标、Opportunity、Browser；真实AI；无关重构或升级。

## 9. 业务不变量
证据不改；输入创建起冻结；PENDING一次终结；终态/子结果/review不可UPDATE/DELETE；事实强引用；revision单调；pointer同Run且COMPLETED严格前进；review只追加到当前analysis。

## 10. 契约变化
新增分析/子结果/review/选择components，无operation；六张表（五业务实体+多产品事实绑定），Run可空pointer复合FK；unique/trigger；0054加法无回填。

## 11. 后端实现
不接入Router/分析服务/Worker。后续事务按Run→Analysis→Fact锁定装配/终结/发布。现有事实/用户删除入口补历史引用。DB错误按精确SQLSTATE/constraint，未知原抛。

## 12. 前端实现
重生成generated类型并补齐GEO_ANALYSIS删除阻断元数据；无路由、query key、URL、页面、dirty或分析交互变化。

## 13. 测试计划
闭合schema/真实实例合同；PG前滚、存量和ORM；unique、UPDATE/DELETE、关联/强引用、指针与过期review；并发反例。虚构数据和隔离PG，无真实平台。

## 14. 验收标准
证据/分析/review分表可追溯；绕过应用不能改历史、串Run、倒退pointer、review过期；事实归属正确，无事实claim只能UNJUDGEABLE；各层一致，实际结果记录，最终review。

## 15. 验证命令
基线contract-check通过；unit105passed；PG43passed。最低git diff --check、make contract-check/lint/typecheck/test-unit/test-integration、uv run --project backend alembic -c backend/alembic.ini upgrade head。完整命令与日志见implement.md。

## 16. 数据和上线
先0054再消费者；历史pointer=NULL无推断回填。禁止破坏性downgrade；停止新分析写入并前向修复。无双写/flag需求，仅本地测试迁移。

## 17. 风险与开放问题
ADR解决草稿CASCADE/SET NULL/单事实/可选指针。重点检查终态Run限定例外、MVCC、review过期。仅用户五类情况blocked，环境故障准确记录。

## 18. 完成证据
implement.md、evidence保存基线/命令/迁移/diff/保留审计/独立复核。最终unit后端3057/前端1141、定向PG26、空库前滚及静态合同检查通过；完整integration初次897通过/1失败，修复后定向通过，未重跑全量。未执行不得写通过。

## 19. 后续任务
GEO-502/503/504/505、506/507/508；不实施。
