<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# PartSignal 项目规则

## 业务与架构不变量

- 系统采用 contract-first modular monolith。`contracts/openapi.yaml` 是 API 权威，`contracts/database.md` 是数据库权威；根级合同由主代理维护。
- `backend/` 与 `frontend/` 是并行修改边界。被限定在单侧目录的子代理不得修改根级合同、部署文件或执行 Git 操作。
- PostgreSQL 是业务状态唯一来源；Redis 只作 Celery broker。服务端最终裁决状态转换、权限和输入校验，前端隐藏入口不构成安全控制。
- Markdown 是内容正文唯一可编辑来源，不保存可独立编辑的 HTML 或 editor JSON。
- AI 只能创建草稿；未知产品事实显式失败，不猜测、补零或增加模糊兼容。
- 已批准事实与内容不可原地修改。Publishing 与 GEO 记录在保留期间不可变；唯一跨历史删除例外是管理员永久删除已明确归档的 content-task aggregate。
- 开发适配器和真实外部服务在代码与测试中明确区分，未实现业务行为不得以固定成功路径伪装。

## 项目工作流

- 小型局部修改、只读调查和简单对话不需要 Trellis task。跨模块、公共合同、数据库、权限、状态同步、配置、长期需求或需要独立验收的工作使用 task。
- 首次进入现有 task、范围变化或上下文缺失时读取相关 `prd.md`、`design.md`、`implement.md` 与 spec；同一 task 中复用未变化的已读上下文。
- `frontend/AGENTS.md` 只拥有前端目录规则；`docs/frontend-v2/README.md` 路由专项设计文档。迁移计划仅用于迁移、legacy routing、阶段门禁、分支或 Cutover 历史。
- 当前分支规则有两个记录来源：本文件采用 `main` 单分支，迁移历史记录 V2 临时分支例外。创建分支或提交前依据用户当前指示解析，不自动沿用历史例外。
- 功能、权限、数据模型、API、配置或部署行为变化时更新对应权威文档；一次性实现过程留在 task 历史，不复制到多个稳定规范。
