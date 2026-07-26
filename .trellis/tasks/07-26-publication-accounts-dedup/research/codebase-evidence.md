# 代码库证据

## 发布账号

- `backend/app/models/publication.py:26-43`：`PlatformAccount` 已有 `platform_profile_id`、`label`、`account_identifier`、`is_active`，只存在 `(platform_profile_id, is_active)` 普通索引，没有 revision 或账号标识唯一约束。
- `backend/app/routers/publication.py:146-200`：现有 API 只有列表、创建和删除；创建允许工程师/管理员，删除只允许管理员。
- `backend/app/services/publication.py:88-157`：创建会锁定启用平台；删除锁账号并拒绝删除被 `PublicationRecord` 引用的记录。没有编辑或启停命令。
- `backend/app/services/publication_queries.py:221-262`：候选按任务具体平台返回全部启用账号，因此数据模型本身已经支持“同平台多账号”。
- `frontend/src/features/settings/SettingsPage.tsx:53-68`：账号页支持平台筛选、创建、状态展示和管理员删除，没有编辑/启停交互。
- `contracts/database.md:5-11`：可变聚合必须携带 revision，客户端提交 `expected_revision`；新增账号编辑后应沿用该既有契约。

## GEO 问题库与导航

- `frontend/src/app/AppLayout.tsx:19-40`：GEO 导航只有观测记录和分析洞察；发布账号与“历史目标问题”都位于业务设置。
- `frontend/src/features/settings/SettingsPage.tsx:25-50`：`/settings` 默认显示目标问题 Tab，`tab=accounts` 才显示发布账号。
- `docs/GEO多平台内容运营系统方案设计.md:631-653`：新人工 GEO 观测必须选择真实 `QueryTopic`，用于问题覆盖分析；新内容任务不再创建该关联。
- `contracts/database.md:194-207`：`0022` 已规定新 `MANUAL_ARTICLE_SEARCH` 必须关联真实 `query_topic_id`。

## 人工发布与重复门禁

- `frontend/src/features/publications/PublicationWorkspace.tsx:387-395`：缺少账号时链接固定为 `/settings`，没有携带 Tab 或当前 `platform_profile_id`。
- `frontend/src/features/publications/PublicationDrawer.tsx:149-171`：账号字段已是单选 `Select`，请求只提交一个 `platform_account_id`，但没有明确的单账号业务提示。
- `backend/app/models/publication.py:46-69`：发布记录保存 `platform_account_id` 与 `content_hash`；只有 `idempotency_key` 是唯一列。
- `backend/app/services/content_production.py:630`：内容哈希由标题、摘要、Markdown 正文和标签确定，并保存到不可变内容版本。
- `backend/app/services/publication.py:160-251`：发布登记只按 `idempotency_key` 获取 advisory lock 和检查重放，随后把内容版本哈希复制到发布记录；没有平台加哈希检查。
- `backend/app/services/publication.py:260-336`：`mark-published` 只锁当前发布记录和任务，没有检查同平台同哈希的其他发布历史。
- `backend/app/services/publication_queries.py:68-80`：只有 `PENDING_MANUAL_PUBLISH`、`PLATFORM_REVIEW` 可以进入 `REJECTED`；`PUBLISHED` 与 `VERIFIED` 只会进入下线或验证失败状态。
- `contracts/database.md:45-51`：发布历史口径必须读取追加式状态事件；后续下线不能抹掉曾公开事实。

## 迁移与测试边界

- 当前 Alembic head 是 `0025_markdown_facts_direct_platform`，新账号 revision 和唯一约束必须创建新 revision，不能修改历史迁移或 `migration_schema_v1.py`。
- `backend/tests/integration/test_publication_review_closure.py` 已覆盖账号平台匹配、幂等键、发布状态闭环和停用平台，可扩展为账号维护与重复发布状态矩阵。
- `backend/tests/integration/test_migrations.py` 是 PostgreSQL 迁移与触发器权威回归入口。
- `frontend/src/features/publications/PublicationsPage.test.tsx:209-222` 已覆盖无匹配账号恢复入口；`frontend/src/app/AppLayout.test.tsx:103-104` 已覆盖当前导航，可直接更新断言。
