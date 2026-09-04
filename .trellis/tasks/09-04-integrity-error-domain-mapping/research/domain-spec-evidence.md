# Research: 稳定 backend/domain 完整性错误与业务约束证据

- Query: 审计 identity、product facts、platform configuration、content planning、content production、publication、AI configuration 各稳定 service owner 的领域错误、状态码、完整性约束、不可变性、权限/状态边界，并判断数据库契约、OpenAPI、generated client、稳定 spec 与业务设计文档的后续影响。
- Scope: mixed（项目源码、Trellis spec、业务设计文档与本地迁移/合同；未引入外部网络资料）
- Date: 2026-09-04

## Findings

### 阅读文件清单

以下是本次实际读取或针对性读取的文件。迁移文件一项是通过 `rg --files` 建立的完整版本清单并读取约束/命名证据；未把每个历史迁移全文复制进研究记录。

| 文件 | 用途 |
|---|---|
| `.trellis/workflow.md` | Trellis 阶段、任务与研究输出边界。 |
| `.trellis/spec/backend/index.md` | backend spec 索引及各域规范入口。 |
| `.trellis/spec/backend/error-handling.md` | `IntegrityError`、`AppError`、ErrorEnvelope、OpenAPI metadata 的稳定错误合同。 |
| `.trellis/spec/backend/database-guidelines.md` | PostgreSQL 最终约束、不可变性、发布/配置/内容事务合同。 |
| `.trellis/spec/backend/available-actions-contract.md` | action projection 非授权、锁内复核、删除阻断与 409 错误矩阵。 |
| `.trellis/spec/backend/publication-workbench-guidelines.md` | 发布工作、公开成果、问题、删除与 `55000` 数据库守卫。 |
| `.trellis/spec/backend/ai-configuration-guidelines.md` | AI 渠道/Header/模型、快照、管理员权限和 AI 错误约束。 |
| `.trellis/spec/backend/content-version-detail-contract.md` | 内容版本详情的只读快照和事务读取合同。 |
| `.trellis/spec/backend/directory-structure.md`、`.trellis/spec/backend/quality-guidelines.md`、`.trellis/spec/backend/logging-guidelines.md` | backend 层目录、质量与日志约束（未发现会改变本次领域映射结论的额外规则）。 |
| `.trellis/tasks/09-04-integrity-error-domain-mapping/prd.md` | 本任务的 R1–R7 研究范围、验收条件及“未知错误不得固定映射”的要求。 |
| `backend/app/errors.py`、`backend/app/main.py`、`backend/app/db.py` | ErrorEnvelope/全局 handler、FastAPI 注册和请求会话回滚边界。 |
| `backend/app/services/identity.py` | 用户创建、批量状态、删除与 `USER_IN_USE`。 |
| `backend/app/services/product_facts.py` | 产品身份唯一约束和事实/产品 revision 事务。 |
| `backend/app/services/platform_configuration.py` | Platform Type、Prompt、AI 配置相关服务路径。 |
| `backend/app/services/content_planning.py` | Platform Profile、Query Topic、Content Task 创建路径。 |
| `backend/app/services/content_production.py` | Generation/Humanization job、内容版本创建路径。 |
| `backend/app/services/publication.py` | Platform Account、PublicationWork、公开内容 issue/repair 路径。 |
| `backend/app/services/ai_configuration.py` | AI Channel、Header、Model 增删改和约束触发点。 |
| `backend/app/models/identity.py`、`product_facts.py`、`configuration.py`、`content.py`、`ai_generation.py`、`publication.py`、`geo_files.py` | ORM 唯一、检查、外键、部分唯一索引和历史关系。 |
| `backend/app/routers/identity.py`、`product_facts.py`、`configuration.py`、`planning.py`、`production.py`、`publication.py` | 各命令的 operationId、权限依赖和显式 response status metadata。 |
| `backend/alembic/versions/0001_*.py`–`0043_*.py` | 线性 Alembic 版本及约束/触发器演进清单；关键版本包括 `0027_guard_audit_actor_user_delete`、`0032_task_idempotency`、`0034_publication_redesign`、`0037_simplify_deletion_lifecycle`、`0038_published_article_delete`、`0043_geo_platform_identity`。 |
| `contracts/database.md` | 数据库演进、当前约束名称、已批准的稳定错误映射。 |
| `contracts/openapi.yaml` | 冻结 operation/status/schema 合同；错误码字段目前为字符串而非枚举注册表。 |
| `docs/architecture.md` | router/service/model/DB 权威分层及模块边界。 |
| `docs/GEO多平台内容运营系统方案设计.md` | 领域不变量、角色、不可变历史、显式失败与测试原则。 |
| `docs/GEO系统前后端技术与部署方案.md` | 后端模块、事务/并发、迁移和 AI pipeline 设计。 |
| `docs/content-humanization-prompt.md` | Markdown Prompt、只读来源、不可猜测和快照合同。 |

### 稳定规范的直接约束

`error-handling.md:61-87` 明确 PostgreSQL 是唯一约束的最终权威，预检查不能替代 `flush()` 竞态保护；捕获方只能读取驱动提供的 `error.orig.diag.constraint_name`，不得解析 `str(error)`。已确认的约束须先 `rollback()`，再抛 `AppError(code, message, 409, details)`；未知 `IntegrityError` 必须原样上抛（`error-handling.md:76-87`）。字段错误的 `loc` 固定为 `['body', '<field>']`，结构沿用 `details.errors[]`（`error-handling.md:70-79`）。把所有完整性错误改写为 `REVISION_CONFLICT` 被规范列为反例（`error-handling.md:102-115`）。

运行时错误层只有一个 `ErrorEnvelope` owner，`error_responses(*status_codes)` 只能由 operation 显式声明真实状态，禁止第二套 code registry 或 status mapping（`error-handling.md:118-147`）。因此未来若为未知数据库故障定义 500，必须先有经批准的公共错误合同；不能在研究或实现中临时增加通用错误类型。

`available-actions-contract.md:34-49` 要求 PostgreSQL 当前资源/引用/操作者为动作资格的权威输入；`available_actions` 只是投影，命令必须重新校验。删除阻断必须在同一锁事务内复核，不能靠前端或偶发 FK 异常推断（`available-actions-contract.md:51-67`）。账号唯一性合同已具体要求业务预检查和约束竞态返回相同 code/字段，并且未知错误不得吞掉（`available-actions-contract.md:253-293`）。用户 bulk 的任何数据库、编程或审计异常都须回滚整批（`available-actions-contract.md:315-376`）。

`database-guidelines.md:340-350` 规定发布工作/事件/核验/文章/问题的历史关系与成功提交边界，并要求平台、账号、内容版本、内容哈希绑定由应用服务生成结构化错误、由 PostgreSQL 最终保护。`database-guidelines.md:377` 和 `:402-408` 分别确认账号 normalized identifier 与 Platform Type slug 的精确映射。发布规范进一步要求历史不可变、错误关闭/删除语境必须由数据库守卫保护，直接非法历史更新/删除应为 PostgreSQL `55000`（`publication-workbench-guidelines.md:11-29,66-76,156-214`）。

### 现有 handler 与事务边界

`backend/app/errors.py:76-78` 当前把所有未在 service 捕获的 `IntegrityError` 都包装成 `REVISION_CONFLICT`、HTTP 409，且 handler 本身没有调用 `rollback()`。`backend/app/main.py:249-262` 将此 handler 全局注册；这与未知错误原样上抛、不能伪装为 revision 冲突的稳定规范冲突。`backend/app/db.py:31-40` 只在依赖生成器收到异常时执行会话 rollback，因此未知异常的响应边界和回滚责任必须在后续合同设计中明确，不能假定当前 handler 已提供通用正确语义。当前 main 只观察到 AppError、RequestValidationError、IntegrityError 三个 handler（`main.py:259-261`），没有已存在的统一 500 ErrorEnvelope owner。

精确检索显示 service 中有 6 个模块、9 个 `except IntegrityError` 捕获点：identity 1、product_facts 2、platform_configuration 3、content_planning 1、content_production 1、publication 1；AI configuration 没有捕获点。捕获并不等于正确映射，以下按域区分。

### 各领域 owner、约束与映射

#### Identity

- ORM 约束：`backend/app/models/identity.py:28-66` 中 username、session token hash 的唯一性，`ck_users_account_type`，Session→User 级联外键；`identity.py:69-112` 中 audit actor 为 `SET NULL`，另有审计字段检查。
- 用户创建只做 normalized username 预检查，重复时错误为 `REVISION_CONFLICT`（`backend/app/services/identity.py:399-412`），`flush()` 没有本域捕获。因此并发 username unique 竞态会落到当前错误 handler，且现有 code 语义不匹配；合同未批准新的 username conflict code，不能自行命名。
- 用户删除先锁全局用户状态与目标行，过期 revision 为 `REVISION_CONFLICT`，启用账号为 `USER_ACTIVE`，业务引用预检为 `USER_IN_USE`（`identity.py:597-620`）。删除 `flush()` 仅按 SQLSTATE `23503` 映射 `USER_IN_USE`，未知 SQLSTATE 上抛（`identity.py:622-649`）。这满足“业务历史引用统一阻断”的当前合同（`contracts/database.md:245-249`），但没有再核对 constraint name：多个业务 FK 的 23503 被聚合成同一个 `USER_IN_USE` 是有意业务语义，未来测试须确保非 FK 错误不会被误归类。
- 权限/状态边界由 service/router owner 负责；用户删除成功后才追加 `user.deleted` 审计，失败不能留下 success audit（`identity.py:635-649`；`contracts/database.md:247-249`）。

#### Product facts

- `Product` 的 normalized brand + part number 唯一约束、revision/status/check，以及 FactVersion 的 `(product_id, version)`、一条 pending 部分唯一索引、RESTRICT 外键和批准后不可变规则见 `backend/app/models/product_facts.py:27-100`。
- `product_facts.py:47-72` 是符合规范的精确 owner：只识别 `uq_products_normalized_brand`，rollback 后返回 `PRODUCT_ALREADY_EXISTS` 409，并定位 `body.part_number` 与 `body.brand`；create/update 在 `:395-424`、`:427-485` 的 flush 路径复用它。其余约束不吞掉。
- update 先锁产品、检查 expected revision，再阻止已有 APPROVED/RETIRED 事实时原地改身份（`product_facts.py:435-469`）。成功审计/commit 在 flush 之后，维持不可变与“失败不记 success”边界。
- Router 的 create/update operationId 位于 `backend/app/routers/product_facts.py:108-178`，已有 409 metadata；当前 OpenAPI 不需因该已存在的 409/code 增加 status。

#### Platform configuration

- `PlatformType.slug` 的唯一约束和 Profile/Prompt 的当前绑定、启停及外键见 `backend/app/models/configuration.py:40-125`。`_flush_platform_type()` 只识别 `uq_platform_types_slug`，返回 `PLATFORM_TYPE_SLUG_EXISTS` 409、`body.slug` details（`backend/app/services/platform_configuration.py:390-424`）；这与 `database-guidelines.md:402-408`、`contracts/database.md:77` 一致。
- Platform Profile create 的预检查返回 `PLATFORM_SLUG_EXISTS`，但其竞态捕获在 rollback 后查询“slug 是否已经存在”再决定错误，而不是检查 constraint name（`backend/app/services/content_planning.py:304-346`，关键为 `:319-320,337-344`）。该查询可能把另一种完整性故障误判成 slug 冲突；应在实现任务中按真实 migration constraint name 建立精确 mapping，并未知上抛。
- Platform Prompt create/update 同样使用 name 预检查，并在 flush 失败后 rollback 再查询同名行映射 `PLATFORM_PROMPT_NAME_EXISTS`（`platform_configuration.py:615-653`、`:656-713`）。这是竞态保护不足和潜在误归类，不能由查询结果代替驱动 constraint identity。Prompt revision 仍应先锁行并只把 stale revision 映射 `REVISION_CONFLICT`（`:665-685`）。
- AI Channel/Header/Model 属于 configuration service 的同一领域，但 `backend/app/services/ai_configuration.py:461-508,542-588,591-638,680-715` 的 create/update flush/commit 没有 IntegrityError 捕获。模型中 Header `(channel_id, normalized_name)`、Model `(channel_id, model_id)` 唯一性和 exactly-one/check/FK 约束见 `backend/app/models/ai_generation.py:71-129`。当前 AI spec 要求管理员权限、配置变更使 channel/model 测试失效、generation 使用不可变 snapshot（`ai-configuration-guidelines.md:3-21,23-75`），但尚未给这些约束定义可在本域落地的完整错误矩阵；未知错误不能直接改成现有 AI 业务 code。
- Configuration routers 的 Platform Type/Prompt/Profile/AI operationId 位于 `backend/app/routers/configuration.py:356-407,503-563,610-715`，大多声明 409/422；实现若增加已批准 code 但不改变 status，OpenAPI schema 结构未必需要改。

#### Content planning

- ContentTask 的唯一幂等键、状态/当前指针 checks、产品/事实/平台/issue 外键与 source issue 唯一关系见 `backend/app/models/content.py:28-88`。创建路径用 advisory transaction lock，并在已存在记录时按 payload 返回 `IDEMPOTENCY_CONFLICT`（`backend/app/services/content_planning.py:404-433`）。
- 实际 insert/flush owner `add_locked_content_task()` 在 `content_planning.py:380-401` 没有 IntegrityError 捕获。若 advisory lock 之外发生 unique/FK/check 竞态或直接数据库非法写入，会全局落到错误 handler；特别是 `uq_content_tasks_idempotency_key` 竞态应先由 contract 明确是否与已存在幂等请求同语义，不能沿用 `REVISION_CONFLICT`。
- Query Topic create 的 flush（`content_planning.py:197-223`）也没有本域映射；删除/引用阻断应沿 available-actions 的锁内业务错误（如 `QUERY_TOPIC_IN_USE`）处理，而不是等待 FK 异常。
- planning router 的 create operationId 位于 `backend/app/routers/planning.py:134-177,232-288`，目前常用命令 response metadata 含 409/422。

#### Content production

- GenerationJob 的幂等键、来源版本唯一、活动 HUMANIZE 部分唯一、job type/status/token/duration checks 及任务/版本外键见 `backend/app/models/ai_generation.py:132-229`。
- `_create_job()` 在 `content_production.py:370-387` 直接 flush。Generation create path 没有对应 IntegrityError owner；Humanization create 虽捕获 `IntegrityError`，却 rollback 后先查询同 idempotency key，若没有查到就无条件映射 `HUMANIZATION_ALREADY_ACTIVE`（`content_production.py:470-516`，关键 `:496-511`）。这会把未知 constraint/check/FK 错误误报为活动自然化作业，也没有读取 `diag.constraint_name`；应分别证明幂等唯一约束与 active-humanization 唯一约束的名称和 code，再保留未知上抛。
- 生产服务多处 content version/job flush 没有本域捕获（可见 `content_production.py:386,687,857,864`）；内容事实只读、AI 输出只生成 draft、失败不得固定成功或补造事实，相关业务设计见 `docs/GEO多平台内容运营系统方案设计.md:182-217,369-448,1075-1094` 与 `docs/content-humanization-prompt.md:1-32`。
- production router 的 Generation/Humanization/manual draft operationId 位于 `backend/app/routers/production.py:220-247,312-437,495`，已有错误 metadata 主要覆盖 409/422。

#### Publication

- Platform Account 的规范化唯一约束 owner 正确：`publication.py:208-235` 只检查 `uq_platform_accounts_profile_identifier_normalized`，rollback 后返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 409 和 `body.account_identifier`。create/update 复用该 helper（`publication.py:272-314`），与 `available-actions-contract.md:276-287`、`contracts/database.md:201` 一致。
- PublicationWork 的 idempotency/content-task 唯一、活动 platform+content hash 部分唯一、状态/revision checks 见 `backend/app/models/publication.py:61-146`。创建先 advisory lock、锁账号和批准内容并做业务唯一预检，但 `db.flush()` 在 `publication.py:476-555` 没有 IntegrityError owner；`_finish_work_command()` 也在 `:468-473` 直接 flush。竞态或遗漏约束会错误落到全局 handler。
- PublishedArticle/Verification/Issue/Attachment 的只读/追加历史、passed/open 部分唯一、repair source 唯一与外键见 `publication.py:149-290`。打开 issue 与创建 repair task 的 flush（`publication.py:838-945`）依赖预检而没有精确 constraint mapping；同类竞态不能被固定成 revision 冲突。
- Publication workbench 对直接非法历史 UPDATE/DELETE 的要求是 `55000`，成功核验、文章与来源任务必须同事务（`publication-workbench-guidelines.md:11-29,66-76,156-214`；`database-guidelines.md:343-350`）。这类数据库守卫错误与可预期的业务 409 是不同边界，不应共用一个“数据约束冲突” code。
- publication router 的 account/work/verification/article operationId 位于 `backend/app/routers/publication.py:207-231,279-559` 及后续公开成果命令；现有 route metadata 主要显式声明 401/403/404/409/422。

#### AI configuration

AI configuration service 没有 `IntegrityError` 捕获（`rg` 结果仅在 `platform_configuration.py` 找到平台配置 helper；AI 路径见 `ai_configuration.py:461-715`）。因此 Header/Model unique race、channel/model foreign key、check constraint 等会逃逸到当前全局 409 handler。该域的稳定边界是 ADMIN-only mutation、channel/header/model revision lock、敏感值不进入 snapshot、provider failure 显式失败（`ai-configuration-guidelines.md:3-75`；`docs/GEO系统前后端技术与部署方案.md:347-441`），并非“任何 DB 错误都是 revision conflict”。需要先确定每个可预期约束的业务 code/status/details，再落 service owner；未知错误保持显式内部失败。

### 路由、合同和 generated client 影响

- `backend/app/routers/identity.py`、`product_facts.py`、`configuration.py`、`planning.py`、`production.py`、`publication.py` 的相关命令已普遍显式声明 `error_responses(401,403,404,409,422)`；`contracts/openapi.yaml` 对这些 operation 的冻结 status 与 `ErrorEnvelope` 组件已存在。`backend/tests/unit/test_contract.py:310` 还断言当前 operation 不自动增加 500。
- `contracts/openapi.yaml` 的错误 `code` 是自由字符串（ErrorEnvelope/ErrorDetail 附近约 `:4300-4358`），未发现 `PRODUCT_ALREADY_EXISTS`、`PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`、`PLATFORM_TYPE_SLUG_EXISTS` 作为枚举注册。因此现有 409 code/details mapping 的修复通常只需 service/test，不需手工改 generated client；generated client 应继续从 OpenAPI 生成，不能另建错误类型表。
- 若最终决定未知 IntegrityError 以统一 500 ErrorEnvelope 返回，当前没有现成 generic 500 handler，且 route metadata、OpenAPI、runtime comparator、generated client/frontend error projection 都没有该公共合同。此决定必须先由 contract owner 批准：明确 code/message/details/泄漏边界、覆盖的 operation 集合和 status metadata，再同步 `contracts/openapi.yaml`、运行时声明与生成产物；不能把 `500` 偷塞进 `error_responses` helper 或用现有 `REVISION_CONFLICT` 过渡。
- 若未知错误继续通过既有框架内部失败边界，不改公共 4xx 合同，则应保留“不吞、不改写、不泄露约束文本”的明确边界测试；当前全局 handler 仍须处理，因为它实际会将未知错误改写为 409，不能把未注册 handler 当作已完成的内部边界。

### 事务、不变性和验证要求

`db.flush()` 和 `db.commit()` 都是完整性错误触发点。现有正确 helper（产品、Platform Type、账号）在 flush 捕获后 rollback，再抛稳定 `AppError`；审计/成功 commit 位于其后（例如 `product_facts.py:405-423`、`platform_configuration.py:403-424`、`publication.py:227-235`）。用户删除同样在删除 flush 成功后才追加审计（`identity.py:627-649`）。未捕获路径则由 `get_db()` 的异常回滚（`backend/app/db.py:31-40`）或当前 handler/框架生命周期承担，责任不够明确；本研究未发现生产代码使用 `Session.begin_nested()`，也不应为了映射而引入保存点，除非某命令明确需要保留外层事务。

每个新 mapping 都应以真实 PostgreSQL 集成测试证明：预检查命中和并发 constraint race 返回相同 code/status/details；只识别精确 constraint name；失败事务无成功审计、无 revision/历史部分写入；未知 unique/FK/check/not-null 不返回 409 revision 冲突、不泄露 SQL 文本。跨域高风险路径另测锁顺序和不可变历史：平台→账号删除/创建、ContentTask 幂等锁、PublicationWork 内容身份 advisory lock、用户删除 `23503`/`55000` 守卫、AI snapshot 与 provider failure。

### 文档/spec 后续影响判断

- `contracts/database.md` 已准确记录 Platform Type（`:77`）、Platform Account（`:201`）和 User delete（`:247-249`）现有正式约束/错误语义；在不改约束名、code 或业务语义的实现任务中不应修改。若新增 Platform Profile slug、Platform Prompt name、ContentTask/GenerationJob/PublicationWork/AI Header/Model 的正式 mapping，须在此合同的相应域章节补充精确 constraint name、status、details、未知错误行为。
- `.trellis/spec/backend/error-handling.md`、`database-guidelines.md`、`available-actions-contract.md` 已提供原则与部分具体映射。实现修复后，应只更新与新确认约束对应的稳定条目；不要写通用 registry 或第二套 type system。特别是 database-guidelines 当前明确 Platform Type/Account，但没有覆盖本研究识别的 Profile/Prompt/Content/Production/AI 完整性矩阵。
- `contracts/openapi.yaml`、runtime response metadata 与 generated client 在已有 409 且 ErrorEnvelope/code 自由字符串的情况下通常无需变更。只有新增公共状态（尤其 500）或 details shape/status 必填性变化时才需同步，并由 contract-first 门禁验证。
- `docs/architecture.md:5-15,21-37` 已规定 OpenAPI/DB 权威、service 持有事务/锁/错误映射、model 不自行改变 schema、历史不可变和 AI snapshot；`docs/GEO多平台内容运营系统方案设计.md:182-240,307-319,369-448,1045-1094` 已规定领域不变量、角色与显式失败；`docs/GEO系统前后端技术与部署方案.md:285-338,347-441,464-506` 已规定 API/事务/并发/迁移；`docs/content-humanization-prompt.md:1-32` 已规定 Prompt 与 draft-only。当前不需要为“修正错误映射”重复维护业务设计事实。仅当批准了新的公开错误 code/status、改变状态转换或删除/不可变语义时，才更新对应业务设计。

### 推荐的实施拆分与第一任务

推荐先做一个不改公共合同的窄任务：`platform-configuration-integrity-mappings`。原因是该 owner 同时包含一个已正确的精确样例（Platform Type）和三个明显需要修正/补齐的竞态路径（Profile slug、Prompt name、AI Header/Model 等），可以先确立真实 constraint-name、rollback、details 与未知上抛的可复用服务边界。第一任务的验收应限定为：

1. 为 Profile slug、Prompt name 及经确认的 AI unique 约束读取实际 migration constraint name；service 只按 `diag.constraint_name` 映射，未知 IntegrityError 原样上抛。
2. precheck 与真实 PostgreSQL race 返回同一已批准业务 code/status/details；flush 失败 rollback，审计和 revision 不产生成功副作用。
3. 补齐 configuration/planning operation 的 PostgreSQL integration、runtime ErrorEnvelope 和并发测试；现有 OpenAPI 409 metadata 保持一致。
4. 若发现缺少正式 code/details 合同，先在任务设计阶段报告给主 agent/contract owner，不在 service 内发明 registry、兼容字段或默认 409。

后续可按独立 owner 拆分：产品/账号/用户（保留正确样例并补 user username 决策）、ContentTask/GenerationJob 幂等与活动唯一、PublicationWork/Issue/Repair 唯一与不可变守卫，最后才处理全局 IntegrityError 边界和潜在 500 公共合同。全局边界不应先行大范围改写，因为当前 OpenAPI 明确没有 500 metadata，且缺少统一 500 ErrorEnvelope handler。

## External references (docs, versions)

- 本次未访问互联网或第三方在线文档；外部协议事实只记录项目已经选定的 PostgreSQL 16 / Alembic / SQLAlchemy 组合（`contracts/database.md:1-17`、`backend/app/db.py:7-28`）。
- 迁移版本证据来自本地 `backend/alembic/versions` 的 `0001`–`0043` 线性清单及其约束定义；旧迁移冻结和 Alembic-only 规则见 `contracts/database.md:1-17`。PostgreSQL SQLSTATE `23503` 的项目内使用与业务映射见 `backend/app/services/identity.py:627-633`，并非本研究新增外部解释。

## Related specs

- `.trellis/spec/backend/error-handling.md:61-116,118-175`
- `.trellis/spec/backend/database-guidelines.md:340-350,377,402-408,688`
- `.trellis/spec/backend/available-actions-contract.md:34-67,253-313,315-376`
- `.trellis/spec/backend/publication-workbench-guidelines.md:11-29,66-76,156-214,216-374`
- `.trellis/spec/backend/ai-configuration-guidelines.md:3-75,77-116,166-170`
- `.trellis/spec/backend/content-version-detail-contract.md:1-77`

## Caveats / Not Found

- 本文件是稳定 domain/spec 证据和拆分建议，不替代主任务需要的逐约束完整矩阵；尤其尚未为每个未捕获 unique/check/FK 约束批准业务 code。不能据此把所有未知错误统一变成一个新的 409 或 500。
- `PlatformProfile`、`PlatformPrompt`、ContentTask、GenerationJob、PublicationWork/Issue/Repair、AI Header/Model 的实际 canonical constraint name 需要在实现前再对当前 migration/database schema 做精确核验；ORM 未命名约束会受命名 convention/历史迁移影响，不应按模型字段猜名字。
- OpenAPI 当前 code 字段不是枚举，generated client 未提供错误码 registry；不要直接编辑 generated client。若公共 status/details 发生变化，须由 OpenAPI authority 驱动重新生成并通过 runtime/generated contract gate。
- 当前 `IntegrityError` 全局 handler 没有区分 stale revision、已知唯一冲突、FK/check、数据库守卫或编程错误，也未自行 rollback；这是本任务需要由主 agent/contract owner 决定的边界，不是本研究私自修复的代码。
- 未发现 `Session.begin_nested()` 的生产调用；是否采用 savepoint、是否保留外层事务状态需由具体 service command 的事务合同决定。 
