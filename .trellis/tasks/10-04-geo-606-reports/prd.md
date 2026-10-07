# GEO-606 Task Brief：打印报告与安全 CSV

## 1. 基本信息
GEO-606 / R5；主代理负责；geo/GEO-606；base main；依赖 GEO-605 manifest done / Trellis completed，2026-10-04人工接受已核对。状态 review；无提交、归档、生产启用。
## 2. 目标
用户以回答级洞察同一筛选预览与打印透明报告，并安全导出可追溯的运行、引用、声明；机会未实施时明确拒绝而非空成功。
## 3. 关联需求
AC-REPORT-01～04、AC-AUDIT-01～02、AC-SEC-02；WBS GEO-606完整行。
## 4. 必读依据
用户列出的18份文档、根/后端/前端AGENTS、Trellis workflow/spec；605 prd/design/implement及人工接受；根OpenAPI/DB的回答级指标、证据、分析、复核与审计合同；0050/0054～0056、现有查询/公式/详情、客户端与E2E。目标设计与当前合同分别核对，不按标题编码。
## 5. 当前行为
601～605已实现公式、总览、双周期洞察、当前分析/复核、分页组成证据和URL筛选。旧文章级打印独立。无回答级报告、CSV、报告审计或机会表。
## 6. 目标行为
六个报告操作，预览/打印共用GeoReportPreview；打印为实时报告，显示as_of/生成时间/筛选/方法/版本/质量，无归档能力。无候选为available=false/NO_DATA；全不合格为NO_ELIGIBLE_RUNS。CSV空集409；机会501 NOT_IMPLEMENTED。
## 7. 范围内
报告预览与打印；现有指标/趋势/覆盖/SOV/引用/风险/质量；四CSV端点、固定白名单、公式注入防线、UTF-8流式与审计；合同/generated/测试/文档。
## 8. 范围外
607索引/P95/100k运行性能阶段；702机会实体及行动；Browser、706干预比较、生产启用、真实外部AI、旧文章迁移、升级依赖、无关重构。
## 9. 不变量
PG唯一来源；服务端公式/资格/current指针与latest有效Review唯一；失败不作未提及，null不补零；完整维度/币种不混算；原证据/分析/复核不可变；Router无事务/行锁/写入。CSV列闭合，无secret/配置/raw/完整回答/事实片段。
## 10. 契约变化
OpenAPI六GET：preview、print、runs.csv、citations.csv、claims.csv、opportunities.csv；统一认证/请求ID/错误；CSV Content-Disposition及as_of。DB新增只读/审计语义，无DDL/Alembic/回填，head0056。
## 11. 后端
报告在RR调用洞察，方法/公式服务端拥有。CSV固定大小keyset分批装配现有输入、同一RR，首条初始化后才200，异常/断连/finally关闭全部资源。审计独立应用事务记录成功授权和开始导出，不声称客户端收齐；审计失败阻断返回。无状态变化/业务行锁/revision/幂等命令；重复GET独立记录。
## 12. 前端
/geo/reports与/geo/reports/print；独立report key、generated类型、基础URL筛选、应用print layout。首次加载/空/不合格/权限/错误/后台刷新区分；临时刷新失败保留快照，失权隐藏。直接浏览器下载，避免JS缓冲整个CSV。
## 13. 测试计划
Unit：空白/控制/=+-@、引号/换行/中文、固定字段、100k合成行、懒读取、关闭/错误。PG：同筛选/current Review/latest attempt/白名单/审计/空/RR分批。Contract：全API漂移和生成。Frontend：URL/key/透明指标/null/错误/权限/打印。E2E：真实API预览→打印→下载，列/审计，本地fake。
## 14. 验收
筛选/生成时间/as_of/公式/质量完整；透明分子分母/样本/维度；无数据不成功打印；CSV稳定ID追溯、注入转义、固定列、常量批次内存、资源释放；机会明确不可用；仅review。
## 15. 命令
git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；定向见evidence。
## 16. 数据与上线
无新迁移/回填/开关/生产操作。隔离PG/Redis/临时存储精确清理。回退新增路由和服务，保留历史/审计。无持久化报告/归档。
## 17. 风险与停止
资格不一致、流式生命周期/部分失败、敏感列、打印布局。仅用户五类条件blocked；环境测试失败记录命令/证据，不伪装通过。
## 18. 完成证据
evidence保存开始hash/before、基线后端24/前端23通过；后续命令/独立复核/范围验证见implement.md。无Commit/PR。
## 19. 后续
GEO-607、702、706，均不实施。
