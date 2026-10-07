# PartSignal Database Contract

## Conventions

- PostgreSQL 16 is the only supported business database.
- Tables and columns use `snake_case`; identifiers are UUID; timestamps are timezone-aware UTC.
- Mutable aggregates carry an integer `revision`; clients must submit `expected_revision`.
- Alembic is the only schema migration entry point. API and Worker never run migrations on startup.
- Revisions `0001` through `0008` use `app.migration_schema_v1` as a frozen metadata snapshot; future runtime model changes must add a new revision and must not edit that snapshot.
- JSONB is limited to immutable generation snapshots, structured generation output, and audit details. Editable product facts use one Markdown body on `products`; platform rules and normalized fact subgraphs no longer exist after `0025`.
- Review records, publication work events, publication verifications, observations, and audit logs cannot be modified in place。`0027` 仅在物理删除停用用户时允许把匹配 `audit_logs.actor_id` 置空；`0029` 允许管理员按完整更正链删除人工 GEO 观测；`0037` 允许普通删除未成功发布的任务聚合，并允许管理员永久删除已归档任务聚合。发布与 GEO 历史在保留期间仍禁止原地改写，删除只能从显式业务命令进入。

## GEO EngineSurface / CollectionProfile 合同（GEO-203 / R1）

`0046_geo_surfaces_profiles` 在 `0045_geo_prompt_variants` 后仅增量创建两表及 AIModel 复合唯一键，无回填、seed、生产迁移或旧 GEO 数据改写。GEO-203 提供数据组件/ORM/Schema，GEO-204 提供 Registry/运行资格；GEO-205 接线管理 API/页面而不增加数据库结构。内部单租户共享配置，created_by 是服务端追溯身份，ADMIN 管理、ENGINEER 仅消费非敏感摘要，不是新增身份体系。

### geo_engine_surfaces

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_engine_surfaces |
| name / slug | varchar(160) / varchar(100) | 非空无首尾空白；slug小写连字符标识，uq_geo_engine_surfaces_slug 包含停用行 |
| surface_kind | varchar(24) | CONSUMER_UI / MODEL_API / SEARCH_API / MANUAL_SITE |
| provider_brand | varchar(40) | OPENAI / ANTHROPIC / GOOGLE / AZURE_OPENAI / ZHIPU / QWEN / CUSTOM；展示目录，不猜测adapter协议 |
| website_url | text NULL | 仅信息地址，不发请求；http/https，无userinfo、query、fragment，Schema使用HttpUrl额外验证 |
| compliance_status | varchar(24) | NOT_REVIEWED / APPROVED / REJECTED / SUSPENDED；默认NOT_REVIEWED |
| capabilities | JSONB | 六键全部必填、闭合且布尔：answer_text=true，citations/web_search_signal/model_version/usage/cost；不代表单次结果 |
| is_active / revision | boolean false / integer 0 | 配置合法不表示启用或运行资格 |
| first_referenced_at | timestamptz NULL | 内部首次运行引用锁存，>=created_at；设置后不可清除/改写，已引用不可DELETE，配置更新只影响未来快照 |
| created_by | UUID | fk_geo_engine_surfaces_creator → users.id RESTRICT |
| created_at / updated_at | timestamptz now() | 创建身份不可变，真实变更由命令服务更新 |

CHECK前缀`ck_geo_engine_surfaces_`：name、slug、kind、provider、website、compliance、capabilities、revision、reference_time。索引：`ix_geo_engine_surfaces_active_name(is_active,name,id)`、`ix_geo_engine_surfaces_creator(created_by)`。

### geo_collection_profiles

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_collection_profiles |
| engine_surface_id | UUID | fk_geo_collection_profiles_surface → geo_engine_surfaces.id RESTRICT；归属创建后不可变 |
| name | varchar(160) | 非空无首尾空白；uq_geo_collection_profiles_surface_name(engine_surface_id,name)，包含停用行 |
| collection_mode / adapter_key | varchar(16) / varchar(100) | MANUAL/API/BROWSER；adapter为小写标识，MANUAL固定manual；模式创建后不可变 |
| ai_channel_id / ai_model_id | UUID NULL | MANUAL/BROWSER全空；API全空或全非空；MATCH FULL禁止半绑定 |
| language_code / region_code | varchar(16) / varchar(16) | 与PromptVariant相同显式格式；小写语言/两位大写地区，不推断真实注册状态 |
| login_state | varchar(24) | API=NOT_APPLICABLE；MANUAL/BROWSER=ANONYMOUS或AUTHENTICATED |
| web_search_policy | varchar(24) | UNKNOWN / REQUESTED / REQUIRED / NOT_APPLICABLE；配置意图，不是实际搜索事实 |
| settings_json | JSONB DEFAULT '{}' | 按模式闭合非敏感配置，见下表；未知键/嵌套JSON/类型/范围明确拒绝 |
| is_active / revision | boolean false / integer 0 | 无自动启用 |
| last_test_status / last_tested_at | varchar(16) UNTESTED / timestamptz NULL | UNTESTED⇔时间空；PASSED/FAILED必须有时间；测试实施属于后续任务 |
| created_by | UUID | fk_geo_collection_profiles_creator → users.id RESTRICT |
| created_at / updated_at | timestamptz now() | 创建追溯不变 |

`uq_ai_models_id_channel UNIQUE(id,channel_id)` 是同一AIModel权威归属的可引用键，原channel+model_id唯一键不变。`fk_geo_collection_profiles_model_channel (ai_model_id,ai_channel_id) → ai_models(id,channel_id) MATCH FULL ON UPDATE RESTRICT ON DELETE SET NULL` 验证真实模型归属；通过既有AIModel.channel_id FK验证渠道存在。既有channel→models CASCADE保持，删除渠道或模型成对清空两引用，Profile保留，不恢复secret/不猜替代模型。API空绑定可以表示显式adapter配置或解绑后的配置；必须由GEO-204 registry/资格判定可用，不能由数据合法性推断可执行。

| 模式 | settings允许键与默认语义 |
|---|---|
| MANUAL | require_screenshot:boolean，缺省true |
| API | temperature:number/null，0..2；max_output_tokens:integer/null，1..65536；缺省null（无覆盖） |
| BROWSER | require_screenshot:boolean，缺省true；answer_timeout_seconds:integer，10..600，缺省120 |

公共`settings`与持久化`settings_json`显式转换，Out不提供AI key、密文、Cookie、Header、浏览器会话/路径、任意request_parameters或自由JSON。全部叶子是闭合bool/number/null；不能把secret藏入允许值。API空绑定与MANUAL/BROWSER凭据禁止由Pydantic判别联合、OpenAPI oneOf及DB CHECK/MATCH FULL共同覆盖。能力函数`geo_surface_capabilities_valid`和settings函数`geo_profile_settings_valid`是0046冻结的IMMUTABLE合同，不导入运行时Schema。

CHECK前缀`ck_geo_collection_profiles_`：name、mode、adapter、model_mode、language、region、login、search、settings、test、revision。索引：`ix_geo_collection_profiles_surface_active(engine_surface_id,is_active)`、`ix_geo_collection_profiles_model(ai_model_id,ai_channel_id)`、`ix_geo_collection_profiles_creator(created_by)`。

### 版本、生命周期及错误

两资源独立revision owner；创建0，实际配置/测试/历史锁存变化恰好+1，no-op保持revision/updated_at；数据库守卫保护id、creator、created_at与Profile归属/模式，更新时间不倒退。AIModel FK的SET NULL是明确的引用解绑副作用，不自动递增配置revision或变更测试事实；后续运行资格必须重读当前绑定，不以历史PASSED授予执行资格，管理接线负责资格失效投影。Surface的历史锁存仅防止删除，不冻结当前配置，未来真实运行需在持锁同事务设置锁存并保存不可变快照。Profile真实历史RESTRICT FK由未来Run消费方接入，本任务不伪造Run引用。

GEO-205 写命令锁序为User→AIChannel→AIModel→Surface→Profile；服务负责事务、expected_revision CAS 和最小成功审计。测试结果的写入与过期检查由 GEO-403 接入；本阶段无队列或外部调用。User.created_by两表引用接入现有批量删除预检/投影，RESTRICT提供最终防线。

唯一冲突仅`23505 + uq_geo_engine_surfaces_slug / uq_geo_collection_profiles_surface_name`；模型归属由`23503 + fk_geo_collection_profiles_model_channel`保证。GEO-205 在业务 flush 边界映射已登记的唯一键与引用约束；未知异常保持失败，不能按文本或宽泛SQLSTATE猜测。非法结构仍受本节具名`23514`保护。downgrade以55000拒绝删表，恢复用前滚修复或迁移前备份。

### GEO-205 管理命令与安全读模型

两资源各有列表、创建、详情、更新、启用、停用、删除，共14个操作。全部认证，写入 ADMIN + CSRF；Service 锁后重读当前账号资格。ENGINEER 的读模型只有 summary，configuration=null，available_actions=[]，deletion=null；不会取得 adapter、settings、channel/model 引用、网站或创建者配置。管理员 configuration 仍是闭合非敏感 Out，永不读取 AI Key、密文、Header、Cookie、浏览器会话或资料路径。数据组件本身不直接作为角色无差别的HTTP响应。

读请求在认证前建立 REPEATABLE READ 并禁 autoflush，列表使用固定批量查询与稳定排序、total 和 10/20/50 分页；动作/删除/启用阻断由服务端投影，不是授权凭证。当前 Surface 删除检查实际 Profile 引用和 first_referenced_at；当前 Profile 没有 Run/Plan 引用表，不伪造历史数量。未来真实引用消费方必须接入 RESTRICT FK、锁和删除查询，不能靠当前零引用路径授予历史删除许可。

写事务从 User FOR NO KEY UPDATE 开始，舍弃认证待写 last_seen_at 活动提示以避开 Session→User 的改密锁环，不修改过期/撤销规则。依次锁定当前与目标 Channel（UUID排序）、Model（UUID排序）、Surface、Profile；初读只决定锁集合，锁后重新比对绑定/revision。CREATE默认停用与 UNTESTED；Profile配置实际变更清除旧测试事实并停用；模式和Surface归属不可变。实际变化revision恰好+1、更新时间单调不减；同值更新/启停不改revision、时间或成功审计。业务与最小白名单成功审计同事务提交，未知错误整体回滚；没有命令自动重放或 Idempotency-Key。

启用 Profile 使用假设active=true的当前快照复用 GEO-204 evaluate_profile。MANUAL受监测总开关与Surface启用要求，API/BROWSER另有子开关、合规、adapter批准、环境、测试及当前模型资格；BROWSER未批准不可启用。Surface是中立目录配置，启用它不会启动任何采集。修改合规状态立即影响当前资格，资格不持久化。GEO-205没有test接口或测试结果生成；连接测试和模型生命周期失效规则由GEO-403提供。

GEO-205沿用0046，无Alembic revision、数据回填、旧观测改写或生产数据库操作。精确HTTP错误映射与对应条件见根OpenAPI及本任务实施记录；业务flush与audit flush边界区分，未知SQLSTATE/约束不能转换成成功或猜测业务冲突。

## GEO PromptVariant 合同（GEO-201 / R1）

`0045_geo_prompt_variants` 在 0044 后仅 expand 一张表。复用 `query_topics`，不迁移或替换其旧 `variants` 数组，不回填历史观测，也不创建 Batch/Run。数据库要求 UTF8。

| 字段 | 类型 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | pk_geo_prompt_variants |
| query_topic_id | UUID NOT NULL | fk_geo_prompt_variants_topic → query_topics.id RESTRICT |
| prompt_text | text NOT NULL | NFKC + Unicode 空白折叠，1..8000 字符，保留大小写、标点含义、连字符与型号后缀；拒绝 NUL |
| normalized_hash | varchar(64) GENERATED ALWAYS STORED NOT NULL | geo_prompt_text_hash(prompt_text)，UTF8 SHA-256 hex；客户端不可写 |
| mention_mode | varchar(16) NOT NULL | BRANDED / UNBRANDED |
| language_code | varchar(16) NOT NULL | 2..16 字符，小写语言标签，^[a-z]{2,8}(-[a-z0-9]{1,8})*$ |
| region_code | varchar(16) NOT NULL | 两位大写 ASCII 代码；只验证格式，不推断注册真实性 |
| priority | varchar(16) NOT NULL | CORE / STANDARD / EXPLORATORY |
| is_active | boolean NOT NULL DEFAULT true | 停用仍占唯一键 |
| revision | integer NOT NULL DEFAULT 0 | 有效变更恰好 +1，no-op 不递增 |
| first_referenced_at | timestamptz NULL | 内部不可逆首次运行引用锁存，>= created_at |
| created_by | UUID NOT NULL | fk_geo_prompt_variants_creator → users.id RESTRICT，来自服务端操作者 |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | 创建追溯不可变；有效变更由 Application Service 写 updated_at，单调不减 |

`uq_geo_prompt_variants_identity UNIQUE(query_topic_id,normalized_hash,mention_mode,language_code,region_code)` 包括停用行，不包括 priority。`ix_geo_prompt_variants_topic_active(query_topic_id,is_active)` 与 `ix_geo_prompt_variants_created_by(created_by)` 支持读取与删除预检。CHECK 名称为 `ck_geo_prompt_variants_` + `prompt` / `mention_mode` / `language` / `region` / `priority` / `revision_nonnegative` / `reference_time`。

`geo_normalize_prompt_text` 冻结 NFKC 与 Python Unicode whitespace 的 29 个码点集合。保存 canonical prompt_text，以 generated hash 防伪；不使用大小写折叠或型号去后缀。NFKC 会规范全角标点。`geo_prompt_text_hash` 固定 UTF8 转换，避免 PostgreSQL convert_to 的 STABLE 属性阻止生成列；函数不会受会话编码参数影响。

`geo_prompt_variant_guard` 保护 INSERT/UPDATE/DELETE：创建必须 revision=0、首次引用空；id/topic/creator/created_at 不可改；首次引用只能在活动且语义未变的行上设置；标记不能清除或改写。已引用后五项语义配置冻结，只允许 active→disabled（重复停用为 no-op），不允许删除或重新启用。新问题必须新建变体。历史门禁采用本任务明确的更严格要求；不是修改历史后仅影响未来。

未来真实运行创建者必须与其真实引用 FK（RESTRICT）一起接入：Application Service 按 User→QueryTopic→PromptVariant（User 使用 FOR NO KEY UPDATE，与审计 FK KEY SHARE 兼容） 顺序锁定，锁后校验角色、归属、活动和 expected_revision，设置 first_referenced_at、revision+1、updated_at 并冻结输入，与运行记录及成功审计同事务提交。后续消费者不得只写 FK 而遗漏锁存；运行引用失败时锁存同事务回滚。首次引用标记自身不是 Run，GEO-201 的测试验证锁存边界，不宣称真实 Run 已实现。

QueryTopic 删除预检/投影包括全部变体（含停用），`GEO_PROMPT_VARIANT` 为公共 deletion blocker；旧引用摘要三个计数字段保持原合同。User 删除计入 created_by 并沿用 USER_BUSINESS_HISTORY。GEO-201 没有新增前端入口；GEO-202 工作区为 /geo/questions，保留旧 /geo/topics。

| 稳定数据库失败 | 后续应用映射义务（GEO-202 接线） |
|---|---|
| 23505 + uq_geo_prompt_variants_identity | 409 GEO_PROMPT_VARIANT_EXISTS |
| 历史删除预检；23514 + ck_geo_prompt_variants_history | DELETE: 409 GEO_PROMPT_VARIANT_IN_USE；编辑/启用: 409 GEO_PROMPT_VARIANT_IMMUTABLE |
| 锁后 expected_revision 不符 | 409 REVISION_CONFLICT，不自动重放 |
| 23503 + fk_geo_prompt_variants_topic / creator | QueryTopic / User 删除冲突，现有 IN_USE 语义 |
| 23514 + initial / identity / revision_step / updated_at | 写入者合同错误，不能吞错或伪装成功 |

未知 SQLSTATE / constraint 保持显式失败。GEO-201 只冻结组件与持久化边界；GEO-202 接线七个变体端点及 geo_prompt_variant.created/updated/enabled/disabled/deleted 成功审计。唯一键仲裁并发创建；行锁与触发器仲裁引用/编辑交错。no-op 不改 updated_at，不凭空递增 revision。降级主动 SQLSTATE 55000 失败，事务 DDL 保留全部数据与 revision；恢复使用前向修复，不允许 DROP 历史表。

### GEO-202 Application Service 接线

沿用公司内部单租户：ADMIN/ENGINEER 均管理问题变体，created_by 仅作追溯，不是用户私有隔离键。主数据配置与既有 Catalog 一致可读写，自动能力仍默认关闭且本任务没有运行端点。创建请求 body.query_topic_id 必须等于路径 ID；不能提交 hash/creator/history/revision/action 等服务端字段。

写入禁 autoflush 后按 User→QueryTopic→PromptVariant 锁序，锁后复核活动账号、首次改密和角色，topic 存在性及 expected_revision。topic_id 不可改，初读只选择锁集合，锁后重新加载权威行。只对实际字段变化递增 revision 和单调 updated_at；语义规范化 no-op 保持全部业务字段及审计不变。历史后 PATCH/enable 拒绝，disable 重复为 no-op。CRUD 没有 Idempotency-Key，唯一键防重复创建，stale 命令不能重放。

同事务 flush 业务变化、最小白名单审计并 commit；审计只含 revision/is_active，无问题正文。只在业务 flush 边界映射上述精确唯一/历史约束；审计 flush/未知完整性错误原样失败并回滚。列表/详情用 REPEATABLE READ 与禁 autoflush，join 当前 QueryTopic 摘要，count/rows 固定查询，无客户端拼接。搜索为规范文本字面子串，LIKE 通配符转义；筛选基于当前主题意图及显式变体维度，稳定排序 tie-break UUID。历史标记只提供 HISTORY_REFERENCE 阻断，不宣称 Run/Plan 计数。run_entry.available=false/NOT_IMPLEMENTED 是未开放能力，无执行成功含义。

本任务没有 Alembic revision、列/索引/约束或数据回填，head 仍为 0045_geo_prompt_variants。真实 Run 后续需按原锁存/FK/快照同事务义务接入。

GEO-202 命令入口舍弃认证依赖待写的 `SessionRecord.last_seen_at` 活动提示，避免 User→Session 与改密的 Session→User 形成锁环；不修改 expires_at/revoked_at，也不放宽认证或 CSRF。会话有效期按 expires_at、撤销按 revoked_at 裁决，last_seen_at 不参与安全决定。User 的 FOR NO KEY UPDATE 仍阻止资格字段更新与删除；主题/变体继续 FOR UPDATE。真实同账号主题编辑/删除与同 Cookie 改密交错均由 PostgreSQL 回归验证。

## GEO Catalog 合同（GEO-101 / R1；GEO-102 ORM/Alembic；GEO-103 Schema/策略）

本节冻结 GeoSubject/Alias/Domain 合同。GEO-102 已实现三表 ORM、模型注册及 `0044_geo_catalog`，Catalog revision 从 `0043_geo_platform_identity` 前滚（当前 head 为 0045 PromptVariant）；这不表示生产数据库已迁移。GEO-103 已实现 Schema、规范化、真实父子/别名歧义与无 I/O 的 stage/actions/deletion/当前 Product 投影；GEO-104 CRUD Application Service/Router 已接线并完成验收。公共 Schema 和标准操作分别见 `contracts/openapi.yaml` 的 `components.schemas.Geo*Subject*` 与 `paths./api/v1/geo/subjects`。既有文章关系 GEO、Product/FactVersion 与历史迁移均保持独立。

### 身份、归属与规范化

这是沿用现有身份系统的公司内部单租户 Catalog；ADMIN 管理，ADMIN/ENGINEER 读取，`created_by` 是操作者追溯字段而非资源隔离键。不得接受客户端 created_by、revision、normalized 字段、actions/blockers 或敏感凭据。Subject 类型和 Product 绑定创建后不可改变。

- `OWN_PRODUCT` 必须引用现有 `products.id`，其他类型 product_id 必须为空。其 canonical_name、normalized_name、display_name 在 GEO 表中必须全部为 NULL；公共 canonical_name 从当前 Product.part_number 投影，display_name 为 Product.brand、单个空格、Product.part_number，product 摘要只读当前 Product identity/revision。不得复制 brand/category/参数/事实 Markdown/FactVersion；description 只作监测用途说明，不是产品事实编辑入口。产品更新不会递增 Subject revision，也不回填 GEO 名称；一致读返回 Product 自身 revision。
- 非 OWN_PRODUCT 保存监测身份 canonical_name/display_name，不保存公司产品事实。原始名称/别名先 Unicode NFKC、去除首尾 Unicode 空白、把连续 Unicode 空白合并为一个 ASCII 空格；保存值 1..240 字符；匹配键再 casefold，长度仍须 1..240。保留连字符、型号后缀及标点，不能折叠不同型号。display_name 使用相同空白/长度规则，不用于 identity 唯一性。description 最大 4000 字符，默认空。
- 品牌（OWN_BRAND、COMPETITOR_BRAND）和 REFERENCE_PART 无父级；OWN_PRODUCT 可无父级或指向 OWN_BRAND；COMPETITOR_PRODUCT 可无父级或指向 COMPETITOR_BRAND。父级不能为自身。parent 是否启用不改变类型合法性；停用品牌不自动修改子 Subject，计划资格由后续任务裁决。
- 每个 Product 最多一个**活动** OWN_PRODUCT；停用身份保留，可存在多个停用历史身份。重新启用必须重新竞争同一 partial unique。非自有名称不设全局/父级唯一，避免错误合并不同实体。
- Alias 的 alias_kind 为 NAME/PART_NUMBER/ABBREVIATION/LEGACY；language_code 可空，采用 2..8 位语言子标签及连字符分隔的 1..8 位字母数字子标签，总长 2..16，保存小写。此标签仅用于匹配语境，不猜测语言。唯一键为 `(subject_id, normalized_alias)`，包括停用条目。跨 Subject 相同别名允许登记为歧义候选；未来匹配必须返回歧义并要求人工复核，不能无条件任选一个对象。
- Domain 输入可为 Unicode，但服务必须执行 IDNA2008 + UTS #46（non-transitional、STD3）转换为 lowercase ASCII，校验 A-label 可回解并满足 DNS 标签 1..63、完整主机名 3..253、至少两个标签。拒绝 IP literal、空白、协议、路径、query、fragment、端口、userinfo、通配符、空标签、尾点和非法 IDNA。不执行 DNS、HTTP、域名所有权验证或子域猜测；这是精确 hostname 匹配。relation_type 为 OWNED/OFFICIAL/DISTRIBUTOR/OTHER，是管理员配置关系，不证明网络所有权。当前 API 只有创建/删除 Domain，is_active 恒 true；修改需按 revision 删除后重建。相同 hostname 可属于多个 Subject，未来归属必须显式保留歧义。

### `geo_subjects`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK `pk_geo_subjects` |
| subject_type | varchar(32) NOT NULL | 五种 GeoSubjectType |
| product_id | UUID NULL | FK `fk_geo_subjects_product_id_products` → products.id RESTRICT |
| parent_subject_id | UUID NULL | 与 parent_subject_type 成对为空或非空 |
| parent_subject_type | varchar(32) NULL | 内部 FK 判别列，不接受客户端输入、不输出；从已锁父行取得 |
| canonical_name / normalized_name / display_name | varchar(240) NULL | OWN_PRODUCT 全空，其余全非空且符合规范化边界 |
| description | text NOT NULL DEFAULT '' | 最大 4000 字符，监测用途说明 |
| is_active | boolean NOT NULL DEFAULT true | 当前启停权威 |
| revision | integer NOT NULL DEFAULT 0 | >=0；整个 Subject aggregate 的唯一写版本 |
| created_by | UUID NOT NULL | FK `fk_geo_subjects_created_by_users` → users.id RESTRICT |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | UTC；服务在真实 aggregate 写入时更新 updated_at |

数据库最终约束：

| 稳定名 | 定义 |
|---|---|
| ck_geo_subjects_type | subject_type IN 五种枚举 |
| ck_geo_subjects_product_identity | OWN_PRODUCT: product_id 非空且三个名称列全空；其余: product_id 空且三个名称列全非空 |
| ck_geo_subjects_names | 所有非空名称 trim 后非空且长度 1..240；description 长度 <=4000；Unicode NFKC/casefold 由 Schema/Service 建立，不谎称普通 SQL trim 完全验证 Unicode |
| ck_geo_subjects_revision_nonnegative | revision >=0 |
| ck_geo_subjects_parent_type | 两父列全空，或 OWN_PRODUCT→OWN_BRAND / COMPETITOR_PRODUCT→COMPETITOR_BRAND；品牌与参考型号父列必须全空 |
| ck_geo_subjects_parent_not_self | parent_subject_id IS NULL OR parent_subject_id <> id |
| uq_geo_subjects_id_type | UNIQUE(id, subject_type)，供复合 FK 引用 |
| fk_geo_subjects_parent_identity | (parent_subject_id, parent_subject_type) → geo_subjects(id, subject_type)，MATCH FULL，ON DELETE RESTRICT，ON UPDATE RESTRICT；同时保证存在与真实父级类型 |
| uq_geo_subjects_active_own_product | UNIQUE(product_id) WHERE subject_type='OWN_PRODUCT' AND is_active；这是独立 partial unique index |

父子类型用 CHECK + 复合 FK 提供真实 SQL 最终防线；不能只做 Service 预检。两级合法类型关系天然排除多层循环。`0044_geo_catalog` 的 `geo_subjects_identity_guard` 禁止更新 subject_type/product_id/created_by/created_at（SQLSTATE 55000，后续服务先以字段 validation 拒绝）；不为该未知数据库守卫错误增加宽泛业务映射。

索引：`ix_geo_subjects_type_active_name_id(subject_type,is_active,normalized_name,id)`、`ix_geo_subjects_product_id(product_id) WHERE product_id IS NOT NULL`、`ix_geo_subjects_parent_id(parent_subject_id)`、`ix_geo_subjects_created_by(created_by)`、`ix_geo_subjects_updated_id(updated_at,id)`。OWN_PRODUCT 名称筛选/排序 JOIN 当前 Product，不持久化派生搜索字段。NAME_ASC 按规范名称、id；UPDATED_DESC 按 updated_at DESC、id DESC，列表 total 与 items 应来自同一读取快照。

### `geo_subject_aliases`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK pk_geo_subject_aliases |
| subject_id | UUID NOT NULL | fk_geo_subject_aliases_subject_id_subjects → geo_subjects.id，ON DELETE CASCADE，仅显式聚合删除 |
| alias / normalized_alias | varchar(240) NOT NULL | 规范化显示值 / casefold 匹配值 |
| alias_kind | varchar(24) NOT NULL | 四种 GeoSubjectAliasKind |
| language_code | varchar(16) NULL | 受控标签或 NULL |
| is_active | boolean NOT NULL DEFAULT true | 可通过 Alias PATCH 改变 |
| created_at | timestamptz NOT NULL DEFAULT now() | UTC |

`uq_geo_subject_aliases_subject_normalized UNIQUE(subject_id,normalized_alias)` 包括停用行；`ck_geo_subject_aliases_kind` 检查枚举，`ck_geo_subject_aliases_text` 检查 trim 非空及长度，`ck_geo_subject_aliases_language` 检查小写受控标签或 NULL。`ix_geo_subject_aliases_normalized_active(normalized_alias,is_active,subject_id)` 支持跨对象歧义读取。subject_id/id/created_at 不可由 PATCH 改变。

### `geo_subject_domains`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK pk_geo_subject_domains |
| subject_id | UUID NOT NULL | fk_geo_subject_domains_subject_id_subjects → geo_subjects.id，ON DELETE CASCADE，仅显式聚合删除 |
| hostname | varchar(253) NOT NULL | 规范 IDNA ASCII hostname |
| relation_type | varchar(24) NOT NULL | 四种 GeoSubjectDomainRelationType |
| is_active | boolean NOT NULL DEFAULT true | 本轮 API 恒 true，无独立更新/启停命令 |
| created_at | timestamptz NOT NULL DEFAULT now() | UTC |

`uq_geo_subject_domains_subject_hostname UNIQUE(subject_id,hostname)`；`ck_geo_subject_domains_relation` 检查枚举，`ck_geo_subject_domains_hostname` 检查 lowercase ASCII DNS 标签结构、长度及非 IP，完整 IDNA round-trip 校验仍在 Schema/Service；`ck_geo_subject_domains_active` 检查 is_active=true。`ix_geo_subject_domains_hostname(hostname,subject_id)` 支持歧义读取。无 Domain PATCH；不能由客户端写规范化输出或创建信息。

### revision、锁、动作与删除

- Subject/Alias/Domain 是一个可变聚合。Subject 创建 revision=0；Subject PATCH/enable/disable、Alias create/update/delete、Domain create/delete 每次成功改变聚合后父 revision 恰好 +1、updated_at 更新，业务写入与最小成功审计同事务提交。子行无独立 revision；子命令的 expected_revision 是父版本。已处于目标 enable/disable 状态且 revision 当前时返回同一投影，不增版本、不重复成功审计；stale revision 始终先返回 REVISION_CONFLICT。PATCH 的有效字段值全部未变时同样无版本递增。
- GEO-104 Application Service 的统一锁序：涉及 OWN_PRODUCT 先锁 Product；品牌父级（旧、新，去重 UUID 升序）→目标 Subject（品牌目标也属于品牌锁阶段）→目标 Alias/Domain。读到的 parent/type 只用来确定锁集合，取得目标锁后复核 revision 和身份；发生变化拒绝，不自动重放。创建父子关系、品牌删除、子命令及将来新增业务引用必须遵守同一锁序。Router 不拥有事务/行锁/ORM 写入。
- ADMIN 的 stage 为 ACTIVE/DISABLED，primary_task 分别为 MANAGE_SUBJECT/ENABLE_SUBJECT；UPDATE、CREATE_ALIAS、CREATE_DOMAIN 始终可尝试，按启停状态提供 DISABLE 或 ENABLE。ENGINEER 读取同一业务 stage，primary_task=MANAGE_SUBJECT（只读入口），所有资源及子资源 available_actions=[]、deletion=null。不从 primary_task 名称授予编辑权限。ADMIN 删除无直接引用时 deletion.blockers=[] 且有 DELETE；存在引用时去掉 DELETE 并返回非空正整数 blocker。无需为删除先停用未引用 Subject。子资源 ADMIN 动作为 Alias UPDATE/DELETE、Domain DELETE，不因历史运行而冻结当前字典。
- references 是当前直接引用的批量一致读取计数，不是持久化派生状态：CHILD_SUBJECT 对应 child_subject_count（含停用子级）；MONITORING_PLAN 对应 monitoring_plan_count（含暂停/归档计划）；OBSERVATION_RUN 对应 observation_run_count（所有引用过的运行，含失败/取消及历史）；ANALYSIS 对应 analysis_count（去重 analysis revision，不累计其中多条 mention/claim）；OPPORTUNITY 对应 opportunity_count（包括关闭机会）。每类独立去重，不跨类别相加作为总样本。未实施的引用域不存在对应行时计数为 0，不代表已实现该域查询能力。
- 所有新增对 Subject 的业务身份引用必须通过真实 RESTRICT FK/关系表及同一 Subject 行锁接入 deletion owner；不能仅在 JSON snapshot 中保存 UUID 后宣称没有历史引用。后续任务负责新增其实际引用查询、FK 和反例测试，本任务不定义这些域的表。已被历史引用的 Subject 永不物理删除，只停用；相关字典和父级变化只影响未来配置/快照，不更新既有 Run/Analysis/Review。
- Subject 删除只在持锁同事务重新统计上述直接引用后执行；仅 Alias/Domain 可随 Subject 聚合清理，绝不级联 Product、子 Subject、计划、运行、分析、机会或审计历史。Alias/Domain 单独删除只改变当前字典，历史消费者必须保存完整当时字典快照，不建立会阻止当前字典维护的历史子行 FK。
- GEO-104 已将 GEO Subject 直接引用接入 Product 删除服务/投影（包含停用身份），公共 DeletionBlockerType 增加 GEO_SUBJECT，FK RESTRICT 是最终防线。用户删除包含 Subject.created_by 业务引用。审计目标采用稳定 UUID 与受控摘要，删除后保留最小 tombstone，不因 target_id 标量记录而永久冻结无引用 Subject。

### HTTP 与精确错误映射

沿用 ErrorEnvelope、session、CSRF 和 X-Request-ID。404 NOT_FOUND 用于 Product/Subject/父级/子资源不存在；子 ID 不属于 URL Subject 同样 404，不允许跨父级写入。422 VALIDATION_ERROR 覆盖非法 enum、空白/长度/IDNA、只读字段、试图改类型/Product、空 PATCH。409 REVISION_CONFLICT 在锁内先于其他可变业务冲突。无 Idempotency-Key 或外部调用；重复创建不会假成功或自动重放。

| SQLSTATE + 精确 constraint/index 名或业务条件 | HTTP / code | details |
|---|---|---|
| 23505 + uq_geo_subjects_active_own_product；活动 Product 预检或 enable 冲突 | 409 GEO_SUBJECT_PRODUCT_EXISTS | errors 定位 body.product_id；enable 定位当前绑定并给出 subject_id/product_id |
| 23505 + uq_geo_subject_aliases_subject_normalized | 409 GEO_SUBJECT_ALIAS_EXISTS | errors 定位 body.alias |
| 23505 + uq_geo_subject_domains_subject_hostname | 409 GEO_SUBJECT_DOMAIN_EXISTS | errors 定位 body.hostname |
| 已存在父级但类型错误/自引用；23514 + ck_geo_subjects_parent_type / ck_geo_subjects_parent_not_self | 409 GEO_SUBJECT_PARENT_INVALID | errors 定位 body.parent_subject_id |
| Subject 删除预检命中 | 409 GEO_SUBJECT_IN_USE | references=[{type,count}]，与 deletion.blockers 同一 owner |
| Subject DELETE 的 23503 + fk_geo_subjects_parent_identity，或后续已登记直接业务引用 FK | 409 GEO_SUBJECT_IN_USE | {}；rollback 后不重查、不伪造 blocker 数量 |

唯一冲突的 errors 使用 loc/msg/type 结构，type 分别为 geo_subject_product_exists、geo_subject_alias_exists、geo_subject_domain_exists、geo_subject_parent_invalid。未知 SQLSTATE、约束、trigger、commit 或审计失败保持未知错误；事务回滚，无部分子资源写入、revision 或成功审计。不得解析异常文本、全局吞 IntegrityError 或猜测默认计数。新的未来 FK 必须先登记到本合同及具体命令映射再使用，不能把任意 23503 都映射成 GEO_SUBJECT_IN_USE。

### 实施与恢复边界

GEO-101 只冻结合同。GEO-102 新增 `0044_geo_catalog`，仅添加三张表、约束、索引及身份守卫，不修改 0001～0043 或 migration_schema_v1，不回填或改写历史 Product/GEO 数据；迁移冻结自身 DDL，不导入运行时 ORM。隔离 PostgreSQL 16 的空库及含旧记录的 0043 前滚、metadata、直接 SQL 和唯一索引并发验证见 `.trellis/tasks/10-01-geo-102-catalog-orm/implement.md`。downgrade 以 SQLSTATE 55000 明确拒绝删除三表，保留 revision 和数据；恢复使用前滚修复或迁移前 PostgreSQL 备份。GEO-103 的请求/响应声明、Unicode/IDNA 规范化及领域/投影策略按本合同实现，没有新增 revision 或历史回填；实施与机器形状/实例验证见 `.trellis/tasks/10-01-geo-103-catalog-policy/implement.md`。GEO-104 已接线 12 个标准 OpenAPI 操作及 Catalog Application Service，拥有聚合锁、revision、精确映射和同事务成功审计。列表/详情由服务在认证读取前建立 REPEATABLE READ 并关闭 autoflush（认证 last_seen_at 不能在纯读快照中自动写入），请求内批量读取当前 Product、父级、字典及直接引用；未来尚不存在的四个引用域显式为零，不能据此声称已实现查询。审计登记十个 Catalog 成功动作，target_type=GeoSubject、target_id=稳定 Subject UUID；facts 仅 revision/is_active，不复制名称、描述、字典或产品事实。搜索在同一快照批量规范当前 Product/显示名称，与 q 统一 NFKC/Unicode 空白/casefold，不写身份副本；匹配 UUID 以单一 ARRAY 参数进入 SQL count/page。删除保留审计 tombstone。实施证据见 `.trellis/tasks/10-02-geo-104-catalog-api/implement.md`；无新 Alembic revision、历史回填或生产迁移。Catalog 页面由 GEO-105 实施。

## Product Detail Read Projection

`GET /api/v1/products/{product_id}/detail` 不持久化第二份业务状态。服务在同一 PostgreSQL `REPEATABLE READ` 请求事务中，从 `products`、`fact_versions`、`content_tasks`、`publication_works`/`published_articles`、当前 GEO correction tails 及各领域追加记录批量形成 compact projection；查询次数不得随关联行数线性增加。GEO rate 沿用现有 GeoMetrics 分母，分母为零时返回 `NULL`。

Product Activity 的权威记录依次来自 `product.created/product.updated` 成功审计、`fact_review_records`、`content_tasks.created_at`、`content_review_records`、`publication_work_events` 与 `geo_observations.created_at`。服务统一按 `timestamp DESC, kind ASC, source id DESC` 排序并截取最近 10 项；不得使用 mutable `updated_at`、Audit target 递归或浏览器合并来补造时间线。`product.created` 与 `product.updated` 作为成功审计和对应业务写入同事务追加，不回填历史记录，也不需要数据库迁移。

## Migration Order

### 0001 Identity And Audit

`users`, `roles`, `user_roles`, `sessions`, `audit_logs`.

This historical revision created six fixed roles. Revision `0009` migrates them to the current two-account-type model and removes `roles` and `user_roles`.

当前认证 snapshot 不增加数据库字段：`sessions.id` 是服务端内部稳定 session identity，`GET /api/v1/auth/session` 以同一次 `SessionRecord` + joined `User` 读取返回 user projection、该 record 验证后的 CSRF Token，以及用部署 `SESSION_SECRET` 对 `partsignal-session-binding-v1:<session UUID>` 做 HMAC-SHA256 得到的公开不透明 `session_binding`。binding 只用于客户端区分 session snapshot，不能用于认证、CSRF、数据库查找或凭据重放；Session UUID、session token、token hash 与 CSRF hash 均不进入响应、日志或审计。

### 0002 Product Facts

`products`, `reference_parts`, `part_parameters`, `replacement_relations`, `evidences`, `parameter_evidence_links`, `replacement_evidence_links`, `fact_claims`, `claim_evidence_links`, `fact_versions`, `fact_review_records`.

这些规范化事实表和 `fact_versions.snapshot_json` 仅描述历史 revision；`0025` 已将当前事实模型收敛为产品 Markdown 工作区和不可变 Markdown 事实版本，并物理删除规范化事实子图。

### 0003 Content Planning

`query_topics`, `platform_profiles`, `platform_profile_versions`, `content_tasks`.

`platform_profile_versions` 仅描述历史 revision，已由 `0025` 物理删除。当前 `content_tasks` 直接绑定具体 `platform_profile_id` 和同产品的非空 `APPROVED fact_version_id`，不会随配置变化静默改绑。Revision `0032` 为普通任务创建增加可空且由 `uq_content_tasks_idempotency_key` 最终保证唯一的 `idempotency_key`：同键同四部分普通 identity（`product_id`、`fact_version_id`、`platform_profile_id` 和不存在 `content_task_geo_sources` 的 ordinary source kind）重放返回原任务，同键异载荷或 GEO 任务冲突，不同键仍允许相同业务输入；历史任务和发布修复任务保持空值。命名 advisory lock 负责正常请求串行化，数据库唯一约束仍是旁路 writer 的最终仲裁；普通创建 caller 只在 PostgreSQL `23505` 且 diagnostics 精确为该约束时 rollback 后按键重查并重验 winner，其他唯一性或完整性错误继续失败。

### 0004 Content Production

`generation_jobs`, `content_versions`.

`generation_jobs.idempotency_key` is unique. Redis carries only the job UUID. A unique `content_versions.source_job_id` prevents duplicate drafts. Worker execution rechecks the current task, product, and approved fact before and after generation; expired `RUNNING` leases are recovered from PostgreSQL by Celery Beat. AI content and every content version that has entered review are immutable. The current unreviewed `HUMAN DRAFT` is the sole payload-update window and is protected by task ownership, revision, review-history, and database-trigger checks.

### 0005 Content Review

`content_review_records` plus immutability and task-version constraints.

Approving a new version and superseding the previous approved version happen in one transaction. Creators may approve their own fact or content versions; all state, evidence, and quality gates still apply.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain an internal business label and operator identifier, never credentials. A concrete platform may own multiple accounts, while one article publication selects exactly one account. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with PostgreSQL transaction advisory locks. After `PUBLISHED`, URL and content binding cannot change.

Current-state counts come from `publication_records.status`. Period publication metrics and recent activity come from append-only `publication_status_events`, and their shared `as_of` comes from the PostgreSQL clock: a rolling window cohort is the distinct records whose `PUBLISHED` event falls inside `[window_start, as_of)`, verification count is the cohort subset with any later `VERIFIED` event by `as_of`, and exception count is the distinct records receiving `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` inside the same window. A later removal never removes the historical publication from its original cohort.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth. Revision `0029` later adds one guarded exception that permits administrators to delete an entire manual-observation correction chain.

`uq_geo_observations_supersedes_once` is the independent partial unique index on `geo_observations(supersedes_id) WHERE supersedes_id IS NOT NULL`; it has no `pg_constraint` UNIQUE row. `create_geo_observation` retains the Product → eligible Published Article → previous Observation lock order and successor precheck. Both that precheck and only the exact root INSERT diagnostics `sqlstate=23505` plus `diag.constraint_name=uq_geo_observations_supersedes_once` map to `409 GEO_OBSERVATION_HAS_SUCCESSOR`, message `该 GEO 观测已被纠正`, and `details={}`. The exact path performs the command-root rollback before raising and never queries, guesses, or replays a winner. Other integrity failures, relation work, and commit failures remain unknown and must not be classified from database error text.

Concurrency evidence distinguishes the production row-lock path, whose loser reaches the successor precheck after the winner commits, from a test-only lock/precheck bypass that proves real transaction-ID waiting at the partial unique index. Both paths leave exactly one successor; a losing command leaves no observation relation, file association, content/publication mutation, or success audit side effect.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus historical `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Publication attachments additionally require `category=OPERATION_SCREENSHOT` in both candidate creation and `mark-published`; other modules enforce their own category contracts at their service boundaries. `publication_attachments` is one append-only evidence relation used in both publication phases, with no mutable phase or replacement field. Revision `0025` later deletes `evidences` and its file foreign key; the current head therefore has three actual `file_records` references: platform Logo, publication attachment, and GEO observation attachment. Revision `0029` permits only the GEO attachment rows belonging to a declared full-chain manual-observation deletion to be removed.

文件传输由应用后端中转，不新增表、列或状态。接收字节后，服务锁定 `FileRecord` 并重新检查意图创建者、`PENDING` 与上传有效期；持锁执行对象写入，成功仍保持 `PENDING`。complete 的 HEAD 校验与 abort 使用同一行锁，清理器继续 `FOR UPDATE SKIP LOCKED`，防止对象写入与确认、中止或删除声明交错而复活已删除文件。

### 0009 Configuration Center And AI Generation

`users` gains `account_type` (`ADMIN | ENGINEER`) and `must_change_password`. Existing users with `SYSTEM_ADMIN` become `ADMIN`; all other existing users become `ENGINEER`. After the mapping, `roles` and `user_roles` are removed so `users.account_type` is the only permission source. Disabling a user or resetting a password revokes all active sessions. A transaction may not disable or demote the last active `ADMIN`. Revision `0027` later adds a restricted physical-deletion path for disabled, unreferenced users.

新账号默认启用，管理员提供的 `temporary_password` 只保存安全哈希，并固定写入 `must_change_password=true`；新建账号临时密码最少 12 位，重置临时密码和用户自助改密的正式新密码最少 8 位。列表摘要由 PostgreSQL 对全部用户实时聚合，不保存统计快照，也不从审计推测趋势；`admin_total` 统计全部实际 `ADMIN`，不因停用而排除。单个与批量启停共享同一行锁、revision、最后启用管理员保护、会话撤销和逐用户审计不变量；合法批量命令只把写入前的预期业务错误作为逐项失败，任何数据库、编程或审计异常都回滚整批。用户 CSV 只导出批准的非敏感业务列，完整生成后追加 `user.exported` 审计；停用或重新启用只改变当前用户状态，不删除、改绑或改写任何历史业务与审计外键。

`users.username` 在服务端经 `strip().lower()` 后形成账号身份，并由 PostgreSQL 唯一约束 `uq_users_username` 最终裁决。创建预检与该约束的精确 `sqlstate=23505` 路径都返回 `409 USER_USERNAME_EXISTS`、message `用户名已存在` 和 `body.username` 字段错误；其他 SQLSTATE、constraint 或缺失 diagnostics 保持 unknown，不按错误文本或请求字段猜测。唯一约束失败发生在成功审计追加前，并与 User 写入一起回滚。删除用户仍保留两条既有 `USER_IN_USE` 语义：引用预检返回动态摘要和 `details.references`，delete command 内真实 `23503` 的最终防线返回固定 `用户仍有业务历史引用，不能删除` 与空 details；二者不通过失败后的查询合并。

`platform_types` owns a unique category `slug`; `name` is not unique. Name is trimmed by the request schema and limited to 160 characters; slug is an explicitly supplied lowercase letters/digits/hyphens value limited to 100 characters and may be updated. The database constraint `uq_platform_types_slug` is the final uniqueness authority; create/update map only its exact `23505` violation to `PLATFORM_TYPE_SLUG_EXISTS` with `body.slug`, while unknown integrity failures remain visible. The collection read model exposes `platform_count` as the total direct `PlatformProfile` references, including Enabled and Disabled profiles, using the same grouped query as deletion blockers and sorting by `lower(name), id`. Type DELETE requires `expected_revision`; the service locks the type row, rejects stale revision before counting profile references, then returns `PLATFORM_TYPE_IN_USE` when references remain. Revision `0009` initially placed one mutable Markdown system Prompt under each type; revision `0014` replaced that ownership with one current Prompt per concrete platform。`0025` 又删除了任务上的类型快照和可编辑 Prompt；当前任务只直接绑定具体平台，生成输入由平台 Prompt 与事实版本 Markdown 唯一决定。

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names with `casefold()`, and stores exactly one of a plain or encrypted value; `(channel_id, normalized_name)` is uniquely enforced by `uq_ai_channel_headers_channel_id`, whose exact `23505` violation maps to `AI_CHANNEL_HEADER_NAME_EXISTS`. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state; its trimmed, case-sensitive `(channel_id, model_id)` identity is uniquely enforced by `uq_ai_models_channel_id`, whose exact `23505` violation maps to `AI_MODEL_ID_EXISTS`. Other integrity failures remain unknown instead of being guessed as identity conflicts. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, final system/user messages, platform identity and approved fact version after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `initialize-accounts` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. At this revision the cleanup was the only physical user-deletion exception; revision `0027` later adds the restricted application deletion contract.

### 0011 Generation Reliability

`generation_jobs` gains nullable `last_dispatch_attempt_at` and non-negative `dispatch_attempt_count` fields plus a partial due-time index for `PENDING` rows. These fields are diagnostic metadata inside the existing Job aggregate; `generation_jobs.status` remains the only execution authority and Redis continues to carry only the Job UUID.

After the API commits a new Job, Broker dispatch failure leaves it `PENDING`. Celery Beat redispatches only rows whose `COALESCE(last_dispatch_attempt_at, created_at)` is older than the configured threshold, using PostgreSQL row locks and a bounded batch. Only a Worker that atomically changes `PENDING` to `RUNNING` may call the provider, so accepted-but-unrecorded Broker messages and concurrent recovery remain harmless duplicates.

The execution lease is calculated from the immutable snapshot as `started_at + input_snapshot.channel.timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS`; the grace must be positive. Expired `RUNNING` Jobs become `FAILED/WORKER_LOST` and are never automatically dispatched again. If the provider accepted a request before the Worker lost its result, only an explicit retry may create a new traceable Job.

### 0012 AI Data Classification

该 revision 曾在 `content_tasks` 上引入生成输入分级字段。`0025` 已物理删除这些字段；当前分级只属于产品事实工作区和不可变事实版本，第三方模型出站只接受 `FactVersion.classification=PUBLIC`。PostgreSQL 仍是分级唯一来源，Redis 不保存分级状态。

### 0013 Publication And Review Closure

`publication_attentions` is the authoritative business queue for a publication that reaches `REMOVED` or `VERIFICATION_FAILED`. One publication can create at most one attention. An attention must be inserted as revision-zero `OPEN`, may only become `RESOLVED`, cannot be deleted, and resolution requires an actor, UTC time, and non-blank comment. `content_tasks.source_publication_attention_id` is nullable and unique, so one attention creates at most one repair task without introducing a second task model. Both the attention binding and a non-null repair source are immutable.

Every new `publication_record` must use an active account whose `platform_profile_id` equals the task's direct `platform_profile_id`. The application service validates account activity and platform equality with explicit errors; the PostgreSQL insert trigger is the final protection for the cross-table platform equality. The first related publication that reaches `VERIFIED` changes an `OPEN` task to `COMPLETED` in the same transaction. A later publication loss never reopens or cancels that task; it creates the unique attention instead. A task with `PENDING_MANUAL_PUBLISH`, `PLATFORM_REVIEW`, or `PUBLISHED` publication state cannot be cancelled.

The repair command fixes product and direct platform from the original task. Historical tasks also retain their real query-topic link; product-driven tasks keep that link null. It must explicitly select a non-blank `APPROVED` fact version for the same product. Creating the repair task does not resolve the attention.

Fact and content review records remain append-only. `request-changes` requires a non-blank comment, while submit and approve comments remain optional. Revision `0013` extends both database status guards so `CHANGES_REQUESTED -> PENDING_REVIEW` is valid without changing the immutable version payload. Review contexts are read projections over immutable fact/content versions, deterministic version diff, actor summary, stable review history and, for content only, generation lineage; they do not project Evidence status or persist a second copy.

Before `0013`, `python -m app.cli preflight-integrity` must return an empty JSON array. It reports stable IDs for `COMPLETED_WITHOUT_VERIFIED_PUBLICATION` when a completed task has no append-only `VERIFIED` publication status event, and for non-terminal `PUBLICATION_PLATFORM_MISMATCH`; a publication that was verified and later removed remains valid completion history, while an explicitly `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` mismatch remains traceable but no longer blocks deployment. The command exits non-zero when any issue exists and never changes history. The migration repeats the critical check so direct Alembic execution cannot bypass the deployment gate. Once any attention or repair source exists, downgrade is refused and deployment must move forward.

### 0014 Platform Prompt Ownership

`platform_prompts.platform_profile_id` is the primary key and references `platform_profiles.id` with `ON DELETE CASCADE`; each concrete platform owns zero or one current Markdown Prompt. The migration creates a replacement table and copies each legacy type Prompt to every existing profile of that type. A legacy Prompt whose type has no concrete platform produces no row. The old table and `platform_type_id` column are removed; there is no dual read, dual write, type-level compatibility endpoint, or fallback Prompt.

The current Prompt row also owns its `revision` and `updated_at`. Platform collection projections expose that exact `updated_at` as nullable `prompt_updated_at`; they do not reuse platform audit time or persist a duplicate field. Prompt update and physical deletion both lock the current row and compare the caller's required `expected_revision`; a stale command returns `REVISION_CONFLICT` without deleting or auditing a false success.

该 revision 曾以不可变 `platform_profile_versions` 管理平台规则。`0025` 已物理删除规则版本表、管理工作台、规则状态机、影响摘要和任务规则引用；当前具体平台只维护一个可选的当前 Markdown Prompt。

Administrators may physically delete a `fact_version` in any status only when neither `content_tasks` nor `content_versions` references it. The service locks the target, reports every non-zero direct reference, explicitly deletes subordinate `fact_review_records`, and deletes the version in the same transaction. Each `fact_review_record` is owned by its exact `fact_version_id`; a version review context must query that parent ID and never aggregate sibling versions through `product_id`. This administrative cleanup is the only exception to normal append-only review history; it never cascades to or rewrites tasks, content, generation, publication, or observation history, and product deletion never implicitly deletes fact versions.

Revision `0016` replaces only the `fact_review_records` append-only trigger. `UPDATE` remains forbidden, and `DELETE` is allowed only when the transaction-local `partsignal.fact_version_delete_id` exactly matches the row's parent version. The service sets that value only after locking the version, proving it has no content references, and recording the safe audit summary. Other append-only tables and the `RESTRICT` foreign key are unchanged; downgrade restores the original generic trigger.

### 0017 Optional Content Humanization

`content_humanization_prompts` is a database-enforced singleton (`id = 1`) containing the only current naturalization Prompt. The migration inserts no row: an administrator must explicitly create the first value, and every row records a real `updated_by` user plus an optimistic-lock `revision`. There is no seed value, environment fallback, platform copy, delete operation, or second runtime source.

`generation_jobs.job_type` is required and limited to `GENERATE | HUMANIZE`; historical rows are backfilled to `GENERATE` before the migration removes the column default. `source_content_version_id` uses `RESTRICT` and is paired with the type: original generation must have no source, while naturalization must have one. A partial unique index on `source_content_version_id` where the type is `HUMANIZE` and status is `PENDING | RUNNING` prevents concurrent active jobs for the same source.

A successful naturalization creates a new immutable `content_versions` row with `source_type = AI`, `source_job_id` pointing to the naturalization job, and `based_on_id` pointing to the frozen source version. It never updates the source. The job snapshot is the authority for the selected model, global Prompt revision and Markdown, complete source article and hash, original approved facts, PUBLIC classification, task requirements, and final messages; credentials remain outside snapshots and Redis still carries only the job UUID.

The API and Worker both require an `OPEN` task, an `AI` source in `DRAFT | CHANGES_REQUESTED`, a non-blank approved `PUBLIC` fact version, and an active product. Worker validation occurs before and after the provider call, including source identity, status, type, task/fact binding, frozen hash, and original generation lineage. Once any `HUMANIZE` job exists, revision `0017` refuses downgrade so immutable AI history cannot become unreadable; deployment must use a forward fix.

New generation snapshots include the concrete platform identity and continue freezing the final system/user messages. Old immutable snapshots may omit the concrete-platform object only for historical reads; new writes must include it. Platform Prompts can diverge after migration, so `0014` does not guess how to merge them on downgrade; rollback requires the pre-migration PostgreSQL backup.

### 0018 Manual GEO Article Observation

`geo_observations.observation_kind` explicitly separates historical `LEGACY_MODEL_RESULT` rows from new `MANUAL_ARTICLE_SEARCH` rows. The migration assigns the legacy discriminator without changing any historical business field. Legacy query/model/answer fields and new `search_platform/search_query` fields are mutually exclusive under a database check; new writes have no target question, model call, web-search flag, answer summary, citation, accuracy, or observation-level recommendation.

At revision `0018`, `geo_observation_publications.recommendation_status` was the authoritative per-article result for manual observations and was limited to `RECOMMENDED | NOT_RECOMMENDED`. Historical associations remained `NULL` and meant “not assessed per article”; the migration never inferred a status from old citations, possible-influence links, or observation-level recommendation. Revision `0029` later removes this field instead of preserving an obsolete compatibility value. The insert trigger continues verifying that every new result belongs to the observation product through `PublicationRecord -> ContentVersion -> ContentTask`, the publication is currently `PUBLISHED | VERIFIED`, and `final_url` is present.

The create service locks the product and all current eligible publication rows, then requires the request to cover that exact publication ID set. Revision `0018` required at least one verified `OPERATION_SCREENSHOT`; revision `0029` makes evidence optional. Article titles, platform identity, links, and publication status remain projections of their existing owners and are not duplicated in GEO storage. Metrics and the default records list use the same filtered set of current correction-chain tails; `include_history=true` is the explicit read path for superseded rows. A row is current only when no `geo_observations.supersedes_id` points to it.

Correction is an append-only service operation over the existing schema: it creates a new `MANUAL_ARTICLE_SEARCH` row whose `supersedes_id` points to the current manual row. The service rejects already-superseded targets and changes to the product, search platform, or search query. No new table, column, index, migration, or duplicated summary field is introduced for the records page.

Frontend V2 Observation Detail 同样不新增持久化字段。`GET /geo-observations/{observation_id}/detail` 在单个 `REPEATABLE READ` 请求中，由 requested node 通过 recursive CTE 找到唯一 root，再读取全部后继并由服务端校验、排列为 root→tail；响应明确给出 selected/root/tail 与原记录、当前查看、链尾标记，浏览器不得遍历 `supersedes_id` 或按时间猜测当前节点。Product、Query Topic、recorder、逐篇 Published Article 事实、Legacy citation 和附件均按完整链 ID 集合批量读取；Article 展示使用 `PublicationWork` 终态平台 snapshot、实际标题与 final URL，证据只从节点直接拥有的 attachment 关系读取 `FileRecord` 并统一签发短期 URL。既有 `attachment_file_ids` 继续表示祖先继承后的可见 ID，但 Detail 的证据归属只以节点内直接 evidence 为准。缺少链、Product、Topic、recorder、Article URL 或可读文件时返回稳定 409，不做跨接口补装或默认值推断。

Manual GEO history is forward-only. Once a `MANUAL_ARTICLE_SEARCH` row exists, revision `0018` refuses downgrade because removing the discriminator, search fields, or article results would destroy immutable business meaning.

### 0019 Product-Driven Content Tasks

`content_tasks.query_topic_id` becomes nullable while retaining its `RESTRICT` foreign key. Existing tasks are not rewritten and keep their real query-topic UUID; new ordinary tasks and repair tasks originating from them store `NULL`. `0025` 后，新普通任务只需产品、同产品非空 `APPROVED` 事实版本和活动具体平台；人工首稿不依赖平台 Prompt，系统 AI 生成才要求当前 Prompt。

`ContentTaskCreate` no longer accepts a query topic. New generation snapshots omit the `query_topic` object entirely rather than storing null, an empty object, or an invented question. Historical tasks still resolve and freeze their real query topic when creating a new generation job. Repair tasks inherit the original task's nullable link, and repair context returns a nullable query-topic projection for explicit new/legacy handling.

`GET /content-tasks/creation-options` 是不持久化的创建表单 read model：用固定次数集合查询返回活动 Product 及其非空 `APPROVED` FactVersion、活动 PlatformProfile，并可返回 handoff Product 的资格原因。它只约束显示范围，不是安全控制。普通任务 POST 在同一事务内按平台、产品、事实版本顺序锁行并重新校验，options 读取后资源变化仍必须由写命令拒绝。

Revision `0019` rewrites no task or immutable job snapshot. It refuses downgrade before restoring `NOT NULL` when any product-driven task exists; rollback after new writes requires a forward fix or the pre-migration PostgreSQL backup, never a placeholder query topic.

### 0020 Platform Branding And Task List Projection

`platform_profiles` gains nullable `website_url`, `logo_file_id`, and `logo_external_url`. The uploaded Logo foreign key uses `RESTRICT`; the referenced `file_record` must be a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` object before the application accepts it. A database check permits at most one Logo source, so an uploaded file and an external URL are never stored together. Signed object-storage URLs are response projections and are never persisted. Revision `0028` later makes `logo_external_url` read-only for legacy rows; new writes only bind `logo_file_id`.

The content-task list remains a read projection and adds no duplicate display columns. It joins each task's direct platform and displays the platform's current name, website, and Logo. The projected AI status is the latest `generation_job` whose `job_type = GENERATE`, ordered deterministically by `created_at DESC, id DESC`; `HUMANIZE` jobs are content-version post-processing and never replace the task's generation status. The projection batches products, platforms, Logo files, publication state, and generation status instead of issuing per-task queries.

Revision `0020` refuses downgrade when any platform branding field is non-null. Removing populated branding requires a forward fix or a pre-migration backup rather than silent data loss.

### 0021 AI Channel And Model Management

`ai_channels` gains required `description`, `protocol_type`, and `provider_brand` fields. Existing rows are migrated with an empty description, the sole implemented protocol `openai-compatible-chat-completions`, and `CUSTOM` brand; the migration never infers a brand from a name or URL. The protocol and brand columns have database checks and no runtime default, so new writes must submit one registered pair. Protocol chooses the real request adapter; brand is controlled display and filtering metadata only. A name, description, or brand-only change preserves connection state, while Base URL, protocol, API Key, or Header changes disable the channel and invalidate all child model tests.

Channel latest-test state remains a deterministic projection over `ai_models`: among models with `last_tested_at`, the row ordered by `last_tested_at DESC, id DESC` is authoritative; a channel without a tested model projects `UNTESTED` and a null time. No channel-level test column or second status state machine is added. Channel collection counts, Header count, enabled-model count, and latest test are read projections rather than persisted summaries.

`generation_jobs(ai_channel_id, created_at)` supports channel usage windows. Usage statistics include both allowed business job types, `GENERATE` and `HUMANIZE`, and never include model tests or discovery because those operations do not create generation jobs. Counts include all selected jobs, success and failure count only terminal states, `last_used_at` is the maximum non-null `started_at`, and durations or token totals aggregate only provider-reported non-null values; an empty aggregate remains null rather than being estimated or replaced with zero. The query never scans snapshots or reconstructs ownership after a deleted channel has set the job foreign key to null.

Channel operation history remains a projection over the append-only `audit_logs` table. New model create, update, enable, disable, delete, and test entries include the non-sensitive `channel_id` in `change_summary`; existing models also relate older entries through their current foreign key. Historical events for already-deleted models without `channel_id` remain only in the global audit log and are not guessed into a channel history. Model discovery and testing record only status, counts, and stable error codes, never credentials, Header values, provider response bodies, or complete sensitive errors.

The provider execution invariant remains `AT_MOST_ONCE`: after any request byte is sent, no automatic provider retry is allowed. An explicit retry creates a new `generation_jobs` row linked through `retry_of_id`, retaining its own immutable, non-sensitive snapshot. The UI therefore exposes the fixed policy “仅手动重试” and no retry-count configuration.

### 0022 GEO Observation Insights

版本 `0022` 紧跟 `0021_ai_channel_model_management`，保证 Alembic 只有一个线性 head；它不修改 AI 渠道数据或约束。

新建 `MANUAL_ARTICLE_SEARCH` 观测必须关联真实 `query_topic_id`。`0022` 之前的人工观测通过 `NOT VALID` 约束保留历史 `NULL`，洞察聚合会明确排除这些记录，不把它们猜测到某个问题主题。首次追加式更正历史空主题记录时必须补充真实主题，后续更正不得改变主题。

`geo_observation_publications` 在 `0022` 新增可空的 `discovered`、`mentioned`、`cited` 和 `accuracy` 事实，既有行保持 `NULL`。该版本曾要求新人工关系提交累计阶段事实；`0029` 随后删除逐篇推荐和引用，只保留相互独立的 `discovered`、`mentioned` 与可空 `accuracy`。旧模型观测关系必须保持全部逐篇事实为空。插入触发器继续校验发布内容归属、可观测状态和非空公开链接。

洞察只聚合更正链当前链尾中的完整人工观测；服务必须先校验同次观测的全部逐篇关系，再应用内容平台、内容主题或发布内容筛选，不能用筛选隐藏缺失事实。`0029` 后，趋势率、平台率和内容排行统一按相互独立的发现、提及、准确事实计算，不再提供阶段漏斗。问题覆盖先按人工观测、问题主题和精确 GEO 平台去重。曾真实发布且仍被历史观测引用的发布记录在下线后继续可筛选追溯。分母为零时保持 `NULL`，历史不完整记录进入数据质量排除计数，迁移与服务均不推断缺失事实。只要已经写入新主题关联或逐篇洞察事实，迁移就拒绝降级；恢复必须使用前向修复或迁移前备份。

### 0023 Platform Management

版本 `0023` 紧跟 `0022_geo_observation_insights`。`platform_profiles.is_active BOOLEAN NOT NULL` 是具体平台启停的唯一业务状态；迁移把所有既有平台显式回填为 `true`，新建平台也显式写入 `true`。平台 `slug` 的全局 identity 由 `uq_platform_profiles_slug` 最终保证，只有该 constraint 的 `23505` 映射为 `PLATFORM_SLUG_EXISTS` 与 `body.slug` 字段错误。`0025` 后，配置完整只表示存在当前具体平台 Prompt，不保存派生列、汇总行或历史快照。

停用平台仍可查看、编辑、重新启用及维护 Prompt，但所有新建 `ContentTask`（包括发布异常修复任务）、`PlatformAccount` 和 `PublicationRecord` 的服务必须先锁定同一平台行并拒绝 `is_active=false`。停用不修改既有账号的 `is_active`，不修改 Prompt、任务、内容、发布、GEO 或审计历史。平台启用、停用与所有受限新建路径遵循“先锁平台，再检查状态并写入”的统一锁顺序，防止并发检查后写入穿透。

平台配置完整性、账号数量和引用次数均为 PostgreSQL 实时投影。平台引用数直接统计 `content_tasks.platform_profile_id` 的唯一 `ContentTask.id`；最近 30 天使用同一 UTC `as_of` 和半开区间 `[as_of - 30 days, as_of)`，历史数不设时间下界。`content_tasks(platform_profile_id, created_at)` 与 `platform_accounts(platform_profile_id, is_active)` 支持聚合；`audit_logs(target_type, target_id, created_at DESC)` 支持平台创建、编辑、启用和停用的真实时间投影。无对应审计时返回 `NULL`，不得使用迁移时间补造。

在 `0023` 的初始合同中，任一内容任务或平台账号都会阻断平台物理删除。`0037` 已把当前规则收缩为“先停用，仅 `OPEN` 任务和非终态发布工作阻断”，并允许清理平台账号但绝不级联任务。`0023` 降级会删除启停状态，只能在业务确认可丢失当前停用事实后执行；旧迁移与冻结的 `migration_schema_v1.py` 保持不变。

平台账号删除必须提交当前 `expected_revision`。服务按 Platform → Account 固定顺序锁行，先比较 revision，再在同一持锁事务实时统计非终态 `PublicationWork`；PublicationWork 创建遵循相同锁序，因此不能穿透删除复核。只有终态历史时允许删除账号，历史继续读取冻结的账号 label/identifier snapshot。同平台账号标识的 `lower(btrim(account_identifier))` 唯一性由 `uq_platform_accounts_profile_identifier_normalized` 权威保证；只有该 constraint 的 `23505` 竞态路径与业务预检统一返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 与 `body.account_identifier` 字段错误，不得由客户端先 GET 或解析数据库文本替代并发控制。

### 0024 Audit Outcome

版本 `0024` 紧跟 `0023_platform_management`，继续以现有 `audit_logs` 作为唯一业务审计来源。表新增必填 `business_module`、`outcome`、`result_message` 和可空 `error_code`；`outcome` 只允许 `SUCCESS | FAILED | DENIED`，`business_module` 只允许契约声明的九个模块。失败的创建命令尚无真实对象，因此 `target_id` 改为可空；任何读取方都必须显式处理该状态，不得补造 UUID。

历史 action/target 组合必须先通过迁移内的完整分类校验，再回填模块。既有同事务追加记录默认为 `SUCCESS`；只有 `ai_model.tested` 的失败测试和 `ai_channel.models_discovered` 的已记录失败按其稳定字段精确回填为 `FAILED`，其他历史结果不得从自由文本或 HTTP 状态猜测。迁移新增 `audit_logs(created_at DESC, id DESC)` 以保证全局分页稳定；既有目标时间索引保留。

`0024` 当时让九类关键命令在业务回滚后以独立事务追加 `FAILED` 或 `DENIED`。`0037` 已移除该运行时行为并清理对应历史；当前只允许保留白名单内的 `SUCCESS` 与业务状态同事务提交。`details` 只保存按业务模块登记的 `changes/facts`，写入边界与详情读取共用同一字段白名单；值仅允许 null/string/number/boolean 或这些标量的一维列表。列表只投影 metadata，不读取 `details`；详情遇到未知字段或不安全 shape 时整体返回 `AUDIT_PROJECTION_FAILED`，不部分展示或泄漏原始 JSONB。

审计时间按 UTC 存储和传输，查询时间窗采用半开区间 `[created_from, created_to)`。`actor_id` 使用 `SET NULL`，响应中的姓名和账号类型是当前用户目录投影而非历史快照。关键词只匹配当前操作者 username/display name、模块、动作、对象类型/标识、请求 ID、结果说明和错误码，不搜索 JSON details。列表的 count/rows 都 outer join 当前用户且固定为两条 SQL；filter options 固定两条去重排序 SQL。`request_id` 允许重复，只用于关联链路，并限制为 1 至 100 个可打印 ASCII 字符。`0037` 后专用触发器禁止普通 UPDATE，只放行受约束的操作者置空；任务聚合删除可精确删除旧目标审计，但没有通用审计删除 API。本次 read/write 投影收紧没有数据库 schema 或历史重写。

### 0025 Markdown Facts And Direct Platform Tasks

版本 `0025` 紧跟 `0024_audit_outcome`，一次性删除结构化产品事实和平台规则版本两套已废弃业务模型。历史迁移、`migration_schema_v1.py` 和既有不可变生成快照保持冻结；当前 Schema 只由本 revision、运行时 ORM 和本契约表达。

`products` 新增 `facts_body_markdown TEXT NOT NULL` 与 `facts_classification VARCHAR(16) NOT NULL`，后者只允许 `PUBLIC | INTERNAL | RESTRICTED`；既有 `facts_revision` 继续作为事实工作区乐观锁。新产品初态正文为空且分级为 `RESTRICTED`，保存事实命令必须拒绝去除空白后为空的正文并原样保存非空 Markdown。`fact_versions` 以 `body_markdown` 和 `classification` 替换 `snapshot_json`；新版本必须从同一产品工作区冻结非空正文与分级，历史空版本可继续被旧记录引用，但不能创建新内容任务。

迁移使用 revision 文件内冻结的确定性 Markdown 渲染器分别处理当前规范化工作区和每个历史 `snapshot_json`。渲染器只按固定章节、稳定记录顺序和字段顺序输出数据库已有值，不总结、归并、补值或调用 AI。分级取已有 Evidence 中限制最高的值，顺序为 `RESTRICTED > INTERNAL > PUBLIC`；没有可确定 Evidence 分级时写入 `RESTRICTED`。渲染和行数校验完成后删除 `parameter_evidence_links`、`replacement_evidence_links`、`claim_evidence_links`、`part_parameters`、`replacement_relations`、`fact_claims`、`evidences`、`reference_parts`，但不删除独立 `file_records`。

`content_tasks` 新增 `platform_profile_id UUID NOT NULL REFERENCES platform_profiles(id) ON DELETE RESTRICT` 和 `(platform_profile_id, created_at)` 索引。迁移通过原 `platform_profile_version_id -> platform_profile_versions.platform_profile_id` 唯一回填；任一任务无法回填时整个 revision 失败。随后删除 `platform_profile_version_id`、`platform_type_id`、`platform_type_snapshot`、`user_prompt_markdown`、任务分级三字段、受众、角度、转化目标、格式、长度与 `canonical_url`，以及对应检查与索引。`query_topic_id` 和 `source_publication_attention_id` 保持原义。

删除全部 `platform_profile_versions` 数据和表。`PlatformProfile` 是任务与发布的唯一平台身份，`PlatformPrompt` 是系统 AI 的唯一当前 system Prompt，`PlatformProfile.allowed_domains` 是发布 URL 的唯一平台域名规则。平台配置完整只表示已配置当前 Prompt；缺少 Prompt 不阻止创建内容任务或人工首稿，只阻止系统 AI 作业。平台引用数直接统计 `content_tasks.platform_profile_id`，平台物理删除由任务和平台账号直接引用共同阻断。

新普通内容任务请求精确写入 `product_id`、同产品非空 `APPROVED fact_version_id` 和活动 `platform_profile_id`，并固定 `query_topic_id=NULL`。发布异常修复任务继承原任务的平台和可空目标问题，只允许选择同产品非空 `APPROVED fact_version_id`；不复制已删除任务要求。发布平台等值的应用校验与 PostgreSQL 触发器都直接比较 `content_tasks.platform_profile_id` 和 `platform_accounts.platform_profile_id`。

新原始生成快照使用 `contract_version=content-markdown-v2`，冻结非敏感渠道、模型、平台身份、事实版本身份及分级、`system_message` 和 `user_message`。实际供应商请求必须恰好包含两条消息：system 正文逐字等于创建作业时读取的 `PlatformPrompt.template_markdown`，user 正文逐字等于 `FactVersion.body_markdown`；校验空白时不得改写原字符串。只有事实版本分级为 `PUBLIC` 才允许第三方出站。系统不再追加固定前缀、任务 Prompt、任务要求、产品元数据、事实 JSON 或平台规则。

自然化继续复用现有 `generation_jobs`，新快照版本为 `humanization-markdown-v2`，只冻结当前自然化 Prompt、来源文章、来源原始作业、事实版本身份及最终消息，不读取结构化事实、任务要求或平台规则。历史 `chat-json-v1` 与 `humanization-json-v1` 快照不改写且只读；不得从旧快照创建重试。迁移锁定 `generation_jobs` 并在发现任一旧契约 `PENDING | RUNNING` 作业时失败，部署必须先停止新流量并清空或显式终止旧作业。

任务级人工首稿直接创建 `ContentVersion(source_type=HUMAN, source_job_id=NULL, based_on_id=NULL, status=DRAFT)`，不创建生成作业。标题、摘要、Markdown 正文、标签和变更说明仍由现有内容版本契约校验；后续人工修订、审核、唯一批准版本、人工发布、状态事件和内容哈希与 AI 草稿完全共用。

事实与内容审核上下文不再投影 Evidence 状态。质量检查删除平台规则长度/禁用表达、任务受众/角度/格式/长度和结构化参数数字来源检查，只保留严格四字段模型 JSON、标题/摘要/正文非空、Markdown 安全渲染、内容哈希、状态转换、唯一批准版本和发布域名等确定性边界。

该 revision 的 downgrade 明确失败。恢复旧结构化关系或规则版本只能使用迁移前 PostgreSQL 备份，不得根据 Markdown 或历史快照反向猜测数据。

### 0026 Publication Account Deduplication

`platform_accounts` 新增非负 `revision`，业务标签与内部运营账号标识均须在 `btrim` 后非空。同一具体平台内，`lower(btrim(account_identifier))` 必须唯一；停用账号仍占用标识，不同具体平台可以保存相同标识。写入边界去除两侧空白但保留大小写用于内部展示。运营标识可以是平台用户名，也可以是“注册手机号 + 持有人”等内部组合，但不得保存密码、Cookie、令牌，不得进入日志或审计详情。

账号编辑和启停固定按“锁具体平台行、锁账号行、校验 expected revision、写业务与脱敏审计”的顺序执行。停用只影响新发布候选，不删除或改写历史引用；平台归属创建后不可编辑。迁移在创建规范化唯一索引前锁表并检查空值与重复组，发现无法无损处理的数据时以 `55000` 失败，不自动合并或删除账号。

人工发布以 `platform_profile_id + ContentVersion.content_hash` 作为平台内容身份。创建登记和 `mark-published` 都对该身份获取事务 advisory lock，并读取发布记录及追加式状态事件：存在非 `REJECTED` 尝试时禁止重复登记；任一记录曾出现 `PUBLISHED` 或 `VERIFIED` 事件后永久禁止同平台同内容再次登记或公开，后续 `REMOVED` 或 `VERIFICATION_FAILED` 不撤销公开事实。只有全部既有尝试从未公开且已进入 `REJECTED` 时，才允许换另一个启用账号重试。不同具体平台互不阻断，幂等键继续只负责同一请求重放。

### 0027 Guard Audit Actor User Delete

版本 `0027` 紧跟 `0026_publication_account_dedup`，不新增业务表或列，只把 `audit_logs` 的通用追加式触发器替换为操作者置空专用守卫。用户删除服务必须先锁定用户表和目标行，只允许删除 `is_active=false` 的账号；活动账号返回 `USER_ACTIVE`。会话沿既有外键级联清理，任一业务外键引用继续由 `RESTRICT` 阻断并映射为 `USER_IN_USE`。

删除事务先设置事务本地 `partsignal.user_delete_id`，随后仅允许在用户删除触发的外键级联上下文中，把匹配用户的 `audit_logs.actor_id` 从该 UUID 更新为 `NULL`，且 `to_jsonb(NEW) - 'actor_id'` 必须与旧行完全一致。错配用户、未声明事务变量、手工直接更新、把空操作者改为其他值、修改其他审计字段以及所有审计 DELETE 均以 `55000` 失败。用户删除成功后追加新的 `user.deleted` 审计事件，由实际执行删除的管理员作为操作者；历史审计事件保留但被删用户的当前目录投影为空。降级恢复原通用触发器。

本 revision 最初只允许删除没有 `generation_jobs` 或 `content_versions` 的 `CANCELLED` 任务；该旧规则已由 `0033` 的任务自有历史删除契约取代。

### 0028 Platform Logo Lifecycle

版本 `0028` 紧跟 `0027_audit_user_delete_guard`。`file_records` 新增可空 `cleanup_after` 与 `deleted_at`，状态扩展为 `DELETING | DELETED`；允许的新增转换只有 `PENDING | VERIFIED | FAILED | ABORTED -> DELETING -> DELETED`。`DELETED` 必须有 `deleted_at`，其他状态必须没有。对象元数据继续不可变。

管理员显式请求 Icon Horse 单候选时，服务端只访问固定 `https://icon.horse/icon/{规范化域名}`，校验 PNG、JPEG、WebP 或 ICO 后先持久化 `PENDING`，再写入自有对象存储并转为 `VERIFIED`。候选和手工上传完成的 `PLATFORM_LOGO` 设置 `cleanup_after = verified_at + 24 hours`；绑定任一平台时锁定文件并清空该字段。替换、清空或删除平台 Logo 后，仅在最后一个实际外键引用解除时设置 `cleanup_after = now() + 7 days`。

清理器以 PostgreSQL 为唯一权威，使用有限批次和 `FOR UPDATE SKIP LOCKED`。它在声明删除前实时检查 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id`；不得查询 `0025` 已删除的 `evidences`，也不维护引用计数。到期 `PENDING`、任意 `FAILED | ABORTED`、到期 `VERIFIED` 和已有 `DELETING` 可被扫描；有引用时不得删除，无引用时先提交 `DELETING`，再幂等删除对象，成功后写 `DELETED/deleted_at`，暂时失败则保留 `DELETING` 供下一轮重试。

平台 Logo 外键触发器最终保证非空 `logo_file_id` 只引用 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`。迁移把既有已引用 Logo 的 `cleanup_after` 保持为空，把既有无引用 `VERIFIED PLATFORM_LOGO` 设置为迁移时点后七天。`logo_external_url` 本阶段保留用于旧数据只读展示，创建和更新不再接受新的外链；迁移和 Worker 均不联网批量转换旧外链。存在任一 `DELETING | DELETED` 时禁止降级，因为对象删除不可逆。

### 0029 Manual GEO Independent Facts And Deletion

版本 `0029` 紧跟 `0028_platform_logo_lifecycle`。`geo_observation_publications` 物理删除 `recommendation_status` 与 `cited`，人工逐篇事实只保留相互独立且必须显式提交的 `discovered`、`mentioned`，以及允许为空的 `accuracy`（`ACCURATE | PARTIAL | INCORRECT | UNJUDGEABLE`）。迁移不根据旧阶段字段推断新事实；既有 `discovered`、`mentioned`、`accuracy` 原样保留。新建与更正的 `attachment_file_ids` 都允许为空，每个更正版本只关联当次新增文件；读取链尾时按祖先顺序聚合证据，不复制历史关联。

管理员只可按完整更正链物理删除 `MANUAL_ARTICLE_SEARCH` 观测，不能删除单个版本或 `LEGACY_MODEL_RESULT`。服务按产品、根观测、链节点的固定顺序锁定并验证链连续性，再在同一事务设置当前节点的 `partsignal.geo_observation_delete_id`，依次删除该节点的逐篇发布关系、附件关系及观测，最后写入只含稳定 ID 与数量的审计摘要。专用触发器继续禁止全部 UPDATE，只放行父 ID 与事务声明精确匹配的 DELETE；错配、缺少声明或不完整链均失败。

删除事务提交后，仅把已经没有平台 Logo、发布附件或 GEO 附件引用的文件安排进既有延迟清理状态机；清理器仍以三个实际外键为唯一引用权威，不保存引用计数，也不立即删除对象。通用文件清理不再限定 `PLATFORM_LOGO` 分类。审计不得记录搜索词、备注、回答、文件名或文件内容。该迁移会丢弃旧逐篇推荐与引用字段，降级仅恢复空列而不猜测历史值；恢复业务语义必须使用迁移前备份或前向修复。

### 0030 Controlled Publication Record Deletion

版本 `0030` 紧跟 `0029_geo_evidence_management`，不新增业务表或列。发布记录只有在完整状态事件历史从未出现 `PUBLISHED | VERIFIED`，且没有 `geo_observation_citations`、`geo_observation_publications` 或 `publication_attentions` 引用时才可物理删除；当前状态不是删除资格来源。发布关注事项一旦存在就阻断删除，因此经其关联的修复任务也不会失去来源。

删除服务使用现有的“具体平台 + 内容哈希”事务 advisory lock，再锁定发布记录并重新检查全部阻断引用。事务设置 `partsignal.publication_record_delete_id` 后，只允许删除目标记录的未公开状态事件、发布附件关系和记录本身；任何 `PUBLISHED | VERIFIED` 事件即使目标匹配也由数据库拒绝删除。错配目标、未声明事务变量、普通 UPDATE 和对其他聚合的 DELETE 均以 `55000` 失败。

删除成功只审计稳定目标 ID、状态事件数量和附件数量，不保存标题、URL、说明或文件名。解除附件关系后，只有已无平台 Logo、发布附件或 GEO 附件引用的文件才进入既有清理状态机；共享文件继续保留。发布周期指标仍来自保留的公开状态事件，因此受控删除不会改写任何已公开历史。

### 0031 Reusable Platform Prompts

版本 `0031` 紧跟 `0030_publication_record_deletion`。`platform_prompts` 改为独立模板库，以独立 UUID 为主键并新增全局唯一名称；该 identity 由 `uq_platform_prompt_templates_name` 最终保证，只有该 constraint 的 `23505` 映射为 `PLATFORM_PROMPT_NAME_EXISTS` 与 `body.name` 字段错误。`platform_profiles.platform_prompt_id` 是可空外键并使用 `ON DELETE RESTRICT`。一个平台最多绑定一份当前 Prompt，一份 Prompt 可被多个平台复用；配置完整性、缺失数量和平台投影都只从该外键实时派生。

迁移为每条旧 Prompt 保留原正文、revision、操作者和时间，并使用旧 `platform_profile_id` 作为新 Prompt UUID；名称确定为“平台名称（slug）”。复制和回绑完成后校验行数、正文与绑定关系，任一不一致都中止迁移。降级只允许每份 Prompt 恰好绑定一个平台且不存在未绑定模板，否则以 PostgreSQL `55000` 拒绝；迁移不按正文合并或猜测归属。

Prompt 更新锁定模板行并比较 `expected_revision`；保存前由管理端明确展示全部受影响平台。`0037` 起删除 Prompt 会在同一事务自动解绑全部当前平台并递增其 revision；平台删除仍不删除模板。新原始生成请求同时提交所确认的 Prompt UUID 与 revision，服务端锁定任务、平台及其当前绑定后重新校验，变化时返回 `PLATFORM_PROMPT_CHANGED`，不得使用过期确认。

新原始生成快照只写 `content-markdown-v3`，除既有最终消息、平台、事实、渠道和模型外，还冻结 Prompt 的 UUID、名称与 revision。`content-markdown-v2` 仅作为明确的历史类型继续读取并按原快照重试；后续换绑、更新或删除当前配置都不改变历史作业。自然化继续使用 `humanization-markdown-v2`。

### 0033 Controlled Content Task Owned History Deletion

版本 `0033_task_owned_history_delete` 紧跟 `0032_content_task_idempotency`，不新增业务表或列。只有 `CANCELLED` 任务可物理删除；该任务可以拥有生成作业、内容审核记录以及 `DRAFT | PENDING_REVIEW | CHANGES_REQUESTED` 内容版本。任一 `APPROVED | SUPERSEDED` 内容版本、任一关联发布记录或非空 `source_publication_attention_id` 都返回 `CONTENT_TASK_IN_USE` 并阻断删除。发布记录覆盖其 GEO 引用、文章观测和发布异常历史，修复来源单独阻断，因此任何下游历史都不会被清理。

服务按 UUID 顺序锁定目标任务的生成作业、内容版本和任务行，并在锁内重新检查状态与全部保护关系。事务设置 `partsignal.content_task_delete_id` 后，只允许把匹配任务内容版本的 `source_job_id` 置空，以及删除这些版本的审核记录；普通内容修改、审核记录 UPDATE、未声明或错配任务的 DELETE 继续以 `55000` 失败。服务随后依次删除任务生成作业、审核记录、未批准内容版本和任务，任一步失败都整体回滚。

删除成功只审计任务 UUID 与生成作业、内容版本、审核记录数量，不保存标题、正文、Prompt 或审核说明。产品、事实版本、平台、用户、发布、GEO 和既有审计均保持不变。任务列表与详情用同一批量保护历史投影决定 `DELETE` 动作，服务端仍是最终删除权限和状态权威。

### 0034 Publication Workflow Redesign

版本 `0034_publication_redesign` 紧跟 `0033_task_owned_history_delete`。该 revision 重新建立发布当前态：`publication_works` 保存一次人工发布工作的绑定和阶段，`publication_work_events` 与 `publication_verifications` 保存追加式历史，`published_articles` 保存首次核验成功后形成的只读公开成果，`published_content_issues` 保存发布后的页面问题，`publication_attachments` 只归属于发布工作。

新旧发布状态无法无损映射。迁移必须在替换结构前检查旧发布、关注事项、附件和依赖旧发布身份的 GEO 关系；任一非空时汇总表名与数量并以 PostgreSQL `55000` 中止，不删除、补值或猜测映射。通过预检后删除旧表与旧删除门禁，将 `content_tasks.source_publication_attention_id` 替换为唯一且不可改绑的 `source_published_content_issue_id`，并把 GEO 外键统一替换为 `published_article_id`。downgrade 同样以 `55000` 拒绝，恢复只能使用迁移前备份。

发布工作使用 `PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED | COMPLETED | CLOSED`。失败核验只追加当时标题、URL、发布时间和说明快照，并把工作置为 `ACTION_REQUIRED`；后续结果修正仍发生在同一工作上。首次成功核验原子创建与工作同 ID 的 `PublishedArticle`，并完成工作和来源任务。显式关闭必须保存原因、说明、操作者和时间，并原子取消来源任务。成功成果不再回退；后续问题由 `PublishedContentIssue OPEN -> RESOLVED` 独立表达，创建修复任务不会自动解决问题。

修复任务创建先锁定内容问题并检查既有来源关系；PostgreSQL 的 `uq_content_tasks_source_published_content_issue_id` 是并发竞争的最终权威。只有真实 `23505` 且 diagnostics 的 `constraint_name` 精确等于该名称时，服务才在回滚失败事务后返回既有 `409 REPAIR_TASK_EXISTS`；其他唯一、外键、触发器、缺失 diagnostics 或非 `23505` 的完整性异常保持 unknown 500，不解析数据库错误文本，也不得伪装成 revision 冲突。成功创建、问题/文章/事件历史和 AuditLog 必须保持原子，已知或未知失败都不得留下部分写入。

打开发布后内容问题必须先以 `FOR UPDATE` 锁定同一 `PublishedArticle`，再由既有预检查拒绝已有 `OPEN` 问题或曾以 `RETIRED` 解决的问题。Partial unique index `uq_published_content_issues_one_open` 是“每篇文章至多一个 OPEN Issue”的最终并发权威；只有真实 `sqlstate=23505` 且 diagnostics 的 `constraint_name` 精确等于该名称时，Issue INSERT owner 才在 root rollback 后返回与预检查相同的 `409 PUBLISHED_CONTENT_ISSUE_CONFLICT`、消息 `文章已有开放问题或已退役` 和空 details。识别不得解析数据库错误文本；命中后不查询或重放 winner。`RETIRED` 语义仍只属于既有预检查，数据库直接写入触发的 `23514` 不得归因于该 partial unique mapper。其他 Issue unique、FK、CHECK、NOT NULL、trigger、constraint trigger、非 `23505`、其他约束及缺失 diagnostics 均保持 unknown 500。已知失败 rollback 后 Session 必须可复用；失败不得留下第二个 Issue、Repair Task、状态/revision 变化、GEO 关系或 SUCCESS AuditLog。

工作终态字段、成果、事件、核验和问题历史由触发器冻结或限制为契约允许的状态变化。`0038` 起只有两类精确事务上下文可以删除发布历史：管理员永久删除已归档来源任务，或管理员永久删除一条没有 GEO 下游引用的成果聚合；未声明或错配目标的直接 DELETE 以 PostgreSQL `55000` 拒绝。GEO 新观测只能引用没有 `OPEN` 问题且从未以 `RETIRED` 解决问题的 `PublishedArticle`；打开问题、创建观测和删除成果锁定同一文章，避免资格竞态。

### 0035 Business Workflow Primary Tasks

版本文件 `0035_business_workflow_primary_tasks.py` 紧跟 `0034_publication_redesign`，Alembic revision 为 `0035_business_workflow`。事实版本不再保存可重新提交的 `DRAFT`：事实工作区提交原子冻结一个 `PENDING_REVIEW` 版本，每个产品至多一个待审核版本；既有草稿或多待审核等歧义数据以 PostgreSQL `55000` 阻断迁移，不猜测业务结论。

`content_tasks.current_content_version_id` 是内容单主线的唯一当前指针。迁移只在每个任务的版本历史能确定唯一当前版本时回填；多个候选主线以 `55000` 阻断。当前草稿或退回版本可转为 `ABANDONED`，新修订和自然化结果通过原子更新该指针成为当前版本，旧版本保持不可变历史。数据库触发器校验当前版本必须归属同一任务，每个任务至多一个待审核内容版本。

`publication_works.content_task_id` 固定发布工作的稳定任务身份并取代按内容版本唯一；首次核验成功前，工作可切换到同任务、同平台的当前批准版本。每次切换在事件中冻结前后内容版本，核验记录冻结当次内容版本，成果读取成功核验快照而不是可变工作指针。旧工作、事件和核验只有在归属可唯一确定时才回填，否则以 `55000` 阻断。

开始发布的最终唯一性由 `uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id` 与 partial unique index `uq_publication_works_active_platform_hash` 共同裁决。服务先按 request key、ContentTask 和同平台 active content hash 执行持锁预检；只有真实 `23505` 且 `diag.constraint_name` 精确等于这三个名称之一时，Work INSERT owner才允许在root rollback后恢复。恢复始终先按request key查询winner：`content_version_id/platform_account_id`全等返回canonical replay，任一不同返回既有`409 IDEMPOTENCY_CONFLICT`；没有同key winner时，content-task或active platform/hash冲突返回既有`409 PUBLICATION_IDENTITY_CONFLICT`，idempotency约束却找不到winner则保持unknown。其他unique、PASSED verification、Article、Attachment、FK、CHECK、trigger、缺失或替代位置diagnostics全部原样失败，不解析数据库错误文本，也不得映射为`REVISION_CONFLICT`。合规锁并发与数据库竞争都只能提交一个Work和一条`CREATED`事件；loser不得改变ContentTask status/revision/current pointer，或留下Verification、Article、GEO关系、source与SUCCESS AuditLog。

`content_task_geo_sources` 按内容任务一对一冻结 GEO 异常规则、分析周期、来源文章或问题、GEO 平台和结构化依据。来源行只允许插入，不允许更新或删除；创建服务必须重新计算当前洞察并与内容任务同事务写入。该迁移包含新的不可逆业务历史，downgrade 固定以 `55000` 拒绝，恢复使用迁移前备份或前向修复。

GEO 优化任务与普通任务共享 `content_tasks.idempotency_key` 的全局唯一空间，但 source kind 属于 canonical identity：普通任务必须不存在 `content_task_geo_sources`，GEO 任务必须存在一条形状完整的来源快照。GEO 创建 owner 只恢复 PostgreSQL `23505` 且 `diag.constraint_name` 精确为 `uq_content_tasks_idempotency_key` 的 task INSERT 竞争；命中后先 root rollback，再按 key 重查已提交 winner。完整同 GEO identity（task 的 product/fact/platform 与 source 的 rule/date/article/topic/GEO platform）返回 canonical replay；完整 ordinary winner或任一可证明的异 GEO identity返回既有 `IDEMPOTENCY_CONFLICT`。winner 不存在、task identity 不完整，或来源文章已按 `0037` 的 `ON DELETE SET NULL` 生命周期消失等导致 GEO source identity 不可证明时，必须重新抛出原始 `IntegrityError`，不得猜测 replay 或冲突。task 与 GEO source 继续同一事务提交；source flush、commit 及其他完整性错误不进入该 mapper。

### 0036 Remove Publication Section URL

版本文件 `0036_remove_publication_section_url.py` 紧跟 `0035_business_workflow`，Alembic revision 为 `0036_remove_section_url`。该 revision 删除没有稳定跨平台含义的 `publication_works.section_url`；开始发布只绑定 `content_version_id` 与 `platform_account_id`，准备更新只允许变更账号并提交 revision 和说明。

迁移先以 0035 的当前定义替换 `partsignal_guard_publication_work()`，仅从准备阶段冻结条件移除栏目地址比较，再删除列；账号冻结、身份不可变、结果登记和状态转换规则保持不变。`0037` 后终态历史仍不可原地修改，但可随已归档任务聚合永久删除。真实公开位置只由结果登记的 `final_url` 保存，并继续匹配具体平台允许域名。

既有栏目地址按已确认的无效数据直接丢弃，不转存到影子列、JSON 或历史表。该值无法确定性恢复，downgrade 固定以 PostgreSQL `55000` 拒绝，恢复必须使用迁移前备份。

### 0037 Simplified Deletion Lifecycle

版本文件 `0037_simplify_deletion_lifecycle.py` 紧跟 `0036_remove_section_url`。`content_tasks` 新增正交的可空 `archived_at`、必填平台名称快照与可空网站 URL 快照；`publication_works` 新增必填平台名称、账号标签和账号标识快照。迁移只从升级时仍受强外键保护的当前行确定性回填，任何缺失都以 PostgreSQL `55000` 中止，不猜测历史显示值。

归档只接受未归档 `COMPLETED` 任务；恢复只清空 `archived_at`，两者都校验并递增 revision，不改变业务状态。默认任务列表只返回未归档任务，`archive_status=ARCHIVED|ALL` 才读取归档范围。普通删除校验 `expected_revision`，只接受未归档 `OPEN | CANCELLED` 任务，拒绝运行中生成作业以及任何成功文章或 GEO 文章关系；它删除任务拥有的草稿、审核、生成和未成功发布工作，但不触碰外部页面。

管理员永久删除只接受已归档任务、匹配 revision 和固定确认文本 `永久删除`。服务锁定并重新计算范围，删除任务拥有的内容、发布成果与问题、发布事件和核验；只删除失去全部文章关系的人工 GEO 更正链，共享 GEO 记录与共享文件保留。删除旧目标审计后只写一条 `content_task.permanently_deleted` 空详情墓碑。归档、恢复及永久删除都不验证或删除外部页面。

发布成果永久删除只接受管理员、匹配同 ID `PublicationWork.revision` 和固定确认文本 `永久删除`。`GeoObservationPublication` 与 `GeoObservationCitation` 按去重观测数投影为 `GEO_OBSERVATION`，`ContentTaskGeoSource` 投影为 `GEO_OPTIMIZATION_SOURCE`；任一引用存在都返回结构化 `409 PUBLISHED_ARTICLE_IN_USE`，不得依赖现有 `CASCADE` / `SET NULL` 静默解绑。无阻断时，事务删除成果拥有的工作、事件、核验、附件关系和内容问题，保留修复任务并解除其来源问题，保留批准内容；来源任务仍绑定实时平台时恢复为 `OPEN`，平台已经删除且外键为空时转为 `CANCELLED`，两者都递增 revision。任务若已归档则保留 `archived_at`；恢复归档后，`OPEN` 可重新进入待发布，`CANCELLED` 保持已取消。删除旧目标审计后写入 `published_article.permanently_deleted` 最小墓碑，且不验证或删除外部页面。

`source_published_content_issue_id` 的 current-head 权威删除语义为 nullable `ON DELETE SET NULL`；早期 revision 中的 `RESTRICT` 已由 `0037_simplify_deletion_lifecycle` 替换。删除成果聚合时，SET NULL 只解绑被保留的 Repair Task，不能改变该任务的 status、revision 或 `archived_at`；恢复为 `OPEN` 或转为 `CANCELLED` 并递增 revision 的对象始终是原 Article 的来源 ContentTask。

平台删除仍要求先停用，并在存在 `OPEN` 内容任务或非终态发布工作时拒绝；它绝不级联删除任务。平台账号随平台删除，终态任务与工作把实时平台/账号外键置空后使用标量快照显示。单独账号删除只由非终态发布工作阻断。Prompt 删除通过共享事务 advisory lock 串行化绑定变更，在同一事务自动解绑全部平台、递增平台 revision 后删除模板；历史生成作业继续读取不可变输入快照。

审计写入收缩为 `RETAINED_AUDIT_ACTIONS` 中的成功事件。迁移删除全部 `FAILED | DENIED` 以及白名单外历史，并把审计门禁收窄为禁止 UPDATE；业务层没有通用审计删除 API，只在任务聚合删除时按精确目标清理旧审计。该迁移、历史审计清理和已执行永久删除不可逆，downgrade 固定以 `55000` 拒绝并要求恢复升级前备份。

### 0039 Published Article Delete Missing Platform

版本文件 `0039_published_article_delete_missing_platform.py` 紧跟 `0038_published_article_delete`，不新增列或重写数据。归档状态检查扩展为 `archived_at IS NULL OR status IN ('OPEN', 'COMPLETED', 'CANCELLED')`，使成果删除后因原平台已删除而取消的来源任务继续保留正交归档标记；`OPEN` 仍必须绑定实时平台。若已经存在归档 `CANCELLED` 任务，downgrade 以 PostgreSQL `55000` 拒绝，否则恢复 `0038` 的归档状态集合。

### 0040 Content Draft Management

版本文件 `0040_content_draft_management.py` 紧跟 `0039_article_delete_platform`，不新增业务表或列。当前 `OPEN` 任务指向的人工 `DRAFT` 在没有审核记录时可按 revision 原地保存标题、摘要、Markdown、标签、内容哈希和质量问题；版本号、事实、来源、lineage、变更说明和创建信息保持不变。AI 草稿、历史版本、退回版本以及已进入审核的内容继续不可变。

人工 `DRAFT | ABANDONED` 只有在没有审核、子版本、生成来源/结果、发布工作、发布事件或核验引用时才可彻底删除。当前草稿删除前把任务指针恢复到直接父版本或置空；历史草稿不改变指针。应用层在持锁状态返回结构化引用，事务再设置精确 `partsignal.content_version_delete_id`；数据库 DELETE 守卫与现有 `RESTRICT` 外键负责最终竞态保护。AI 草稿不进入该删除窗口。

删除审计 `content_version.deleted` 只保存任务 UUID 和内容版本号，不保存标题、摘要、正文、标签、Prompt、模型响应或变更说明。草稿旧值与已删除正文无法确定性重建，因此 downgrade 以 PostgreSQL `55000` 拒绝，只允许前滚修复或恢复升级前备份。

### 0041 Content Task List

版本文件 `0041_content_task_list.py` 紧跟 `0040_content_draft_management`。`content_tasks` 新增非空 `updated_at`，历史值确定性回填为 `created_at`；任务自身变更由 ORM 更新该时间，当前人工草稿原地保存显式触碰任务时间。`(archived_at, updated_at, id)` 索引支持默认归档范围与稳定排序。

内容任务列表的“最近更新”不保存第二套业务状态。读投影取任务时间、当前主线版本创建时间、生成作业活动时间、审核记录时间和发布工作时间的最大值，并按 `updated_at DESC, id DESC` 排序。当前内容摘要只能通过 `content_tasks.current_content_version_id` 读取，禁止选择版本号最大值代替主线。

### 0042 Content Version Detail

版本文件 `0042_content_version_detail.py` 紧跟 `0041_content_task_list`。`content_versions` 新增可空 `updated_at`：升级不回填旧行，只为后续 INSERT 设置数据库默认值；ORM 只在既有合同允许的人工草稿保存、审核状态/revision 转换和旧批准版本转 `SUPERSEDED` 时写入真实更新时间。`null` 表示该历史版本没有可证明的更新时间，不得使用迁移时间、任务时间或审核时间补造。

### 0043 GEO Insight Platform Identity

版本文件 `0043_geo_insight_platform_identity.py` 紧跟 `0042_content_version_detail`。`publication_works.platform_profile_id_snapshot UUID NULL` 无外键地冻结创建时的平台 UUID，与既有 `platform_profile_name_snapshot` 共同成为 Published Article、GEO Detail 和 GEO Insights 的历史平台身份 owner；实时 `platform_profile_id` 仍保持 `SET NULL` 删除语义。升级只从尚存在的实时 UUID 确定性回填；任一 Published Article 无法回填时以 PostgreSQL `55000` 原子中止，不按名称、审计或随机值猜测身份。新发布工作必须同时写入与实时平台一致的 snapshot，后续更新守卫禁止修改；列只为已经丢失实时身份的非 Published Article 历史保持可空。若任一发布工作已经失去实时平台 UUID，降级会丢失冻结身份，因此迁移以 `55000` 拒绝降级。

Content Version Detail 是一次 `REPEATABLE READ` 只读投影。它只读取目标版本、任务当前指针、Fact Version identity、创建者、目标祖先链上的生成/自然化 Prompt 与 model snapshot，以及按既有顺序累计的审核记录；不返回完整 Task、Fact Markdown、Diff、无关 GenerationJob、版本列表或动作投影。`review_result` 必须取目标版本自身最后一条真实审核记录，`is_current` 只比较 `content_tasks.current_content_version_id`，两者都不得从版本状态推导。

普通任务删除在行锁内校验调用方必填的 `expected_revision`，不匹配返回 `REVISION_CONFLICT`；删除范围与阻断条件仍由服务端在同一事务最终复核。

### 0044 GEO Catalog

版本文件 `0044_geo_catalog.py` 紧跟 `0043_geo_platform_identity`。新增 `geo_subjects`、`geo_subject_aliases`、`geo_subject_domains`，落实本合同的命名 CHECK/FK/UNIQUE/index 和 Subject 不可改身份触发器。活动 OWN_PRODUCT 的 partial unique 允许多个停用历史身份，并对创建及重新启用提供同一数据库仲裁；父级 MATCH FULL 复合 RESTRICT FK 校验真实品牌类型；子字典只在删除 Subject 时 CASCADE。无历史回填、服务写入、revision 自动递增或 HTTP 错误映射；未来 Application Service 继续拥有聚合事务、锁序、CAS 与成功审计。降级明确失败，不能用删除 Catalog 数据作为恢复方式。

### Content Task Detail 读取快照

`GET /api/v1/content-tasks/{content_task_id}/detail` 不新增表或持久化第二套状态。请求在 PostgreSQL `REPEATABLE READ` 中读取任务及其锁定 Product、FactVersion、Platform identity，并以固定次数批量查询当前内容、生成、审核、发布、真实来源与 Activity；查询次数不得随相关记录数量线性增长。

当前内容只能由 `content_tasks.current_content_version_id` 解析，禁止以最大 `content_versions.version` 代替。latest generation 按 `created_at DESC, id DESC` 确定；review 只属于当前主线内容；source 只投影真实 `query_topic_id`、`content_task_geo_sources` 或 `source_published_content_issue_id` 关系。Activity 由任务、生成、内容版本、审核和发布追加记录联合，按 `timestamp DESC, kind ASC, source_id DESC` 稳定排序并截取最近 10 项，浏览器不得再次合并或排序。

## State Machines

```text
FactVersion: PENDING_REVIEW -> APPROVED -> RETIRED
                            \-> CHANGES_REQUESTED

ContentVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> SUPERSEDED
                    \-> ABANDONED    \-> CHANGES_REQUESTED -> ABANDONED

ContentTask: OPEN -> CANCELLED
             OPEN -- first successful PublicationVerification --> COMPLETED
             COMPLETED -- permanent article delete --> OPEN | CANCELLED
             OPEN | COMPLETED | CANCELLED -- archive/restore --> same status

GenerationJob: PENDING -> RUNNING -> SUCCEEDED | FAILED
               PENDING -> FAILED (pre-execution snapshot/runtime gate rejection)
               (applies to both GENERATE and HUMANIZE)

PublicationWork:
PREPARING -> PLATFORM_REVIEW -> AWAITING_VERIFICATION
PREPARING -> AWAITING_VERIFICATION
AWAITING_VERIFICATION -> ACTION_REQUIRED -> AWAITING_VERIFICATION
AWAITING_VERIFICATION | ACTION_REQUIRED -> COMPLETED
PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED -> CLOSED

PublishedContentIssue: OPEN -> RESOLVED

PlatformProfile: ENABLED <-> DISABLED

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED | DELETING
            VERIFIED | FAILED | ABORTED -> DELETING -> DELETED
```

State changes not shown above are invalid. A rejected immutable fact or content version is a terminal historical conclusion; correction creates a new immutable version from the editable fact workspace or current content lineage. Only the current unreviewed `HUMAN DRAFT` may be saved in place; every frozen payload remains immutable.

## Required Constraints

- `products.part_number`、`products.brand` 与 `products.category` 的保存值均须去除两侧空白、非空且不超过 160 字符；产品身份由规范化后的品牌与型号组合唯一确定。
- 非空 `content_tasks.idempotency_key` 全局唯一；普通任务创建先按命名请求键获取 PostgreSQL 事务 advisory lock，再判断重放或执行当前业务校验。三字段业务输入本身不唯一。
- Version numbers are unique within their owner: product fact or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- A product has one Markdown fact workspace protected by `facts_revision`; new fact versions freeze its non-blank Markdown and classification.
- 每个产品至多一个 `PENDING_REVIEW` 事实版本；工作区提交直接创建该不可变版本，不存在版本级草稿或原版本重提。
- Approved fact versions permit status-only transition to `RETIRED`; all other columns are immutable.
- 内容版本只允许有效状态转换。当前、未审核的人工 `DRAFT` 可按 revision 保存可编辑载荷；AI 草稿以及提交审核后的全部版本不可原地修改。
- `content_tasks.current_content_version_id` 是内容主线唯一权威，必须为空或指向同任务版本；审核、修订、自然化、待发布资格和发布版本切换只接受当前版本。
- 每个任务至多一个 `PENDING_REVIEW` 内容版本；放弃当前草稿或退回版本后，指针恢复到该任务最近批准版本，没有批准版本时置空。
- 无直接引用的人工 `DRAFT | ABANDONED` 可通过精确单版本删除事务清理；AI 草稿、审核历史和任何生成/发布下游引用均阻断删除。
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- 用户物理删除仅限管理员操作停用账号；会话级联清理，审计操作者按 `0027` 受约束置空，任何业务历史引用都阻断删除。用户实时 `admin_total` 统计全部 `ADMIN`，包括停用账号。
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted. Platform types do not own Prompts after `0014`.
- A concrete platform binds zero or one current Prompt, while one Prompt may be shared by multiple platforms. Missing binding keeps the platform selectable for manual content tasks but makes system AI generation unavailable.
- Platform Prompt update and deletion require optimistic revision matching against the locked template row. Prompt deletion atomically unbinds every current platform and increments each platform revision; platform deletion never deletes the template.
- A concrete platform's `is_active` state is independent from configuration completeness. A disabled platform remains manageable but cannot be used to create a content task, repair task, platform account, or publication work; disabling never mutates existing accounts, configuration, or history.
- Platform completeness, account counts, and task-reference counts are real-time read projections. Completeness is true when the current platform Prompt exists; a task reference is counted once through `content_tasks.platform_profile_id`.
- A concrete platform stores at most one Logo source. New writes only accept a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` file; `logo_external_url` remains a nullable read-only legacy field until a later migration, and `website_url` remains an explicit nullable URI.
- File cleanup uses the three actual current-head file foreign keys as its deletion authority. Unconfirmed files retain their configured grace period, detached previously used files retain seven days, and object deletion remains retryable through `DELETING` before a `DELETED` tombstone is recorded.
- Product, fact version, platform profile, platform account, platform type, and user physical deletion is admin-only. Services lock targets and return structured `409` conflicts; the only configured cascades are the approved Prompt auto-unbind, platform-owned account cleanup, and task-aggregate deletion paths.
- A product can be physically deleted only when no `FactVersion`, `ContentTask`, or `GeoObservation` directly references it. A platform profile must first be disabled and requires no `OPEN` content task or nonterminal `PublicationWork`; deleting it never deletes a task. A platform account requires no nonterminal `PublicationWork`; a platform type requires no platform profiles.
- 未归档 `OPEN | CANCELLED` 内容任务可连同其任务聚合删除，但运行中的生成作业、成功文章或 GEO 文章关系阻断普通删除。`COMPLETED` 任务只能先归档；管理员随后可按固定确认文本永久删除整个内部任务聚合，共享 GEO 与文件保留。
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive snapshot. Original-generation v2/v3 snapshots may retry from their frozen input; legacy v1 snapshots are read-only.
- Automatic recovery dispatches only overdue `PENDING` jobs. Dispatch counters, queue ages, failure codes, and provider duration diagnostics must never contain prompts, response bodies, credentials, or sensitive Headers.
- Third-party AI egress requires the bound fact version to be explicitly `PUBLIC`; missing, legacy-empty, `INTERNAL`, or `RESTRICTED` fact data is a hard denial.
- Original generation revalidates the user-confirmed current Prompt UUID and revision, then sends exactly one system message equal to that Prompt and one user message equal to the frozen fact Markdown; no prefix, task field, metadata, JSON wrapper, repair, model switch, or fallback is allowed.
- A manual first draft creates a `HUMAN DRAFT` content version with null generation and parent lineage, then uses the same review and publication gates as AI content.
- A publication work can reference only an approved content version whose fact is not retired at creation time.
- A publication account profile must equal the content task's locked platform profile; both the application service and PostgreSQL enforce it.
- A publication work freezes the selected platform in `platform_profile_id_snapshot` without a foreign key. Published Article and GEO history read this UUID plus `platform_profile_name_snapshot`; deleting the live platform may null only the live foreign key and must not alter either snapshot.
- A concrete platform may own multiple publication accounts, but their internal identifiers are unique by `lower(btrim(account_identifier))`; disabled accounts retain identity and historical references but are excluded from new publication candidates.
- A publication work selects exactly one account. One content task has at most one work, and one `platform_profile_id + content_hash` has at most one non-closed work.
- Work idempotency、ContentTask identity与active platform/hash的数据库最终权威分别是`uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id`与`uq_publication_works_active_platform_hash`；仅`23505 + exact diag.constraint_name`可进入局部恢复，且任一获准约束都必须先按request key保持canonical replay/`IDEMPOTENCY_CONFLICT`优先级，再处理`PUBLICATION_IDENTITY_CONFLICT`。
- 非终态发布工作仅可切换到同任务、同平台的当前批准版本；切换事件记录前后版本，每次核验记录当时版本，成功成果永久读取成功核验快照。
- Result registration requires a valid HTTP(S) URL matching the configured platform domain and may append only verified `OPERATION_SCREENSHOT` evidence. Result fields, evidence, work event and audit commit or fail together.
- A failed verification appends an immutable snapshot and leaves the work pending in `ACTION_REQUIRED`; it never creates an article or completes/cancels the task.
- Task completion has no public manual command. The first successful verification atomically creates the read-only `PublishedArticle` and completes the open source task; completed tasks never revert.
- A nonterminal work may only end without success through explicit close with a structured reason and non-blank comment; close atomically cancels the source task.
- Publication works, events, verifications, articles and issues cannot be individually deleted through business APIs. Published results remain immutable in place; the only aggregate exception is administrator permanent deletion of their archived source task.
- Repair-task creation and issue resolution are separate explicit commands. A repaired issue remains `OPEN` until explicitly resolved, and resolving it does not complete the repair task.
- Fact and content review records are append-only, and every request-changes command requires a non-blank comment.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Manual GEO observations cover every currently eligible `PublishedArticle` for one product and store one independent `discovered`, `mentioned`, and optional `accuracy` result per article. Articles with an open issue or a historical `RETIRED` outcome are ineligible. Evidence screenshots are optional; corrections aggregate ancestor evidence for reads without duplicating file links. Administrators may delete a complete manual correction chain directly; archived-task permanent deletion removes only chains that lose every article relation.
- Historical GEO publication associations with null insight facts remain explicitly incomplete and never enter manual insight denominators.
- GEO 优化任务必须与一条不可变 `content_task_geo_sources` 来源快照同事务创建；服务端重新计算异常，拒绝客户端伪造、过期或数据不足的依据。
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents. Runtime audit accepts only retained successful actions; task aggregate deletion may remove old target logs and preserve one minimal deletion tombstone.

## CONTENT_GENERATOR 业务生成运行模式

`CONTENT_GENERATOR` 为各进程启动时的配置快照，保留 `deterministic` 和 `openai-compatible`。`deterministic` 只表示关闭正式业务生成，不能生成固定成功内容；GENERATE、HUMANIZE 与 RETRY 命令在任何 Job 写入、提交和 Redis 投递前返回 `409 AI_GENERATION_DISABLED`，包括同 key 的幂等 replay。管理模型测试/发现属于独立操作，仍遵守各自权限、revision 和网络门禁。

正式 Worker 以 Job 行锁吸收重复投递；deterministic 下所有 PENDING 在执行前进入 `FAILED/AI_GENERATION_DISABLED`，保留原 attempt/started 字段，设置 finished_at、清 lease，不创建 ContentVersion、不写供应商成功 metadata 或审计。门禁先于已有 source_job_id 内容回收快速路径；既存内容历史不修改。openai-compatible 的既有内容回收语义保持不变。RUNNING 重投始终直接返回，配置变更不能撤回已发请求；原执行继续按 lease 与迟到结果合同收尾。配置文件变化不代表运行进程已重载，API/Worker/Scheduler 必须加载同一受控模式后才可声称新模式生效。
