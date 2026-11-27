# GEO-105 Task Brief：监测对象、竞品、别名和域名页面

## 1. 基本信息
GEO-105；R1；负责人主代理；状态 completed（manifest done，2026-10-02 本会话用户人工验收完成）；分支 geo/GEO-105 已存在；依赖 GEO-104（manifest done，Trellis completed，2026-10-02 人工接受）；无 Commit/PR。

## 2. 目标
管理员可维护五类监测身份、别名和域名；搜索筛选、详情、启停与删除阻断完整；ENGINEER 只读，409 保留表单，不泄露敏感数据。

## 3. 关联需求
CAP-GEO-01；AC-SUB-01/02/03；AC-SEC-02；GEO-105 WBS 完整行及 manifest deliverables/acceptance。

## 4. 必读资料
根/前端 AGENTS，.trellis/workflow 与 frontend spec；GEO README、交付01/02/04/05与manifest、产品01～03、业务01～03、技术01～04及07、ADR-001；GEO-101～104记录；OpenAPI Catalog paths/components、database Catalog、0044迁移、Catalog Schema/Router/policy/query/service/test；现有配置页、认证主体屏障、表单/Table Kit。

## 5. 当前行为
GEO-104 已提供12操作与完整聚合投影，generated类型已生成。前端无 Catalog UI。OWN_PRODUCT名称为当前Product只读投影。已有未提交GEO-001～104工作，evidence/start-files.json保存起始指纹，禁止覆盖。前端基线3文件36测试通过；其余基线与最终结果见 [implement.md](./implement.md)。

## 6. 目标行为
URL恢复搜索/筛选/分页/选中；管理员新增/编辑/启停/受约束删除对象；Alias创建/编辑/删除、Domain创建/删除；读取完整聚合显示当前身份、父级、字典、直接引用和服务端阻断。409不重放且保留所有本地表单，显式刷新后由用户重新提交。

## 7. 范围内
Catalog domain API/model/form/list/detail；configuration route、导航及路由生成；组件/API/URL测试；必要文档和状态接线。

## 8. 范围外
GEO-106纵向业务验收/产品引导；其他GEO任务；Batch/Run、外部采集、分析、指标、机会、Profile/Plan；无新身份/依赖大版本/数据库或部署服务；不提交、不归档。

## 9. 不变量
API DTO仅generated；动作/删除资格来自服务端；ENGINEER不渲染编辑器；OWN_PRODUCT绑定不可改且不编辑事实；子写共用父revision；后台刷新不重置草稿；无自动重放；既有文章关系GEO独立。

## 10. 契约变化
OpenAPI无operation/schema/错误码变更，运行contract-check/generated check；数据库DDL/FK/锁/删除合同不变；Alembic沿用0044_geo_catalog，无前滚操作/回填。仅校正文档中过时实施状态。

## 11. 后端实现
无业务代码变更。服务端既有事务、Product→品牌UUID顺序→目标Subject→子项锁序、revision仲裁、精确SQLSTATE+constraint错误及原子审计继续权威。无Worker/Collector。

## 12. 前端实现
/configuration/geo-entities，URL q/subject_type/is_active/product_id/parent_subject_id/sort/page/page_size/subject_id/new；Catalog API唯一query key。表单RHF/Zod；基线revision与草稿同身份持有；canonical成功更新cache，写前cancel在途详情。DirtyGuard及显式刷新/重新确认；加载/空/失败/权限/冲突/完成反馈；TableShell局部滚动，键盘与焦点遵循Base UI。

## 13. 测试计划
Vitest API/URL、正常CRUD payload、CSRF、read-only actions、409 no replay/保留、子父revision、pending、后台刷新、主体continuation；generated检查；路由/导航测试；production artifact浏览器布局和键盘定向验证。真实API完整Catalog纵向E2E留GEO-106。无数据层变化不重复PG全门禁。

## 14. 验收
ADMIN可维护所有授权字段，ENGINEER只有读取；409保留表单与request ID、可显式加载最新revision后再次确认；删除阻断仅服务端投影；无事实正文或凭据调用/存储/回显；URL刷新/Back恢复。

## 15. 验证命令
基线前端定向测试/contract-check/typecheck/Catalog单元；git diff --check；make lint；make typecheck；make test-unit；npm --prefix frontend run test；npm --prefix frontend run typecheck；make contract-check；按风险补定向browser检查。记录真实命令/退出码/未运行原因。

## 16. 数据和上线
Catalog配置无外部调用；四项自动能力开关不改变；不迁移生产。代码恢复可回退本任务前端文件；无历史数据转换或downgrade。

## 17. 风险与停止
实质风险：草稿与server cache/revision竞争、重复写、主体切换、删除确认过期。仅文档/ADR不可解冲突、未批准破坏性迁移、需改变已批准边界、必需输入/授权缺失、依赖未完成时blocked。环境不足只记录验证限制。

## 18. 完成证据
implement.md/evidence命令日志、起始/最终范围差、截图与代理审计；本地完成只更新manifest/Trellis review，不done。

## 19. 后续任务
GEO-106 Catalog真实API纵向验收和使用引导；本次不实施。
