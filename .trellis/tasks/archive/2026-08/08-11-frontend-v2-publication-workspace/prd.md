# Frontend V2 Publication Workspace

## 目标

在 `/publishing/work/$workId` 交付 Frontend V2 的单个发布工作台，使运营人员能够以批准 Markdown 和服务端状态机为唯一依据，从 `PREPARING` 完成人工发布、结果登记、人工核验、失败后换版再核验，最终进入 `COMPLETED` 或显式 `CLOSED`。

父任务只维护共同合同、实施顺序和最终集成门禁；业务实现与已验证的前置缺口由三个子任务承担：

1. `frontend-v2-publication-workspace-core`：Context、工作台骨架、准备、平台审核、结果/证据、关闭，终点为 `AWAITING_VERIFICATION` 或 `CLOSED`。
2. `frontend-v2-publication-verification`：核验、失败态、合法版本切换、重新核验与 `COMPLETED` 只读交接。
3. `frontend-v2-publication-action-required-revision`：补齐失败核验后的 Content Task 修订/审核入口，并完成此前被阻塞的真实栈 Flow B。

## 已确认结论

- 新增单一 `PublicationWorkspaceContext` 读模型；浏览器不得通过 Work Detail、Content、Platform、Account、Event、Verification、File 等全局接口自行拼接首屏。
- 批准正文必须随 Context 首屏返回；Publication Package 继续按用户点击单独请求，不预取、不塞入 Context。
- `Publishing Instruction` 是页面内固定操作说明，不是业务数据；当前数据库、OpenAPI 与实现均无该字段，不新增伪造字段或第二来源。
- `Target Section` 已由迁移 `0036_remove_publication_section_url` 永久移除；V2 蓝图必须同步删除该字段，不渲染占位、不恢复兼容字段。
- 保持 PostgreSQL 为业务状态唯一来源、Redis 仅作 Celery broker；命令继续携带 CSRF 与 `expected_revision`，服务端继续最终校验权限、状态、版本、账号、域名和证据。
- 不新增运行时依赖、全局 Store、通用 Context 框架、通用上传框架或第二套设计系统。

## 范围

### In Scope

- `/publishing/work/$workId` canonical route、hash section、direct/refresh/Back/Forward 与 dirty navigation protection。
- Context/OpenAPI/Pydantic/query/router，以及相关 endpoint 的真实 401/403/404/409/422 错误声明。
- `WorkspaceShell`、`StickyActionBar`、`DetailSection`、`Timeline`、RHF、`MarkdownPreview` 与现有错误/状态原语的组合。
- 现有发布命令的 V2 UI：preparation、platform review、result/evidence、verification、switch content version、close。
- append-only Event、Verification、Attachment 展示；证据上传复用现有文件意图协议与浏览器原生文件/加密能力。
- 两条互相独立的真实栈 Playwright 流：准备/结果登记；失败核验/换版/重新核验/完成。
- 直接受影响的 OpenAPI、数据库/前端蓝图、Trellis 稳定规范与 generated types 同步。

### Out of Scope

- Published Articles 列表/详情、GEO Issue 处理、GEO verification、分析、调度或完整 Phase 4 Publishing checkpoint。
- 自动发布、平台爬取、自动核验、批量操作、富文本编辑、批准内容原地修改。
- 恢复 `Target Section`、新增发布指令存储字段、V1 页面重做或通用 Workflow/Upload/Context 框架。
- 本规划阶段的业务代码、合同或权威文档修改；获得用户批准前不激活任务、不建分支。

## 验收标准

- [x] 三个子任务分别通过自身适用的 contract/backend/component/production-artifact/real-stack 必需门禁。
- [x] 工作台首次加载只请求一个 Context；Publication Package 与附件下载只在用户操作时请求。
- [x] Context 在 `REPEATABLE READ` 快照中返回 work、绑定 Markdown、平台上下文、合法账号选项、合法换版候选、events、verifications 与 attachments，查询数量固定。
- [x] 前端只消费服务端 `primary_task`、`available_actions`、账号选项和换版候选，不从 status、全局列表或内容历史重建资格。
- [x] 409 不自动重放；保留本地表单/已上传证据选择与 request ID，用户显式重载后才采用最新 canonical Context。
- [x] `PREPARING → PLATFORM_REVIEW → RESULT_REGISTERED → AWAITING_VERIFICATION → ACTION_REQUIRED → REGISTER_RESULT → AWAITING_VERIFICATION → COMPLETED` 与任意非终态 `→ CLOSED` 均由真实后端状态机证明。
- [x] 失败核验、events、verifications、attachments 和 PublishedArticle 保持不可变/append-only 语义；批准内容不被工作台修改。
- [x] `docs/frontend-v2/03-page-and-workflow-blueprint.md` 不再声明 `Target Section`，且不出现兼容占位。
- [x] 375/768/1024/1280/1440/1920、200% zoom、浅/深/system、键盘、焦点恢复、reduced motion 与页面无横向溢出验收通过。
- [x] 父任务最终检查代码、OpenAPI、generated types、数据库合同、前端文档与两条真实栈流程一致；不把本任务宣称为完整 Publishing E2E。

## 批准门禁

用户已于 2026-08-11 批准并完成 Core、Verification 与 `frontend-v2-publication-action-required-revision` 的业务实施。父任务收尾进一步确认换版后的权威动作序列为 `CONTENT_VERSION_CHANGED → REGISTER_RESULT → AWAITING_VERIFICATION / RUN_FIRST_VERIFICATION`，并获批仅修正既有 V1 E2E 的漂移；最终集成门禁已通过。

唯一授权冲突已解决：允许随 OpenAPI 机械更新 `frontend/src/shared/api/schema.d.ts`，并允许父任务收尾修改 `frontend/tests/e2e/mvp-flow.spec.ts`。实际无 generated schema diff，也未修改任何 V1 运行时代码或页面。
