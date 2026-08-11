# Frontend V2 Publication ACTION_REQUIRED Content Revision — Design

## 1. 根因与最小修复点

根因不在 Editor、Review 或 Publication command：这些能力已存在。唯一断点是 Content Task 共享 SQL 投影把所有未终态 Publication Work 都提前归类为 `CONTINUE_PUBLICATION`，导致既有 Editor 无法收到 `REVISE_CONTENT`。

最小修复只调整 `content_task_workflow_projection()` 的 CASE 优先级，并继续让该投影服务列表、详情、Editor Context 与 Review Context：

```text
PublicationWork ACTION_REQUIRED
├── current == work.content_version_id && APPROVED
│   && FAILED verification.content_version_id == current.id
│   └── PUBLISHING / REVISE_CONTENT
├── current DRAFT
│   └── DRAFT / EDIT_AND_SUBMIT_REVIEW
├── current PENDING_REVIEW
│   └── REVIEW_PENDING / REVIEW_CONTENT
├── current CHANGES_REQUESTED
│   └── CHANGES_REQUESTED / REVISE_CONTENT
└── current APPROVED && 当前版本没有 FAILED verification
    └── PUBLISHING / CONTINUE_PUBLICATION
```

换版命令会同时更新 `work.content_version_id`，因此不能只用 `current != work.content_version_id` 区分换版前后。投影必须关联不可变 verification snapshot：失败仍绑定当前 work 版本时进入修订；切到尚未失败的新版本后继续重新登记结果，旧版本的失败快照不得污染新版本入口。

其他 Publication Work 状态继续使用现有投影：未终态为 `PUBLISHING / CONTINUE_PUBLICATION`，完成态为 `VERIFIED / VIEW_FULL_LINEAGE`。不增加 enum、DTO、endpoint、数据库字段或 helper abstraction。

## 2. 端到端数据流

```text
Workspace VERIFY FAILED
  → PublicationWork ACTION_REQUIRED（批准版本不变）
  → Content Task handoff
  → shared server projection: REVISE_CONTENT
  → existing Editor: CREATE_REVISION → SAVE → SUBMIT_REVIEW
  → existing Review: APPROVE（旧批准版本 SUPERSEDED）
  → shared server projection: CONTINUE_PUBLICATION
  → Workspace Context: exact switch_candidate
  → SWITCH_CONTENT_VERSION
  → CONTENT_VERSION_CHANGED / REGISTER_RESULT
  → 重新登记真实发布结果
  → AWAITING_VERIFICATION / RUN_FIRST_VERIFICATION
  → VERIFY PASSED
  → Work + ContentTask COMPLETED, PublishedArticle immutable handoff
```

动作资格始终来自服务端投影；写命令继续在事务中校验 current pointer、revision、状态、事实和候选。前端不增加 Publication status 分支来开启 Editor，也不把 Content 页面嵌入 Publication Domain。

## 3. 前端边界

- 保留 Workspace 现有 `/content/tasks/{task_id}` 链接；Content Task Detail 通过现有 action registry 把 `REVISE_CONTENT`、`REVIEW_CONTENT`、`CONTINUE_PUBLICATION` 分别映射到 Editor、Review、Workspace。
- Editor/Review 页面与 API client 预计无需生产代码修改；只有真实栈证明现有 handoff 不可达时，才在本任务范围内修正直接缺口并重新提交规划审阅。
- Flow B 扩展现有 `publication-workspace-real-stack.spec.ts`，不新建重复 spec；`deploy/scripts/e2e-local.sh` 已运行该文件，无需修改脚本入口。

## 4. 合同与兼容性

- `workflow_stage` 与 `primary_task` 使用 OpenAPI 已有枚举值，响应 shape 不变，因此不更新 `contracts/openapi.yaml` 或 generated types。
- 数据库状态与不可变历史规则不变，不更新 `contracts/database.md`，不增加 migration。
- V1 运行时代码和页面不在消费或修改范围内；父任务收尾只修正既有 V1 E2E，使其消费换版后的 `REGISTER_RESULT`，重新登记后再按 `RUN_FIRST_VERIFICATION` 执行首次核验。

## 5. 风险与回滚

- 风险：CASE 顺序错误可能让正常发布任务误入编辑链。用同一集成测试同时断言正常发布、ACTION_REQUIRED 各内容阶段及完成态。
- 风险：Flow B 直接写测试数据库会掩盖 UI 断点。真实栈只允许 API 创建前置记录和读取结果，所有失败核验、修订、审核、switch、结果登记与通过核验均走 V2 UI。
- 回滚点：服务端投影 CASE 与对应测试可作为一个原子变更回滚；不涉及数据迁移或历史修复。
