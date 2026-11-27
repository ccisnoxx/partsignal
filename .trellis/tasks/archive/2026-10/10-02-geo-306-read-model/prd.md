# GEO-306 Task Brief：Batch/Run 列表与详情读模型

## 1. 基本信息

Task ID GEO-306；R2；状态 completed（manifest：done）；负责人主代理；依赖 GEO-303、GEO-305 均 done 且已人工接受；当前分支 geo/GEO-306；无提交/PR/生产部署。

## 2. 目标

运行中心可读取批次汇总和筛选分页，单请求详情能查看冻结输入、原始证据、状态、attempts 与真实时间线；尚未交付的数据质量/分析能力明确占位。

## 3. 关联需求

WBS GEO-306 完整交付行；PRD 9.4/9.5、AC-PLAN-04、AC-RUN-01/03/04/05；页面需求第6/7节；Accepted ADR-001/002/003。

## 4. 必读资料与证据

已读取根/后端/前端 AGENTS、Trellis workflow/backend spec；用户指定 README、delivery 01/02/04/05/manifest 与三个ADR；PRD、页面、领域、状态机、技术/数据/API/前端/Worker/测试文档的相关完整章节。大根合同按受影响完整单元读取。已检查0048..0051迁移、Batch/Run/Answer模型、状态owner、MANUAL提交、资格、存储与既有测试。前序Task Brief/design/implement及人工接受记录已核对。

## 5. 当前行为

GEO-303冻结矩阵与创建身份；GEO-302纯状态/action策略；GEO-304不可变Answer/Citation与File生命周期；GEO-305 MANUAL上下文、草稿、正式提交/分析NOT_IMPLEMENTED。无Batch/Run读取端点。旧文章关系观测独立。基线单元1419 passed；真实PG/本地OSS集成69 passed，精确命令见implement.md和evidence。

## 6. 目标行为

五个GET：Batch list/detail/batch runs；Run list/detail。稳定排序、10/20/50分页、total、冻结筛选；详情原文/引用/签名文件/尝试链/实际时间戳。Batch requested计cell，状态数量计最新attempt，attempt_count与费用计全部attempt。未知费用不补零。

## 7. 范围内

- [x] 闭合读Schema、五个GET、summary/分页/详情/时间线。
- [x] RR与批量固定查询、防N+1、历史读取和安全签名。
- [x] data quality不可用占位；合同/generated/定向测试/文档/独立复核。

## 8. 范围外

GEO-307页面和人工编辑交互；GEO-308阶段验收；取消/重试/重分析/复核命令；Collector、机器分析、指标、机会、复测引擎、调度、真实外部AI、无关重构、依赖升级或新基础设施。

## 9. 业务不变量

PG唯一来源；不写缓存/状态/revision；不以分页重建summary；最新attempt不择优答案；原始输入与证据保持不可变。真实命令可用性仅manual entry，其余false。单租户共享历史，created_by不形成私有权限。

## 10. 契约变化

OpenAPI先新增读取operation与闭合响应/过滤枚举。Database补只读合同，无表列索引修改、Alembic或数据迁移。继续0051 head，不改变删除/FK/触发器。

## 11. 后端设计

Router只参数/身份/依赖/服务调用。认证前复用read_snapshot建立RR及关闭autoflush；查询服务组装；纯状态与费用投影复用既有owner。按完整Batch集合读取轻量状态事实，按页读取冻结输入。详情批量加载Answer/Citation/File，签名不HEAD、不下载、无外部网络。

## 12. 前端

仅generated类型；无route/query key/URL/页面行为变化。未来GEO-307消费单一详情和服务端actions。

## 13. 测试计划

Unit/contract：闭合schema、runtime/static/generated一致；签名和nullable占位。PG/API：筛选/半开时间/排序/分页；最新attempt vs全尝试；固定SELECT；认证前RR，count与rows、原始答案/文件/状态跨查询并发一致；无GET隐式写；权限/强制改密/404/422；已提交大文件签名/真实字节不入JSON。使用本地OSS。

## 14. 验收

一次详情返回冻结输入/状态/答案/引用/受控文件/完整cell尝试链；未知分析和资格明确不可用；批次summary不随Run当前页变化，重复尝试不增加requested；文件受限时间签名，lease token/秘密不公开。

## 15. 验证命令

git diff --check；make contract-generate；make contract-check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker --context colima compose -f .trellis/tasks/10-02-geo-306-read-model/evidence/compose.validation.yaml'；新增定向pytest。只声明实际结果。

## 16. 数据与上线

无数据迁移。部署代码与generated；历史读不受GEO写开关。只专用验证Compose/卷，恢复初始Colima停止/default context。回退应用代码即可，无数据回滚。

## 17. 风险与停止

分页/summary不同统计单位、RR快照混合、当前资格误作冻结历史、费用覆盖不完整、秘密/原始字节泄漏。停止仅用户列出的五类条件；普通验证失败诊断修复或准确分类。

## 18. 完成证据

evidence/start-files.json与baseline为任务起点；baseline-unit.log与baseline-integration.log均通过。后续候选diff、实际验证、独立复核写implement.md/evidence。

## 19. 后续

GEO-307前端；GEO-308 R2验收；分析/指标/机会/retention由后续任务。本任务不实施。
