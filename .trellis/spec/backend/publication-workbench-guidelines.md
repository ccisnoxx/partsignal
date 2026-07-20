# 发布管理工作台契约

## 场景：人工发布工作台聚合与结果证据

### 1. 范围与触发条件

- 修改 `/publications` 的流程计数、发布记录/关注列表投影、周期数据、最近动态或结果登记时适用。
- PostgreSQL 的 `publication_records`、`publication_status_events`、`publication_attentions` 与 `publication_attachments` 是唯一业务来源；前端不得从分页结果重算全量数据或维护第二套状态机。
- 本场景复用现有发布表和追加式附件关系，不新增统计表、证据阶段列或缓存状态。

### 2. 签名

- 摘要：`GET /api/v1/publication-workbench-summary?window_days=7|30`，默认 `7`，响应 `PublicationWorkbenchSummary`。
- 记录列表：`GET /api/v1/publication-records?page=<int>&page_size=<int>&status=<PublicationStatus?>`，响应 `PublicationRecordList<PublicationRecordListItem>`。
- 关注列表：`GET /api/v1/publication-attentions?status=<OPEN|RESOLVED?>`，响应 `PublicationAttentionList<PublicationAttentionListItem>`。
- 发布命令：`POST /api/v1/publication-records/{publication_id}/{command}`；`PublicationCommand.attachment_file_ids: uuid[] = []` 只允许在 `command=mark-published` 时非空。
- 数据库仍使用既有 `publication_status_events(publication_id,status,created_at)` 与 `publication_attachments(publication_id,file_id)`；本场景没有 Alembic revision。

### 3. 契约

- 摘要响应必须包含 `as_of`、`window_start`、`window_days`、七个当前状态计数、`open_attention_count`、周期指标、三类确定性异常计数和最多 5 条最近状态事件。
- 当前状态计数读取 `PublicationRecord.status`；滚动窗口使用半开区间 `[window_start, as_of)`。
- `registered_published_count` 是窗口内出现 `PUBLISHED` 事件的 distinct publication 数；`verified_count` 是该 cohort 在 `as_of` 前曾出现 `VERIFIED` 事件的数量；零分母的 `verification_rate` 为 `null`。
- `new_exception_count` 是窗口内出现 `REJECTED | REMOVED | VERIFICATION_FAILED` 事件的 distinct publication 数。后续下线或验证失败不从历史发布 cohort 扣除。
- OPEN attention 只按结构化 `trigger_status=REMOVED|VERIFICATION_FAILED` 分类；平台拒绝来自当前 `PublicationRecord.status=REJECTED`，禁止解析自由文本。
- 列表响应直接带内容、版本、平台、账号、最后验证时间和服务端 `available_actions`；列表循环不得调用详情投影。
- 详情 `PublicationRecord` 直接投影锁定的 `content_title/content_version`、`platform_profile_id/platform_profile_name` 与 `platform_account_label/account_identifier`；Drawer 和旧详情路由不得从当前列表页或其他接口猜测这些上下文。
- 候选创建阶段与 `mark-published` 结果阶段共用追加式 `publication_attachments`，两条写路径只接受 VERIFIED `OPERATION_SCREENSHOT`。结果证据、实际标题、最终 URL、发布时间、状态事件和审计必须在同一事务提交或回滚。
- 前端只从摘要状态键、真实 attention 触发值和 `available_actions` 派生筛选/动作；`tab`、分页、`window_days`、筛选和 Drawer 对象 ID 写入 URL，表单正文留在组件本地。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| `window_days` 不是 `7` 或 `30` | 请求边界返回 `422`，统计服务不接收普通任意整数 |
| 非 `mark-published` 命令携带非空 `attachment_file_ids` | `422 VALIDATION_ERROR` |
| 文件缺失、重复或状态不是 `VERIFIED` | `422 VALIDATION_ERROR` 或 `FILE_INTEGRITY_FAILED`，发布字段和附件关系均不落库 |
| 文件类别不是 `OPERATION_SCREENSHOT` | `422 VALIDATION_ERROR`，候选记录、发布字段和附件关系均不落库 |
| 同一结果证据已绑定当前发布记录 | `409 PUBLICATION_ATTACHMENT_EXISTS` |
| 实际标题、最终 URL 或发布时间缺失 | `422 VALIDATION_ERROR` |
| 最终 URL 不属于锁定平台允许域名 | `422 VALIDATION_ERROR` |
| 当前状态不允许命令 | `409 INVALID_STATE_TRANSITION` |
| 权限或 CSRF 不满足 | 保留统一 `403`，前端隐藏动作不能替代服务端校验 |

### 5. 正常、基础与失败案例

- 正常：记录进入平台审核后，`mark-published` 同时写实际结果和一张已验证截图；后续验证成功，7/30 天统计均保留该发布历史。
- 基础：窗口内没有 `PUBLISHED` 事件时，登记数和验证数为 `0`、验证率为 `null`；最近动态为空数组。
- 失败：结果截图仍为 `PENDING`，命令整体失败；记录保持 `PLATFORM_REVIEW`，实际标题/URL/发布时间为空，候选阶段已绑定证据保持不变。

### 6. 必需测试

- 契约检查断言 FastAPI、OpenAPI 和生成 TypeScript 类型对 `7|30`、列表投影、命令附件字段完全一致。
- PostgreSQL 集成测试断言 7/30 天 cohort、验证率、后续异常不回删历史、错误类别证据在两阶段原子回滚、详情锁定投影和两阶段附件共存。
- 查询次数断言候选、记录、关注、摘要分别固定为 `2/2/1/2` 条 SQL；用 `EXPLAIN (ANALYZE, BUFFERS)` 检查摘要与最后验证聚合，只有真实计划证据不足时才评审索引迁移。
- 前端组件测试覆盖默认 7 天、仅 7/30、URL 恢复、按需 Drawer、账号匹配、服务端动作和结果证据 ID 载荷。
- Playwright 覆盖 1536×1024、1024px、375×812，浅色/深色/跟随系统，以及成功、真实失败、证据、验证、异常、修复后仍 OPEN 和显式解决。

### 7. 错误与正确示例

错误做法：从当前页 `items.length` 计算流程数量，遍历每条记录请求详情，再按错误文案猜测异常类型；上传文件成功后即在 UI 标记为“已绑定”。

正确做法：

```python
summary = publication_workbench_summary(db, window_days)
records = list_publication_records(
    db,
    page=page,
    page_size=page_size,
    status_filter=status_filter,
)

command_publication(
    db=db,
    publication_id=publication_id,
    command="mark-published",
    payload=PublicationCommand(
        actual_title="真实发布标题",
        final_url="https://allowed.example/posts/1",
        published_at=published_at,
        comment="人工发布完成",
        attachment_file_ids=[verified_file_id],
    ),
    actor=actor,
    request_id=request_id,
)
```

只有命令成功响应中的 `attachments` 才表示已绑定；上传成功但命令失败的文件仍只是独立 `FileRecord`。
