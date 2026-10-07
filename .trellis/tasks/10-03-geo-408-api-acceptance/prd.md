# GEO-408 Task Brief

## 1. 基本信息
GEO-408；R3；状态 done（Trellis completed，2026-10-03 本会话用户人工验收）；主代理负责实现与整合，analyst只读核对产品/运行时，deep_engineer拥有隔离测试装配；当前分支geo/GEO-408；依赖GEO-407、GEO-307在manifest均done，已核对人工接受记录；本地完整门禁通过，用户已人工审查并接受实现与测试证据；无Commit/PR/生产发布。

## 2. 目标
用户从运行中心创建API批次，自动刷新采集进度，读取原始回答/引用、独立token usage、实际费用与未知覆盖、安全失败/外部调用状态，并经确认显式创建新attempt；真实本地API/PG/Redis/Celery与fake provider完成R3演示及开关关闭零调用证明。

## 3. 关联需求
WBS GEO-408完整行；roadmap第6节八项R3业务演示；CAP-GEO-05/06/16；PRD运行中心/详情、错误与费用语义。只落实408交付。

## 4. 必读文档
根/frontend/backend AGENTS、Trellis workflow及frontend/infra适用spec；用户指定README、delivery 01/02/04/05/manifest、PRD、domain/state、technical/data/API/Worker/security/testing/operations和Accepted ADR001/002/003/005；根OpenAPI/数据库GEO完整单元、相关0048..0053迁移；307/407 prd/design/implement与实际代码测试。两条只读调查分工完整读取大型产品与技术文档，报告存evidence。

## 5. 当前行为
407已保存引用/usage/cost/错误元数据，406有服务端retry命令/动作及唯一后继；307运行中心有5秒轮询、原始证据、费用覆盖，缺usage/发送事实/HTTP与Retry-After以及retry交互。当前E2E关闭API采集，仅启动内容fake；生产adapter仍未批准，批次默认INTERNAL且Collector仅允许PUBLIC。起点有前序未提交变更，baseline-sha256/before保留证据。

## 6. 目标行为
自动活跃阶段可见页面5秒刷新，后台失败保留成功数据并显式恢复；不刷新表单/焦点。未知费用/token不补零或推算；失败展示安全字段。retry仅由available_actions授权，确认携带expected_revision；未知结果只读取尝试链，不自动或同键重放无幂等键POST。原attempt终态/证据保留，成功导航新ID并保留当前筛选。

## 7. 范围内
- geo-runs查询、采集详情和retry组件及相关组件验证；文案校准。
- 真栈fake provider测试、仅隔离test进程装配及必要E2E runner接线/端口生命周期。
- R3使用与运维说明、验收记录、manifest/README/追踪与哈希。

## 8. 范围外
其他GEO任务；GEO-801/902；机器分析/业务指标/机会/Browser；生产adapter批准、PUBLIC授权产品能力、定时计划调度、真实供应商、历史迁移、生产发布、无关重构及依赖升级。

## 9. 业务不变量
PG业务权威；Redis仅稳定run ID；Router无新增事务/写入；generated类型唯一API来源；server workflow/actions唯一资格；未知保持null；冻结输入/证据与旧终态不修改；每attempt至多一次发送，失败不自动重发；测试不放宽生产安全边界。

## 10. 契约变化
OpenAPI/数据库/Alembic无本任务变更；消费现有GeoRunDetail/GeoRunListItem/GeoRunRetryCreated与retry POST。当前head0053_geo_collection_admission；隔离测试空库前滚通过，无新revision/回填。

## 11. 后端实现
生产Application Service无改动。既有配置→accounting→Batch→Run锁和lease/token/唯一后继/不可变守卫继续拥有执行、预算和retry裁决。测试装配只在tests目录与独占e2e数据库生效；真实OpenAICompatibleCollector/TLS与SSRF边界不替换，仅绑定本机fake地址和虚构数据。明确校验隔离运行输入。

## 12. 前端实现
/geo/runs现有URL/query key不增加。详情单一GET。retry对话框拥有确认revision，会话QueryClient journal跨详情卸载保留pending/unknown blocker；principal continuation、卸载、重复提交和导航意图守卫；4xx保持错误/请求ID，刷新后重新确认；未知结果只GET链。新采集字段使用现有tokens/primitives/语义dl，代表宽度及键盘验证。

## 13. 测试计划
基线geo-runs 54/8 files，backend read/workflow/config 22项通过。定向组件：独立usage/null/零、发送事实/429、动作资格、确认/revision/no replay、未知/409/卸载/主体/导航、轮询活跃/hidden/error。真栈：profile创建/测试/启用、管理与计划全部既有UI配置、UI创建batch、PG/Celery采集、引用/usage/cost、重复消息次数、发送后UNKNOWN、新attempt及原始链、开关关闭零provider调用。所要求完整门禁实际运行；失败分类保留，不以定向代替。

## 14. 验收标准
R3八项演示须有实际证据；开关关闭provider业务请求零；原状态和attempt不可变；unknown不是0；无真实第三方；采集停于COLLECTED并显示分析NOT_IMPLEMENTED；可恢复失败显式操作。

## 15. 验证命令
基线：npm --prefix frontend run test -- src/domains/geo-runs；UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_read_contract.py backend/tests/unit/test_geo_run_workflow_contract.py backend/tests/unit/test_geo_worker_configuration.py -q。
候选：git diff --check；make lint；make typecheck；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；make verify；定向真栈与测试装配边界验证，精确环境及结果保存implement.md。

## 16. 数据和上线
生产开关默认关闭；安全停止新采集并停Worker/Beat，不重发SENT/UNKNOWN。无新迁移/回填；回退本任务前端及测试接线即可。测试只用独占PG/Redis和回环fake。生产批准及数据外发合同仍需另行已授权任务。

## 17. 风险与开放问题
无幂等键retry回执丢失、旧主体/导航迟到、fake装配误入生产、未知预算、后台轮询错误、全门禁已知环境/前序失败。只按用户五类真实条件blocked；一般验证失败记录并在scope内修正。无新业务状态或安全语义。

## 18. 完成证据
Task evidence保留基线、当前任务候选diff、所有实际命令/exit/日志、浏览器证据及子代理审计。实现验证交付时manifest/task/brief为review；2026-10-03用户已人工接受，manifest为done、Trellis task为completed，人工验收依据见implement.md。

## 19. 后续任务
GEO-801、GEO-902及R4分析/复核按各自依赖与批准另行执行，不实施。
