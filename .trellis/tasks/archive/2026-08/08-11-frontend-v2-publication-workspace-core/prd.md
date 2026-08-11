# Frontend V2 Publication Workspace Core

## 目标

交付 `/publishing/work/$workId` 的可运行核心工作台：单次 Context 首屏、批准内容与按需 Package、准备、平台审核、结果和截图证据登记、事件/附件历史、关闭，以及到 `AWAITING_VERIFICATION` 的明确交接。

## 需求

- 新增 `GET /api/v1/publication-works/{work_id}/workspace-context`，在一个 `REPEATABLE READ` 请求中返回工作台所需最小快照。
- 首屏不得请求全局 ContentVersion、Platform、PlatformAccount、Event、Verification 或 File 列表补字段。
- Context 返回绑定 Markdown、最小平台上下文、服务端筛选的 active matching accounts、零或一个合法换版候选，以及 canonical work/history/attachments。
- Publication Package 只在点击“复制发布包”时请求；批准内容全程只读。
- 实现 preparation、platform review、result registration、evidence upload/download、close；所有命令携带 CSRF 与 `expected_revision`。
- hash 只使用 `summary/preparation/result/verification/content-version/close`；未知或缺失 hash replace 为 `summary`，保持既有 Work List handoff。
- 修复共享 `DirtyGuard` 只比较 pathname 的缺陷，使同路由 search/hash 变更也受保护。
- `Publishing Instruction` 使用静态流程说明，不加入 API；从 V2 蓝图删除已不存在的 `Target Section`。
- Core 到达 `AWAITING_VERIFICATION` 时显示明确的后续核验交接，不实现固定成功、假核验或客户端状态跳转。

## Out of Scope

- VERIFY、SWITCH_CONTENT_VERSION、ACTION_REQUIRED 修正与 COMPLETED PublishedArticle handoff；由依赖子任务 `frontend-v2-publication-verification` 完成。
- PublishedArticle/GEO 页面、自动发布、批量操作、通用上传器/工作台框架、V1 UI 重做。

## 验收标准

- [ ] Context runtime/OpenAPI/generated types 一致，真实 401/403/404/409/422 被声明和展示。
- [ ] Context 固定 SQL 数且在并发写入场景下保持同一 PostgreSQL snapshot；missing/broken lineage 明确失败。
- [ ] Direct/refresh/Back/Forward 和六个 canonical hash 正确；dirty search/hash/path navigation 均被阻断。
- [ ] UI 只从 `primary_task/available_actions` 映射动作，从 `eligible_accounts` 映射账号；不读取全局列表或从 status 推导。
- [ ] Result 只关联 verified `OPERATION_SCREENSHOT`；对象上传失败/complete 重试/结构化错误真实可见，附件 append-only。
- [ ] 409 保留表单和 file IDs，不自动重放，显式重载才采用新 Context。
- [ ] 实际状态流 `PREPARING → PLATFORM_REVIEW → RESULT_REGISTERED/AWAITING_VERIFICATION` 与任意非终态 `→ CLOSED` 由 integration test 证明。
- [ ] production-artifact fixture 对未声明 API、console/page/request failure 直接失败，并覆盖 375/768/1024/1280/1440/1920、键盘和焦点。
- [ ] 独立真实栈 Flow A 从已有批准内容开始，经 V2 页面完成准备与结果登记，读取最终 Context 为 `AWAITING_VERIFICATION`。
- [ ] `Target Section` 从权威 V2 蓝图移除；无数据库迁移、无新依赖、无业务字段回填。
