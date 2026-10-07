# GEO-307 Task Brief：运行中心、人工录入和详情页面

## 1. 基本信息
GEO-307 / R2；状态 done，2026-10-02已由本会话用户人工审查并接受实现与测试证据；Trellis状态completed；依赖 GEO-306=done（2026-10-02人工接受记录已核对）；主代理负责集成，人工编辑器独立委派。分支 geo/GEO-307 已存在；没有提交、PR或生产部署。

## 2. 目标
工程师可从现有计划创建人工批次，在批次/运行双层视图中选择运行、保存人工草稿、上传截图、编辑引用及正式提交，刷新恢复筛选、选择和已保存草稿；详情可追溯冻结输入与不可变证据。

## 3. 关联需求
WBS GEO-307 完整行；PRD 9.4/9.5、11.3 MANUAL、AC-RUN；页面规格6/7；R2业务演示。后续目标文档不作为提前实施其他任务的授权。

## 4. 必读资料
根与frontend AGENTS；Trellis workflow/frontend spec；用户指定README、delivery 01/02/04/05/manifest、PRD、页面、领域、状态机、技术/数据/API/前端/Worker/质量文档、Accepted ADR001/002/003；根合同受影响完整单元；0048..0051迁移与Schema、manual/read services、现有相邻前端与测试。GEO-306 prd/design/implement和接受记录。大文档按相关完整章节读取。

## 5. 当前行为
303有批次创建API，305有MANUAL上下文/草稿/幂等提交，306有5个Batch/Run读端点；前端无运行页面。Plan原生运行按钮仍UI_NOT_IMPLEMENTED，运行中心将独立提供创建入口。已有脏修改保留，起点见evidence/start-status.txt与baseline。

## 6. 目标行为
批次/运行分页与URL筛选；批次完整summary；创建计划批次后按canonical ID进入批次。manual context编辑保存、dirty离开保护、截图intent/PUT/complete、引用顺序、显式实际采集时间；提交后readonly详情及COLLECTED/NOT_IMPLEMENTED反馈。后台刷新保留草稿。

## 7. 范围内
运行中心、计划批次创建、人工编辑器、截图、引用、详情、安全展示、组件/真实栈E2E、导航、相关说明与证据。

## 8. 范围外
GEO-308/R2整体验收与GEO-408；取消/重试命令、自动采集、机器分析/复核/指标/机会、定时执行、真实AI、无关重构、依赖升级。

## 9. 不变量
PG唯一业务来源；前端仅generated DTO，typed workflow/actions唯一资格源；不重建状态机/指标；冻结输入只读，正式证据只读；草稿不进URL或持久浏览器存储；后台刷新和409不覆盖本地输入；不自动重发写操作。

## 10. 契约与数据库
计划复用现有API/Schema，OpenAPI、数据库和Alembic无变化。head=0051_geo_manual_collection，无回填。发现必需合同缺口必须在owner处理并更新本记录。

## 11. 后端
不新增事务、锁或状态语义。既有User→Surface/Profile→Batch→Run→Draft→Files排序锁；提交还持actor/key事务advisory锁。expected_draft_revision、唯一提交身份/Answer、不可变触发器与原子审计继续裁决；前端仅传命令。

## 12. 前端
/geo/runs；view/filters/page/page_size/batch_id/run_id/edit在URL。runs.api唯一key与请求owner；详情单GET，不join证据。RHF持草稿，canonical保存结果更新基线；409仅显式重载。Query读取使用AbortSignal；identity切换重建编辑器。轮询按展示阶段，隐藏页面暂停，失败保留成功数据。限时证据不持久缓存，纯文本/安全Markdown与noopener/noreferrer。

## 13. 测试计划
URL/model/API、动作映射、轮询停止/后台失败、dirty导航、保存/冲突与canonical reset、上传complete失败、错误/权限、安全正文；Playwright真实栈创建批次→保存→刷新→截图→引用→提交→详情，人工编辑器与详情覆盖375/768/1024/1440px，编辑器验证CSS 200%缩放。不访问真实AI。实际命令、完整门禁失败和覆盖限制见implement.md。

## 14. 验收
筛选/分页/选择刷新恢复；已保存草稿刷新恢复；未保存修改离开提示；409保留输入；提交原文/引用/证据冻结且详情可见；summary不是当前页计算；后续分析不伪造成功。

## 15. 命令
基线：npm --prefix frontend run test -- src/domains/geo-plans src/domains/geo-questions src/domains/geo/geo-evidence-upload.test.tsx src/design-system/forms/dirty-guard.test.tsx；UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_manual_collection_contract.py backend/tests/unit/test_geo_read_contract.py。
候选：git diff --check；make lint；make typecheck；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；make contract-check；npm --prefix frontend run build；按诊断增加定向检查。

## 16. 数据与上线
保持写开关，E2E仅隔离数据库/本地对象存储。无生产迁移、回填或发布。回退本任务前端和说明即可，已提交证据仍由现有后端读取。

## 17. 风险与停止
草稿版本/身份、过期响应、提交结果未知、文件complete生命周期、签名过期与安全链接。停止仅业务文档不可消解冲突、未批准破坏迁移、需改变已批准指标/状态机/安全、必需输入或授权缺失、依赖未完成。

## 18. 完成证据
基线日志、candidate patch、checks与独立审查写evidence和implement.md。manifest已按planned→in_progress→review交付，未自行done/归档。完整make e2e的两项既有失败保留；定向GEO-307真实栈与独立fixture检查通过，不能将补充验证合成为完整门禁通过。子代理审计因配置哈希变化未取得有效全任务Digest，保留原计划和失败证据。

## 19. 后续
GEO-308/R2阶段验收；GEO-408/API自动观测页面；R4分析/复核及R5指标。均不实施。
