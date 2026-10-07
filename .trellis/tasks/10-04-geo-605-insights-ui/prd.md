# GEO-605 Task Brief：总览和分析洞察前端

## 1. 基本信息
GEO-605 / R5，主代理负责，分支 geo/GEO-605，base main；依赖 GEO-602/603/604 manifest=done、Trellis=completed，并有本会话人工接受记录。当前 review；无提交、PR、归档或生产部署授权。

## 2. 目标
在统一 URL 筛选下展示回答级 GEO 总览与分析洞察，保留服务端透明指标、完整维度、样本等级与组成证据下钻；所有图形有可访问表格替代。

## 3. 关联需求
CAP-GEO-08/09/11，CAP-GEO-12 仅保留服务端机会不可用占位；PRD §9.1/9.6/12/16.5（AC-METRIC-01～05/07）、页面规格 §2/3/9/13/14、WBS GEO-605完整任务行。增强型同现/新消失引用、平均排序等无当前605依赖合同者不补造。

## 4. 必读依据
用户指定的18份文档及根/前端AGENTS、Trellis workflow/frontend spec、infra/e2e-isolation，Accepted ADR-003/004；根OpenAPI、数据库合同R4/R5、0054～0056迁移与当前读服务、Schema、generated类型；602/603/604 Task Brief/design/implement/接受记录。上下文按适用完整章节读取，不将目标文档误认为已实现。

## 5. 当前行为
PG拥有冻结输入、原始Answer、current成功analysis及绑定latest有效Review。602/603/604提供总览、双窗口洞察、运行贡献/引用/声明/质量分页。现有 /geo/insights、/geo/insights/print 属文章关系级，回答级 UI 缺失。

## 6. 目标行为
/geo/overview 与 /geo/insights/answers 提供筛选、卡片、趋势/矩阵/SOV/引用/风险/质量和表格；依赖DTO的全部区块统一筛选，完整cell不合并、null不补零，组成数据下钻回既有Run Detail。旧路由保留。

## 7. 范围内
- [x] URL基础筛选、下钻选择器、分页及刷新/历史恢复。
- [x] 总览质量卡片、重点产品、风险、最近批次、真实机会不可用说明。
- [x] 双周期趋势、产品/平台/问题覆盖、SOV、引用与声明、质量/费用分币/版本。
- [x] 可访问表格、loading/empty/error/403/404/后台刷新状态。
- [x] 组件、路由、null/sample level及真实API E2E；任务与稳定文档证据。

## 8. 范围外
606打印报告/CSV、607性能/索引阶段、706干预比较、机会行动闭环、Browser Collector、生产启用、真实外部AI、公式/指标裁决、后端增强能力、无关重构/依赖升级。保留旧文章级洞察与打印/优化流程，不迁移书签。

## 9. 业务不变量
generated OpenAPI唯一API类型；公式/资格/状态机/current选择归服务端。业务完整cell分栏，模式/点名/版本不混算；服务端null/UNKNOWN/UNJUDGEABLE保留；费用分币不换币；同筛选全部区块；无统一总分。图表等价表格，旧文章和回答分母独立。

## 10. 契约变化
OpenAPI：无新增operation/schema/enum/error；消费七个既有GET，数组按repeat query发送。Database：无DDL/表列索引约束/删除语义变化；无新Alembic/回填/历史重写，head0056。

## 11. 后端实现
无后端生产修改；沿602～604 EngineerUser、RR禁autoflush、12应用SELECT/13含认证、实时as_of。无写事务、行锁/锁序、revision、状态转换、幂等写入、审计、queue或外部I/O影响。cell消失404、损坏历史409、参数422、401/403保持。

## 12. 前端实现
Route仅search规范化/prefetch/metadata/composition。insights.api.ts唯一query key；base filters与detail selector分离，类型来自operations/components。筛选变化清除下钻分页；下钻沿服务端descriptor，URL可刷新、Back/Forward。AbortSignal与Query key隔离过期读取，同key后台临时失败保留快照并显示错误；权限或失效错误隐藏旧快照，不跨filter使用placeholder。表单临时草稿RHF拥有，应用后URL拥有。as_of逐响应展示，不客户端join业务快照。原生SVG仅坐标/百分数格式化、表格始终可用；无图表依赖。

## 13. 测试计划
Unit/Component：URL、generated参数、null/NONE/OBSERVED/REPORTABLE/STABLE、服务端value与分子分母独立、不比较低样本、同筛选、错误恢复、取消与迟到、明细分页/安全文本。Contract：make contract-check。PG Integration：未改生产数据库，复用602～604证据。E2E：真实API准备人工证据及分析/复核→UI筛选→洞察/下钻→刷新/Back/Forward，旧页面回归，375/768/1024/1440与缩放/键盘；fake/local only。

## 14. 验收标准
1. 任意基础筛选作用于总览和回答洞察全部区块，URL可恢复。
2. 服务端结果直接展示，无业务公式/分母/样本级别重新计算。
3. null显示无可用样本/不可计算；低样本数值与标签保留、无趋势结论。
4. 组成运行/引用/声明/质量明细可分页并返回原始Run；失效cell显式重读摘要。
5. 图形标题/图例/样本/分母和可访问表格完整，宽表局部滚动。
6. 旧文章级洞察/打印兼容，不实现后续任务；本地验证完成仅review。

## 15. 验证命令
`git diff --check`、`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`npm --prefix frontend run test`、`npm --prefix frontend run typecheck`、`make e2e`；定向组件/路由/真实API E2E、build。逐命令JSON/log在evidence，不将未运行写成通过。

## 16. 数据和上线
无新迁移/回填/开关/生产启用。隔离E2E独占随机PG数据库、Redis非0、临时存储，退出证明精确清理。回退本任务新增只读前端即可，不删除历史。

## 17. 风险与开放问题
完整cell长维度与宽表；旧URL回归；筛选切换与迟到数据；跨请求as_of差异与消失cell；真实栈环境及范围外已有失败。仅文档/Accepted ADR不可消解冲突、未批准破坏迁移、需改指标/状态机/安全、必需输入/授权缺失、实际依赖未完成才blocked。

## 18. 完成证据
基线 frontend 46文件/398测试通过；命令JSON/log见evidence/baseline-frontend。baseline-files.json和before保存现有脏工作原像。实现、逐项结果、审查与范围审计见implement.md。无Commit/PR、Alembic、生产迁移。

## 19. 后续任务
GEO-606、607、706及后续R6/R7均不实现。
