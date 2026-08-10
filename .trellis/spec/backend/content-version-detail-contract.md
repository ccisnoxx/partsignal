# Content Version Detail 不可变详情合同

## 1. Scope / Trigger

- 修改 `/content/versions/$versionId`、`GET /api/v1/content-versions/{content_version_id}/detail`、`ContentVersionDetail`、内容版本追溯或 `content_versions.updated_at` 时适用。
- 本合同只覆盖一个 Content Version 的不可变详情读取；不建立 Content History、Publication Workspace、通用 Version Detail framework 或任何写命令。

## 2. Signatures

```text
URL: /content/versions/$versionId
GET: /api/v1/content-versions/{content_version_id}/detail
operationId: getContentVersionDetail
query key: ["content", "versions", "detail", versionId]
DB revision: 0042_content_version_detail
```

服务端投影入口：

```python
get_content_version_detail(
    db: Session,
    content_version_id: uuid.UUID,
) -> ContentVersionDetail
```

## 3. Contracts

- endpoint 使用与基础 ContentVersion GET 相同的 `CurrentUser` 读取权限，并在 PostgreSQL `REPEATABLE READ` 中一次形成页面快照。
- `ContentVersionDetail` 只返回：目标内容版本 canonical 字段、`is_current`、creator、最小 Fact identity、目标祖先链 generation lineage、目标版本 review result 与累计 review timeline。
- 响应不得包含 `primary_task`、`available_actions`、mutation URL、完整 ContentTask、完整 Fact Markdown、Diff、无关 GenerationJob 或完整版本历史。
- `is_current` 只比较 `ContentTask.current_content_version_id` 与目标版本 ID；页面不得修改该指针，也不得按最大版本号猜测。
- generation lineage 复用 `resolve_content_ai_lineage`。channel snapshot 只允许非敏感配置与敏感 Header 名称，禁止返回 API key 或敏感 Header 值。
- `review_result` 是目标版本自身最后一条实际 `ContentReviewRecord`，不从 status 推导；`review_timeline` 保持服务端 `created_at, id` 顺序。
- revision `0042_content_version_detail` 增加 nullable `content_versions.updated_at`。升级不回填 legacy 行；未来 INSERT 使用数据库默认值，既有合法 ORM 更新使用 `onupdate`。`null` 必须显示为未知，禁止回退到任务、审核或迁移时间。
- 浏览器只调用 detail endpoint；页面对 HUMAN/AI、当前/历史和全部六种 status 始终只读，不提供 SAVE、DELETE、APPROVE、REQUEST_CHANGES 或 ABANDON。

## 4. Validation & Error Matrix

| 条件 | API / 页面处理 |
| --- | --- |
| 未认证或无效会话 | `401 ErrorEnvelope`；进入既有身份流程 |
| 会话要求强制改密 | `403 PASSWORD_CHANGE_REQUIRED`；详情不泄露 |
| UUID 格式非法 | `422 VALIDATION_ERROR` |
| 目标版本不存在 | `404 NOT_FOUND`；无 retry |
| task、fact、creator 归属断裂 | `409 CONTENT_VERSION_DETAIL_INCOMPLETE`；不返回部分详情 |
| AI lineage 断裂或非法 | `409 CONTENT_VERSION_DETAIL_INCOMPLETE`；不请求 GenerationJob fallback |
| 首屏普通失败 | 明确错误和 retry，只重取 detail key |
| 背景刷新失败且已有 data | 保留不可变快照并提供“重试刷新” |
| response ID 与 URL 不一致 | 阻断全部 payload，不展示快照 |

## 5. Good / Base / Bad Cases

- Good：从 Content Task activity 进入历史 AI 版本，一次 GET 展示冻结 Markdown、Prompt/model、祖先 lineage、审核时间线与 canonical Task/Fact 链接，全页无写入口。
- Base：HUMAN legacy 版本没有 generation/review snapshot 且 `updated_at=null`，页面分别显示明确空态和“历史记录未记录”，不补造数据。
- Bad：浏览器依次请求基础 ContentVersion、Review Context、GenerationJob 和 FactVersion 拼详情，或从 status/current 标记生成审核或编辑动作。

## 6. Tests Required

- Contract：冻结 path、operation、compact schemas、401/403/404/409/422，并断言基础 `ContentVersion` schema 不扩张。
- Migration/backend：验证 legacy null、未来 default、ORM 更新时间、downgrade、HUMAN/AI、current/history、snapshot/result/timeline、404、`REPEATABLE READ` 与固定查询次数。
- Component：覆盖六种 status、两种 source、snapshot 有无、长 Markdown/tags/change summary、canonical links、loading/error/retry/stale 和无写控件。
- Fixture Playwright：direct/refresh/Back/Forward、375/768/1024/1440、键盘/焦点、404/403、未声明请求和写请求失败、console/pageerror/requestfailed 审计。
- Real stack：独立创建真实 HUMAN ContentVersion，经登录、FastAPI、PostgreSQL 和 production preview 只执行一个 detail GET。

## 7. Wrong vs Correct

```tsx
// Wrong：浏览器 join 多个 workspace，并从状态推导动作。
const version = await getContentVersion(versionId);
const review = await getContentReviewContext(version.id);
const canApprove = version.status === 'PENDING_REVIEW';

// Correct：Content domain 的单一 query 只渲染服务端快照。
const detail = useQuery(contentVersionDetailQueryOptions(versionId));
return <ContentVersionDetailPage versionId={versionId} />;
```
