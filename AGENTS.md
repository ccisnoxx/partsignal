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

# PartSignal Project Rules

- 系统采用契约优先的模块化单体，`contracts/openapi.yaml` 和 `contracts/database.md` 由主 Agent 维护。
- `backend/` 与 `frontend/` 是并行开发边界；子 Agent 不得越界修改根目录、契约、部署文件或执行 Git。
- PostgreSQL 是业务状态唯一来源，Redis 只用于 Celery Broker。
- Markdown 是内容唯一可编辑正文源，不保存可独立编辑的 HTML 或编辑器 JSON。
- AI 输出只能创建草稿，未知产品事实必须失败，不得猜测、补零或使用模糊兼容逻辑。
- 已批准事实和内容不可原地修改；发布记录和 GEO 观测必须保留历史。
- 新增或实质修改的中文业务代码应补充必要的中文注释、Docstring、日志和错误信息。
- 实现前读取相关文档和契约；契约不清时报告主 Agent，不得自行创建兼容字段或第二套类型。
- 测试必须明确区分开发适配器与真实外部服务，不得用固定成功路径掩盖未实现业务。
- 所有状态转换、权限和输入校验以服务端为最终权威，前端隐藏按钮不构成安全控制。


## Project Overrides

### Language

- User-facing replies should default to Chinese.
- AI-created or substantially changed code comments, docstrings, JSDoc/TSDoc, logs, exception messages, and print outputs should default to Chinese.
- Keep machine-readable fields, protocol fields, config keys, API fields, error codes, structured log keys, code identifiers, and CLI/file path literals in their required original form.
- Project documentation, Trellis specs, and task artifacts should default to Chinese. This project-specific rule overrides any generic Trellis template language notes that say documentation should or must be English, unless the target path already has a clear English convention, external publication requires English, or the user explicitly requests English.
- Do not add comments for obvious code. Comments should explain non-obvious responsibilities, boundary conditions, side effects, business rules, exception branches, and important trade-offs.
- When editing Python files, tests, scripts, or Trellis docs in this project, apply a touched-scope documentation pass: review newly added or materially changed modules, classes, functions, complex branches, exception paths, developer-visible output, and nearby touched comments/docstrings.
- If touched code contains English comments, docstrings, JSDoc/TSDoc, logs, exception messages, or print output, translate or rewrite them into Chinese unless they are external protocol text, third-party/API field names, machine-readable values, test-contract literals, or explicitly requested English text.
- Do not add comments to untouched legacy code only because the file currently has few or no comments; prefer updating the touched code and removing stale, misleading, or mechanical comments such as `START/END MODIFICATION`.
- After non-trivial Python changes, the final reply should state whether comments/docstrings/developer-visible text were added, updated, or intentionally left unchanged.

### Trellis Usage

- For simple conversation, read-only investigation, small local fixes, or low-risk single-file changes, do not ask whether to create a Trellis task and do not create one unless the user explicitly asks for one. This project-specific rule overrides generic Trellis no-task triage prompts.
- Use a Trellis task for cross-module changes, public API changes, data contract changes, configuration changes, database changes, permission changes, cache/state-sync changes, long-lived requirements, or work that needs explicit acceptance criteria.
- Once a Trellis task exists, read `prd.md`, `design.md`, `implement.md`, and the relevant `.trellis/spec/` files before writing code.
- For complex tasks, do not implement until `prd.md`, `design.md`, and `implement.md` are reviewable.

### Engineering Constraints

- Confirm the real implementation before editing. Do not add guessed compatibility fallbacks or silent defaults.
- Default to the smallest sufficient solution. Do not introduce extra layers, factories, strategies, plugins, DDD, microservices, or generic frameworks for architectural appearance.
- Introduce abstraction only when real duplication, a clear testing boundary, multiple concrete implementations, a stable ownership boundary, or proven change pressure exists.
- Do not add thin wrappers that only forward fields, wrap one call, or rename another function.
- Do not hardcode secrets, tokens, private config, or real credentials. Use the existing project configuration mechanism or environment variables.
- Validate and sanitize external input at system boundaries. Use parameterized queries or existing safe project APIs for database access.

### Validation

- After code changes, run the smallest effective validation.
- For Trellis tasks, validate according to `implement.md` and the relevant spec quality gates.
- If heavier checks are skipped, state the reason, the substitute checks, and the remaining risk.

### Browser Automation

- Use the project-installed `playwright-cli` skill for local UI debugging, repeatable browser workflows, and post-deployment validation.
- Prefer existing Playwright tests or project scripts before creating an ad hoc browser flow.
- Use snapshots, `find`, or a known selector to inspect and target elements; take screenshots only when visual evidence is needed.
- Use `playwright-cli console`, `requests`, and tracing for ordinary frontend diagnostics.
- For authenticated deployed checks, use a named persistent session or saved storage state, and keep authentication state files untracked.
- Turn a verified browser flow into a Playwright test when it will be repeated or used as a regression check.
- Use Chrome DevTools CLI only when Playwright CLI does not cover the required diagnostic, such as Lighthouse, deep performance profiling, or heap snapshots.
- Use `@Chrome` only when the user explicitly requests it or the interaction depends on visual browser state that Playwright cannot represent reliably.

### Git

- 当前开发阶段采用 `main` 单分支流程。除非用户明确要求，不得创建 `codex/*`、`agent/*`、`feature/*` 或其他开发分支；日常变更直接提交到主工作目录的 `main`。
- 平台自动创建的 detached worktree 只用于隔离执行，不作为最终交付分支。完成后必须把已验证变更提交到主工作目录的 `main`，不得把成果遗留在临时分支或旧 worktree。
- 开始新工作前先确认主工作目录位于 `main` 且工作区干净；需要同步远端时只允许在干净工作区执行 `git pull --ff-only origin main`。
- 如果用户明确批准临时分支，完成并合入 `main` 后应删除对应本地和远端分支，避免形成第二条开发线。
- Do not run `git reset --hard`, `git checkout -- <file>`, history rewrites, or broad deletion unless the user explicitly requests and confirms it.
- Before committing work code, present a commit plan and get user confirmation.
- Do not include unrecognized dirty files in commits.
- Do not push automatically.
- Before running `task.py archive` or `add_session.py`, explain if it may create Trellis bookkeeping commits.

### Documentation Maintenance

- 当功能、业务规则、权限、数据模型、API、配置或部署行为发生变化时，必须在同一任务中更新对应的权威文档。
- 方案文档只描述当前已实现或已明确批准的设计；删除或改写已失效、与实现冲突的旧方案，决策过程保留在已归档的 Trellis 任务中。
- 避免重复维护同一事实：API 以 `contracts/openapi.yaml` 为准，数据库以 `contracts/database.md` 为准，稳定开发约束写入 `.trellis/spec/`，业务与系统关系写入 `docs/` 方案文档。
- 任务完成或归档前检查代码、契约、测试和方案文档是否一致；无需更新文档时，在收尾说明中明确原因。
