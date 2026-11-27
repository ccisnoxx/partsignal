# GEO-607 Task Brief：完成洞察性能、索引和 R5 验收

## 1. 基本信息
- Task ID：GEO-607；发布：R5；负责人：主代理；状态：review。
- 依赖：GEO-606 done / Trellis completed，人工接受记录已核对。
- 分支：geo/GEO-607；未授权提交、推送、生产迁移或启用。

## 2. 目标
在真实 PostgreSQL 的至少100k Run数据下，验证常用30天洞察性能、查询计划、固定查询数和R5门禁，必要时以最小查询/索引调整消除已测瓶颈，业务事实始终可从运行与分析重建。

## 3. 关联需求
PRD §15.4、AC-METRIC-01～07、AC-REPORT-01～04；测试质量§12、路线图R5退出门禁；WBS GEO-607完整行为本任务授权。

## 4. 必读文档
用户指定18份GEO产品/业务/技术/交付/ADR文档、根/backend AGENTS、Trellis workflow/backend数据库与质量spec、当前OpenAPI和数据库合同、0048～0056迁移、601～606 Task Brief/实施记录与当前相关代码/测试。完整路径见 implement.jsonl。

## 5. 当前行为
任务开始时回答级总览、洞察、同筛选下钻和报告已实现，RR/autoflush=false，固定12应用SELECT。候选先按时间与冻结JSON维度、全局后继筛选，再在Python应用对象/产品交集。没有100k数据库fixture/P95/EXPLAIN门禁，606只验证100k合成CSV序列化。

## 6. 目标行为
提供可重复生成的虚构100k Run fixture；测量从认证HTTP入口至响应解析的常用30天P95，保留原始样本和环境；EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)对应真实查询；sparse/dense查询数恒定且无逐行SELECT；常用洞察≤3s，技术建议<2s单独报告。

## 7. 范围内
- [x] 虚构100k fixture、基线与候选测量、N+1和EXPLAIN检查。
- [x] 测量支持的必要索引/最小读取优化、ORM/数据库合同一致。
- [x] R5验收文档和用户指定完整验证。

## 8. 范围外
不实现GEO-902/905、Opportunity行动/规则/复测、Browser Collector、生产启用、指标公式/状态/权限变更；不升级依赖或改写历史迁移。

## 9. 业务不变量
PostgreSQL唯一权威，无指标可写缓存；保留冻结binding、最新attempt/current成功analysis/latest有效review；失败不作未提及；模式/点名/版本完整分栏；SOV集合不随目标筛选收缩；UNJUDGEABLE及未知费用不补零；守卫和审计完整。

## 10. 契约变化
OpenAPI预计无变化。数据库按真实计划新增必要索引，Alembic0057接0056；无新表/列/业务回填/历史改写；正常错误映射不变。

## 11. 后端实现
Router不拥有事务/锁/ORM写。读取优化归既有read service，RR、批量与固定SQL保持。fixture真实遵循创建/采集/分析/复核数据库守卫，不禁trigger、不改replication role。不涉及Worker/Collector调用。

## 12. 前端实现
无页面、路由、query key、URL状态或generated变更；现有真实栈由make verify验证。

## 13. 测试计划
Unit：现有指标/读取/报告；PG：冻结交集筛选、current/latest、迁移/metadata；Contract：runtime/generated；Security/Performance：100k/P95/SQL计数/查询计划；E2E：用户指定make verify既有旅程，不新增无关Browser矩阵。

## 14. 验收标准
100k运行规模可独立复现；常用30天洞察P95≤3秒；固定SELECT数且无N+1；索引计划及前滚可验证；无不可重建指标缓存；最终review等待人工验收。

## 15. 验证命令
`git diff --check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration COMPOSE=<隔离项目>`、新增性能/EXPLAIN命令、`make verify COMPOSE=<隔离项目>`。每个实际命令、退出码和阻断记录evidence/*.json及*.log。

## 16. 数据和上线
隔离geo607-validation PG16/Redis/fake-oss；性能数据在专有数据库生成和清理。索引前滚不改变历史；恢复通过关闭新读取路径/前向修复或仅移除新索引，禁止删除历史业务数据。生产未执行。

## 17. 风险与开放问题
索引只优化SQL，Python装配/序列化必须实测；冻结关系下推不能用当前可变Catalog当历史字典；性能阈值受环境与筛选影响，输出具体覆盖和限制；强制门禁的环境失败必须精确分类。

## 18. 完成证据
基线212 unit、31真实PG/HTTP通过。最终3559后端/1197前端单元、1006PG集成、100k性能/EXPLAIN及完整E2E/部署/Compose门禁通过；五场景P95 .147/.259/.252/2.874/1.506秒。初次verify因缺E2E连接环境exit2，补齐独立target环境后复用七个已成功目标，续跑exit0。仅取得两个有效单产品原源码性能基线，不宣称完整before/after；全对象洞察未达2秒建议。精确命令、失败、迁移、三次独立复核覆盖边界及范围审计见implement.md/evidence。Git初始脏树已有完整快照，不把历史差异冒充本任务修改。

## 19. 后续任务
GEO-902、GEO-905保持planned；未实施能力按manifest独立验收。
