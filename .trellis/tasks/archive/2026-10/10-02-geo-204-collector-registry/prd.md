# GEO-204 Task Brief：Collector Registry 与 Profile 资格策略

## 1. 基本信息

Task ID GEO-204；R1；负责人当前 Codex 主代理；当前状态 completed（manifest=done，2026-10-02 人工接受）；分支 geo/GEO-204，base main；依赖 GEO-203=done 且 Trellis completed，有 2026-10-02 用户接受依据。无提交/PR/发布。

## 2. 目标

为后续 Plan preview 和 Worker 建立同一可复用的 adapter 查询、配置校验和运行资格策略，未知 adapter 和能力不匹配明确失败，检查过程无外部调用。

## 3. 关联需求

CAP-GEO-03；CAP-GEO-16 的资格部分；AC-SEC-03；未来 AC-PLAN-02 的资格基础，不宣称实现计划预览。

## 4. 必读文档

已读取根/后端 AGENTS、Trellis workflow/backend 与 guides 索引、相关错误/质量/AI边界规范、GEO-203 PRD/design/implement/接受记录；用户指定 README、roadmap、完整 WBS（含 GEO-204 行）、execution guide、task template、manifest、product 01/02/03、business 01/02/03、technical 01/02/03/04/07 和 Accepted ADR-001。另读 technical 05、security 的外部门禁、Accepted ADR-005。当前相关权威为根 OpenAPI 的 Surface/Profile/能力/settings 组件、database 的 Surface/Profile/AI 生命周期章节、0046迁移、ORM/Schema和既有测试。

## 5. 当前行为

0046 两表、闭合配置、复合 MATCH FULL FK/成对 SET NULL、revision 守卫已实现。四项 Settings GEO 开关默认关闭。没有 collectors 目录或资格策略，没有 Plan/Run/profile端点或页面。当前工作树含先前未提交任务，初始状态与文件哈希保留在 evidence。单元基线161 passed；Docker 初始停止，已使用独立 compose 完成46项PG基线和后续检查（见implement.md）。

## 6. 目标行为

不可变 registry 按精确 key 查询，拒绝重复及未知 key。注册项提供版本、固定模式、能力、配置限制、环境与批准信息；默认仅 manual。纯 validate_profile 与 eligibility result/require_eligible 可供后续调用。一次非敏感列查询构造当前 Profile/Surface/模型事实快照，不受 ORM identity map 旧值影响。

## 7. 范围内

- [x] Registry、capabilities、配置限制和共享资格策略。
- [x] 未知/mode/capability、合规/开关/启停/测试/实时模型门禁。
- [x] 单元 contract tests、定向 PostgreSQL 证据和指定六项命令。
- [x] 本任务文档/manifest/SHA及证据。

## 8. 范围外

GEO-205 CRUD/启停/API/UI；GEO-207 RunMatrixBuilder/费用；GEO-401 request/answer/transport error协议；连接测试/失效写策略、Worker、Batch/Run、真实或fake provider请求、Browser会话存储、分析、指标、机会、生产迁移、依赖升级或Git提交。

## 9. 业务不变量

PostgreSQL唯一业务状态源；Registry只是受控代码元数据。未知key无回退；自动adapter未登记实现不能假成功；配置合法不授予采集权。自动模式需APPROVED Surface、approved adapter、对应开关、启用和已测试配置。模型身份必须精确匹配当前引用；解绑后的PASSED不能放行。

## 10. 契约变化

无OpenAPI operation/schema/error变化；无DB表列约束变化，无Alembic revision。新增内部类型/稳定blocker不是HTTP错误码，不持久化资格状态，不改历史记录。

## 11. 后端实现

Registry与纯策略不接收Session或ORM。Application Service用列查询显式映射内部不可变快照，禁止autoflush，不提交、不rollback、不加锁，调用方拥有事务。未来写锁序继续User→Channel→Model→Surface→Profile，发送资格需在执行边界重读。无新Router/Queue/lease/dispatch/at-most-once实现；发送路径属于后续任务。

## 12. 前端实现

无路由/query key/URL/页面行为变化，无generated变更。

## 13. 测试计划

Unit/Contract：配置闭合、未知/重复key、模式/surface/语言/地区/login/search、能力交集与要求、默认关闭/父子开关、环境批准、停用与测试、模型归属与解绑。PG：真实当前行变化、删除后PASSED/引用重读、单查询/非敏感投影/无写。已有 Surface/Settings/合同为基线。无E2E/性能或真实provider测试。

## 14. 验收

精确key可解析且不静默替换；缺失能力有定位blocker；预览可读取同一result，执行可require_eligible，策略没有调用方角色分支；开关/合规/引用资格失败均拒绝；测试不执行provider。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（专用COMPOSE）；另加Profile/Registry定向单元及PG。实际命令、exit code、日志保留evidence，skip不算通过。

## 16. 数据和上线

沿用0046，无新前滚/回填/seed/生产变更。默认registry仅manual；Settings默认值不变；资格结果即时计算，无缓存和可写第二状态。结束清理专用容器/卷并恢复Docker起始状态。

## 17. 风险与开放问题

能力声明不等于单次搜索/引用事实；资格不覆盖后续发送所需数据分级、预算、network、browser session与lease。仅用户列明五类条件blocked；环境阻断精确记录，不扩大任务或放宽安全。

## 18. 完成证据

本地验证完成，manifest/Trellis更新review，完成时间保持null；证据见implement.md/evidence。独立只读复核已完成且无阻断发现，审计Digest已校验；六项指定门禁结果见implement.md，不自行done/归档。

## 19. 后续任务

GEO-205、GEO-207、GEO-401及后续采集任务；本次不实施。
