# GEO-101 实施与验证记录

## 1. 交付状态

发布增量 R1；依赖 GEO-003、GEO-002 均已人工接受为 done。仅实现 GEO-101 合同层，未实施后续任务。工作分支为 `geo/GEO-101`，未提交、推送或部署。

本地实现、契约测试及静态检查已经通过；独立只读复核通过，未确认阻断合同交付的 P1/P2 问题。Task Brief 见 [prd.md](prd.md)。manifest 和 task.json 只进入 review，不由代理标记 done。

## 2. 当前实现与目标的区别

现有系统有 164 个真实 OpenAPI operation，现有 GEO 为文章关系观测。Catalog 没有表、ORM、Pydantic Schema、Application Service、Router 或 UI；源码 Alembic head 为 `0043_geo_platform_identity`，实际数据库版本未经本任务检查。

本次增加可验证的公共 Schema、待接线的完整 Path Item 和数据库目标合同。标准 `paths` 与实际 Router 继续严格相等。12 个 Catalog 操作暂存根 OpenAPI `x-geo-catalog-contract.paths`，标记 CONTRACT_ONLY；GEO-104 实施 Router 时迁入标准 paths 并删除扩展。没有修改 drift comparator、添加豁免或伪造成功路由。语义比较证实原有 OpenAPI 节点及原有数据库合同段落完全保留，见 [scope-inspection.json](evidence/scope-inspection.json)。

## 3. 修改文件

| 文件 | 用途 |
|---|---|
| `contracts/openapi.yaml` | 33 个 Catalog Schema、12 个待接线操作、错误及安全声明 |
| `contracts/database.md` | 三表目标合同、命名约束/索引、归属、并发及删除保证 |
| `backend/tests/unit/test_geo_catalog_contract.py` | 29 项可观察公共合同测试；未新增业务实现 |
| `frontend/src/shared/api/generated/schema.d.ts` | 由根 OpenAPI 生成新增组件类型；现有 paths/operations 保留 |
| `docs/geo-monitoring/01-product/02-geo-core-prd.md` | Catalog 请求字段与事实边界同步 |
| `docs/geo-monitoring/02-business/02-domain-model.md` | 聚合版本、品牌父级及事实归属同步 |
| `docs/geo-monitoring/03-technical/02-data-architecture.md` | 三表合同改为引用根数据库权威，删除竞争性表定义 |
| `docs/geo-monitoring/03-technical/03-api-contract-design.md` | 接线边界、请求/响应、权限、错误及版本语义同步 |
| `docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md` | 仅标记 Catalog 合同证据，不冒充运行时完成 |
| `docs/geo-monitoring/04-delivery/task-manifest.yaml` | 仅 GEO-101 planned → in_progress → review |
| `docs/geo-monitoring/README.md`、`CHANGELOG.md`、`SHA256SUMS` | 入口、变更记录及完整性同步 |
| `.trellis/tasks/10-01-geo-101-catalog-contract/` | Task Brief、任务元数据、验证与复核证据 |

起始工作树包含 GEO-002～005 及其他任务的未提交改动，本任务未覆盖它们。完整起始状态见 [initial-status.txt](evidence/initial-status.txt)。未修改 backend runtime、Alembic、迁移 snapshot、前端业务代码、根部署文件或依赖。

## 4. OpenAPI 合同

- Subject 类型：OWN_BRAND、OWN_PRODUCT、COMPETITOR_BRAND、COMPETITOR_PRODUCT、REFERENCE_PART。
- create/update 使用 subject_type 判别的闭合对象。OWN_PRODUCT 只接受现有 Product ID、合法可空品牌父级及监测用途 description；拒绝名称、事实、revision、归属等只读输入。类型/Product 绑定不可变。PATCH 必须至少有一个可编辑字段，省略保留原值，显式 null 清空父级。
- Alias 有 NAME/PART_NUMBER/ABBREVIATION/LEGACY、受控可空语言标签及启停字段；Domain 有 OWNED/OFFICIAL/DISTRIBUTOR/OTHER，创建/删除，输出为规范 ASCII hostname 且 is_active 恒 true。
- SubjectOut 包含当前 Product/parent 摘要、aliases/domains、references、workflow_stage、primary_task、available_actions、deletion.blockers、revision 和创建信息。枚举未知值明确拒绝。list 提供筛选、稳定排序及 page/page_size/total。
- Subject create 返回 201；Subject delete 返回 204；其余写操作包括子项 delete 返回最新 SubjectOut，客户端从父投影取得 aggregate revision。
- 统一 ErrorResponse、X-Request-ID、session 和写请求 CSRF。ADMIN 写、ADMIN/ENGINEER 读；子资源跨父 ID 写入按 404 处理。
- 五个领域错误：GEO_SUBJECT_IN_USE、GEO_SUBJECT_PRODUCT_EXISTS、GEO_SUBJECT_ALIAS_EXISTS、GEO_SUBJECT_DOMAIN_EXISTS、GEO_SUBJECT_PARENT_INVALID；同时沿用 AUTH_REQUIRED、PERMISSION_DENIED、CSRF_INVALID、PASSWORD_CHANGE_REQUIRED、VALIDATION_ERROR、NOT_FOUND、REVISION_CONFLICT。错误映射的 SQLSTATE 和具体 constraint/index 名在根数据库合同中明确。

## 5. 数据库、迁移与数据说明

目标 `geo_subjects`、`geo_subject_aliases`、`geo_subject_domains` 仅作合同定义。OWN_PRODUCT 的三个名称列必须 NULL；非自有对象名称列非空。活动 Product 身份由 partial unique index 保证；停用历史身份保留。

父级使用内部 parent_subject_type 判别列、配对 CHECK、合法类型 CHECK、`UNIQUE(id,subject_type)` 和 MATCH FULL 复合 RESTRICT FK，确保 SQL 最终防线真实验证父级类型。Alias 唯一性包含停用行；Domain 按 Subject+规范 hostname 唯一。跨 Subject 相同别名/域名允许登记，未来匹配必须保留歧义并要求复核。

新增 Alembic revision：**无**。前滚、downgrade、回填及历史数据迁移：**未执行且不适用**。GEO-102 负责新的迁移，不修改既有 0001～0043 或 migration_schema_v1；本任务没有表已创建或约束已生效的运行证据。合同先行阶段的恢复仅撤回本次新增合同/生成类型，不删除现有数据。

## 6. 业务不变量、锁、幂等与错误

OWN_PRODUCT 名称及最小摘要只读当前 Product；无第二事实源，不接收 Product 事实编辑字段，description 只作监测用途。Product revision 独立，不以产品编辑伪增 Subject revision。PostgreSQL 保持业务状态唯一来源，没有 Redis 消息或网络采集实现。

Subject/Alias/Domain 共享父 revision。所有非创建写命令提交 expected_revision；服务取得锁后先校验版本，再判断业务冲突。真实变更只增一次版本，与 updated_at 和最小成功审计同事务；同状态 enable/disable 或完全无变化 PATCH 在当前版本下不增版本、不重复审计。Catalog 不使用 Idempotency-Key，重复创建按唯一冲突明确失败，不自动重放。

未来统一锁序：涉及 OWN_PRODUCT 的 Product → 旧/新品牌（去重 UUID 升序）→目标 Subject → Alias/Domain。父身份读值只用于确定锁集合，取得目标锁后重验 revision/身份；Router 不拥有事务、锁或 ORM 写入。并发保证仅定义合同，尚未执行并发数据库测试。

ADMIN 删除仅在同事务持锁重新统计直接引用后进行；blockers 覆盖子 Subject、计划、运行、分析、机会，历史引用仅允许停用。ENGINEER 的 actions 为空、deletion 为 null。Subject 删除只级联当前 Alias/Domain，不级联 Product、子 Subject 或任何历史；Alias/Domain 单独删除不改变既有完整字典快照。

只对明确 SQLSTATE+稳定约束名映射领域错误；FK 竞争 rollback 后返回 GEO_SUBJECT_IN_USE 空 details，不重查伪造 blocker。未知异常、审计或提交失败保持失败并整体回滚，不能宽泛吞 IntegrityError。未来引用域必须添加真实 RESTRICT FK 和同一 Subject 锁，具体表及计数实现留给后续任务。

## 7. 安全、隐私、外部调用与前端

沿用公司内部单租户身份与 ADMIN/ENGINEER 权限；created_by 是受控操作者追溯，不是客户端隔离键。闭合请求拒绝伪造 created_by、actions、blockers、revision 等输出。没有新身份系统、凭据/secret 字段、外部 AI、DNS、HTTP 或 TLS/SSRF 边界变化。

域名输入合同要求 IDNA2008/UTS #46 non-transitional+STD3；拒绝协议、端口、路径、IP literal、通配符等，关系枚举不构成所有权证明。归一化 Service 实现留给 GEO-103，不以 schema pattern 冒充完整 IDNA runtime 校验。

前端只更新 generated 类型，没有页面、路由、query key、URL 状态或前端状态机变化；未接线的 GEO operations 不出现在当前 paths 类型中。GEO-105/106 负责真实页面和端到端验收。

## 8. 实际验证

| 命令 | 结果 | 证据 |
|---|---|---|
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py`（基线） | exit 0，129 passed | evidence/baseline.json |
| `make contract-check`（基线） | exit 0 | evidence/baseline.json |
| `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py backend/tests/unit/test_geo_catalog_contract.py` | exit 0，158 passed | evidence/contract-schema-tests.json、.log |
| `make contract-check`（候选） | exit 0；runtime 与 164 个 operations 一致，generated 无漂移 | evidence/required-checks.json |
| `make lint` | exit 0；Ruff、ESLint | evidence/required-checks.json |
| `make typecheck` | exit 0；mypy、前端 tsc | evidence/required-checks.json |
| `make test-unit` | exit 0；后端 850、前端 863 passed | evidence/test-unit.json、.log |

新增 Schema 测试验证有效/无效的可观察实例：Product 绑定及只读事实拒绝、父级类型、空 PATCH、aggregate revision、枚举与语言、域名危险输入和规范输出、必须投影、blocker 及分页。Path Item 测试验证状态码/返回体、唯一 operationId、权限/CSRF、请求 ID 和领域错误覆盖。schema refs 与 JSON Schema 定义检查通过。

最终 `git diff --check` 通过；定向未跟踪文件 whitespace 检查通过。`shasum -a 256 -c SHA256SUMS`（cwd=docs/geo-monitoring）113 项通过。新增/修改文档链接检查通过。详见 evidence/final-checks.json、checksum-check.json、link-check.json。首次哈希刷新误用工作目录导致脚本未找到文件，校验发现8个预期变更项尚未刷新；纠正工作目录并刷新后通过，非业务失败。未运行 PostgreSQL 集成、迁移演练、E2E、浏览器矩阵、构建或 make verify：本任务未实现运行时/DDL/UI，相关行为尚不存在；这些检查由对应后续任务实施。没有把它们表示为通过。

## 9. 独立复核和完成证据

fresh critical_reviewer 已完成独立只读复核，未确认阻断交付的 P1/P2 问题；主代理按实际风险覆盖和证据接受该复核交付，不等于任务人工接受。报告见 [independent-review.md](evidence/independent-review.md)。审查输入指纹与最终合同一致，未发生复核后合同改动。

SUBAGENT_EXECUTION_DIGEST 由 work-plan 从本次 plan/execution 校验生成，Audit Bundle 已关闭且 audit-verify 通过，无异常；见 [摘要](evidence/SUBAGENT_EXECUTION_DIGEST.md) 与 [引用](evidence/audit-reference.json)。Bundle ID：`20261001T230125Z-geo-101-catalog-contract-0d37d7b0`。模型及推理档位仅为 Agent TOML 配置证据。

manifest 仅 GEO-101 planned → in_progress → review，依赖及其他任务记录完全保留。task.json.status=review、completedAt=null，等待人工验收；未自行 done 或归档。根合同原有内容语义、运行时、迁移和用户原有改动范围核查通过，见 scope-inspection.json。

## 10. 限制与后续

GEO-101 完成的是待人工验收合同，API 及数据库功能仍不可用。此任务不建立 Batch/Run、PromptVariant、EngineSurface、CollectionProfile、指标、机会或采集能力。

下一步为人工复核 GEO-101，再按依赖推进 GEO-102 ORM/Alembic、GEO-103 Schema/领域策略、GEO-104 Service/API；GEO-201/GEO-203 等继续依据 manifest 独立处理，本任务未提前实现。

## 11. 人工验收完成 — 2026-10-01

本会话用户明确表示：“我已经人工审查并接受 GEO-101 的实现与测试证据。”据此仅将 manifest 的 GEO-101 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，并记录完成日期、接受者、范围与依据；Task Brief 的当前状态同步更新。

以上实施章节及 evidence 保留提交人工验收时的历史状态和验证边界。人工接受不表示尚未实现的 ORM、迁移、Service、Router 或页面已经可用，也不把未执行测试改写为通过。本次只记录 GEO-101 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾验证：git diff --check 通过；五个收尾文件另用独立临时 Git index 检查未跟踪文件，diff --check 通过。manifest 除 GEO-101 的 status 外保持原样，其他任务与原验证证据未修改；SHA256SUMS 仅更新 manifest 条目。
