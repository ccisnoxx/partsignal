# GEO-702 Task Brief

## 1. 基本信息
GEO-702；Opportunity 模型、identity和评估器；R6；in_progress；主代理负责根合同及集成。依赖GEO-701/603/604均done且有人工接受记录。当前分支geo/GEO-702；无提交/发布授权。

## 2. 目标
系统从同口径有效观测批量评估初始规则，确定性去重开放机会，保留首次触发证据及后续评估，不从未知或低样本数据制造异常。

## 3. 关联需求
AC-OPP-01/02、REQ机会规则和CAP机会闭环的数据与评估切片；不包含AC-OPP-03起的行动/复测。

## 4. 必读文档
用户列出的20份GEO文档、根及backend AGENTS、backend数据库/错误/质量规范，OpenAPI/database，0054～0058、701/603/604任务设计及接受记录。全部目标文档另由只读合同分析代理核对。

## 5. 当前行为
701保存完整配置快照及统一SamplePolicy；603/604按一致快照投影指标、趋势、声明、引用和质量；机会未实现占位。无Opportunity表/identity/evaluator。基线164unit/30PG通过；首次PG启动runtime镜像缺pytest，已构建test target并获得通过证据。

## 6. 目标行为
十条规则返回值/阈值/分子/分母/来源及不可用原因；同identity最多一条开放机会，新来源/评估追加、历史触发值冻结。无法评估时保存评估结果，无误导性Opportunity。重复相同输入无额外revision。

## 7. 范围内
opportunities/sources/actions、持久化评估记录、确定性identity、纯规则及状态策略、批量应用服务、合同/迁移/定向测试。

## 8. 范围外
703 API/读模型/工作台及ack/dismiss命令；704跨域行动创建；705/706复测/比较/解决命令；707E2E闭环；Browser、生产保留、上线、无关重构/依赖升级。

## 9. 业务不变量
PG唯一业务状态；指标沿用601资格和603可比门禁；NEEDS_REVIEW未复核排除。低样本/无分母/未配置不能触发。首次trigger snapshot不可变，sources/actions/evaluations追加保留；关闭需原因且禁止终态回退；不得自动解决。无引用不能猜成可观察0。

## 10. 契约变化
OpenAPI只增加数据组件不operation，并生成前端类型。Database加四表和开放identity partial unique、来源去重、不可变/状态守卫及Batch真实机会来源FK。0059加法迁移，禁止猜测回填；历史悬空机会来源显式失败。

## 11. 后端实现
Router不变。纯规则与应用服务分离。写事务重验并锁User，再独立一致读捕获current rules、latest attempt/current有效分析Review；写入沿Product→品牌→Subject→排序identity advisory lock→Opportunity row，partial unique最终裁决。首次快照不修改，重复来源/评估无副作用。现有用户/资源删除保护补实际引用。

## 12. 前端实现
只generated数据类型，无路由/query key/URL/页面变化。

## 13. 测试计划
单元：10规则阈值/样本/不可比/未配置/状态机/identity。PG：同键并发、重放、追加新证据、周期/关闭后去重、规则更新历史不变、原子回滚、直接SQL守卫、迁移/metadata。无用户旅程变化，不运行后续闭环E2E。

## 14. 验收标准
同identity并发最终一条开放记录；低样本/不可用只评估记录；有来源ID/规则实际配置/阈值/值/不可用原因；重复评估不改旧snapshot；新周期按identity区分；状态策略和数据库守卫一致。

## 15. 验证命令
git diff --check、make lint、make typecheck、make test-unit、make test-integration COMPOSE=<独占配置>、uv run --project backend alembic -c backend/alembic.ini upgrade head。追加contract-check和精确定向检查，结果以evidence JSON退出码为准。

## 16. 数据和上线
机会开关默认关闭；不启用生产、不真实外部AI。0059无历史回填，迁移有界超时和事务回滚；已引用历史禁止破坏性downgrade，备份恢复或前向修复。

## 17. 风险与开放问题
规则与去重窗口按方法文档/701统一；锁顺序/并发唯一/不可变/迁移由真实PG和fresh独立复核验证。只用户五类停止条件blocked。

## 18. 完成证据
evidence基线哈希/manifest前像及逐命令日志；design.md、implement.md；审计Bundle；最终只review不done，不提交/归档。

## 19. 后续任务
703→704→705→706→707，不实施。
