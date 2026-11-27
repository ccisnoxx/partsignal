# GEO-101 Task Brief：GEO Catalog 公共契约与数据库合同

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-101 / R1 |
| 状态 | done（2026-10-01 用户人工审查并接受实现与测试证据；Trellis 为 completed） |
| 负责人 | 主代理维护根合同；候选完成后 fresh critical_reviewer 只读复核 |
| 依赖 | GEO-003=done、GEO-002=done；2026-10-01 从 manifest 和人工接受记录确认 |
| 分支 | geo/GEO-101（开始时已存在） |
| PR/Commit | 无；本任务不提交、推送、部署或归档 |

## 2. 目标

为后续 Catalog 实现冻结可验证的 GeoSubject、GeoSubjectAlias、GeoSubjectDomain 公共请求/响应、类型、错误、规范化、revision、动作及删除合同。OWN_PRODUCT 引用现有 Product，不形成型号、品牌、类别或事实正文的第二事实源。

## 3. 关联需求

CAP-GEO-01、REQ-GEO-SUBJECT-001～004；REQ-GEO-SUBJECT-005 的历史快照边界作为后续消费者义务，不实现分析。

## 4. 必读资料

根 AGENTS.md、backend/AGENTS.md（后端边界代理规则）、frontend/AGENTS.md（generated types）、.trellis/workflow.md、backend 规范索引及 available-actions/error-handling/database-guidelines 相关合同；frontend 类型索引。

完整读取用户指定的 GEO README、产品愿景、PRD、页面规格、业务架构、领域模型、状态机、技术架构、数据架构、API 设计、前端架构、质量策略、路线图、WBS、执行指南、任务模板、manifest 和 ADR-001。依赖证据来自 GEO-002/003 Task Brief、实施记录及 GEO-003 基线说明。当前代码依据：Product/GeoObservation ORM、Product 删除服务、统一错误、contract_check、相关旧迁移源码、契约测试和 frontend 生成脚本；未修改 frozen migration/schema snapshot。

## 5. 当前行为

现有 GEO 是文章关系观测和旧模型历史，OpenAPI 有 164 个真实 operation；无 Catalog 表、ORM、Schema、Router、Service、Worker 或页面。当前源码迁移 head 为 0043_geo_platform_identity，实际数据库版本未知。Product 拥有 part_number/brand/category/事实 Markdown。基线契约测试 129 passed，make contract-check 通过，见 evidence/baseline.json。

## 6. 目标行为

Schema 正反例能验证类型、产品绑定、字段 closure、revision、Alias/Domain、分页和投影。12 个目标操作有固定 operationId、权限、CSRF、请求/响应及错误映射。三张目标表有稳定命名的 CHECK/UNIQUE/FK、索引和删除合同。当前 164 个 runtime operation 保持完整漂移校验。

## 7. 范围内

- 两份根合同；新增标准 components 和显式 CONTRACT_ONLY 操作扩展。
- Catalog Schema tests 与 generated types 同步。
- 相关目标文档对齐、导航/追踪/哈希及本任务证据。

## 8. 范围外

GEO-102、103、104 的 ORM/Alembic/领域策略/Service/Router，GEO-105 页面，GEO-201/203，所有 Batch/Run/采集/分析/指标/机会业务；数据库操作、外部平台访问、新依赖、部署、无关重构。

## 9. 业务不变量

Product 是自有事实唯一 owner；PostgreSQL 是状态唯一 owner；Subject 是子资源 revision 唯一 owner；服务端投影不是授权；历史引用禁止物理删除；字典修改不改写历史；跨 Subject 重名仅作为歧义候选，不能自动任意匹配。

## 10. 契约变化

OpenAPI：`x-geo-catalog-contract.paths` 明确待 GEO-104 接线，components 是公共 Schema 权威。禁止给 comparator 增加豁免/overlay 或实现空成功 Router。待接线操作不进入当前 paths/operations 生成物；后续接线任务必须把冻结操作迁入 paths 并通过同一 runtime gate。

Database：定义 geo_subjects、geo_subject_aliases、geo_subject_domains；OWN_PRODUCT 的 canonical/normalized/display name 持久化为空，读取时从 Product 投影；活动 Product partial unique；父子类型的 DB 最终约束；聚合内部 CASCADE、外部 RESTRICT。无新增 Alembic、触发器执行或迁移结果。

## 11. 后端实现与并发设计

仅写合同，不实现后端。未来 Application Service 在同一事务维护业务写入、revision 和受控审计；锁 Product（如适用）→品牌父级→目标 Subject→目标 Alias/Domain；同层多 ID 升序。子写入使用 expected_revision（父），成功返回完整父投影。只映射精确 SQLSTATE + constraint name；未知失败回滚并暴露。Catalog 不要求 Idempotency-Key；重复创建是唯一性冲突，旧 revision 不自动重放。

## 12. 前端影响

仅由 api:generate 同步组件类型。无路由、query key、URL、页面、表单或状态机实现。未来消费 required workflow_stage/primary_task/available_actions/deletion；409 保留输入、显式刷新。

## 13. 测试计划

- Contract：标准 Draft 2020-12 Schema 正反例，local refs、操作 metadata、typed action/blocker/revision、Product 事实缺失与聚合子命令。
- Unit：现有契约测试回归；按质量文档执行 make test-unit。
- 静态/生成：make contract-check、make lint、make typecheck、git diff --check。
- PostgreSQL/迁移/E2E/Worker：不运行，当前任务没有相应实现或行为变化；其执行证据由后续任务取得。
- 候选独立只读复核：重点检查 OWN_PRODUCT 事实归属、可满足 Schema、父子与删除/concurrency 合同。

## 14. 验收

1. 完整请求/响应/枚举/错误/删除及 revision/actions/blockers 有公共定义。
2. OWN_PRODUCT 请求禁止提交自有名称及 Product 事实，数据库禁止保存重复身份字段。
3. aggregate revision 和当前动作/删除投影无前端第二权威。
4. 基线 runtime gate 未放宽，Contract schema tests 与最低四项命令有实际结果。
5. manifest/Trellis 进入 review，其他 GEO task 条目不变。

## 15. 验证命令

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py
git diff --check
make contract-check
make lint
make typecheck
make test-unit
```

## 16. 数据和上线

无 Alembic revision、前滚、回填、数据迁移或开关变化。合同先交付，GEO-102 从当前源码 head 新增迁移；GEO-104 实现 endpoint 后才宣称 runtime 可用。撤销本任务只恢复本任务合同/文档/generated 片段；不撤销既有未提交改动。

## 17. 风险与停止条件

风险：Product 第二事实源；静态 Schema 不可满足；子命令未保护 aggregate revision；历史引用删除穿透；契约先行冒充 runtime。用闭合判别 Schema、父 revision、命名数据库防线及明确 CONTRACT_ONLY 生命周期处理。

仅在用户指定的无法消解业务冲突、未批准破坏性迁移、已批准边界变化、必需输入/授权缺失或依赖实际未完成时 blocked。原目标草案的 Catalog 字段分歧在本任务按公共 authority 统一；其他域冲突仍由其任务处理。

## 18. 完成证据

基线见 [evidence/baseline.json](./evidence/baseline.json)；最终变更、精确测试结果、独立复核、文档和工作树检查将写入 implement.md/evidence。无运行库与前滚通过声明。

## 19. 后续任务

GEO-102 ORM/Alembic；GEO-103 Schema/规范化/领域策略；GEO-104 Service/Router/审计/既有生命周期接入；GEO-105/106 UI/E2E。GEO-201/203 等继续遵守各自依赖与单任务授权，本轮不实施。
