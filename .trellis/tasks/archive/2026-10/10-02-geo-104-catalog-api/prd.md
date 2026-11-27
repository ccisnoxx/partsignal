# GEO-104 Task Brief：Catalog 应用服务和 API

## 1. 基本信息
Task ID：GEO-104；R1；状态 done，2026-10-02 本会话用户人工审查并接受实现与测试证据（Trellis completed）；负责人主代理；依赖 GEO-103（manifest done，实施记录含人工接受），GEO-101/102 done；分支 geo/GEO-104 已存在；无 Commit/PR。

## 2. 目标
管理员可管理监测对象、别名和域名，工程师只读完整列表/详情；每次真实写入维护版本、引用保护和成功审计。

## 3. 关联需求
CAP-GEO-01；AC-SUB-01/02/03；AC-AUDIT-01/02；统一权限和CSRF要求。

## 4. 必读资料
docs/geo-monitoring/README.md、04-delivery/01～05、task-manifest.yaml；01-product/01～03；02-business/01～03；03-technical/01～04及07；ADR-001；根AGENTS、backend/AGENTS、.trellis/workflow、backend错误/数据库/质量规范；GEO-101～103任务记录；contracts/openapi.yaml和database.md的Catalog及Product/User合同；0044迁移、Catalog ORM/Schema/policy/projector、相邻服务和测试。

## 5. 当前行为
0044已有三表/约束/身份守卫；GEO-103提供规范化、父子/歧义策略和纯投影；12个操作为CONTRACT_ONLY，无Router、CRUD、真实计数和Catalog审计。Product/User未纳入Catalog引用。旧文章级GEO仍独立。基线单元132 passed；PostgreSQL基线结果写implement.md。初始dirty工作树不可归于本任务，evidence保存指纹/快照。

## 6. 目标行为
12个冻结操作接线，ADMIN写/两角色读；事务、锁内revision、no-op、精确约束、稳定排序分页、引用计数及审计可由真实PostgreSQL/API验证。

## 7. 范围内
Subject CRUD/enable/disable；Alias create/update/delete；Domain create/delete；批量一致读/子引用；Product/User生命周期接线；合同、generated类型、测试、文档与状态。

## 8. 范围外
GEO-105/106及其他任务；新Batch/Run/分析/计划/机会表和业务；外部采集、真实AI/OSS、指标；新页面/路由/query key；无关重构、依赖大版本升级、生产操作。

## 9. 不变量
Product唯一事实 owner；OWN_PRODUCT只保存ID；Subject类型/product/创建信息不可变；父Subject统一拥有子revision；有真实引用不能物理删除；业务写入/revision/审计原子；未知IntegrityError保留；Router无事务/锁/ORM写入。

## 10. 契约变化
OpenAPI：冻结12操作迁入paths、移除扩展；Product删除blocker枚举增加GEO_SUBJECT；既有Schema/error语义不变。Database：不新增DDL，仅更新应用接线/生命周期状态。Alembic head沿用0044，无历史回填/新revision。

## 11. 后端
Router仅参数/认证/CSRF/响应。应用服务按Product→旧/新品牌去重UUID升序→目标Subject→子项持锁，锁后重验revision/身份；不自动重放。Subject PATCH/子写真实变化恰好+1，no-op不增版本/审计。错误只在具体业务flush边界匹配精确SQLSTATE+constraint；审计和commit失败保持unknown并回滚。查询在认证前建立REPEATABLE READ并关闭纯读autoflush，同快照批量Product/父级/字典/引用，查询数固定。当前仅CHILD_SUBJECT域存在；其余域未实施所以无引用行，不创建占位表/假查询。

## 12. 前端
generated OpenAPI类型同步，Catalog页面/路由/query key/URL状态留GEO-105；必要的既有删除/审计投影兼容只按实际公共变化处理。

## 13. 测试计划
单元：精确diagnostics正反例及scope；契约：runtime与根合同及generated；PG/API：CRUD、PATCH省略/null、no-op/stale、字典唯一、父子/子归属、删除计数、Product/User阻断、安全审计、权限/CSRF；并发：真实锁等待、唯一竞争、更新/删除与引用竞态。无UI/Worker变更，不运行对应E2E或真实平台。

## 14. 验收
有直接引用的删除返回409，停用成功且引用不改；只有精确已登记约束映射业务错误；子成功返回完整父投影；ENGINEER所有写入口403；失败无部分写入/版本/审计；列表/详情读取同一快照且无N+1。

## 15. 验证命令
基线Catalog单元及PG现有Catalog测试；真实Cookie并发读/写及Unicode当前Product搜索反例；git diff --check；make lint；make typecheck；make test-unit；make test-integration（独立Compose project/样例env覆盖）；make contract-check；按风险增加定向API/并发测试。

## 16. 数据和上线
不改启动配置、不启用自动采集；Catalog CRUD为配置能力，无外部调用。使用0044既有expand迁移；无历史回填、生产迁移、downgrade。恢复为代码回退/前滚修复或迁移前备份，不删除Catalog历史。

## 17. 风险与停止
锁后过期状态、跨父级写、唯一冲突、删除/引用竞态和审计失败原子性通过定向真实PG覆盖。仅不可消解业务/ADR冲突、未批准破坏性迁移、改变已批准边界、必需输入/授权缺失或依赖未完成时blocked；环境验证限制精确记录。

## 18. 完成证据
implement.md及evidence保存命令/退出码/日志/起始与最终范围核对；候选需独立只读复核；manifest/Trellis仅review，不自行done，不提交/归档。

## 19. 后续任务
GEO-105页面，GEO-106纵向验收；后续实际引用域新增时接入同一计数/RESTRICT FK/锁合同，本轮不实现。
