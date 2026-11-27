# GEO-701 实施与验证记录

## 当前状态与入口

实现与本地验证完成，manifest/Trellis=review；completedAt=null，等待人工接受。GEO-601已done/completed并核对人工接受，GEO-702保持planned。进入分支即geo/GEO-701，未创建/切换分支，未提交、推送、PR或生产启用。

读取了用户全部指定文档、完整WBS行、根及backend/frontend AGENTS、相关spec、当前合同/实现/迁移/测试；编码前向用户输出12项preflight并创建19节Task Brief。README §4的治理优先级消解PRD与指标方法的3组默认样本差异：下降/主题用STABLE5，重复错误跨3运行。初始误判blocked已撤销，保留resolved_by_document_precedence证据；没有新增人工裁决或改变601公式。

## 实现

- PG单一当前指针与追加不可变revision，完整规则配置JSONB。REPORTABLE/STABLE默认3/5，下降0.10、竞品0.15、自有引用前期2、重复错误3运行/30天、稳定性3重复/0.67、去重30天。质量数值/连续失败次数未批准默认，初始null不猜测。
- 恢复配置minimum_runs5、回到基线0、主题可见率0.6、引用1、事实错误0、稳定性0.67；严格可比/人工确认固定true。这里只交付配置，恢复比较/状态转换由706实现，不能用恢复最低样本降低对应指标冻结样本资格。
- GET/PUT /api/v1/geo/rules和POST /preview，管理员权限，PUT/preview CSRF，闭合严格Schema。preview仅CONFIGURATION_AND_SAMPLE_GATES，展示拟用完整快照/样本等级/十规则资格，不计算Opportunity触发。未来正式评估复用FrozenRuleSet、SamplePolicy、sample_gates。
- 新批次创建事务一次捕获current实际值，v2保存完整configuration+revision，Plan/Run输入使用相同revision。幂等重放保持原批次，不读取新规则覆盖旧快照。未来Opportunity须保存GeoRuleSnapshot完整值；本任务没有Opportunity实体，不能虚报Opportunity持久化验收。
- /configuration/geo-rules管理员表单、generated API类型、唯一query key、结构化阈值/恢复/去重、null与0区分、canonical保存/刷新。dirty/409保留输入，显式加载最新基线不自动重提；preview输入变化失效、取消/卸载/令牌ABA和principal epoch保护。工程师403保留地址且不请求配置。
- 审计geo_rule_set.updated白名单仅revision；created_by强引用纳入既有用户历史删除阻断。没有日志或响应保存答案、事实正文、URL、凭据或新增外部网络访问。

## 事务、锁和错误

Application Service独占更新事务；Router只协议/认证/委派。更新User FOR NO KEY UPDATE→current FOR UPDATE，锁后重验账号/改密/管理员，CAS expected_revision；实际更新insert revision→pointer+1→审计→commit。异常全部rollback，同值无revision/audit。两位不同管理员并发同基线只有一次commit、一条audit，另一位409 REVISION_CONFLICT；不自动重试。

GET/preview在认证前建立RR、禁autoflush，不提交heartbeat、不写规则/业务/审计/队列。preview的proposed_revision仅候选，不预留也不授权保存；旧baseline明确409。配置未初始化503 GEO_RULES_UNAVAILABLE，Schema422、身份401/权限或CSRF403沿用既有错误；未知数据库故障不映射假成功。

## Alembic 与历史

0058_geo_rule_configuration，down_revision=0057_geo_insight_indexes；事务5s锁超时/120s语句超时。只新建2张规则表，初始化revision1与系统NULL creator，不回填历史配置。Frozen SQL固定校验，驱动执行避免JSON冒号被SQLAlchemy误解为bind参数。规则计数字段拒绝3.0/0.0等小数表示，比例允许0..1有限值；DB守卫禁止规则history UPDATE/DELETE/TRUNCATE和current删除/截断/非+1。

保留旧v1 validator原合同，0058扩展v2并验证configuration与不可变revision一致，新增Run v2父revision守卫。已有v1 Batch/Run和旧GEO历史逐行前滚不变，两个新表ORM metadata与实际PG一致。DB仍接受合法v1内部写入以保留既有历史夹具/旧尝试合同；生产新工厂总输出v2，不宣称任意raw SQL只允许v2。

0058 downgrade显式拒绝销毁可能被历史引用的规则；安全恢复为迁移前备份或前向修复。只在隔离数据库执行空库与非空历史前滚，生产未迁移。旧0057索引往返测试固定目标0057，保留其真正可逆保证，不跨0058删除规则历史。

## 基线与失败诊断

基线用户8命令全部实际通过：230定向后端、3559后端/1197前端单元、1006PG集成，契约/lint/types及diff；完整日志/argv在evidence，不以基线代替候选验收。

候选失败均保留退出码与原输出，按证据修复后定向重跑：

- 根合同新增错误响应最初inline不符合canonical ErrorResponse，operation/response硬编码总数未同步；修正合同及237操作/1528响应/1291 raw响应计数，77及458契约定向通过。
- 首次迁移op.execute解析JSON中的冒号导致SQL bind错误，改exec_driver_sql；首个CSRF反例长度不足触发422，改成合法长度错误token验证403，没有放宽CSRF。
- 安装FastAPI省略None默认，沿既有_custom_openapi显式恢复3 nullable默认null，generated同步；候选全unit的2项metadata计数失败已修正，最终完整unit通过。
- 首次完整PG集成1018通过/1失败：历史0057索引往返测试从新head0058错误降级；固定该测试历史fixture到0057，33项迁移/规则/批次定向通过后重跑完整集成。
- 独立核心复核P2：public样本schema允许1、PG允许整数位的3.0表示。修正字段minimum2/3与严格数值词法，并增加真实SQL SELECT/INSERT拒绝反例；固定true/0严格类型同步。
- 新Run反例最初使用已QUEUED批次，被既有initial_matrix先拒绝；改为同一事务合法PLANNED v2批次，直接命中ck_geo_run_rule_revision，未禁用任何守卫。
- lint失败为测试import排序与SQL字符串过长，局部修正，最终make lint通过。

## 最终本地验证

- make contract-check：exit0；完整FastAPI契约及generated OpenAPI类型一致。
- make lint：最终前端生命周期修复后exit0；ruff与eslint。
- make typecheck：最终前端生命周期修复后exit0；mypy与前端tsc（其中实际执行npm --prefix frontend run typecheck）。
- make test-unit：exit0；3577后端、1221前端，130前端文件。此后只修正前端commit时机并加1回归，backend输入保持不变，复用后端成功证据；最新前端1222项由独立npm命令全套验证，不重复无变化的3577后端测试。
- npm --prefix frontend run test：最终前端生命周期修复后exit0；1222通过，130文件（此前1221证据保留）。
- npm --prefix frontend run typecheck：exit0。
- make test-integration COMPOSE=<独占geo701-validation配置>：exit0，1025通过、29条既有SQLAlchemy循环FK/计算列/dialect_options警告，506.69秒；final-integration.json/log记录精确argv和退出码。
- git diff --check：exit0；最终收尾结果见final-diff-check.json/log。
- 额外真实栈E2E：PARTSIGNAL_E2E_SPEC=tests/e2e/rules-real-stack.spec.ts deploy/scripts/e2e-local.sh；最终修复后1 desktop project用例通过，预览无写入/保存/刷新/工程师403/无GET；secret scan clean，owner-tagged测试DB/Redis key/端口/存储清理成功。桌面1440与mobile375截图已检查无页面横向溢出，保存在evidence；不是浏览器矩阵。
- 前端worker目标43项、后续token ABA20项，type/lint/build自报通过；主代理最终前端全套与真实E2E独立取得上述退出码。构建仅有既有Markdown chunk大小提示。

## 独立复核与审计

首位fresh critical_reviewer覆盖公共Schema、PG整数/不可变/CAS及旧v1；两项P2已修正。第二位fresh critical_reviewer覆盖修正后的合同/数据库与前端权限、草稿和过期preview，确认token commit/passive-effect的P2，已改useLayoutEffect同步失效与卸载cleanup；复核静态及最小反例支持解除。实际组件21项通过、修复前同一反例失败，最后完整frontend1222项及E2E再次通过。Audit Bundle ID=20261004T144634Z-geo-701-78866027，frontend实现与两个独立复核stage的计划/派发/执行证据在持久化Bundle；SUBAGENT_EXECUTION_DIGEST已由3个stage聚合生成，Bundle closed，audit-verify通过、20个产物、无异常。复核交付accepted不代表GEO-701人工验收。

## 范围、限制和停止条件

本次45个维护文件详见evidence/modified-files.md/json，另有本Task与日志；相对开始baseline-files.json判断新增/修改，前序数百dirty/untracked工作保留，无依赖升级/无关重构。指标方法/PRD/API设计与根合同同步，SHA256SUMS只更新实际改动条目；没有修改其他任务状态。

未运行生产迁移/部署、真实外部AI、Browser、生产保留、完整浏览器矩阵或旧100k性能门禁：前述业务明确范围外；本次未改公式/洞察性能路径，不新增性能改进声明。GEO-702机会实体/identity/批量评估、705复测计划、706恢复比较均待后续任务。实际Opportunity保存完整snapshot只能在702验收，本次提供公共完整snapshot及可验证冻结入口，不伪造机会。

只有用户指定无法消解业务/ADR冲突、破坏性历史迁移、改变批准合同/安全边界、必需输入/授权缺失或依赖未完成才blocked。当前无该类阻断；本地完成后review等待人工接受，禁止自行done。

## 收尾证据

最终文档SHA256SUMS校验exit0，manifest-state-audit确认仅GEO-701变化、601 done/702 planned。scope-audit相对开始前像45文件，未修改范围外前序文件或删除任何baseline文件；已检查实际diff、完整新增维护单元、合同/generated及migration drift，无新增假成功/静默fallback/敏感数据。测试只用合成内部账号与fake服务。专有geo701-validation及geo701-e2e容器/网络（前者自身新卷）已清理，两个命令exit0，未影响开发/其他任务项目。validation-summary汇总精确命令/退出码，复用无变化后端证据。生产、Opportunity和后续任务均未执行。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-701 的实现与测试证据。”据此记录 manifest=done、Trellis=completed，完成日期为2026-10-04。既有review阶段实现、测试结果及覆盖限制保留为验收前历史；本次不重新实现或重复运行功能门禁。

本次仅收尾GEO-701，不修改其他任务状态、不实施后续任务，不提交、推送或归档。SHA256SUMS仅同步manifest条目。收尾git diff --check精确命令和结果保存于evidence/acceptance-diff-check.json/log。
