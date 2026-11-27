# GEO-801 Task Brief

## 1. 基本信息
GEO-801：建立独立 Browser Collector 服务骨架和 Compose profile。R7；状态 completed（manifest done，2026-10-05 人工接受）；负责人主代理；分支 geo/GEO-801；无提交/PR。GEO-408/GEO-002 在 manifest 均 done，人工接受记录已核对。

## 2. 目标
提供可独立构建、启动、探测与停止的 Browser 执行骨架。普通 API/Worker 不引入浏览器依赖；未批准/未实现能力明确拒绝，骨架不持有业务状态。

## 3. 关联需求
ADR-005，PRD §6.3/11.3/14.4，技术架构 §4.2，Worker §12，部署 §2.2/12；WBS GEO-801 完整行。只交付服务边界，不宣告 R7 试点完成。

## 4. 必读文档
用户指定 GEO README、delivery 01/02/04/05/manifest、产品愿景与完整PRD、domain/state、technical 01/05/06/07/08及Accepted ADR002/003/005；根AGENTS、backend AGENTS、Trellis workflow/spec backend与infra索引、质量/网络/交付合同；根OpenAPI/数据库的Profile/Run相关结构、0046/0048/0053迁移；GEO408/002任务记录；实际Worker/dispatch/Registry与部署测试。大型根OpenAPI按结构定位Profile/BrowserSettings/Run snapshot，未全文复读无关模块。

## 5. 当前行为
四开关默认false，API首次/补投递/恢复只选择API。Registry没有Browser注册，Profile/settings不持有Cookie或session路径。claim却只排除MANUAL，误投BROWSER会被API失败流程改写。没有Browser容器、profile或运行时健康。

## 6. 目标行为
三个Compose环境共享独立geo-browser include，默认不启动Browser；专用镜像包含固定版本Playwright/Chromium，普通镜像不含它们。非root、sandbox、资源限额、只读FS、tmpfs、network_mode=none，无端口/业务secret。真实健康执行离线内存DOM探测；会话探测明确NOT_IMPLEMENTED。CLI内部领取只接受UUID，关闭/STOP返回COLLECTOR_DISABLED，开关允许仍返回BROWSER_ADAPTER_NOT_IMPLEMENTED；不产生lease、不消费Broker。普通claim只接受API。

## 7. 范围内
- [x] 独立package/image/service/profile、健康与安全停止。
- [x] 普通Worker领取边界修正及回归。
- [x] Compose/真实容器/基线与最低门禁、文档、独立复核证据。

## 8. 范围外
GEO802加密会话引用/导入/撤销/volume；GEO803模拟AI站和Adapter合同套件；804真实adapter/平台批准；805截图/原始证据提交；806管理UI/session health与业务频率；807试点；无真实AI/生产部署、无新身份、指标/状态机变更或无关重构。

## 9. 业务不变量
PG仍唯一业务状态来源。骨架无PG/Redis/对象存储连接/凭据，不登记Browser假adapter。消息只能稳定ID；Router无改变，lease与SEND仍由已有Application Service拥有。未知/未实现显式失败，不伪造成功；历史输入/证据/终态保持。

## 10. 契约变化
OpenAPI无operation/schema变化，database无DDL变化；Alembic head0062_geo_opportunity_decisions保持，无新revision或数据迁移。内部领取错误非HTTP公共合同且不写Run.error_code。骨架只有回环GET /health。

## 11. 后端实现
只修改geo_runs.claim_collection_run首段模式守卫；非API在配置锁、事务写入前返回None。API继续配置→accounting→Batch→Run锁序和lease/token/at-most-once/预算合同；其他执行与恢复无改动。Browser CLI不创建业务租约，待未来真实adapter合同建立后接线现有业务权威。

## 12. 前端实现
无路由/query key/URL/generation类型或页面变化。

## 13. 测试计划
已有相关unit基线104通过，18组Compose启动无外部调用通过。新增独立Node unit：配置、UUID、开关、STOP热切换、缺目录fail closed、健康失败脱敏。Backend unit/真实PG：误投BROWSER/MANUAL零写入，API旧路径继续通过。Compose：dev/staging/prod默认与profile；真实容器健康/隔离/claim拒绝/kill switch/停止清理；普通镜像依赖检查。最低用户命令全部执行，失败保留原始证据。

## 14. 验收标准
无profile不启动；显式profile且关闭开关仍健康但不接业务；实际浏览器离线DOM探测可证明runtime；STOP动态阻断；开启也不伪装已实现采集；Browser/API包依赖分离；普通worker误投Browser不改变任何Run字段。

## 15. 验证命令
`git diff --check`、`make lint`、`make typecheck`、`make test-unit`、`make test-deploy-scripts`、`make contract-check`、`make test-geo-browser`和定向PG/worker回归。精确命令/exit见implement.md与evidence。

## 16. 数据和上线
无迁移/回填/生产修改。profile默认关闭、STOP默认存在；服务无网络且不接核心credential env_file。停止服务或创建STOP；启动配置不是热加载，变更需recreate。后续打开网络/会话/adapter必须另行相应任务验证；当前停止不修改业务Run。

## 17. 风险与停止条件
sandbox运行由真实容器验证；环境阻断准确报告，不加入SYS_ADMIN/unconfined或关闭sandbox来通过。只按用户五类业务条件blocked；普通测试失败先定位再修正。保留所有前序未提交内容，evidence/before与baseline-sha256记录任务起点。

## 18. 完成证据
实际结果见implement.md与evidence；最低命令、真实runtime/PG/普通镜像边界均已完成；独立P2已修正与复验，validated digest/audit通过；manifest仅801→review，等待人工接受。文档包原有核心PRD SHA不一致已确认起点存在，未修改业务语义。

## 19. 后续任务
GEO-802、GEO-803，再按各自依赖推进804–807，本任务不实施。


## 人工验收完成 — 2026-10-05

本会话用户明确表示：“我已经人工审查并接受 GEO-801 的实现与测试证据。”据此标记 manifest=done、Trellis=completed。上文review阶段的实施计划、测试与限制作为验收前历史保留，人工接受不扩大到GEO-802/803或真实平台启用。

本次只更新验收记录、manifest对应摘要并运行git diff --check，不修改其他任务状态，不实现后续任务，不提交、推送或归档。
