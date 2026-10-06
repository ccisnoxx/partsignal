# GEO-704 Task Brief

## 1. 基本信息
GEO-704：集成事实修订、内容任务和发布修复行动；R6；review；主代理负责根合同及实现。唯一依赖GEO-703 manifest=done，Trellis=completed且有2026-10-04人工接受记录。当前geo/GEO-704；不提交、推送、发布或标记done。

## 2. 目标
ADMIN/ENGINEER确认机会后，可通过现有服务创建内容任务、打开事实修订工作区、创建/关联发布问题及创建修复任务。GEO追加稳定行动链接、完整来源身份与触发快照，失败不留下半条关联；目标完成不自动解决机会。

## 3. 关联需求
CAP-GEO-13；AC-OPP-03/04/05；AC-AUDIT-01/02；AC-SEC-02。业务状态机§11、PRD§9.7/13、API设计§1.3/11.1。

## 4. 必读文档
根/backend/frontend AGENTS；.trellis/workflow及受影响backend/frontend规范；用户指定20份GEO文档（README、roadmap、WBS、execution guide、template、manifest、PRD、页面、四份业务、数据/API/前端/测试/技术架构、ADR001/002/004）。按文档结构读取当前任务相关完整章节，复测和指标规则仅核对边界；不实施其他任务。GEO-702/703现有任务与接受记录；根OpenAPI/database、0059SQL及相关目标服务/调用者/测试。正文完整合同由根文件维护。

## 5. 当前行为
702四表与不可变来源；703机会RR读模型、ack/dismiss及工作台；行动仅数据结构/只读。内容服务有commit=False，普通请求不接收主题；发布问题/修复服务自行commit；事实使用唯一Markdown工作区。目标领域无Opportunity自动解决逻辑。大量既有dirty变更；621路径起始SHA及/tmp/partsignal-geo704-before保存可比较内容。

## 6. 目标行为
三个actions HTTP操作；事实只打开对应产品工作区；内容用户明确选择批准事实和发布平台，主题来自机会；发布可打开问题、关联开放问题、从问题创建修复任务。来源不跟新current analysis/review漂移；响应带导航和目标可用性；同键重放不重复创建或审计。

## 7. 范围内
- [x] 三行动API与闭合请求/响应、服务端资格
- [x] 现有目标服务事务组合及内部主题传递
- [x] 行动来源快照、幂等、revision、原子审计
- [x] 目标删除保护、合法永久删除后保留历史
- [x] PG/合同/单元及指定门禁、相关E2E
- [x] generated类型、已有行动导航、当前实现文档与review状态

## 8. 范围外
GEO-705及以后；补充观测、复测/基线/解决/继续；完整闭环、规则/指标变更、Browser、生产保留/迁移/上线、真实外部AI、无关重构/依赖升级。无新前端创建表单。

## 9. 业务不变量
目标写入唯一由原领域服务拥有；PG唯一状态、Redis无新消息；Router不拥有事务/行锁/写入。用户确认后才可行动，首行动ACKNOWLEDGED→IN_PROGRESS。首次trigger、全部来源及行动追加历史不改。目标完成不关闭机会。用户不得指定任意产品或用GEO观测面替代发布平台。历史缺快照为null，不造历史。

## 10. 契约变化
OpenAPI：actions/fact-revision、content-task、publication-repair，required expected_revision及Idempotency-Key；返回行动回执和来源。发布请求按OPEN_ISSUE/LINK_ISSUE/CREATE_REPAIR判别。现有详情追加来源/导航/可用性和可创建类型。Database：0060加法行动元数据、actor/key摘要唯一及结构约束/目标守卫；无业务历史回填，旧行列为null且保持不可变。

## 11. 后端实现
Application Service READ COMMITTED：User非键锁→行动键事务advisory→目标领域原资源锁→Opportunity FOR UPDATE刷新/CAS→行动/revision/audit→commit。目标服务commit=False且异常必须终止外层；不允许root rollback后继续关联。请求同键同完整payload重放首次回执，异载荷IDEMPOTENCY_CONFLICT；不同键旧revision为REVISION_CONFLICT。快照含首次trigger、全部当时source身份、选中目标/事实/平台/主题及request ID，不复制回答/事实正文/凭据。Read模型批量目标存在性，无N+1。

## 12. 前端实现
只消费generated新增字段，在已有行动记录中显示到现有目标路由的链接和MISSING；来源机会ID留在导航。无新query key/筛选/状态机/创建表单。已有loading/error/409/权限及Drawer焦点保留。

## 13. 测试计划
Unit/Contract：请求闭合、发布判别联合、服务端行动资格、实际响应root schema。PG：三领域创建/导航、来源冻结、角色/CSRF、stale/closed、同键及异键并发、审计/flush/commit回滚与Session恢复、产品/事实/平台/issue归属、删除守卫与合法永久删除、内容完成/事实获批仍IN_PROGRESS。相关frontend组件与E2E只验证实际新行为，不实现705闭环。

## 14. 验收标准
1. 目标域写入来自现有服务；调用失败无目标/行动/成功audit残留。
2. 机会关联已批准事实/发布平台/主题及来源身份，后续来源追加不改行动快照。
3. 同请求键只生成一个目标及行动；原始revision重放仍回原回执。
4. 目标完成不解决机会；终态拒绝新增行动但历史可读。
5. 普通删除不破坏行动历史；管理员合法归档aggregate永久删除后稳定ID/快照保留、目标显式MISSING。

## 15. 验证命令
git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE=独占配置；make contract-check；相关定向pytest/组件/E2E。每项命令和exit/log写evidence。

## 16. 数据和上线
0060前滚后部署API；不回填旧行动、不改0059及冻结历史。默认开关保持；无外部调用。downgrade拒绝销毁行动历史，失败整体回滚或前向修复。只迁移独占PG测试库，不操作生产。

## 17. 风险与开放问题
提前commit、root rollback释放锁、领域/Opportunity锁序、目标删除与历史引用、同键并发及敏感数据。具体设计见design.md，独立critical review验证候选。仅用户列出的业务冲突/破坏迁移/已批准边界改变/必需授权缺失/依赖未完成条件可blocked。

## 18. 完成证据
基线389相关unit、18PG通过（2既有metadata警告）；baseline命令/退出码/log见evidence。最终测试/前滚/差异/独立review记录implement.md；最终manifest=review、Trellis status/delivery_status=review，完整门禁通过，不done、不归档。

## 19. 后续任务
705复测→706比较/解决→707完整闭环；本次不实施。
