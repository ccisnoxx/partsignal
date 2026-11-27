# GEO-207 Task Brief：服务端运行矩阵预览和费用覆盖

## 1. 基本信息

GEO-207 / R1；当前已由本会话用户人工审查并接受实现与测试证据，manifest=done，Trellis=completed，验收日期2026-10-02；负责人当前 Codex 主代理。分支 geo/GEO-207 已存在。GEO-206、GEO-204 的已完成状态不变。无提交、PR、生产发布或归档，本次只记录验收，不实施后续任务。

## 2. 目标

提供只读服务端 RunMatrixBuilder，准确计算请求的 prompt × profile × repeat，并展示当前资源/共享采集资格 blocker、环境 warning、三模式运行数量和 known/unknown 估价覆盖。为 GEO-208 的预览端点和 GEO-303 的批次工厂提供同一矩阵规则。

## 3. 关联需求

CAP-GEO-04；REQ-GEO-PLAN-001/002/003；AC-PLAN-01/02；费用 unknown 不补零。AC-PLAN-05 的执行预算预留不在本任务。

## 4. 必读文档

根、backend AGENTS，frontend AGENTS（只重生成类型）；Trellis workflow、backend/guides 索引与相关 database/error/quality 规范；GEO-204、206 的 prd/design/implement/接受记录。用户指定 README、roadmap、完整 GEO-207 WBS 行、execution guide、task template、manifest、product 01/02/03、business 01/02/03、technical 01/02/03/04/07、Accepted ADR-001。补读 Worker/Collector 估价章节、文档治理、追踪矩阵、当前根合同、0047迁移、Plan/Prompt/Profile/Registry/资格代码及测试。

## 5. 当前行为

0047 Plan 配置与关系已存在，Schema 校验 PRIMARY/集合唯一/repeat 1..10/Cron/timezone/预算。默认 Registry 仅 manual，共享资格已有启停、合规、能力、环境、开关、测试及当前模型规则。没有 geo_plans.py、预览组件、估价实现、Plan API 或页面。AIModel/Profile 无价格字段，cost 能力声明不能推导估价。工作树大量前序未提交文件，起点 hashes/before 保存在 evidence。单元基线 180 passed；PG 基线另记 implement。

## 6. 目标行为

10×3×3=90，Subject 数不乘入矩阵；不同 Profile 即使同 Surface 仍为不同采集配置。停用/缺失资源保留请求计数并明确阻断，不静默删格。矩阵单元由稳定 UUID 和 1-based repeat_index 确定；不插入 Run。三模式及缺失 Profile 的 unresolved 数明确返回。仅服务端估价边界可供给明确金额/币种；默认全部 unknown/null。已知部分按 Decimal 聚合，覆盖按运行数计；未知不视为免费。已知金额超过预算阻断，未知覆盖提示预算未能确认；不同币种不相加、不换汇。

## 7. 范围内

RunMatrixBuilder/内部不可变输入输出与明确边界转换；固定三次批量 SELECT 的预览服务，复用 load_profile_facts/evaluate_profile。blocker/warning、数量和估价覆盖组件及根 OpenAPI/generated 同步。矩阵、停用、预算、缺能力、边界单元/真实PG/合同测试。文档和任务证据。

## 8. 范围外

GEO-208 CRUD/路由/状态机/actions/权限命令/审计；GEO-209 页面；GEO-303 BatchFactory/快照/幂等；Batch/Run 表或记录；调度、provider estimate/collect 协议及实现、外部调用、Worker、费用预留/消费、分析/指标/机会、秘密存储、依赖升级与无关重构。

## 9. 业务不变量

服务端是 run_count 唯一 owner；PG 是业务源，估价结果不持久化。未知费用保持 null，只有显式零估价才是已知0。能力/批准不推导价格。缺失或停用不改变用户选择；预览不授予执行权。资格复用204，没有第二套模型/开关状态机。

## 10. 契约变化

OpenAPI 新增 GeoMonitoringPlanPreview 及闭合估价/issue 数据组件，不加路径、HTTP错误或状态枚举。Create/Update 不接受客户端 run_count 或 estimate。重生成 frontend schema.d.ts。DB/Alembic/ORM 不变，head=0047，无历史迁移、回填或生产操作。

## 11. 后端实现

纯 Builder 无 Session；Application read service 将列结果显式转换内部事实，禁 autoflush、不提交/回滚/写/锁。调用方拥有事务，复合预览必须在同一 REPEATABLE READ 或 SERIALIZABLE 快照内（服务检查隔离级别）；后续命令在锁内重新裁决。无 revision/state/idempotency 变化。估价回调仅内部无I/O计算边界；无实现返回unknown，异常明确传播。issue 仅 code/field/resource UUID，不回显名字、问题、settings 或凭据。

## 12. 前端实现

仅 generated 类型；无 route/query key/URL/页面状态变更。未来208/209消费服务端值。

## 13. 测试计划

Unit：90金标/Subject不乘/同Surface不同Profile/确定性唯一/1..10及3000单元；停用/缺失/能力/开关/批准；全部未知、显式0、部分/全覆盖、Decimal精度、预算相等/超出/未知、混币及环境差异；估价异常不吞。
Contract：组件与Pydantic及真实JSON实例对应，null/字符串精度、无Plan路径或输入估价字段。PG：当前行/旧identity map/脏Session、三SELECT无写/无秘密正文、同一RR快照及新事务停用、资源缺失定位。无UI、真实provider或批次创建E2E。

## 14. 验收标准

10问题×3配置×3重复准确90，manual/api/browser各30；缺资格仍90且列出blocker。费用未知不补0；known/unknown counts覆盖全部格。预算判断只比较同币明确金额；混币不制造总额。无Batch/Run、provider、ORM写、审计或revision改动。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker compose -p partsignal-geo207-validation -f .trellis/tasks/10-02-geo-207-run-matrix/evidence/validation-compose.yaml'；新增定向unit/PG。基线及实际 exit/result/log 留 evidence，不将skip/未运行记通过。

## 16. 数据和上线

无新migration/上线入口/开关变化。测试用独立PG55447/Redis56387/fake-oss19007与专用volumes，完成后只清理本任务资源，恢复起始Colima停止/default context。无生产访问。

## 17. 风险与停止条件

估价能力尚未实施，默认unknown；当前budget未保存币种，本任务仅对唯一估价币种比较数额，混币明确阻断预算比较。预览快照不等于未来发送许可。仅用户列出的五种真实业务/迁移/授权/依赖条件可blocked；环境阻断记录实际命令与证据。

## 18. 完成证据

见 implement.md/evidence。实现后独立只读复核当前候选的公共合同、预算精度及一致读边界，审计Digest经校验后报告。本地交付进入review后，2026-10-02已依据用户明确人工验收更新manifest=done、Trellis=completed；未提交或归档。

## 19. 后续任务

GEO-208、GEO-209、GEO-303；实际Collector估价/执行预算由后续采集任务拥有，本任务不实施。
