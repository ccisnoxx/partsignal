# C06 内容审核

## Goal

验收 `/content/tasks/$taskId/review` 的单次一致 Review Context、只读审核依据、批准/退回命令和冲突处理。

## Requirements

- 前置 C04 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.5 节、`05-business-actions-state-and-api-contract.md` Content Review 段、`08-testing-quality-and-acceptance.md` Phase 3.5、OpenAPI 与前端状态/动作规则。
- 页面只读取 task-scoped Review Context，展示服务端 current content 的不可变 Markdown、质量问题、批准事实、生成快照、差异及目标版本审核记录；审核动作只由服务端 token 提供。
- 批准/退回使用当前 canonical revision 与 CSRF。退回意见必填、修剪，结构化字段错误回到表单；409 保留用户输入和请求 ID，刷新服务端上下文但不自动重放。批准 unknown/default 500 显示服务端失败，不进入 revision 冲突分支。
- 成功后采用 canonical 结果并刷新相关消费者。页面在窄屏、键盘及焦点恢复下可操作；面向用户的审核区标题使用项目中文界面文案。

## Acceptance Criteria

- [x] 组件/model 检查覆盖 context、token、批准/退回、验证、409 与 unknown 500。
- [x] 当前候选生产预览 fixture 覆盖 direct/refresh、只读内容、权限/异常、响应式/键盘；隔离真实栈证明人工内容批准和退回修订两条连续流程。
- [x] 记录实际代码、验收证据与 C07/C08 下一步。

## Notes

- 范围限于 Content Review 页面/model 与直接测试；隔离真实栈沿用 `deploy/scripts/e2e-local.sh`。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`frontend/src/domains/content/content-review-page.tsx` 的审核标题、主区/依据 Tab、问题/事实/平台/差异/记录区以及相关可访问名称统一为中文；组件和浏览器断言随之更新。`content-review-real-stack.spec.ts` 删除旧的原始 `START_PUBLICATION` 页面展示断言，继续断言服务端 `primary_task` 和中文“开始发布”链接，匹配 C03 当前页面合同。
- `content-review.model.test.ts` + `content-review-page.test.tsx`：2 files / 13 tests 通过，包含动作 token、意见校验、canonical response、批准 unknown 500、409 与 422。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 本轮生产预览 `content-review.spec.ts`：移动/桌面 25 通过、1 项移动 project 按宽度配置 skip。覆盖单 Review Context、direct/refresh/Back/Forward、只读依据、token 动作、CSRF/revision、409 不重放、422、错误恢复与 375/768/1024/1440 布局。
- 隔离真实栈首轮 Flow B（退回→新 HUMAN revision→重新送审批准）通过；Flow A 的业务批准和 API 校验成功，但旧的原始 token 展示断言失败。移除该过期断言后仅重跑 Flow A（人工批准→只读版本→发布交接）通过。两个流程合计分别有本轮成功证据，不把首轮失败计为通过。两次运行各自由脚本确认 Redis DB14、临时数据库/存储和端口清理；Compose 容器/卷已删除。
- 下一步 C07 内容版本详情，随后 C08 汇总 Content 真实闭环及状态 owner/共享边界。
