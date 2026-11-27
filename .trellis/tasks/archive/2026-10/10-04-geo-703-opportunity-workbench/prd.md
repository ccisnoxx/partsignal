# GEO-703 Task Brief

## 1. 基本信息
GEO-703：Opportunity API、读模型和工作台；R6；review；主代理负责根合同和后端，前端单独所有权。唯一依赖 GEO-702：manifest done，2026-10-04 用户人工接受，Trellis completed。当前分支 geo/GEO-703；不提交、推送或发布。

## 2. 目标
ADMIN/ENGINEER 能按 URL 条件浏览机会、查看保留的触发依据及原始证据，并使用服务端投影动作确认或填写原因驳回。刷新和浏览器历史恢复筛选与 Drawer。

## 3. 关联需求
CAP-GEO-12、AC-OPP-01/02/05、AC-AUDIT-01/02、AC-SEC-02；工作台切片不交付 AC-OPP-03/04 或复测。

## 4. 必读文档
用户指定的20份GEO文档（含三个ADR）；根/backend/frontend AGENTS；相关 .trellis/spec；702 prd/design/implement与接受记录；contracts/openapi.yaml/database.md、0059冻结SQL、机会规则/服务/测试、相邻 GEO Drawer/API/审计/真实栈入口。完整文档核对另有只读分析任务。

## 5. 当前行为
702保存4表、完整规则快照/来源、确定性identity、追加评估与状态守卫；尚无Opportunity operation、读模型或工作台。总览及CSV保留占位。API类型已有702数据组件。当前工作树存在大量前序任务改动，evidence/baseline-files.json记录起始SHA、/tmp/geo703-baseline保存可比源码。

## 6. 目标行为
新增列表与详情一致读、acknowledge/dismiss命令；列表字段含规则/优先级/维度/触发值阈值分子分母/时间/状态/revision/服务端动作。详情显示首次快照、最新评估、按历史analysis/review身份读取的来源、原始答案/引用/文件、处理记录。关闭后证据保持可读。

## 7. 范围内
- [x] 4个HTTP操作及公共请求响应组件
- [x] 定向一致读与批量证据，确认/驳回CAS及原子审计
- [x] /geo/opportunities，URL筛选分页/选中机会，Drawer及页面状态
- [x] 权限/revision/并发/组件/真实API E2E与用户指定门禁
- [x] 根合同、当前实现文档、任务证据与manifest同步

## 8. 范围外
704跨域行动创建/导航命令；705基线/复测；706resolve/continue和前后比较；707完整闭环；Browser、生产数据保留/迁移/发布、真实外部AI、总览或CSV占位接线、无关重构/依赖升级。

## 9. 业务不变量
PG唯一状态；首次trigger/source/analysis/review不可变；状态与available_actions服务端拥有；命令重验身份/权限/CSRF/CAS；dismiss code/comment trim非空；终态不能回退；任务完成不自动解决；前端generated唯一类型，不推导动作或公式；输入草稿不进URL/审计。

## 10. 契约变化
OpenAPI：列表/详情、acknowledge/dismiss operation，闭合状态动作读模型、分页筛选、required expected_revision、非空关闭code/comment，401/403/404/409/422及证据签名503。Database：只记录703事务/一致读语义，复用0059，无表列索引/新Alembic，无历史回填。

## 11. 后端实现
Router仅HTTP/认证/CSRF/响应；Application Service拥有RC事务，User NO KEY UPDATE→Opportunity FOR UPDATE刷新identity map，锁后CAS和现有状态政策，revision+1、服务器时间/actor及低敏成功审计原子提交；重复/过期请求明确409，无自动重放。读请求认证前RR禁autoflush，固定次数批量查询；来源绑定已保存analysis/review而非新current，文件复用已有受控签名边界。

## 12. 前端实现
URL包含筛选、排序、列表分页、opportunity_id与来源分页；domain唯一query keys，AbortSignal、mutation不重试，成功更新canonical并失效列表，409保留原因并只在显式刷新后允许再次提交。首载/后台失败/空页/权限/缺资源/不可用证据状态明确；Drawer键盘、焦点返回与窄屏无根溢出。前端只映射typed状态与动作。

## 13. 测试计划
Unit/Contract：请求非空边界、typed投影、非法状态和schema实际实例。PG：权限/CSRF、筛选稳定分页/固定查询数、历史分析一致证据、关闭保留、stale及重复409、同revision并发单赢家、审计失败原子rollback、锁后身份重验。组件：URL/动作投影、loading/empty/error/409草稿与显式刷新、分页/焦点。E2E：真实API机会fixture→Drawer证据→ack→dismiss→刷新/Back恢复；虚构数据，无真实外部AI。

## 14. 验收标准
列表/详情/命令同一状态与动作政策；ENGINEER/ADMIN可处理；非法/旧revision无副作用；驳回必须原因且永久保留证据；历史review不被当前新review替换；URL刷新/历史恢复；服务端筛选排序总数正确；Drawer键盘可用；没有704/706假按钮。

## 15. 验证命令
git diff --check；make lint；make typecheck；make test-unit；make test-integration COMPOSE=独占配置；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；make contract-check；精确定向pytest/Vitest/E2E。每项argv/exit_code/日志保存evidence，不把未运行写成通过。

## 16. 数据和上线
无新migration；0059在独占数据库前滚验证，已有数据不回填；不修改部署开关/启用生产，关闭评估不阻止历史读取和人工处理；错误安全rollback。签名响应no-store，正文和原因只在授权读取中出现。

## 17. 风险与开放问题
证据漂移、并发CAS、权限竞态和日志泄露用定向证据及fresh独立只读复核。仅用户五类条件可blocked：不可消解文档/ADR冲突、未批准破坏迁移、改变已批准指标/状态/安全、缺必需外部输入/授权、依赖实际未完成。环境失败准确记录，先完成可执行验证。

## 18. 完成证据
基线：107后端unit、126前端test、14真实PG通过；命令与日志见evidence。最终证据已更新implement.md；差异/独立review/validated SUBAGENT_EXECUTION_DIGEST保留。实现及本地验证完成manifest→review，不done、不归档。

## 19. 后续任务
GEO-704→705→706→707，不提前实施。
