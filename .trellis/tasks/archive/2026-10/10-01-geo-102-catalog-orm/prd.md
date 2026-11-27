# GEO-102 Task Brief：GEO Catalog ORM 与 Alembic

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID / 发布增量 | GEO-102 / R1 |
| 状态 | done；2026-10-01 用户人工审查并接受，Trellis completed |
| 负责人 | 主代理实现；fresh critical_reviewer 独立只读复核 |
| 依赖 | GEO-101=done；manifest 与前序人工接受记录一致 |
| 分支 | geo/GEO-102（开始时已存在） |
| PR/Commit | 无；不提交、推送、部署或归档 |

## 2. 目标

将 GEO-101 已接受的 Subject/Alias/Domain 合同落实为共享 metadata 和可从当前 head 前滚的 PostgreSQL 迁移，使旁路 SQL 无法建立重复活动 Product 身份、非法父子关系或无效字典记录。

## 3. 关联需求

CAP-GEO-01、REQ-GEO-SUBJECT-001～003；REQ-GEO-SUBJECT-004 仅落实当前 Product/User/父子 FK 防线，不实现后续历史引用域或删除命令。

## 4. 必读文档

根 AGENTS、backend/AGENTS（后端边界代理规则）、.trellis/workflow、backend/guides 索引及迁移/质量规范；用户指定 GEO README、路线图、WBS 完整任务行、执行指南、任务模板、manifest、产品愿景/PRD/页面规格、业务架构/领域模型/状态机、技术架构/数据架构/API/前端/质量策略及 Accepted ADR-001；前序 GEO-101 Task Brief、实施与人工接受记录。

权威实现输入：contracts/database.md Catalog 完整章节、contracts/openapi.yaml Catalog 公共 Schema 与 CONTRACT_ONLY 边界；app/db.py、模型注册、Product/User/旧 GEO 模型、Alembic env/0043、迁移与合同测试。第三方 API 按安装版 SQLAlchemy/Alembic 源码核对。

## 5. 当前行为

源码 head=0043_geo_platform_identity，无 Catalog 三表/ORM；已有 GEO 为文章关系观测。GEO-101 冻结合同但未接 Router；Product 拥有产品事实。共享 Base.metadata 的 CHECK naming convention 会再次包装显式名称，须用 conv 保持稳定名。起始工作树包含前序未提交成果，必须保留。

相关基线 158 passed、1 skipped（未设置 PostgreSQL 测试 URL）。Docker 初始未运行；已成功启动既有 Colima 实例，继续建立隔离 PostgreSQL 16 验证环境。

## 6. 目标行为

三表注册；0044_geo_catalog 依赖 0043；空库及含旧 GEO 的 0043 可前滚、metadata 无漂移；活动 Product 唯一、真实父类型、不可改身份和字典防线有直接 SQL 证据。

## 7. 范围内

- [x] 三个 ORM 模型与注册。
- [x] 新 Alembic revision、命名约束/索引、Subject identity guard。
- [x] metadata/迁移/约束/SQL 反例及相关现有 head 测试。
- [x] 数据库实施状态、必要导航/追踪/清单/哈希、Trellis 证据。

## 8. 范围外

GEO-103 Schema、NFKC/casefold/IDNA 策略、stage/actions；GEO-104 CRUD/API/事务/锁/CAS/审计/HTTP 错误映射及 Product/User 生命周期投影；GEO-105/106 UI/E2E；其他所有 GEO 任务、Batch/Run、采集、指标与机会。不改 frozen migration/migration_schema_v1，不升级依赖，不接外部 AI。

## 9. 业务不变量

1. OWN_PRODUCT 仅持 Product FK，三个名称列全 NULL，无产品事实副本。
2. 每个 Product 最多一个活动身份；停用保留，重启仍竞争唯一。
3. 可空父级只能匹配品牌；复合 MATCH FULL FK 拒绝伪造父类型。
4. 子字典同 Subject 唯一、跨 Subject 可重复，无子 revision。
5. Product/User/品牌父级 RESTRICT；仅当前 Alias/Domain CASCADE。

## 10. 契约变化

OpenAPI 无变化，保留 CONTRACT_ONLY。Database 按已接受三表合同落实所有约束/索引和 geo_subjects_identity_guard，更新实施状态及 0044 说明。仅 expand，不回填或改写旧数据；downgrade 以 55000 拒绝，恢复用前滚修复或迁移前备份。

## 11. 后端实现

只修改模型和 Alembic；无 Router/Service/Query/Worker。revision 默认 0，updated_at 留未来 service 在真实聚合写时维护，不添加自动 CAS/审计。迁移冻结自身 schema，不导入 runtime model。未来锁序 Product→旧/新品牌（UUID 升序）→Subject→子项沿用合同，本次只提供 DB 最终防线。23505/23514/23503/55000 保留结构化 diagnostics，HTTP 映射留 GEO-104。

## 12. 前端实现

不适用；无路由、query key、URL 或页面状态变化。

## 13. 测试计划

Unit 验证注册、事实/版本边界、公共枚举及稳定 DDL。PostgreSQL 验证 0043 含现有 Product/GeoObservation 前滚、旧数据原样保留、空库 head、三表 metadata 一致、直接 SQL 类型/父级/字典/身份正反例、CASCADE/RESTRICT、前滚恢复及两个连接的活动唯一竞争。Contract/静态复用现有 gate。无前端/E2E/Worker 实现，不新增相应测试。候选须独立只读复核 NULL 漏洞、真实父级、并发唯一及历史迁移保留。

## 14. 验收标准

1. 0043→0044 与空库 head 成功；旧 Product/GEO 行及表结构保留。
2. 活动重复/重新启用冲突；停用历史合法。
3. SQL 伪造父类型、半 NULL、非法关系与改身份被拒绝；合法可空父级可写。
4. 字典唯一、枚举、长度、语言、hostname、active 与删除防线生效；metadata 无漂移。
5. 最低命令有真实结果，环境缺口精确记录。
6. manifest/Trellis 只进入 review，其他任务不变。

## 15. 验证命令

```bash
git diff --check
make contract-check
make lint
make typecheck
make test-unit
make test-integration
uv run --project backend alembic -c backend/alembic.ini upgrade head
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_metadata.py
# PostgreSQL 测试使用显式隔离 URL；精确命令/结果写入 implement.md
```

## 16. 数据和上线

先 expand；GEO 开关不变，默认关闭，无回填/后台/外部调用。Alembic 事务失败回滚；有数据后不删三表降级。只操作隔离测试库，不猜生产 URL。

## 17. 风险与停止条件

风险是 CHECK NULL 语义、显式名称二次包装、伪造父类型、唯一范围错误、runtime 污染 frozen 迁移和 metadata 漂移；用明确谓词、conv、冻结 schema 与真实 PostgreSQL 反例验证。仅用户指定的不可消解业务/ADR 冲突、未批准破坏性历史迁移、批准边界变化、必需输入/授权缺失或依赖未完成时 blocked。环境缺口记录后继续可执行验证。

## 18. 完成证据

evidence/baseline.json、initial-status.txt、frozen-fingerprints.json、before/ 保存起始证据；实施、精确命令和独立复核写入 implement.md/evidence。无 Commit/PR/部署。

## 19. 后续任务

人工验收 GEO-102；之后按依赖推进 GEO-103 策略、GEO-104 Service/API/生命周期、GEO-105/106 UI/纵向验收；本次不执行。
