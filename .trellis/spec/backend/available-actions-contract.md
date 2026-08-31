# 资源流程与动作投影合同

## 1. 适用范围 / 触发条件

当资源响应需要表达当前业务阶段、唯一主任务，或当前操作者可尝试的编辑、状态、危险删除、凭据、保存或子资源命令时，使用本合同。它防止前端按角色、状态或分页集合重建业务流程，也防止列表、详情和命令响应产生不同投影。

集合级创建、导航、查看、复制、筛选、导出、打印、认证自服务和文件传输内部动作不属于资源动作投影。

## 2. 签名

每个响应 Schema 使用自身的 typed token，并把 `workflow_stage`、`primary_task` 和 `available_actions` 中适用的字段设为必填；不得建立跨领域通用 enum，也不得给业务投影设置隐式默认值。

```python
class GenerationJobOut(ContractModel):
    workflow_stage: Literal["IN_PROGRESS", "SUCCEEDED", "RETRYABLE_FAILURE", "HISTORICAL_FAILURE"]
    primary_task: Literal["VIEW_EXECUTION_PROGRESS", "VIEW_GENERATED_CONTENT", "HANDLE_FAILURE", "VIEW_FAILURE"]
    available_actions: list[Literal["RETRY"]]

def users_out(db: Session, users: list[User], *, actor: User) -> list[UserOut]: ...
def content_versions_out(db: Session, contents: list[ContentVersion]) -> list[ContentVersionOut]: ...

class DeletionBlocker(ContractModel):
    type: DeletionBlockerType
    count: int

class DeletionProjection(ContractModel):
    blockers: list[DeletionBlocker]
```

需要操作者或数据库事实的投影器必须显式接收这些输入。列表投影器负责批量读取资格事实；单项投影器可以复用列表投影器。

## 3. 合同

- PostgreSQL 当前资源、引用关系和当前操作者是动作资格的权威输入。
- `workflow_stage` 是领域内可解释的当前阶段；`primary_task` 是该资源当前唯一高频主入口。两者都是读模型投影，不是写入授权凭证。
- `available_actions` 表示响应生成时可尝试的命令，不是授权凭证；命令入口必须重新执行服务端校验并保留既有错误合同。
- 同一资源的列表、详情和返回资源的 mutation 响应使用同一领域资格规则。
- OpenAPI 中上述适用字段必须为 required；`frontend/src/shared/api/generated/schema.d.ts` 只能从合同生成。
- 前端主入口只按资源自己的 `primary_task` 穷尽映射，低频命令只按 `available_actions.includes("TOKEN")` 渲染或启用；不得用 `status`、`is_active`、账号类型、权限 Hook 或关联集合推断单个资源的流程。
- 认证自服务复用 `UserOut` 时显式返回 `available_actions: []`；管理接口使用 actor-aware 投影，不另建平行 DTO。
- mutation 成功后使用响应或失效既有 query 取得重新投影的动作；竞态拒绝后刷新资源，不加兼容分支。
- presenter 和 Pydantic serializer 内不得逐行查询数据库。涉及引用门禁的集合先批量取得 id 集合，再在内存投影。
- 产品、事实版本、GEO 问题、平台类型、具体平台、发布账号、内容任务、发布成果和停用用户的资源 Schema 必须包含 required nullable `deletion`。无删除管理上下文时为 `null`；普通删除允许时为 `{ "blockers": [] }` 并同时包含 `DELETE`；发布成果使用 `PERMANENT_DELETE`；存在当前命令的真实阻断时返回非空数组且不包含对应删除动作。
- `deletion.blockers[*]` 只统计服务端权威的当前阻断类型和正整数数量。平台只统计 `OPEN` 任务和非终态发布工作，账号只统计非终态发布工作；平台账号总数是删除影响而不是阻断。写命令锁定目标后必须重新统计，不能把读投影当授权。
- GEO 问题只向 `ADMIN` 投影删除管理上下文；内容任务、GEO 优化来源和 GEO 观测是三类独立直接阻断。删除命令必须校验当前 revision，并在目标行锁内复核相同引用，数据库 `ON DELETE RESTRICT` 继续作为最终门禁。
- GEO 问题列表的三类业务引用摘要对所有可读取该列表的角色可见，并与 ADMIN-only `deletion.blockers` 由同一批量引用查询形成；摘要只用于展示和 canonical resolve links，前端不得据此推导 `USE_FOR_OBSERVATION`、`UPDATE` 或 `DELETE`。集合级创建仍是页面动作，不新增 `CREATE` 资源 token；更新和删除命令必须提交 `expected_revision`，409 只允许显式刷新且不得自动重放。
- Platform Type 只向 `ADMIN` 提供列表与写接口。每行 `primary_task=EDIT_CATEGORY` 只表达当前任务语义；Settings Table 仍把 UPDATE、DELETE 和非空 `PLATFORM_PROFILE` blocker 全部映射到 overflow。`platform_count` 与 blocker 由同一批量直接引用查询形成，包含 Enabled/Disabled PlatformProfile；前端不得从 blocker 或 Platform List 反推数量。DELETE 必须提交 `expected_revision`，锁行后先拒绝 stale revision，再复核引用。
- 内容任务归档使用独立 `archived_at`：未归档完成任务返回 `ARCHIVE`，已归档任务返回 `RESTORE`，且仅管理员同时获得 `PERMANENT_DELETE`。已归档任务不再返回编辑、生成、取消或普通 `DELETE`。
- 发布成果只向管理员投影删除管理上下文；没有 GEO 观测/引用或 GEO 优化来源时返回 `PERMANENT_DELETE`，否则按去重观测数和直接优化来源数投影阻断。写命令复用同 ID 发布工作的 revision，并在锁内复核。

## 4. 校验与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| 当前业务事实不满足动作资格 | 响应不包含该 token，前端不呈现或禁用入口 |
| 当前业务阶段改变 | 服务端返回该 Schema 内新的精确 `workflow_stage` 和 `primary_task`；前端不补旧主入口 |
| 客户端持有过期 token 后提交 | 服务端重新校验并返回既有 `403`/`409`/领域错误；不得按旧投影放行 |
| 响应构造遗漏 `available_actions` | Pydantic、OpenAPI 合同检查或前端类型检查失败；不得静默补 `[]` |
| 调用方没有资源动作上下文 | 调用方必须显式给出合法投影；仅已定义的认证自服务边界可显式给 `[]` |
| 列表动作依赖历史引用 | 使用固定次数批量查询；禁止随行数增长逐行查询 |
| token 不属于该资源的 typed union | 后端类型/Schema 或生成前端类型检查失败；不得增加字符串别名 |
| 调用方没有删除管理上下文 | `deletion=null`；不得伪造空阻断数组或 `DELETE` |
| 具有删除资格且没有直接引用 | `deletion.blockers=[]`，并包含 `DELETE` |
| 存在一个或多个当前阻断 | 返回类型与数量，不包含 `DELETE`；删除命令返回结构化 `409` |
| 平台仅有终态任务/工作或账号 | 停用后可返回 `DELETE`；确认层展示账号清理影响，任务不会级联 |
| 任务 `COMPLETED` 且未归档 / 已归档管理员 | 返回 `ARCHIVE` / `RESTORE + PERMANENT_DELETE` |
| 读投影后新增引用 | 删除命令在锁内重新统计并拒绝；不得相信过期 `DELETE` token |

## 5. Good / Base / Bad

- Good：失败且父任务仍为开放态的生成作业返回 `workflow_stage=RETRYABLE_FAILURE`、`primary_task=HANDLE_FAILURE` 和 `RETRY`；前端先打开失败处理，用户确认后才执行重试。
- Base：旧快照失败作业返回 `HISTORICAL_FAILURE`、`VIEW_FAILURE` 和空动作数组；页面只读展示，也不从 `status === "FAILED"` 自行补回重试。
- Bad：前端使用 `isAdmin && row.status === "DISABLED"` 推导主任务或删除，或后端在逐行 presenter 中查询引用关系。
- Good：停用平台仅有终态发布历史和两个账号时返回空阻断与 `DELETE`；删除命令锁内复核活动业务，账号随平台清理，任务/工作通过快照保留。
- Base：具有管理上下文且没有引用的产品返回空阻断数组和 `DELETE`；认证自服务中的用户投影返回 `deletion=null`。
- Bad：只移除 `DELETE`、把阻断原因留给外键异常，或把历史行级联删除后再删除目标。

## 6. 必需测试

- 后端单元测试：对同一表面状态、不同关联事实覆盖一个允许和一个拒绝场景，并断言精确 `workflow_stage`、`primary_task` 和命令 token。
- 后端集成测试：断言列表、详情或 mutation 返回的 required 字段，并对相同事实调用命令验证最终守卫。
- 引用型列表：用查询计数证明增加资源行数不会线性增加动作资格查询。
- 前端测试：使用相同角色/状态、不同 `primary_task` 或 `available_actions` 的 fixture，分别断言主入口和具体命令只随各自投影变化。
- 合同验证：运行 `make contract-check`、后端 mypy 和前端 typecheck。
- 受约束删除投影至少覆盖 `null`、空阻断和非空阻断，并断言 `DELETE` 与阻断数组一致；任务另覆盖 `ARCHIVE`、`RESTORE`、管理员 `PERMANENT_DELETE`，集合投影用查询计数或固定次数 fake 证明无 N+1。
- 删除命令集成测试：覆盖读后新增引用竞态，断言目标与引用历史保持不变且返回结构化类型和数量。

## 7. Wrong vs Correct

### Wrong

```tsx
const primaryTask = row.status === 'FAILED' ? 'HANDLE_FAILURE' : 'VIEW_EXECUTION_PROGRESS';
```

这在前端复制了服务端的角色、状态和历史引用规则。

### Correct

```tsx
const primaryTask = row.primary_task;
const canRetry = row.available_actions.includes('RETRY');
```

服务端投影决定主入口与可尝试命令，命令处理器仍在写入时校验真实状态。

删除合同同理：错误做法是只返回 `available_actions=[]` 或依赖数据库外键文本；正确做法是同时返回 required nullable `deletion`，并在命令锁内复核同一组直接引用。

## 8. 场景：Query Topic V2 列表、引用与 revision 冲突

### 8.1 适用范围 / 触发条件

实现或修改 Query Topic 列表、创建、更新、删除、开始观测 handoff 或业务引用入口时适用。旧完整 options 与 V2 Table 是两个读取面，但写命令、动作资格、引用统计和 revision 仍只有一个服务端 owner。

### 8.2 签名

```text
GET    /api/v1/query-topics
GET    /api/v1/query-topics/list-items?q&sort&page&page_size
POST   /api/v1/query-topics
PATCH  /api/v1/query-topics/{query_topic_id}  QueryTopicUpdate.expected_revision
DELETE /api/v1/query-topics/{query_topic_id}?expected_revision=...
```

旧 GET 必须继续返回完整 `QueryTopicList`；`list-items` 返回 `QueryTopicListPage`，每项包含 `references`、`primary_task`、`available_actions`、`deletion` 和 `revision`。不得把旧 GET 改成默认分页，也不得增加 Query Topic Detail endpoint 补偿列表缺口。

### 8.3 合同

- `q/sort/page/page_size` 的搜索、稳定排序、count 和分页由服务端完成；浏览器不得对当前页二次筛排。
- Query Topic 服务对当前页 ID 一次批量统计 `CONTENT_TASK`、`GEO_OPTIMIZATION_SOURCE`、`GEO_OBSERVATION`；`references` 对所有读取角色可见，`deletion` 仍只向 `ADMIN` 投影。
- `USE_FOR_OBSERVATION` 是唯一主入口；前端只用响应 ID 形成 `/geo/observations/new?queryTopicId={id}`，不得根据 intent 或引用数推导资格。
- `canonical_question` 与 variants 的 trim、非空、trim 后精确去重和首次顺序由服务端请求 schema 权威执行；前端校验只提供即时反馈。
- PATCH/DELETE 必须提交 `expected_revision`。409 后保留本地编辑输入或删除目标，禁用旧 revision 再提交，只有显式 reload canonical 数据后才能再次确认。
- `QUERY_TOPIC_IN_USE` 必须返回最新引用类型和正整数数量；前端使用固定 canonical resolve links，不请求逐行引用详情。

### 8.4 校验与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| `q` 为空白、page 非正数或 page_size 不在 `10/20/50` | 422；不得静默改写 API 请求 |
| PATCH revision 过期 | `REVISION_CONFLICT` / 409；草稿保留，显式 reload 前禁止再次提交 |
| DELETE revision 过期 | `REVISION_CONFLICT` / 409；不删除、不自动重放 |
| DELETE 锁内发现任一直接引用 | `QUERY_TOPIC_IN_USE` / 409，返回全部非零类型与数量 |
| 非 ADMIN 读取列表 | `references` 完整，`deletion=null`，不含 `DELETE` |
| ADMIN 且三类引用均为零 | `deletion.blockers=[]` 且 `available_actions` 包含 `DELETE` |
| 合法但超出总页数 | 返回真实 `total` 与空 items；前端提供返回有效页的显式入口 |

### 8.5 Good / Base / Bad

- Good：canonical frontend 使用的 list-items 批量返回三类引用，ADMIN deletion 复用同一 counts map，命令再在锁内复核。
- Base：旧完整 GET 继续给 New Observation 和 Correction Workspace 提供全部 Topic options。
- Bad：浏览器逐行查询引用、从本地 count 推导 DELETE/UPDATE/开始观测，或 409 后自动重放 PATCH/DELETE。

### 8.6 必需测试

- OpenAPI/runtime contract：旧 `QueryTopicList` 保持完整，新 `QueryTopicListPage` 的 query、分页和引用字段精确生成到 canonical frontend types。
- PostgreSQL integration：覆盖 canonical/variant search、稳定 sort/page、三类引用、所有角色摘要、ADMIN deletion、固定查询次数、revision conflict 和审计。
- 目标列表 integration：Content Task 两类引用和 GEO Observation 引用 URL 精确映射服务端筛选。
- generated-type strict fixture：拒绝未声明 API，覆盖 URL 恢复、五列、handoff、create/edit/delete、409 不 replay、引用竞态、焦点和 375/768/1024/1440 根无溢出。

### 8.7 Wrong vs Correct

```tsx
// Wrong：客户端引用数不是动作资格。
const canDelete = topic.references.observation_count === 0;

// Correct：只消费服务端 token；命令仍会锁内复核。
const canDelete = topic.available_actions.includes('DELETE');
const handoff = topic.primary_task === 'USE_FOR_OBSERVATION'
  ? `/geo/observations/new?queryTopicId=${topic.id}`
  : undefined;
```

## 9. GEO Insights 的 actor-aware 命令 source

### 9.1 Scope / Trigger

实现或修改 `/api/v1/geo-insights` 的内容/覆盖动作投影、优化 Content Task 命令、历史平台身份或幂等处理时适用。该合同防止前端从指标推断资格，也防止读投影、最终复算与幂等 replay 使用不同 source/target。

### 9.2 Signatures

```text
GET  /api/v1/geo-insights?date_from&date_to&product_id&content_platform_id&geo_platform&published_article_id&query_topic_id
POST /api/v1/geo-insights/optimization-content-tasks
header: X-CSRF-Token, Idempotency-Key
body: GeoOptimizationContentTaskCreate(rule_code, date_from, date_to,
      published_article_id?, query_topic_id?, geo_platform?,
      product_id, platform_profile_id, fact_version_id)
DB: publication_works.platform_profile_id_snapshot UUID NULL, no foreign key
```

### 9.3 Contracts

- `GeoInsightContentPerformance` 与 `GeoInsightCoverageItem` 必须返回 required nullable `optimization_action`。它是命令 source，不是授权凭证；命令仍须在锁内按当前事实复算。
- Declining、Long Unmentioned、Occasional、Uncovered 只有 actor 为 `ADMIN/ENGINEER` 且该异常支持命令时返回 action，并同时令 `primary_task=CREATE_OPTIMIZATION_TASK`；其它行返回 `null` 与精确查看/补样本任务。
- action 只携带 rule、period 和互斥来源身份：内容规则只带 Article；Coverage 规则只带 Topic+GEO Platform。前端不得按数组、status、rate 或 Recommendation 重构。
- GET 使用一次 `REPEATABLE READ`；Published Article 的 Content Platform ID/name 读取 PublicationWork 冻结快照，不依赖可删除实时平台。
- 相同 key 必须先取得 `content-task-create:{key}` advisory transaction lock，再比较完整 target 与 immutable source；相同 payload 返回原任务，不同 payload 冲突。Coverage 复算必须包含所选 Product 与 Content Platform。
- replay miss 必须复用 Content Task 唯一的 `PlatformProfile → Product → FactVersion` 行锁 owner，锁查询强制刷新 identity map；取得 Product 锁后才可调用 `get_geo_insights`，并持锁到 ContentTask、`ContentTaskGeoSource` 与 typed basis 一次提交或回滚。人工 GEO 观测变更复用同一 Product 串行化点；不得先复算后加锁、单独增加 Product-first 锁协议或用提高 endpoint 隔离级别代替正确锁时点。

### 9.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 内容 action 缺 Article 或携带 Topic/平台 | response schema 或请求 schema 拒绝 |
| Coverage action 缺 Topic/平台或携带 Article | response schema 或请求 schema 拒绝 |
| actor 不是 ADMIN/ENGINEER | action 为 `null`，保留查看/补样本任务 |
| 读后异常、Article 或 Coverage 变化 | `409 GEO_INSIGHT_STALE`，不创建、不自动 replay |
| 并发观测更正在 Product 锁内改变异常 | 优化命令先等待；锁后按已提交链尾复算，异常消失则 `409 GEO_INSIGHT_STALE`，task/source/audit 零新增 |
| 并发停用 Platform/Product 或退役 FactVersion | 等待对应行锁并强制刷新，按既有资源错误失败，task/source/audit 零新增 |
| 同 key、完整 source+target 相同 | 返回原 Content Task |
| 同 key、任一 source/target 不同 | `409 IDEMPOTENCY_CONFLICT` |
| PublishedArticle 无法回填平台 UUID | 0043 upgrade 以 PostgreSQL `55000` 原子失败 |
| snapshot 已成为唯一身份时 downgrade | 以 PostgreSQL `55000` 拒绝降级 |

### 9.5 Good / Base / Bad Cases

- Good：ADMIN 读取 Declining row 得到可直接合并三项 target 的 action；命令先按统一锁序锁定目标，再按同一周期、Article、Product/Platform 复算并原子创建任务与 GEO source。
- Base：Viewer 读取相同行只得到 `VIEW_CONTENT_PERFORMANCE`；Coverage 样本不足只得到 `ADD_OBSERVATION`。
- Bad：前端按 `status === "UNCOVERED"` 构造 rule，命令只比较 GEO source、不比较 Product/Platform/Fact，或在默认 `READ COMMITTED` 下先复算 basis、后等待 Product 锁。

### 9.6 Tests Required

- Contract/unit：required nullable action、primary/action 一致性、互斥来源、401/403/409/422。
- PostgreSQL integration：repeatable-read、平台删除后 frozen UUID 精确筛选、Coverage target 复算、同 key 两线程唯一和异 payload 冲突；用两个真实 Session 与 `pg_blocking_pids` 确认优化事务正在等待指定 Product/目标资源锁后才释放变更事务，不得用 sleep 猜时序，并断言 stale/invalid/source 写失败后 task、source、audit 零新增。
- Migration：backfill、insert/update guard、删除实时平台后保留、预检回滚与 downgrade 拒绝。
- Frontend generated-type fixture：只对 non-null action 开 Dialog，精确 body/header、409 不 replay、响应 ID 导航。

### 9.7 Wrong vs Correct

```tsx
// Wrong：浏览器复制异常规则。
const canOptimize = row.status === 'UNCOVERED' && user.account_type === 'ADMIN';

// Correct：只消费服务端 source；POST 仍会最终复算。
const action = row.optimization_action;
const canOptimize = row.primary_task === 'CREATE_OPTIMIZATION_TASK' && action !== null;
```

```python
# Wrong：READ COMMITTED 下先复算、后加锁，会冻结已过期 basis。
insights = get_geo_insights(db, filters=filters, actor=actor)
profile = lock_content_task_creation_resources(db, target)

# Correct：统一锁 owner 先取得 Platform → Product → Fact，再在 Product 锁内复算和提交。
profile = lock_content_task_creation_resources(db, target)
insights = get_geo_insights(db, filters=filters, actor=actor)
task = add_locked_content_task(db=db, payload=target, profile=profile, actor=actor, ...)
db.add(ContentTaskGeoSource(content_task_id=task.id, basis_snapshot=...))
db.commit()
```

## 10. Platform Account actor projection 与 revision 删除

### 10.1 Scope / Trigger

实现或修改 Platform Account list projection、创建/编辑/启停/删除、账号标识唯一性或 Workspace Accounts 消费时适用。该合同防止浏览器复制角色规则，也防止 stale DELETE 越过实时 PublicationWork blocker。

### 10.2 Signatures

```text
GET    /api/v1/platform-accounts?platform_profile_id=<uuid>
POST   /api/v1/platform-accounts
PATCH  /api/v1/platform-accounts/{id}  PlatformAccountUpdate.expected_revision
POST   /api/v1/platform-accounts/{id}/enable|disable  RevisionRequest.expected_revision
DELETE /api/v1/platform-accounts/{id}?expected_revision=<required int >= 0>
DB     uq_platform_accounts_profile_identifier_normalized
```

### 10.3 Contracts

- 集合创建是页面动作，不新增 `CREATE` row token。ADMIN/ENGINEER 均可尝试创建；POST 锁定 Platform 后最终拒绝停用平台。
- 两类角色均获得 UPDATE 与 ENABLE/DISABLE；仅 ADMIN 获得 `deletion` 与 DELETE。平台停用时 row 使用 `PLATFORM_DISABLED/HANDLE_PLATFORM`，既有账号编辑与启停仍按 actor 投影。
- DELETE 按 Platform → Account 固定顺序持锁，先比较 revision，再统计非终态 PublicationWork；PublicationWork 创建使用同一锁序。终态历史只保留账号 snapshot，不阻断删除。
- normalized identifier 由 `lower(btrim(account_identifier))` 数据库约束权威保证；预检与约束竞态共用 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`，`details.errors[].loc=["body","account_identifier"]`。

### 10.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| ENGINEER 删除 | `403`，不进入删除命令 |
| 平台停用时创建 | `409 PLATFORM_DISABLED` |
| normalized identifier 重复 | `409 PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`，定位 `body.account_identifier` |
| DELETE revision 过期 | `409 REVISION_CONFLICT`，不查询结果冒充成功、不删除 |
| 存在非终态 PublicationWork | `409 PLATFORM_ACCOUNT_IN_USE` 与 `PUBLICATION_WORK` count |
| 只有终态 PublicationWork | 删除成功，历史 snapshot 保留 |

### 10.5 Good / Base / Bad Cases

- Good：ADMIN 使用 row revision 删除无非终态工作的账号；服务锁内复核后返回 204。
- Base：ENGINEER 读取相同行并获得编辑/启停动作，但 `deletion=null` 且无 DELETE。
- Bad：浏览器按 `isAdmin` 拼动作、先 GET 最新 revision 再 DELETE、把 revision 设为 optional，或解析数据库英文错误文本。

### 10.6 Tests Required

- Contract/runtime/generated：DELETE query required、minimum 0，canonical frontend schema 同步。
- PostgreSQL integration：ADMIN/ENGINEER CRUD、停用平台 create、normalized precheck/constraint、stale delete、live blocker、terminal history、固定 query count。
- Frontend model/component：token 穷尽 mapping、字段错误、409 保留与显式 reload、精确 cache invalidation、焦点恢复。
- Production artifact：创建/编辑/启停/删除、375px actions、desktop table、runtime/console audit。

### 10.7 Wrong vs Correct

```ts
// Wrong：GET 最新值会把用户确认偷换成另一个 revision。
await refetchAccount(account.id);
await deleteAccount(account.id, latest.revision);

// Correct：提交用户看到并确认的 canonical row revision；冲突后显式 reload。
await deleteAccount(account.id, account.revision);
```

## 11. User 管理 revision、bulk 与安全投影

### 11.1 Scope / Trigger

修改 UserList、管理员用户命令、reset/delete revision、bulk partial 或用户动作投影时适用。

### 11.2 Signatures

```text
GET    /api/v1/users?q&account_type&status&page&page_size -> UserList
PATCH  /api/v1/users/{user_id} UserUpdate(expected_revision + 完整字段) -> User
DELETE /api/v1/users/{user_id}?expected_revision=... -> 204
POST   /api/v1/users/{user_id}/reset-password ResetPasswordRequest(temporary_password, expected_revision) -> User
POST   /api/v1/users/bulk-status UserBulkStatusRequest(items[{user_id, expected_revision}], status) -> UserBulkStatusResult
```

### 11.3 Contracts

- UserList 是页面唯一 read model；summary 是不受筛选影响的全局计数，动作投影按当前 actor 生成。不得逐行查询或让前端按角色/状态补动作。
- UPDATE 与 reset body、DELETE query 都必须携带当前 revision；服务端在既有锁内先拒绝 stale，再执行状态、引用、last-admin、session 与 audit 规则。
- reset 成功返回安全 User projection，只保存密码哈希并撤销目标用户会话；stale reset 不改 hash/revision/session/audit。
- bulk 只接受唯一 user_id，逐项锁定并要求真实状态变化；预期失败 code 固定为 `NOT_FOUND/REVISION_CONFLICT/LAST_ADMIN_REQUIRED/INVALID_STATE_TRANSITION`，意外错误回滚整个事务。
- ADMIN 是所有用户管理 endpoint 的最终权限权威；ENGINEER 对 list/create/bulk/export/update/delete/reset 均为 403。

### 11.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| UPDATE/reset/DELETE revision 过期 | `409 REVISION_CONFLICT`，无状态、会话或成功 audit 副作用 |
| reset 目标是当前 actor | `422 VALIDATION_ERROR`，必须走自助改密 |
| bulk 项已是目标状态 | HTTP 200 partial 中返回 `INVALID_STATE_TRANSITION`，不增加 revision/audit |
| bulk 项过期/不存在/违反 last-admin | HTTP 200 partial 中返回对应固定 code |
| bulk 出现未登记错误 | 回滚整个事务，不伪造 partial success |
| ENGINEER 调用任一管理接口 | `403`，不进入业务命令 |

### 11.5 Good / Base / Bad Cases

- Good：前端提交用户确认时观测的 row revision；409 保留上下文并等待显式 reload。
- Base：UserList 一次返回当前页、全局 summary、动作与 deletion projection，页面不请求 User Detail/Audit。
- Bad：提交前自动拉最新 revision、按 `is_active/account_type` 补动作、把 bulk 同态项当成成功。

### 11.6 Tests Required

- Contract/runtime/generated：delete/reset required revision、reset 200 User、bulk code enum。
- PostgreSQL integration：stale 无副作用、reset session revoke/safe response、自操作与 last-admin、mixed partial 顺序、全 endpoint 403、空/稀疏/密集固定查询次数。
- Frontend model/component：action token 穷尽映射、selection revision 漂移、409 不 replay、顶层 bulk 失败保留和密码缓存清理。
- Production artifact：canonical URL、所有命令 payload、partial feedback、ADMIN 边界、四档响应式、键盘/焦点及未声明 API 失败。

### 11.7 Wrong vs Correct

```ts
// Wrong：用新拉取的 revision 自动重放用户已确认的命令。
await refetchUsers();
await resetPassword(user.id, password, latest.revision);

// Correct：提交当前投影 revision，冲突后由用户显式 reload。
await resetPassword(user.id, password, user.revision);
```
