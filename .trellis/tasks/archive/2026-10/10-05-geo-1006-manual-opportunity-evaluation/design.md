# GEO-1006 设计

入口 POST /api/v1/geo/opportunities/evaluate，200 同步回执，无 CLI。ALL 表示所选模式窗口内全部观测，不能同时带实体过滤；FILTERED 必须有 Subject/Surface/Profile 至少一类过滤，过滤按既有 Overview AND/集合 OR 语义。模式可选，不选表示全部历史模式。窗口最多 31 天以限制同步管理操作范围，每类最多 50 UUID；没有候选仍明确返回不可用原因。

规则 revision 显式读取 geo_rule_set_revisions，不依赖可变 current 指针；旧 revision 合法，不存在显式 404。原领域服务保留 current 默认供已知测试调用者，所有执行均在 User 行锁内重验 ADMIN、active、改密和 READ COMMITTED。

geo_opportunity_evaluation_runs 保存 actor+key SHA 唯一键、canonical request SHA、请求快照、规则 FK 与冻结摘要。User→请求 advisory lock→现有 Product/Subject/identity/Opportunity 锁序；同用户同请求竞争串行，DB unique 最终保护。重放先资格/开关，再查历史，不重评、不追加成功审计。输入规范 UTC、集合去重排序。异常回滚整次业务事务；运维观测由管理入口覆盖最终提交。

evaluate_opportunities 增加显式 revision 和可选 commit=False，以便新事务 owner 原子保存摘要/审计；规则只实现一次。每个 EvaluationResult 带本次捕获 as_of 和不可用原因。计数 evaluated_cells 为规则×范围结果数（包括 NO_CANDIDATES）；created 仅本次非重放 CREATED；existing_reused 为所有已有 opportunity 引用；其他归 skipped；reason count 按评估结果计数。三类计数之和等于 evaluated_cells。

0066 加法迁移，不回填或改历史；回执禁止 UPDATE/DELETE/TRUNCATE、用户/规则 FK RESTRICT，用户删除 owner 计入回执。升级失败事务回滚；降级安全停止并要求前向修复或迁移前成套备份恢复。

审计只保存范围、规则 revision、数量、原因代码、as_of 和筛选摘要 SHA，不保存原始 key、Cookie、回答/事实、URL/过滤原文。新审计字段同步现有前端正向白名单，关联对象按现有 UNSUPPORTED 语义展示；无需新操作页面。

未知故障仍沿既有HTTP500边界，Router只保留AppError业务响应，其他异常退出except后抛出固定RuntimeError，清除底层SQL/验证正文的异常上下文；已安装Starlette会把__context__提升为__cause__，仅from None不能阻止该框架重新连接原异常。领域事务仍先rollback，运维事件保留OPPORTUNITY失败。API/幂等测试与SQL迁移/历史守卫按实际变化边界分开，避免把新维护测试模块扩展超过500行。
