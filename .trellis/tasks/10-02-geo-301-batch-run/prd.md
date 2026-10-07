# GEO-301 Task Brief

## 1. 基本信息
GEO-301 / R2；已由本会话用户人工审查并接受实现与测试证据，manifest=done、Trellis=completed，验收日期2026-10-02；负责人主代理；依赖 GEO-208、GEO-002 均为 done（manifest 与人工接受记录核对）。当前分支 geo/GEO-301。开始 planned，实施 in_progress，实现与本地验证后 review；没有提交、发布或生产数据库操作授权。

## 2. 目标
建立独立回答级 Batch/Run 公共数据组件和 PostgreSQL 模型，保存不可变输入、逻辑采样身份、追加 attempt、lease/dispatch、错误与费用元数据，为后续人工执行和异步采集提供可信边界。

## 3. 关联需求
WBS GEO-301 完整行；CAP-GEO-05；AC-PLAN-03/04、AC-BATCH-01、AC-RUN-01/05/06、AC-SEC-02；Accepted ADR-001/002/003 与 GEO-002 F01/F02/F03/F10 修订。

## 4. 必读文档
已读取用户指定 README、路线图、完整 WBS、执行指南、模板、manifest、PRD、页面规格、领域/状态机、技术/数据/API/前端/Worker/质量文档、ADR-001/002/003及评审记录。根和 backend/frontend AGENTS、backend spec、当前合同、0047、ORM/Schema/测试和依赖任务记录已核对。大文件按受影响的维护单元读取，不以标题替代合同。

## 5. 当前行为
Head 0047；Plan 四表和 API/矩阵预览已存在；run-now 是501占位。旧 GeoObservation 是文章关系观测；没有新 Batch/Run/答案表。无真实采集，默认 Registry 只有 manual。工作树有大量前序未提交成果，相关起点留 evidence/baseline。

## 6. 目标行为
仅新增 Batch/Run 数据组件及两表。输入快照不可改；cell+attempt 唯一，单一后继、同输入连续尝试；终态字段不可改；调度同计划同时间唯一且与revision无关。请求数量是初始逻辑cell数，尝试不扩大它；Batch状态可由runs重建，保存的status只作缓存。

## 7. 范围内
- Batch/Run schema、状态枚举、输入与计划/规则快照。
- attempt/previous、lease/external state/dispatch、revision、错误、provider/time/usage/cost字段。
- 稳定索引、CHECK/UNIQUE/FK、不可变与终态最终防线、0048迁移。
- 指定验证、必要定向测试、generated类型、权威文档、任务证据。

## 8. 范围外
GEO-302策略/动作、303工厂与创建幂等命令、304 AnswerSnapshot/Citation/文件、305人工提交、306读模型、401 Collector协议、Worker/调度执行、机器分析、指标/机会、真实外部调用、旧GeoObservation迁移。

## 9. 业务不变量
PostgreSQL唯一业务权威；Redis只传稳定ID。一次仅301。输入永久冻结，原attempt终态保留；更换问题/环境新batch。Batch计数按初始cell，费用保留全部attempt但不实现指标公式。Plan可变与历史快照独立。敏感凭据不进入快照/响应。

## 10. 契约变化
OpenAPI新增标准components，不新增HTTP operation或放宽runtime gate。数据库两表及0048（down=0047），仅expand，不回填旧数据，不默认downgrade。具体列、CHECK、唯一键与错误边界见根数据库合同；模型与迁移必须一致。

## 11. 后端实现
无新Router/Application Service/Collector。数据边界提供revision与命名约束；状态策略、事务工厂、锁资格和命令错误映射由302/303/405等实施，不伪造成功。数据库只执行不可变、attempt关联和生命周期结构最终防线，不投影动作。

## 12. 前端实现
仅OpenAPI generated类型。无路由/query key/URL状态/组件变化，无前端状态机；当前运行入口仍不可用。

## 13. 测试计划
基线unit162通过、真实PG73通过（4个既有SQLAlchemy warning）。新单元验证Schema/OpenAPI真实payload、闭合快照与未知状态/敏感键拒绝。PG验证空库/0047前滚与旧数据保留、metadata、命名CHECK/唯一、attempt链与并发仲裁、输入/终态UPDATE/DELETE反例。按用户运行全部最低门禁；无新HTTP完整旅程，不跑浏览器或真实provider。

## 14. 验收标准
直接SQL改输入失败；终态不能回退/被迟到结果改写；一个cell同attempt只能一行、一个失败attempt最多一个后继；重试保留原输入/请求数。初始run集合可重建数量，Batch cache不是事实源。旧数据/表/迁移不改写。

## 15. 验证命令
精确结果留implement.md/evidence：git diff --check、make contract-check、make lint、make typecheck、make test-unit、make test-integration（隔离Compose）、uv run --project backend alembic -c backend/alembic.ini upgrade head（隔离DATABASE_URL），以及定向pytest。

## 16. 数据和上线
新入口仍关闭，无配置改变。隔离PG16/Redis/fakeOSS执行迁移与测试；不触及生产。安全停止/恢复用前向修复或备份；downgrade拒绝删除历史。收尾清理本任务环境，恢复起点Colima停止/default context。

## 17. 风险与开放问题
已接受ADR允许合同任务细化计数/状态选择，本次design明确同批次追加尝试与Batch可重建缓存；不改变原Run终态。后续工厂必须接入历史锁存/引用计数/授权与审计；后续答案约束只能304引入，不用假答案支持301。停止条件限用户五项；环境失败记录而不冒充业务blocked。

## 18. 完成证据
基线和起点已留evidence；最终命令、迁移、独立只读复核、增量diff与审计Digest已留证；精确结果见 implement.md。实现阶段交付review；现已依据用户明确人工验收更新manifest=done、Trellis=completed，completedAt=2026-10-02。原始证据保留，未提交/PR/部署或归档。

## 19. 后续任务
GEO-302、GEO-303、GEO-304、GEO-401及各自后续，本次不实施。
