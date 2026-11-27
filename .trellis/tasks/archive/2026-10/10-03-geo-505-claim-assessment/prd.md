# GEO-505 Task Brief：声明提取、事实版本装配和准确性评估

## 1. 基本信息
GEO-505 / R4；主代理；当前分支 geo/GEO-505；manifest 状态 done、Trellis 状态 completed；2026-10-03 已由本会话用户人工审查并接受。依赖 GEO-501、GEO-502 均为 done。无 Commit/PR/部署授权。

## 2. 目标
在冻结回答与监测对象上，使用同产品非空 APPROVED FactVersion，输出可追溯的声明、判定、严重度和复核原因；事实不足明确 UNJUDGEABLE，关键替代关系始终复核。

## 3. 关联需求
CAP-GEO-08、REQ-GEO-ANALYSIS 声明事实核验、方法论第 8 节、WBS GEO-505 完整任务行、Accepted ADR-002/003。

## 4. 必读文档
已读根/backend AGENTS、Trellis workflow/spec（数据库、质量、错误合同）；用户指定的 README、路线图、WBS、执行指南、模板、manifest、PRD、领域模型、状态机、方法论、技术架构/数据/API/前端/Worker/安全/质量及 ADR-002/003；根 OpenAPI 的 Analysis/Claim/Run/Facts 组件、database 的 Markdown/Analysis 合同、0054 迁移和现有代码/测试；501/502/504 任务记录。使用 trellis-before-dev、clean-code-design、structured-response。

## 5. 当前行为
head0054 已有十类 claim、四类 verdict/severity、同产品 APPROVED 强引用/不可变保证；502 提供冻结精确提及。没有声明提取/事实装配/准确性阶段，Worker 和页面分析仍 NOT_IMPLEMENTED。工作树大量前序变更已保存初始 status/hash/修改前文件。

## 6. 目标行为
明确对象上的参数、封装、温度、认证、身份、生命周期、应用、替代/兼容声明可评估；仅同产品 APPROVED 且非空事实有资格。多版本选最高合格 version；每个自有产品独立绑定。事实不足、未识别的语义和对象歧义不猜结论。替代必须方向/目标一致且满足全部批准条件；无条件扩大条件替代为严重错误。

## 7. 范围内
- [x] 本地确定性声明提取和比较（规则版本可追溯）。
- [x] 只读批量事实装配、冻结证据及资格。
- [x] UNJUDGEABLE、严重度、关键替代/高危错误复核门禁。
- [x] 独立金标、unit/PG、合同与任务证据。

## 8. 范围外
GEO-506 Worker/revision/落库/状态推进、GEO-604 insights、汇总指标、Opportunity、Browser Collector、后续复核 API/UI、外部 AI、网络抓取、编辑工作区事实、无关重构/依赖升级。

## 9. 业务不变量
1. 非空 APPROVED 同产品 FactVersion 是唯一准确性证据，Product 工作区不是证据。
2. 事实与对象冻结且相互匹配；未知语义与歧义不推测。
3. 受限事实仅本地使用，正文不进 repr、日志或外部调用。
4. 关键替代关系和 HIGH/CRITICAL INCORRECT 必須人工复核；安全认证不猜测。
5. 无数据库写入或第二状态机；保留现有不可变和审核边界。

## 10. 契约变化
OpenAPI 无新增字段/枚举/operation；复用501合同。Database 仅补充事实选择/只读装配说明，无表/列/FK/触发器变化；无新 Alembic、历史数据回填或删除。head仍0054。

## 11. 后端实现
Router 无变更。Application Service：geo_fact_versions 拥有资格和只读列查询，避免 Session identity-map 陈旧值及 autoflush；geo_claim_rules 拥有有限明确的声明语义；geo_claims 拥有对象归属、结果和复核门禁。调用者拥有事务及 Run→Analysis→Fact 锁序，0054 在未来写入边界再验证资格；本任务不分配 revision、dispatch 或提交。纯阶段同输入同输出，错误为固定中文 ValueError，不回显正文。单次批量查询避免N+1；不跨 Subject 借事实。

## 12. 前端实现
不适用：无路由/query key/search params/generated 类型/页面状态变化；未接线分析状态保留。

## 13. 测试计划
Unit：共享金标+独立声明金标，参数/单位、封装、温度、认证、身份、生命周期、应用、方向/全部条件/部分条件/无条件替代、兼容性、事实不足、非批准/空事实、suffix/歧义/多对象、注入、不泄露 repr、无外部I/O。
PG：真实已批准/待审/退役/空白/同产品多版本事实、每个对象独立绑定、只读装配不 flush、不用工作区、陈旧 ORM 状态仍读取权威数据库。
Contract/fixture：make contract-check、make test-geo-fixtures。无新 UI 或 E2E 旅程；五项用户明确门禁全部执行。

## 14. 验收标准
只使用 APPROVED 非空同产品版本；无事实或不足输出 UNJUDGEABLE；参数/封装/认证/条件替代独立金标通过；受限事实不外发；关键替代复核原因存在。

## 15. 验证命令
基线：定向187 unit、16 PG 已通过（命令/log/exit_code 在 evidence）。最终 git diff --check、make lint、make typecheck、make test-unit、make test-integration（隔离 Compose）；增加定向 unit/PG、合同、fixture 和文档 SHA 校验。

## 16. 数据和上线
无新迁移/回填/开关/生产发布。隔离PG前滚至0054；撤回本地阶段代码不修改历史记录。后续506负责事务/强引用重验，不能由本任务代码声称落库完成。

## 17. 风险与停止条件
明确规则范围之外保守 UNJUDGEABLE；事实内冲突同样不猜；条件不完备不能 ACCURATE。仅用户列出的五类阻断标 blocked；环境验证失败精确记录。保持全部前序工作。

## 18. 完成证据
evidence 保存初始工作树/sha、修改前内容、实际验证命令/log/exit_code、增量diff与保留审查；implement.md 填写实际结果和未覆盖范围。实施及本地验证完成时提交 manifest/Trellis review；2026-10-03 用户明确人工接受后，manifest 更新为 done、Trellis 更新为 completed，验收依据见 implement.md。

## 19. 后续任务
GEO-506、GEO-604 及后续复核交付，仅记录不实施。
