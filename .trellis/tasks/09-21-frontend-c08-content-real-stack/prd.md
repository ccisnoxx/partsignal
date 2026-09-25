# C08 Content 真实业务闭环

## Goal

在同一当前候选隔离栈验收 Content 人工与 AI 连续业务闭环，并复核状态所有权与组件边界。

## Requirements

- 前置 C05–C07 本轮完成。权威为 `docs/frontend-v2/08-testing-quality-and-acceptance.md` 第 13.3/13.4 节、`11-frontend-redevelopment-task-list.md` C08、OpenAPI、项目/前端 AGENTS 状态所有权规则。
- 人工 Flow A/B 分别证明创建、人工草稿、保存、提交、批准与发布交接，以及退回后新 HUMAN 修订、重新送审、批准和 v1/v2 历史归属；AI flow 独立证明生成、自然化、真实超时、按需失败快照和 exact retry。真实业务命令由 V2 页面完成，测试前置配置仅在规定范围用 API。
- 在当前候选生产预览与同一隔离 PostgreSQL/FastAPI/Celery/fake AI 服务上合并运行 Content 三个真实栈 spec。复核 Domain 对 server token/canonical pointer 的使用、Query/URL/Form/local 状态边界和 shared/design-system 依赖方向；只有实证缺口才改代码。

## Acceptance Criteria

- [x] 三个 Content 真实栈 spec 在同一当前候选隔离生命周期全部通过，临时数据库/Redis/对象存储/端口清理确认。
- [x] 完成状态 owner/组件边界复核；发现可操作缺口则修复并验证。
- [x] 记录实际代码、验收证据、残余风险及 U01 下一步。

## Notes

- 本项是 Content 汇总门禁，C05–C07 的 fixture/组件证据保留在各自任务，不将历史 V2 门禁记作本轮通过。

## 中途问题与处理（2026-09-21）

- 当前候选在同一隔离生命周期运行 `content-ai-real-stack.spec.ts`、`content-review-real-stack.spec.ts`、`content-version-detail-real-stack.spec.ts`，4/4 通过。覆盖 AI 生成/自然化/超时/retry、人工批准与发布交接、退回修订再批准、真实 HUMAN 只读详情。脚本确认 Redis DB14、临时数据库/存储及端口清理，Compose 容器/卷已删除。
- 独立只读边界复核确认原实现以 current content ID 作为 Workspace key，叠加 Editor Context 聚焦自动刷新，可在另一会话切换主线时卸载未保存表单和提交 Dialog。随后按下述最终交付修复、补行为测试并完成独立复核。

## 本轮最终交付与验收证据（2026-09-21）

- 实际代码：`frontend/src/domains/content/content-editor-page.tsx` 将 Workspace 挂载身份固定到 task ID，分离 Query 最新上下文与表单正在编辑的 snapshot。后台 pointer/revision/状态/服务端动作变化遇到 dirty、人工修订、提交 Dialog 或 pending 命令时保留输入和备注、暂停旧动作及 AI 命令，并要求显式 reload；reload 失败保留现场。自身成功命令通过服务端 refetch 受控采用 canonical，命令成功但读取失败也阻断旧上下文写入。
- `frontend/src/domains/content/content-ai-production.tsx` 仅以本地 job 响应桥接至服务端 latest job；任务作业 ID 改变时重取列表，以便外部新 job 从旧缓存缺席时仍可开始轮询。已打开的生成/自然化 Dialog 在确认按钮与 handler 两处检查最新 action token。服务端仍最终裁决。C05 原有中文展示继续保留。
- 独立只读审查先发现后台主线切换导致表单重建，再复核候选发现旧 J1 遮蔽外部 J2 与 Dialog token 撤销缺口；修复后窄复核确认两项解除，未发现新的确认阻断。该审查只读，运行结果由本轮实际测试承担。
- 编辑器与 AI 直接组件测试 31/31 通过；新增 8 个编辑现场/重载/命令失败用例及 3 个 AI job/token 用例。原有 Editor 浏览器 32/32、新增竞态 4/4 通过；最终 AI 与后台保护受影响浏览器回归 10/10 通过。最终候选 `npm test` 全前端 83 files / 551 tests 通过，typecheck、lint、`git diff --check` 通过。真实栈脚本同时完成 production build。
- 修复后在同一隔离 PostgreSQL/FastAPI/Celery/fake AI/生产预览生命周期重跑 Content AI、人工审核 Flow A/B、版本详情四场景，4/4 通过。证据包含生成/自然化/超时与 exact retry、人工批准和 `/publishing/work` 交接、退回后的独立 HUMAN 修订及版本只读。脚本报告 Redis DB14 清理、端口 8000/9001/4174/19009 释放、临时数据库删除、临时存储删除；Compose 容器/卷已删除。
- 范围限制：跨会话并发反例由当前候选组件/fixture 模拟不同服务端快照并验证，真实栈四场景未额外启动两个浏览器会话；该差异已显式记录。下一步 U01 Ready Queue 与发布工作列表，随后依赖推进 U02–U07。
