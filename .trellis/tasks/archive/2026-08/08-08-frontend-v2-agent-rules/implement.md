# Implementation Plan

## Ordered Steps

1. 再次核对根规则与 V2 蓝图，只提取需要在 `frontend-v2/` 自动生效的专有约束。
2. 新增精简的 `frontend-v2/AGENTS.md`，按“上下文、架构与状态、服务端动作、UI Pattern、开发与质量、禁止模式”组织。
3. 自审目标文件，删除与根 `AGENTS.md` 重复的通用规则，并核对 `07-migration-plan.md` 第 3、4、5.1 节。
4. 运行必需验证，检查 diff 和工作区范围，报告结果并等待 commit plan 确认。

## Required Validation

```bash
git diff --check -- frontend-v2/AGENTS.md .trellis/tasks/08-08-frontend-v2-agent-rules/
rg -n 'workflow_stage|primary_task|available_actions|Action Registry|Server State|URL State|Form State|Transient UI State|DataTable|Redux|Next.js|页面状态机|猜测性兼容' frontend-v2/AGENTS.md
git diff -- frontend-v2/AGENTS.md .trellis/tasks/08-08-frontend-v2-agent-rules/
git status --short
```

随后人工确认：

- 未复制根 `AGENTS.md` 的通用规则；
- 未与 `docs/frontend-v2/07-migration-plan.md` 冲突；
- 未遗漏 PRD 中的 V2 边界；
- 未夹带应用初始化或其他实现工作。

## Optional Validation

无。本任务没有应用代码、依赖或可执行行为，不运行 npm、构建、测试或浏览器检查。

## Rollback Point

提交前删除本 Task 新增的 `frontend-v2/AGENTS.md` 和 Trellis task 目录即可完整回滚；不得改动其他文件。
