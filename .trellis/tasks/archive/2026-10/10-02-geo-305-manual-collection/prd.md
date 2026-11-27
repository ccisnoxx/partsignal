# GEO-305 Task Brief：MANUAL 草稿和正式提交

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-305 / R2 |
| 状态 | done（manifest）／completed（Trellis）；本会话用户已人工审查并接受实现与测试证据，验收日期 2026-10-02 |
| 负责人 | Codex 主代理 |
| 依赖 | GEO-303、GEO-304，manifest done 且任务有人工接受记录 |
| 分支 / PR | geo/GEO-305（开始时已在该分支）；无 PR/Commit |

## 2. 目标

取得冻结 MANUAL 录入上下文、保存独立版本草稿、以幂等请求一次提交不可变回答/引用/证据。成功 Run 为 COLLECTED，分析投递明确 NOT_IMPLEMENTED，失败无成功回执。

## 3. 关联需求

GEO-305 WBS/manifest完整任务行；PRD 11.3 MANUAL、14.1/14.2/14.3、AC-RUN-01/02/03/04；人工采集流程与 Accepted ADR-001/002/003。

## 4. 必读资料

根及 backend/frontend AGENTS、Trellis workflow、backend/infra有效spec索引和相关合同、GEO-303/304 PRD/design/实施证据；用户列出的README、delivery 01/02/04/05/manifest、product 02/03、business 02/03、technical 01/02/03/04/05/07、ADR-001/002/003，按当前任务相关完整章节读取；大型根OpenAPI/数据库按结构与受影响完整单元读取。当前代码：批次工厂/状态策略、配置资格/锁协议、Answer/Citation Schema/ORM/0050 SQL、文件生命周期/存储、身份/审计/Router及相关测试。

## 5. 当前行为

已有GEO-303 QUEUED Batch/PENDING Run、冻结输入；GEO-302纯状态策略；GEO-304完整同事务Answer/Citation/受控文件防线。无人工端点/草稿/提交身份/分析Worker/人工页面。旧文章关系独立保留。基线单元1401 passed、真实PG集成56 passed，见evidence日志。

## 6. 目标行为

上下文返回冻结输入、草稿及独立revision、当前资格与workflow。保存允许空回答、未录入时间和缺证据。提交必须非空原文、显式带时区时间、至少一项证据；冻结require_screenshot=true时必须截图。正式提交删除临时草稿。重放先读稳定身份，跳过后续配置/状态/草稿变化，不重复审计。

## 7. 范围内

- [x] 三个端点、闭合公共组件、服务端状态/资格。
- [x] 独立草稿revision、提交幂等、原子证据/Run/Batch/审计。
- [x] 加法迁移、文件GC/用户历史引用接入及精确错误。
- [x] 定向并发/失败/迁移/API测试、指定门禁、独立只读复核、文档。

## 8. 范围外

GEO-306读模型、GEO-307页面、GEO-308阶段验收；Collector、分析算法/Worker、指标/机会/复测、调度扫描、真实第三方、无关重构/依赖升级/新基础设施。

## 9. 业务不变量

仅冻结MANUAL且PENDING/NOT_STARTED/无答案可保存或首次提交；客户端不写环境/状态/actor。提交同事务冻结证据并COLLECTED/revision+1，外发仍NOT_STARTED、无lease、无费用猜测。草稿从首次1开始，虚拟未保存0；实际变更+1，同值不变。文件Uploader/HEAD/资格不放宽；正文/URL/文件内容/原key不进审计。NOT_IMPLEMENTED明确没有投递。

## 10. 契约变化

OpenAPI：GET manual-entry、PUT manual-draft、POST manual-submit；expected_draft_revision，submit required Idempotency-Key。闭合请求/响应；空白提交GEO_ANSWER_EMPTY、缺证据GEO_EVIDENCE_REQUIRED、版本冲突REVISION_CONFLICT、非人工GEO_MANUAL_MODE_REQUIRED、不可编辑INVALID_STATE_TRANSITION、异载荷IDEMPOTENCY_CONFLICT。

Database：0051_geo_manual_collection在0050后新增geo_manual_drafts和geo_manual_submissions。具名CHECK/FK/索引/触发器，草稿文件和User引用RESTRICT。提交保存摘要/稳定UUID/版本/时间，不保存原key。无历史回填或原数据改写。

## 11. 后端

Router仅认证/CSRF/schema/调用；Service拥有READ COMMITTED事务。锁序User→identity advisory→Surface→Profile→Batch→Run→Draft→Files(UUID)；读取认证前RR并禁autoflush。当前资格锁后重读，模式/环境/证据要求来自冻结输入。复用GEO-302策略；证据、缓存、身份、最小审计同commit。未知错误原样失败，全部rollback。

## 12. 前端

只generated类型，无route/query key/URL/页面变化。后续页面实现dirty/409输入保护和证据展示。

## 13. 测试计划

Unit/contract：闭合输入/时间/URL/引用位置、运行时与根及generated一致。PG/API：同键/异载荷/异键/跨用户并发、草稿冲突/no-op、证据要求/非MANUAL、冻结输入、资格/身份/CSRF、状态/不可变/旁路SQL、文件GC、失败原子性、旧head前滚。无新UI，真实session/PG/fake-OSS集成验证人工API完整旅程；不新增浏览器E2E。

## 14. 验收标准

并发恰一回答/引用/文件关联/提交身份/成功审计；同键同请求回执逐字相同，异请求409；stale草稿409保留原输入；缺证据/非人工/非法状态/HEAD失败不能COLLECTED；数据/约束/审计失败无部分成功，成功证据不可改或追加。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration COMPOSE='docker --context colima compose -f .trellis/tasks/10-02-geo-305-manual-collection/evidence/compose.validation.yaml'；定向pytest及隔离Alembic upgrade head。逐项结果保存在evidence/。

## 16. 数据和上线

0050→0051只expand，无回填，先迁移再部署。写资格受GEO_MONITORING_ENABLED控制，读草稿不受写开关，自动子开关不影响人工。降级55000安全停止，前向修复。仅专用Compose/卷，完成恢复原context/Colima状态，无生产迁移。

## 17. 风险与停止条件

重点交错：草稿/提交、配置停用、文件GC、跨用户竞争、审计失败。采集时间沿用Run创建≤开始≤采集，不能未来；人工上传应预先去除凭据/账号/支付信息，不宣称通用脱敏器。仅用户五类条件blocked：无法消解文档冲突、未批准破坏性迁移、需改变已批准指标/状态/安全、必需外部输入/授权缺失、依赖未完成。

## 18. 完成证据

起点evidence/baseline与start-files.json；baseline-unit.log、baseline-integration.log。最终diff/门禁/前滚/独立审查见implement.md与evidence/。

## 19. 后续

GEO-306列表/详情、GEO-307页面、GEO-308 R2验收、GEO-506分析Worker、GEO-901草稿保留清理；本任务不实现。
