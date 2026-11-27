# GEO-102 实施与验证证据

## 1. 交付状态

R1 / GEO-102：本地实现、指定验证及独立只读复核已完成，状态 review，等待用户验收，不自行 done。工作分支 geo/GEO-102；没有提交、推送、生产迁移或发布。

## 2. 依赖与 preflight

- 开始时 task-manifest GEO-102=planned；唯一直接依赖 GEO-101=done，前序 Trellis completed 与 2026-10-01 用户接受记录一致。
- 已读取用户指定的 18 份 GEO 文档、完整 WBS 任务行、根及后端 AGENTS、Trellis workflow/相关迁移与质量规范、前序任务记录、Catalog OpenAPI 与数据库完整权威章节、当前 ORM/迁移/相关测试。
- 编码前已在会话输出 12 项 preflight，Task Brief 按模板创建。状态先 planned→in_progress。
- 原实现 head=0043_geo_platform_identity；GEO Catalog 当时只有公共/数据库合同，无三表或 ORM。既存工作树包含 GEO-001～101 的未提交成果，初始清单及局部原文件保存于 evidence/initial-status.txt、evidence/before/。

## 3. 实现摘要与修改清单

| 文件 | 本任务修改 |
|---|---|
| backend/app/models/geo_catalog.py | 新增 GeoSubject/GeoSubjectAlias/GeoSubjectDomain，列、默认、CHECK/FK/UNIQUE/index 与已接受合同一致 |
| backend/app/models/__init__.py | 只新增 geo_catalog 注册 import |
| backend/alembic/versions/0044_geo_catalog.py | 冻结新 revision，添加三表、索引、身份触发器，拒绝破坏性 downgrade |
| backend/tests/unit/test_geo_catalog_metadata.py | 注册、单一 revision owner、产品事实边界、稳定 DDL/枚举合同 |
| backend/tests/integration/test_geo_catalog.py | 前滚、旧行/旧结构保留、metadata、ORM 默认、降级拒绝、真实并发唯一 |
| backend/tests/integration/test_geo_catalog_constraints.py | PostgreSQL 直接 SQL 正反例、唯一、父子、字典、身份与删除防线 |
| backend/tests/integration/test_migrations.py | fresh-head 的两处版本断言及最先 downgrade barrier，共三处局部更新 |
| contracts/database.md | 实现状态、0044 migration order、恢复边界；既有 Catalog 业务语义不变 |
| docs/geo-monitoring/README.md / CHANGELOG.md | 本任务导航与实施记录 |
| docs/geo-monitoring/03-technical/02-data-architecture.md | Catalog 已实现 ORM/迁移与后续 Service 边界 |
| docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md | 数据库已覆盖与后续需求尚未覆盖的状态 |
| docs/geo-monitoring/04-delivery/task-manifest.yaml / SHA256SUMS | 仅 GEO-102 状态及证据链接；受影响文档哈希 |
| .trellis/tasks/10-01-geo-102-catalog-orm | Task Brief、设计、实施与原始命令/审计证据 |

新人工维护源码均小于 500 行。既存大型迁移测试仅局部修改，无无关重构或依赖升级。

## 4. 合同与迁移

OpenAPI 没有本任务变化，Catalog 操作仍是 CONTRACT_ONLY；generated types、Router、Service、前端均未改变。数据库按 GEO-101 既定合同实施，不增加新业务能力。

revision=0044_geo_catalog，down_revision=0043_geo_platform_identity。新 revision 不导入 runtime ORM；仅 expand 三表、约束、索引及 trigger，无存量数据回填、删除或修改。PostgreSQL 16.15 的空库直接执行指定命令到 head 成功；定向测试先在 0043 插入虚构 Product/User/旧 LEGACY_MODEL_RESULT，再前滚并逐项比较旧行内容和所有旧表列定义，保持一致。

0044 downgrade 以 PostgreSQL SQLSTATE 55000 明确失败，拒绝删除 Catalog 身份与字典，失败后 revision/数据保持。恢复路径为前滚修复或恢复迁移前备份；不为测试开放历史删除权限。空库版本、三表、全部真实 constraint/index 与 trigger 见 evidence/postgresql-head.json。

## 5. 关键不变量

- OWN_PRODUCT 的 Product FK 必填，三个名称列全 NULL；其他类型 Product FK 为空且名称必填，不复制产品参数、品牌、事实 Markdown 或 FactVersion。
- uq_geo_subjects_active_own_product 为活动 OWN_PRODUCT 的 partial unique；多个停用历史身份允许存在，重新启用也竞争同一索引。
- 父列全 NULL 或全非 NULL；产品只连对应品牌。CHECK 排除非法类型/自引用，MATCH FULL 复合 FK 校验父行存在及真实 subject_type；伪造判别列、半 NULL 或引用不存在父级均失败。
- geo_subjects_identity_guard 保护 subject_type/product_id/created_by/created_at，真实 SQL 更新返回 55000。
- Alias 同 Subject normalized_alias 唯一（含停用）；Domain 同 Subject hostname 唯一。跨 Subject 重复保留，未添加误合并的全局唯一。
- Domain CHECK 保证 lowercase ASCII DNS 形态、标签/总长、非点分 IP、relation enum 和恒 true；language_code CHECK 检查小写受控标签。完整 Unicode/IDNA 策略仍归 GEO-103。
- Product、创建者 User、品牌父行 RESTRICT，包括停用子身份；仅 Alias/Domain 随无引用 Subject CASCADE，旧 Product/GEO 行保留。

## 6. 事务、锁、版本、并发与错误

本任务没有业务命令或 Router 事务。revision 默认 0，非负；子行无 revision，ORM 不自动更新聚合 revision/updated_at。GEO-104 继续拥有 Product→品牌（UUID 升序）→Subject→子项的统一锁序、CAS、成功审计和业务幂等；未提前实施。

并发测试使用两个独立连接：赢家先插入未提交 OWN_PRODUCT，败者在唯一索引上进入可观察的 PostgreSQL Lock 等待；赢家提交后败者只收到 23505 + uq_geo_subjects_active_own_product，最终只有一条活动身份。没有 mock 数据库错误或应用级假成功。

数据库保留结构化 23505/23514/23503/55000 和稳定 constraint/index 名。HTTP 精确映射尚归 GEO-104；没有宽泛 IntegrityError 吞错、文本解析或未知失败兜底。

## 7. 安全、隐私与前端

沿用公司内部单租户 Catalog，created_by 为追溯 FK；未改变身份、权限、CSRF、SSRF、TLS、凭据、历史不可变或审计边界。无网络采集、DNS/域名所有权检查、外部 AI、Redis 业务消息或真实平台调用。测试仅用虚构主体和样例测试凭据；不读取生产数据。

无前端路由、query key、URL 状态、页面或交互变化。未实现 GEO-103 Schema/策略、GEO-104 CRUD/API、后续 UI、回答级 Batch/Run、指标或机会。

## 8. 验证环境与基线

初始 Docker socket 不可用，既有 Colima VM 停止；启动该 VM 后以独立 Compose project partsignal-geo102-validation、独立 network/volumes 和样例配置建立 PostgreSQL 16.15、Redis、fake-oss。使用缓存测试镜像和源码 bind mount，未修改 deploy/compose.dev.yaml 或旧开发数据。

Host 测试 URL 为 postgresql://partsignal:partsignal_dev@localhost:55439/geo102_validation；这里的口令是 .env.example 的虚构测试配置。所有 integration 使用 temporary_database 创建/清理独立数据库；normal Alembic upgrade 仅迁移隔离基础库。

基线 command（evidence/baseline.json）：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py backend/tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent
```

158 passed、1 skipped，skip 因当时未设置 PostgreSQL URL。建立环境后单独补跑原 fresh migration 基线，1 passed（baseline-postgresql.log/json），不把原 skip 当作数据库通过。

## 9. 实际验证

| 精确命令 | 实际结果 | 原始证据 |
|---|---|---|
| git diff --check | 通过；另检查本任务 11 个未跟踪源码/文档的空白 | evidence/diff-check.log/json、untracked-whitespace.json |
| make lint | 通过：Ruff、前端 ESLint | evidence/lint-candidate.log/json |
| make typecheck | 通过：mypy 81 个源码、前端 tsc | evidence/typecheck.log/json |
| make test-unit | 通过：后端 855、前端 863 | evidence/test-unit.log/json |
| env UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py | 通过：数据库实施文档更新后 29 passed | evidence/catalog-contract-final.log/json |
| sh -c 'cd docs/geo-monitoring && shasum -a 256 -c SHA256SUMS' | 通过：全部 113 份文档哈希 | evidence/docs-check.log/json |
| make contract-check | 通过：runtime drift 与 generated 类型一致 | evidence/contract-check.log/json |
| make test-integration COMPOSE='docker compose --env-file .env.example -p partsignal-geo102-validation -f deploy/compose.dev.yaml -f .trellis/tasks/10-01-geo-102-catalog-orm/evidence/compose-validation.yaml' | 427 passed、2 warnings；完整目标实际执行，无 skipped | evidence/test-integration.log/json |
| env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@localhost:55439/geo102_validation UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head | 通过：空库→0044_geo_catalog | evidence/alembic-upgrade.log/json |
| env PARTSIGNAL_TEST_DATABASE_URL=postgresql://partsignal:partsignal_dev@localhost:55439/geo102_validation UV_CACHE_DIR=.cache/uv uv run --project backend pytest -x backend/tests/unit/test_geo_catalog_metadata.py backend/tests/integration/test_geo_catalog.py backend/tests/integration/test_geo_catalog_constraints.py backend/tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent | 77 passed、2 warnings | evidence/catalog-targeted-candidate.log/json |

最终 git diff --check、文档哈希和状态检查见 evidence/ 中相应收尾记录。此次完整集成命令保留 make 原测试目标，仅 override 隔离运行环境；不是用定向测试替代该要求。

早期失败及修复有保留：首次 Catalog fixture 原生 SQL 缺旧 users 的必填客户端默认字段，第二次缺既有 LEGACY_MODEL_RESULT 合同字段；已依据真实旧约束补齐虚构 fixture，未放宽生产约束。首次 lint 检出本任务 import 排序、fixture 显式再导入和长行，局部修复后重跑通过（evidence/catalog-targeted*.log/json、lint.log/json）。

metadata 对比产生两条 SAWarning：既有非 Catalog 表存在 FK 环，反射过程含 dialect_options；本测试仅比较新三表，FK/默认/索引 compare 无 diff，稳定 CHECK 名另行逐项比较、CHECK 行为由直接 SQL 正反例覆盖。记录警告，不声称完整仓库 metadata 已无漂移。文档哈希首次更新遗漏清单的 ./ 前缀，精确修复五份受影响哈希后全量清单通过，原因与修复见 evidence/docs-hash-correction.json。

## 10. 未运行验证与限制

未运行 make verify、镜像 build、浏览器 E2E/矩阵或真实平台探针：没有页面、部署、Router/Service/外部集成变化，用户最低指定命令已分别完成。未在生产或包含任意生产规模数据的库演练；迁移只新增对象，本地有空库与含既有数据 0043 的前滚证据，不声称生产发布。

Unicode NFKC/casefold、完整 IDNA round-trip、动作/删除 projection、审计、CAS/业务锁与精确 HTTP 错误映射未实施；这些是明确后续任务。旧 Product/User 生命周期 Service 尚未纳入新引用投影，数据库 RESTRICT 已有证据，GEO-104 接线时必须补齐业务入口。

## 11. 独立复核与审计

fresh critical_reviewer 只读复核数据库合同、新模型/DDL、约束与测试。审计 Bundle：20261002T043424Z-geo-102-catalog-review-69b7db5d。未发现可确认的合同偏差、数据完整性漏洞或发布阻断问题；检查范围和未覆盖区域见 evidence/independent-review.md。7 项候选源码/测试复核前后指纹一致（review-write-evidence.json）；本地工具已生成 SUBAGENT_EXECUTION_DIGEST.json/md 并关闭、校验 Bundle，校验结果 passed、无审计异常。主代理自查不算独立复核。

## 12. 收尾与后续

已清理本次独立 Compose 的容器、网络及三份专用 volume，保留原开发资源；本次启动的 Colima 在确认无其他运行容器后恢复为停止状态，见 validation-cleanup/colima-restore 证据。

最终范围检查：44 个冻结单元无变化，OpenAPI 相对任务开始无变化；manifest 解析确认只有 GEO-102 记录改变，全部依赖/其他任务保持。精确本任务差异保存在 evidence/task-diff/，避免把前序未提交成果算成本任务修改。

仅 GEO-102 planned→in_progress→review；GEO-101 保持 done、GEO-103 保持 planned。Trellis completedAt 留空，无 commit/PR/归档。所有后续任务须先人工接受当前任务并重新检查依赖，本轮不实施。

## 13. 人工验收完成 — 2026-10-01

本会话用户明确表示：“我已经人工审查并接受 GEO-102 的实现与测试证据。”据此仅将 manifest 的 GEO-102 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，并记录完成日期、接受者、范围和依据；Task Brief 的当前状态同步更新。

以上实施章节和原始 evidence 保留提交人工验收时的历史状态、测试结果及边界。人工接受不表示未实施的 Schema、Service/API、UI 或后续任务已经完成；不把未运行检查改写为通过。本次不修改其他任务状态，不实现后续任务，不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾检查执行 git diff --check，并另检查五个收尾文件的未跟踪文件空白；结果见本轮最终收尾报告。
