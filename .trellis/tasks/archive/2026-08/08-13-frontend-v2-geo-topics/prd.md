# Frontend V2 GEO Topics

## 目标

在 Frontend V2 交付 canonical `/geo/topics` 列表与短表单管理闭环，使用户能够浏览 Query Topic、查看服务端形成的业务引用、按服务端动作创建/编辑/删除，并把服务端授予的“开始观测”动作明确交接到 `/geo/observations/new?queryTopicId={id}`。

本 Task 只解决 Query Topic 列表与其直接交接。现有完整 Query Topic 列表仍服务于 V1 和 New Observation 选项，不改变其全量语义。

## 审计确认的现状

- `GET /api/v1/query-topics` 无搜索、排序、分页和 `total/page/page_size`，不能满足 V2 Table 的服务端列表要求。
- `QueryTopic.deletion` 只向 `ADMIN` 暴露三类 blocker counts；普通角色看不到业务引用，不能据此绘制所有角色可见的“业务引用”列。
- 后端已有 `_query_topic_reference_counts`，一次批量统计 Content Task、GEO Optimization Source、GEO Observation 三类直接引用；无需数据库迁移或浏览器逐行补请求。
- `primary_task=USE_FOR_OBSERVATION` 已是服务端资格；现有 Query Topic ID 足以形成固定 canonical handoff，不需要把 URL 存入业务 DTO。
- 当前 `/geo/observations/new` 实现尚未读取 `queryTopicId`，本 Task 必须补齐最小 handoff，不能把前置描述当作已实现事实。
- `canonical_question` 只在 service 写入时 `strip`；`variants` 仅做原字符串精确去重，当前允许空白值和 trim 后重复。稳定顺序来自请求数组与 PostgreSQL ARRAY，尚无统一归一化 owner。
- PATCH 已使用 `expected_revision`，DELETE 已使用 query `expected_revision`；两者均返回显式 409，适合保留输入并由用户显式 reload。
- DELETE 已写 `query_topic.deleted` 审计；CREATE/UPDATE 尚无审计。当前账号类型只有 ADMIN/ENGINEER，两者均可创建和更新，因此无需新增集合级 CREATE token 或调整 UPDATE 投影。

## 范围

### 包含

1. 注册 `/geo/topics` canonical route、GEO 导航入口和 Breadcrumb，支持 direct URL、refresh、Back、Forward。
2. 新增 Query Topic V2 紧凑列表 read model，完成服务端搜索、排序、分页、所有角色可见的业务引用摘要和 actor-aware actions。
3. 固定五列：标准问题、意图、紧凑变体、业务引用、操作；变体显示前 1～2 个及 `+N`。
4. 每行最多一个 Primary Action“开始观测”，只消费 `primary_task`，进入 `/geo/observations/new?queryTopicId={id}`。
5. 补齐 New Observation 对 `queryTopicId` 的严格 URL handoff；ID 不存在时明确报错，不猜测或替换 Topic。
6. 使用现有 Dialog、Form Kit、React Hook Form 与 Zod 完成短创建/编辑表单；编辑发送 `expected_revision`。
7. Secondary/destructive actions 进入 RowActions overflow：编辑、删除、查看删除条件或引用情况；不显示“查看详情”。
8. 删除只在响应 `available_actions` 含 `DELETE` 时可发起，服务端在锁内复核 revision 与引用；`QUERY_TOPIC_IN_USE` 明确显示最新引用情况。
9. 为三类 blocker 提供已实现页面的 canonical resolve links，并给对应列表补充精确 Query Topic 筛选；不链接 Insights 或尚未实现的 Optimization 页面。
10. UPDATE/DELETE 的 409 不自动重放；编辑 Dialog 保留本地输入，只有显式 reload 才恢复服务端 canonical revision。
11. 创建、更新、删除成功后失效所有真实 Query Topic 消费者；失败不伪装成功、不清空草稿。
12. 在服务端请求边界统一 canonical question 与 variants 的 trim、非空、去重和稳定顺序；前端只镜像同一规则改善即时反馈。
13. 补齐 Query Topic CREATE/UPDATE 成功审计；保持现有 ADMIN/ENGINEER 的 UPDATE 投影。
14. 支持 loading、empty、filtered-empty、error、retry、分页、键盘、Dialog 焦点返回和基础可访问性。
15. 建立 generated-type strict fixture Playwright E2E；未声明 API 必须失败，覆盖 375/768/1024/1440 且页面根无横向溢出。
16. 更新受影响的 OpenAPI、生成类型与 Frontend V2 权威文档。

### 不包含

- Query Topic Detail route 或独立 Workspace。
- Insights、Print、GEO Optimization 页面或到未实现页面的链接。
- 完整 GEO real-stack E2E、GEO vertical slice 抽象回顾或后续页面预建扩展点。
- 修改旧 `frontend/` 业务 UI；只按 OpenAPI 重新生成其类型并验证兼容。
- 新万能 DataTable、CRUD framework、Form framework、通用 action framework 或新依赖。
- 浏览器逐行查询引用、客户端拼装引用统计或按本地引用数推导动作资格。
- 自动重放失败的 PATCH/DELETE、乐观伪成功或静默 revision 替换。
- 数据库迁移。若实现发现现有模型不能表达已批准需求，必须停止并另行请求确认。

## 功能需求

### R1：canonical route 与 URL Table state

- canonical route 为 `/geo/topics`，导航项独立于 `/geo/observations`。
- URL search params 固定为 `q/sort/page/pageSize`，非法或非 canonical 值由 route replace 为规范值。
- 搜索、排序、翻页和 page size 变化都由 TanStack Router 更新 URL，再由 TanStack Query 读取；浏览器不得对当前页做二次业务过滤或排序。
- Back/Forward 必须恢复对应表格状态，refresh 不丢失状态。

### R2：服务端列表与列投影

- V2 列表由窄 `GET /api/v1/query-topics/list-items` 提供；现有 `GET /api/v1/query-topics` 的完整 `QueryTopicList` 语义、顺序和消费者保持不变。
- `q` 由服务端匹配 canonical question 和 variants；`sort` 至少支持标准问题与意图的升/降序；稳定排序必须以 `id` 收尾。
- 响应包含 `items/page/page_size/total`；集合级创建不属于资源动作投影，当前两类账号均可使用创建入口。
- 每项复用 QueryTopic 业务字段，并增加三类非负引用计数；所有角色都能看到引用摘要，只有 `ADMIN` 得到 deletion 管理投影。
- 引用统计按当前页 Topic ID 一次批量形成；不得按行增加 SQL 或浏览器请求。

### R3：服务端动作与引用引导

- `primary_task=USE_FOR_OBSERVATION` 唯一映射“开始观测”；前端不得根据 intent、引用数或角色自行推导资格。
- `UPDATE` 向当前 ADMIN/ENGINEER 投影；`DELETE` 只向无 blocker 的 ADMIN 投影；集合创建入口不伪造资源 action token。
- 引用摘要分别显示 Content Task、GEO Optimization、Observation 数量，不把三类合并成模糊总数。
- blocker resolve links 固定为：
  - Content Task：`/content/tasks?queryTopicId={id}&queryTopicReference=CONTENT_TASK&archiveStatus=ALL&page=1&pageSize=20`；
  - GEO Optimization：`/content/tasks?queryTopicId={id}&queryTopicReference=GEO_OPTIMIZATION_SOURCE&archiveStatus=ALL&page=1&pageSize=20`；
  - Observation：`/geo/observations?queryTopicId={id}&page=1&pageSize=20`。
- Content Tasks 与 GEO Observations 的服务端列表必须消费这些精确筛选；目标页面显示当前引用筛选并允许清除。Observation 链表仍以当前尾为行，Detail 展示不可变历史；引用计数保持数据库直接 Observation 行数量，不能伪装成链数量。

### R4：创建与编辑 Dialog

- 创建/编辑只包含 canonical question、intent、variants，适合短 Dialog；不得创建 Query Topic Workspace。
- variants 使用输入顺序的可增删字段，至少一项；服务端统一 trim 每项、拒绝空值、按 trim 后值拒绝重复并保留首次输入顺序，不排序。
- 编辑打开时固定当前服务端 revision；PATCH 发送完整 `QueryTopicUpdate` 与 `expected_revision`。
- 表单错误落到对应字段或可聚焦错误摘要；失败保留全部输入，成功才关闭并返回触发元素。

### R5：删除与冲突

- 只有响应 `available_actions` 包含 `DELETE` 才显示删除命令；无 token 时只可查看引用/删除条件。
- DELETE 发送行的 `expected_revision`；后端继续使用 ADMIN 权限、行锁、引用复核、外键约束和 `QUERY_TOPIC_IN_USE`。
- PATCH 409 保留 Dialog 草稿和旧 revision，不 refetch 覆盖、不自动重放；“重新加载服务端版本”显式读取现有完整 Query Topic 列表，按 ID 恢复字段与 canonical revision。
- DELETE 的 `REVISION_CONFLICT` 或 `QUERY_TOPIC_IN_USE` 保留目标与错误反馈，只有显式 reload 刷新列表投影；不得自动再次 DELETE。
- CREATE、UPDATE、DELETE 成功均写追加式审计；失败保持现有显式 error contract。

### R6：New Observation handoff 与缓存

- “开始观测”链接必须显式携带 `queryTopicId={QueryTopic.id}`；不得携带 canonical question 作为身份或根据当前行内容找回 ID。
- New Observation route 严格校验 UUID；选项加载后只接受确实存在的 ID，并初始化 `query_topic_id`。不存在时明确提示并保留可恢复入口，不选择第一项。
- mutation 成功至少失效：V2 Topic list-items、现有完整 Topic options、GEO Observation lists/details/correction contexts、Content Task details/editor contexts。
- 只失效真实读取或展示 Query Topic 的 cache；不失效当前未展示 Topic 的 Publication repair context，也不增加全局 `invalidateQueries()`。

### R7：状态、响应式与可访问性

- 列表区分首次 loading、有缓存 refetch、empty、filtered-empty、error/retry 和超界空页；删除最后一行后规范回前一页。
- 表格使用现有 TableShell、FilterBar、RowActions、Pagination 与 TanStack Table；固定五列，不创建新表格框架。
- 375/768/1024/1440 px 下页面根不得横向溢出；必要的宽表滚动只发生在 TableShell 局部。
- Primary 与 overflow 可由键盘到达；Dialog 有可感知标题/说明/字段错误，关闭或成功后焦点返回实际触发元素。

## 验收标准

- [ ] AC1：`/geo/topics` 已注册导航、Breadcrumb 与 canonical URL；direct/refresh/Back/Forward 恢复 `q/sort/page/pageSize`。
- [ ] AC2：V2 只调用 `GET /api/v1/query-topics/list-items` 绘制表格；V1 与 New Observation 继续使用无分页完整 `GET /api/v1/query-topics`。
- [ ] AC3：搜索、标准问题/意图排序、分页均由服务端完成，响应含稳定 `total/page/page_size`，无客户端页内二次筛排。
- [ ] AC4：五列准确展示 canonical question、intent、前 1～2 个 variants +N、三类引用计数和操作；无“查看详情”或 Detail route。
- [ ] AC5：所有角色可见相同引用摘要；只有服务端 capability/token 决定 CREATE、UPDATE、DELETE 与开始观测，前端不按角色、意图或计数推导。
- [ ] AC6：引用由后端一次批量统计；三类 resolve links 进入已实现列表的精确 Query Topic 筛选，目标页面显示且可清除该筛选。
- [ ] AC7：“开始观测”只由 `USE_FOR_OBSERVATION` 映射到 `/geo/observations/new?queryTopicId={id}`；New 页面确认 ID 存在后初始化 Topic，非法/缺失实体不猜测替代值。
- [ ] AC8：ADMIN/ENGINEER 可创建和编辑；短 Dialog 使用 RHF/Zod，服务端最终保证 canonical question/variants trim、非空、trim 后去重和稳定输入顺序。
- [ ] AC9：编辑发送 `expected_revision`；409 不自动重放且草稿不丢失，显式 reload 才恢复服务端字段和 revision。
- [ ] AC10：仅无 blocker ADMIN 可执行 DELETE；并发 revision 或新引用导致显式 409，删除不重放，`QUERY_TOPIC_IN_USE` 显示最新类型、数量和 resolve links。
- [ ] AC11：CREATE/UPDATE/DELETE 成功写对应审计；现有完整列表继续为 ADMIN/ENGINEER 投影 `UPDATE`。
- [ ] AC12：mutation 成功按真实消费者失效 Topic options/list、GEO list/detail/correction context、Content detail/editor context；失败不关闭表单或伪成功。
- [ ] AC13：loading、empty、filtered-empty、error、retry、分页末页删除与超界页均有明确行为。
- [ ] AC14：375/768/1024/1440 px 页面根无横向溢出；键盘、Dialog 错误焦点和触发元素焦点返回通过验证。
- [ ] AC15：OpenAPI、两套生成类型、后端、Frontend V2、strict fixture E2E 与权威文档一致；fixture 拒绝未声明 API。
- [ ] AC16：无数据库迁移、新依赖、Query Topic Detail/Workspace、Insights/Print/Optimization 页面、V1 UI 修改、通用 CRUD/DataTable/Form 抽象或完整 GEO real-stack E2E。

## 来源文档

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/frontend-v2/02-information-architecture-and-routing.md`
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- `.trellis/spec/backend/available-actions-contract.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/frontend/visual-system.md`
