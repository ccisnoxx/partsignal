# 发布管理工作台契约

## 场景：人工发布工作、首次核验与发布后问题

### 1. 范围与权威来源

- 修改 `/publications`、发布命令、发布账号门禁、GEO 文章候选或修复任务来源时适用。
- PostgreSQL 的 `publication_works`、`publication_work_events`、`publication_verifications`、`published_articles`、`published_content_issues` 与 `publication_attachments` 是唯一业务来源；前端不得维护第二套状态机或从分页结果重算全量数量。
- 发布工作、只读发布成果和发布后内容问题是三个不同生命周期，不得用一个可任意修改的聚合兼任。

### 2. 状态与完成边界

```text
PublicationWork:
PREPARING -> PLATFORM_REVIEW -> AWAITING_VERIFICATION
PREPARING -> AWAITING_VERIFICATION
AWAITING_VERIFICATION -> ACTION_REQUIRED -> AWAITING_VERIFICATION
AWAITING_VERIFICATION | ACTION_REQUIRED -> COMPLETED
任一非终态 -> CLOSED

PublishedContentIssue: OPEN -> RESOLVED
```

- 结果登记必须保存实际标题、最终公开 URL、发布时间、说明和可选已验证 `OPERATION_SCREENSHOT`；登记后进入 `AWAITING_VERIFICATION`。
- 失败核验追加不可变快照并进入 `ACTION_REQUIRED`，工作继续待处理；结果修正后可以再次登记并复核，不创建第二条工作。
- 首次成功核验在同一事务创建同 ID 的只读 `PublishedArticle`，把工作和来源 `ContentTask` 置为 `COMPLETED`，并追加事件与审计。
- 显式关闭必须带结构化原因和非空说明，在同一事务把工作置为 `CLOSED`、来源任务置为 `CANCELLED`；关闭后不可恢复。
- 发布后页面问题只创建 `PublishedContentIssue`。创建修复任务不会解决问题，解决问题也不会自动完成修复任务。
- 发布业务对象、事件、核验、成果和问题均没有日常物理删除能力；开发环境清理使用经核对的数据库重置，不进入业务 API。

### 3. HTTP 签名

读取：

- `GET /api/v1/publication-ready-items`
- `GET /api/v1/publication-workbench-summary`
- `GET /api/v1/publication-works` 与 `GET /api/v1/publication-works/{work_id}`
- `GET /api/v1/published-articles` 与 `GET /api/v1/published-articles/{article_id}`
- `GET /api/v1/published-content-issues` 与 `GET /api/v1/published-content-issues/{issue_id}`
- `GET /api/v1/published-content-issues/{issue_id}/repair-context`

命令：

- `POST /api/v1/publication-works`：只接收 `content_version_id` 与 `platform_account_id`
- `PATCH /api/v1/publication-works/{work_id}/preparation`：只接收 `platform_account_id`、`expected_revision` 与非空 `comment`
- `POST /api/v1/publication-works/{work_id}/platform-review`
- `PUT /api/v1/publication-works/{work_id}/result`
- `POST /api/v1/publication-works/{work_id}/verifications`
- `POST /api/v1/publication-works/{work_id}/close`
- `POST /api/v1/published-articles/{article_id}/issues`
- `POST /api/v1/published-content-issues/{issue_id}/repair-task`
- `POST /api/v1/published-content-issues/{issue_id}/resolve`

不得恢复通用 command 路径、旧路径别名、兼容请求字段或双写。

### 4. 动作、并发与身份

- 每个资源由服务端返回 typed `available_actions` 和可空 `primary_action`；前端只展示该投影，不按状态、URL、角色或关联对象推断资格。
- 工作命令锁定目标行并校验 `expected_revision`。创建工作按请求键获取事务 advisory lock；同平台内容身份按 `platform_profile_id + content_hash` 串行校验。
- 一个已批准内容版本最多有一个发布工作；同一具体平台的同一内容哈希最多有一个未关闭工作。关闭只表达该次工作终止，不绕过内容身份形成重复公开。
- 发布账号必须启用且属于任务锁定平台。账号停用只影响新选择，既有历史身份保持可读；账号凭据、Cookie 和令牌不得保存。
- 发布工作不保存栏目地址或替代地址；不具备栏目概念的平台无需填写占位 URL。
- 最终 URL 必须是 HTTP(S) 且匹配平台允许域名；未知标题、URL、时间、账号或内容一致性必须明确失败，不能补默认值。
- 工作事件、核验快照、成果和问题历史只能追加或执行契约允许的状态更新；直接非法 UPDATE/DELETE 由 PostgreSQL 以 `55000` 拒绝。

### 5. GEO 与修复回流

- GEO 文章身份唯一来自 `PublishedArticle`；`geo_observation_publications.published_article_id` 和 `geo_observation_citations.published_article_id` 不复制标题或 URL。
- 新 GEO 候选排除存在 `OPEN` 问题或曾以 `RETIRED` 解决问题的文章。打开问题和创建观测必须锁定同一文章，候选集合变化返回 `409 GEO_PUBLICATIONS_CHANGED`。
- 修复任务继承原文章的产品与具体平台，用户必须选择同产品当前有效的 `APPROVED FactVersion`；`content_tasks.source_published_content_issue_id` 只写一次且唯一。

### 6. 必需验证

- PostgreSQL 集成测试覆盖连续失败、失败后复核成功、显式关闭、成功核验原子完成、附件、revision、账号/平台门禁、直接非法写入和不可删除历史。
- GEO 集成测试覆盖合格文章全集、问题打开后的候选变化、并发集合校验、问题修复来源和显式解决。
- 契约检查保证 FastAPI、`contracts/openapi.yaml` 和生成 TypeScript 类型一致，旧资源与通用命令不存在。
- 前端组件测试覆盖 URL 恢复、服务端动作投影、失败后继续待处理、关闭确认、只读成果和问题独立处理。
- Playwright 覆盖批准内容到成功核验、只读成果、问题退出 GEO、修复与解决，并检查真实请求、console 与页面错误；失败复核和关闭由 PostgreSQL 集成测试与前端组件测试覆盖。

## 场景：无栏目地址的跨平台人工发布

### 1. 范围 / 触发条件

- 修改开始发布、准备信息、`publication_works` 表结构或发布工作读模型时适用。
- 栏目不是跨平台稳定概念，不得重新引入栏目地址、替代地址、占位 URL 或兼容字段。

### 2. 签名

- `POST /api/v1/publication-works`：`{content_version_id: UUID, platform_account_id: UUID}`。
- `PATCH /api/v1/publication-works/{work_id}/preparation`：`{platform_account_id: UUID, expected_revision: int >= 0, comment: nonblank}`。
- `publication_works` 不包含 `section_url`；真实公开地址只写入结果字段 `final_url`。

### 3. 合同

- 创建响应、工作列表/详情和发布成果详情均不得返回栏目地址。
- OpenAPI 是前端类型的权威来源；删除字段后运行 `make contract-generate`，不得手工添加兼容类型。
- 数据库迁移先替换仍引用待删列的守卫函数，再删除列；不可恢复的删除迁移以 `55000` 拒绝降级。

### 4. 校验与错误矩阵

- 账号未启用 -> `409 PLATFORM_ACCOUNT_DISABLED`。
- 账号不属于任务锁定平台 -> `422 PUBLICATION_PLATFORM_MISMATCH`。
- `expected_revision` 过期 -> `409 REVISION_CONFLICT`。
- `final_url` 不是 HTTP(S) 或不匹配平台允许域名 -> `422 VALIDATION_ERROR`。
- 尝试非法修改冻结身份、终态或删除历史 -> PostgreSQL `55000`。

### 5. Good / Base / Bad

- Good：选择同平台启用账号创建工作，登记匹配允许域名的 `final_url`，核验成功形成只读成果。
- Base：准备阶段只更换同平台启用账号并提交 revision 与非空说明。
- Bad：为没有栏目概念的平台生成占位 URL，或把栏目地址作为可选字段继续透传。

### 6. 必需测试

- 组件测试精确断言创建请求只有两个字段，准备更新请求只有账号、revision 和说明。
- PostgreSQL 迁移测试断言旧行其余数据不变、列已删除、守卫不再引用该列且不可逆降级返回 `55000`。
- 发布流程集成测试断言合法结果可登记，错误域名仍返回 `VALIDATION_ERROR`。
- 合同检查断言 FastAPI、OpenAPI 与生成 TypeScript 类型一致。

### 7. Wrong vs Correct

```jsonc
// Wrong：保留无业务含义的栏目字段或占位值
{"content_version_id":"...","platform_account_id":"...","section_url":"https://example.invalid/placeholder"}

// Correct：开始发布只绑定内容和账号
{"content_version_id":"...","platform_account_id":"..."}
```
