# GEO-203 实施与验证证据

当前状态 completed（manifest=done）；2026-10-02 本会话用户已人工审查并接受实现与测试证据。

## 实现摘要与范围

新增 GeoEngineSurface/GeoCollectionProfile 的26个标准公共数据组件、Pydantic Schema、ORM、0046迁移与模式/FK/秘密/迁移验证。六项能力和合规枚举、固定模式、模型归属、环境、闭合数值/布尔 settings 与默认停用一致。仅数据层，前端只从根合同重生成类型；没有API paths、Router、CRUD Service、页面、Registry/validate_profile、连接测试、Batch/Run、Collector、指标或机会。

GEO-004/GEO-101 在 manifest 均 done，Trellis completed 与人工接受记录已核对。根、backend、frontend AGENTS、适用 spec、全部用户指定 GEO 文档、完整 WBS GEO203 行、已接受 ADR、当前合同/代码/迁移/测试已读取；12点 preflight 已在编码前输出。初始分支已经是 geo/GEO-203，无Git写操作。共享工作树有先前多项GEO和其他改动，初始状态/哈希保存在 evidence/initial-status.txt、initial-files.json；本轮差异见 task-changes.patch 与 changed-files.json。

## 修改文件

- contracts/openapi.yaml、contracts/database.md：标准 components与两表合同，无现有paths/组件变更。
- backend/app/models/geo_surfaces.py、models/__init__.py、models/ai_generation.py：两类ORM注册、AIModel复合UNIQUE；其余AI配置和凭据行为保持。
- backend/app/schemas/geo_surfaces.py：Create/Update/Out、枚举、严格能力和三种闭合 settings。
- backend/alembic/versions/0046_geo_surfaces_profiles.py：冻结DDL、命名约束/函数/触发器/索引。
- backend/app/services/identity.py：仅新增两个created_by到真实引用统计，保持既有USER_BUSINESS_HISTORY、权限、锁和RESTRICT；此前GeoSubject/PromptVariant计数属于先前工作。
- backend/tests/unit/test_geo_surface_contract.py、integration/test_geo_surfaces_profiles.py：新增合同与真实PG反例。integration/test_migrations.py：当前head/安全降级断言。integration/test_geo_prompt_variants.py：独立历史0045与当前head夹具，避免服务使用过期schema。
- frontend/src/shared/api/generated/schema.d.ts：根OpenAPI重生成，无手写模型。
- docs/geo-monitoring：README、CHANGELOG、01-product/02-geo-core-prd.md、02-business/02-domain-model.md、03-technical/02-data-architecture.md、03-technical/03-api-contract-design.md、04-delivery/03-requirement-traceability-matrix.md、task-manifest.yaml、SHA256SUMS。
- 本Task prd.md、design.md、implement.md、task.json 与 evidence；不归档其他任务、不改其状态。

## 合同、迁移与旧数据

revision `0046_geo_surfaces_profiles`，down_revision `0045_geo_prompt_variants`。仅expand两表、AIModel(id,channel_id)复合UNIQUE、函数/触发器/索引；没有seed、历史回填或旧GEO/AI/QueryTopic数据改写。冻结SQL不导入运行时ORM/Schema。旧0045有数据前滚比对users、channels、models、geo_observations、geo_prompt_variants完整行不变；新表与AI唯一键metadata比对通过。AIModel既有4个server_default差异排除于本次新增唯一键比对范围，不掩盖新表默认值。

隔离PostgreSQL16的根目录命令 `APP_ENV=test DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55443/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head` 成功；随后 `alembic current` 确认为0046 head。另有空库升级+seed幂等与旧head前滚测试。downgrade明确以55000拒绝有损删表，version保持0046；恢复采用前滚修复或迁移前备份。未执行生产迁移。

## 不变量、并发与错误

MANUAL/BROWSER引用全空，MANUAL adapter=manual；API两个引用全空或同时引用同一channel的模型，由MATCH FULL复合FK保证。模型/渠道删除保持Profile，成对SET NULL；嵌套触发器豁免只允许两个引用改变、其余整行相等。解绑不伪造revision、测试或审计；未来资格必须重读当前引用，遗留PASSED不可授予运行许可。

DB与Pydantic共同约束模式/login、环境、测试时间、能力和settings。新配置停用、Profile UNTESTED；有效变化revision恰好+1/no-op不增，创建身份/Profile Surface与模式不可变；Surface首引用锁存不可清除、已引用不可删除。配置当前态可更新，未来真实Run保存历史快照和RESTRICT引用，本任务不假造历史消费者。

本任务没有新命令事务、锁、CAS、幂等键或队列；数据库触发器不拥有Application Service职责。expected_revision是请求数据合同，后续GEO204/205负责资格、锁后重读/CAS、完整事务与审计。User删除沿用现有锁和服务，只增加真实引用统计。命名23505/23503/23514失败可精确定位；没有新增HTTP错误码/mapper，未知错误不吞错、不宽泛映射。

## 安全、隐私与前端

Profile不存储、不接收、不返回API key/密文/Cookie/Header/session/path或任意request_parameters；settings只有模式专属bool/number/null，extra字段和嵌套配置明确拒绝，响应不join AI凭据。website_url只有信息展示作用，无认证/query/fragment，不发网络请求。真实模型/浏览器/外部平台未调用；测试使用虚构资料、fake provider和本地对象存储，未放宽生产权限/CSRF/SSRF/TLS/不可变/审计边界。内部单租户共享配置，created_by仅服务端追溯。

前端路由/query key/URL状态、组件与页面均无变化；仅generated types同步。未运行E2E、浏览器矩阵、完整make verify或build：本任务无新页面/完整用户旅程/浏览器差异，也无相应交付门禁。不能宣称这些检查通过。

## 实际验证命令与结果

每个命令的完整日志、命令/退出码/耗时JSON均在evidence。配置中的密码/key均为隔离环境虚构测试值，不读取生产.env。

| 命令 | 结果 | 证据 |
|---|---|---|
| `uv run --project backend pytest backend/tests/unit/test_geo_configuration.py backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_geo_prompt_variant_contract.py backend/tests/unit/test_contract.py`（UV_CACHE_DIR=.cache/uv） | 基线148 passed | baseline-unit.log/json |
| `pytest backend/tests/integration/test_geo_prompt_variants.py backend/tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent`（APP_ENV=test、PARTSIGNAL_TEST_DATABASE_URL隔离PG、uv backend） | 基线16 passed | baseline-postgresql.log/json |
| `uv run --project backend pytest backend/tests/unit/test_geo_surface_contract.py`（UV_CACHE_DIR） | 最终55 passed | targeted-contract-final.log/json |
| `uv run --project backend pytest backend/tests/integration/test_geo_prompt_variants.py backend/tests/integration/test_geo_surfaces_profiles.py`（APP_ENV=test、隔离PG URL） | 最终61 passed | targeted-integration-final.log/json |
| `make contract-check` | 最终通过；现有runtime drift和generated types一致 | contract-check-final.log/json |
| `make lint` | 最终ruff/eslint通过 | lint-final.log/json |
| `make typecheck` | 最终mypy 97源码与tsc通过 | typecheck-final.log/json |
| `make test-unit` | 最终后端1042、前端940 passed | test-unit-final.log/json |
| `make test-integration COMPOSE='docker compose -p partsignal-geo203-validation -f /tmp/geo203-compose.yaml'` | 最终541 passed、6条metadata警告 | test-integration-final.log/json |
| `uv run --project backend alembic -c backend/alembic.ini upgrade head`（前述APP_ENV/DATABASE_URL/UV_CACHE_DIR） | 空库前滚0046通过 | alembic-upgrade-head.log/json |
| `git diff --check` | 最终通过 | diff-check-final.log/json |

## 首次失败与修正依据

1. 0046 PLpgSQL的CASE表达式缺括号，46项setup error；事务回滚，已补括号，后续迁移和46项PG通过（targeted-postgresql*.log保留原始输出）。
2. 测试用了不存在的delete_user(user=...)参数，改为已有user_id；metadata server_default比较包含既有AIModel4项差异，限制该项到本任务新表、仍保留AIModel结构唯一键比较，46项通过。
3. 第一次完整集成540 passed/1 failed：旧PromptVariant夹具固定0045却调用当前identity服务，缺geo_engine_surfaces表。历史迁移与当前head服务用独立数据库夹具，61项定向通过，已启动完整复跑。
4. 独立复核两项P2：ProfileOut测试状态/时间关联未进公开Schema；Name首尾正则允许NUL。主代理补allOf/oneOf、保留API引用约束并修正正则，根合同与generated同步，55项反例与全单元通过。修正过程的mypy类型错误已修好；最终typecheck通过。

SQLAlchemy metadata比较保留既有循环FK排序/dialect_options警告；定向4条、全集成三处共6条，不把warning当作未验证的约束通过。未吞警告或重复重试。

## 独立复核与证据

critical_reviewer fresh只读复核验收通过，发现和修正见evidence/review.md。未重复PG/全套或宣称未来Registry/Run已验证；修正后的两处公共Schema由主代理反例验证，不冒充二次独立复核。validated WorkPlan、execution与SUBAGENT_EXECUTION_DIGEST已生成、bundle已关闭且audit-verify passed；audit_id `20261002T150935Z-geo-203-independent-review-fb36451c`。辅助fingerprint/prompt文件为unclassified artifact警告，哈希校验仍通过，无审计异常。

## 状态、限制与后续

manifest GEO203 planned→in_progress→review，Task Brief已创建/启动并同步review；依赖任务状态保持done，GEO204/205保持planned。最终门禁与清理完成，已更新为review，completedAt保持null，无commit/PR/发布。

已知限制是本任务范围：未实现Registry注册/资格、合规启动门禁、连接测试/失效策略、HTTP动作/错误映射、管理接口/页面和真实历史消费者；API两空不保证adapter存在或可用。自动能力开关保持原有默认关闭，不制造外部成功或替代模型。下一任务GEO204建立Registry/Profile资格，之后GEO205管理API/页面；本次不实施。

## 验证环境清理

专用partsignal-geo203-validation容器、网络与两个数据卷已通过compose down --volumes --remove-orphans清理；docker ps确认无残留运行容器。恢复初始Colima停止状态，实际结果见colima-restore.log/json；无生产环境改动。隔离compose记录在evidence/validation-compose.yaml，可重建同等fake环境。

文档SHA256SUMS全项校验通过（document-checksums.log/json）；Docker context恢复default。最终actual diff及工作树已检查，既有paths/components和无关源码保留；新增源码均低于500行。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-203 的实现与测试证据。”据此仅将 manifest 的 GEO-203 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

以上实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果及已知限制，不将未运行检查改写为通过。本次只记录 GEO-203 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
