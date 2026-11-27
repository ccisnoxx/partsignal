# GEO-205 Task Brief：观测面与 Profile 管理

## 1. 基本信息

Task ID GEO-205，R1；状态 completed（2026-10-02 本会话用户人工验收；manifest=done）；主代理负责根合同与集成。唯一依赖 GEO-204=done，manifest 与 Trellis completed/人工接受一致。分支 geo/GEO-205 已存在；不提交、推送或发布。

## 2. 目标

管理员管理观测面及三模式采集配置的非敏感信息，执行 CRUD/启停，看到真实 UNTESTED 与服务端阻断。ENGINEER 只能读取摘要；管理操作不执行采集。

## 3. 关联需求

CAP-GEO-03/16；PRD 10.2 Surface/Profile、14 权限安全审计、AC-SEC-01/03；页面规格12.1；WBS GEO-205完整行。没有引入未定义的 REQ 编号。

## 4. 必读资料

根/后端/前端 AGENTS、.trellis/workflow、受影响层 spec；用户列明的 README、roadmap、WBS、execution-guide、task-template、manifest、vision、PRD、page-spec、business-architecture、domain-model、state-machines、technical/data/API/frontend architecture、testing-and-quality 与 Accepted ADR-001。相关条款按完整最小章节读取。GEO-203/204记录、根OpenAPI/database、0046与当前代码测试是实现依据。

## 5. 当前行为

0046已创建两表与结构/版本守卫；Schema冻结闭合配置/判别联合，默认停用/UNTESTED。GEO-204默认Registry仅manual，单SQL当前资格读取不加载凭据正文。没有Surface/Profile管理API或页面。Catalog/问题库独立。起始工作树有前置任务未提交改动，initial-status/hashes与before文件保存在evidence。

## 6. 目标行为

ADMIN CRUD/启停，两资源独立revision；列表筛选分页、详情、typed actions/blockers。ENGINEER同一路径仅摘要，configuration=null、无写动作。新配置inactive/UNTESTED，无test endpoint或外部请求。enable通过GEO-204当前资格；BROWSER未批准不能启用。

## 7. 范围内

14个CRUD/启停端点；服务端动作/删除/启用阻断；非敏感管理员表单及只读摘要页；权限/CSRF/revision/事务/审计/敏感回显、组件与目标浏览器验收；实际涉及合同/文档一致性。

## 8. 范围外

GEO-206 Plan、GEO-403连接测试及模型生命周期资格失效、GEO-806 browser session/健康/频率；Batch/Run、Collector transport、真实provider、指标/机会、生产变更、无关重构/依赖升级。

## 9. 不变量

模块化单体、PG权威；Router无事务/锁/ORM写；Service owns revision。三模式结构/身份保持0046。未知adapter明确拒绝不回退；CRUD不等于运行许可。角色摘要与配置显式投影；秘密不进入Profile、响应、日志/审计。停用不改历史，当前引用保护不伪造未来Run/Plan计数。

## 10. 契约变化

OpenAPI新增14 operations、读模型/列表、动作/阶段/blocker/revision与精确领域错误，保留既有Create/Update/Out数据组件。database只补服务合同，不改表列/约束；head 0046，无新revision/回填/历史迁移。

## 11. 后端实现

读认证前RR+禁autoflush，固定批量查询、安全投影，不join秘密正文。写命令舍弃认证待写last_seen heartbeat；User FOR NO KEY UPDATE后重读ADMIN，锁序User→AIChannel(稳定UUID)→AIModel(稳定UUID)→Surface→Profile。初读绑定只选锁集合，锁后比对绑定/revision。实际变更revision+1，no-op不改时间/审计。业务和白名单成功审计同事务；精确SQLSTATE+约束映射，未知错误rollback原样失败。无Idempotency-Key/自动重放，唯一键仲裁重复创建。

Profile create/update验证登记adapter的闭合配置；新建UNTESTED，实际配置更新清除测试事实并停用（不测试、不自动启用），禁止换模式。enable以假设active=true的当前快照调用同一evaluate_profile并锁后重验。MANUAL受总开关/Surface启用；自动另受子开关/合规/adapter批准/环境/测试/模型资格。Surface中立启用不启动采集，合规变更立即影响资格。

## 12. 前端实现

/configuration/geo-surfaces，domain geo-catalog；唯一query key owner。URL owns tab/q/is_active/surface_id/profile_id/page/page_size，默认省略；generated DTO，无动作/资格推断。表单baseline独立Query，后台刷新/409保留输入；显式读取最新后用户再次提交。dirty/卸载/principal guard，写不自动重放；loading/empty/error/forbidden/deleted/blocked/complete与键盘、焦点、窄屏。

## 13. 测试计划

基线Surface/Registry/Settings/contract unit、Catalog frontend、隔离PG Surface/Profile/资格。新增真实API权限/CSRF、摘要差异、CRUD/revision/no-op/精确唯一/历史及真实子引用/安全审计、BROWSER门禁；真实PG并发和rollback；组件覆盖状态/动作/409/URL；目标真实API E2E验证持久化与ENGINEER摘要，浏览器仅本地。

## 14. 验收

ADMIN创建后inactive/UNTESTED；MANUAL可按门禁启停；未批准BROWSER enable失败无成功审计。ENGINEER list/detail仅summary，无配置/设置/绑定/动作，全部写403；缺失/错误CSRF拒绝。stale revision无副作用；未知adapter不回退；不调用provider、不创建Run。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（专用COMPOSE）；npm --prefix frontend run test；npm --prefix frontend run typecheck；定向PG/目标E2E。精确命令/exit/log记evidence，未运行不算通过。

## 16. 数据和上线

无新迁移/回填/seed/生产变更。新自动能力默认关闭，CRUD不发请求。专用project/volumes测试当前head前滚；不使用共享DB，结束恢复初始Colima停止/default context。

## 17. 风险与停止条件

编辑/启用与模型删除须按绑定锁序重读；审计失败整体rollback；读取不能泄漏秘密。仅用户列明业务冲突、未批准破坏迁移、改变批准状态机/安全边界、必需外部输入/授权缺失、依赖未完成时blocked。环境失败精确记录，不放宽边界。

## 18. 完成证据

实施、实际命令、独立只读复核、最终diff/范围证据与审计Digest记implement/evidence。本地验证后manifest/Trellis=review、completedAt=null，不自行done/归档。

## 19. 后续任务

GEO-206、GEO-403、GEO-806，以及后续计划/采集/指标，仅列出不实施。
