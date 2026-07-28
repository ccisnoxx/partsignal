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

- The system uses a contract-first modular monolith. The main agent maintains `contracts/openapi.yaml` and `contracts/database.md`.
- `backend/` and `frontend/` are parallel development boundaries. Subagents must not cross those boundaries to modify root-level files, contracts, deployment files, or run Git operations.
- PostgreSQL is the sole source of business state. Redis is used only as the Celery broker.
- Markdown is the sole editable source for content bodies. Do not store independently editable HTML or editor JSON.
- AI output may create drafts only. Unknown product facts must fail explicitly; do not guess, substitute zeros, or add fuzzy compatibility logic.
- Approved facts and content must not be modified in place. Publishing records and GEO observations must preserve history.
- New or materially changed business code should include necessary Chinese comments, docstrings, logs, and error messages.
- Read the relevant documentation and contracts before implementation. If a contract is unclear, report it to the main agent; do not invent compatibility fields or a second type system.
- Tests must clearly distinguish development adapters from real external services. Do not hide unimplemented business behavior behind fixed-success paths.
- The server is the final authority for all state transitions, permissions, and input validation. Hiding a frontend button is not a security control.


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

- After code changes, select the highest-value validation for the affected behavior and risk; do not treat every available check as a required sequence.
- For Trellis tasks, `implement.md` must separate required validation from optional full-suite validation and list the exact commands for each. Relevant spec quality gates remain authoritative.
- Required validation should directly cover the changed behavior or boundary. Full backend or frontend suites, complete builds, E2E runs, and other repository-wide checks are optional unless the change affects shared contracts, database behavior, permissions, state transitions, core common modules, release readiness, or the user explicitly requests them.
- Apply the global failure-attribution and repair-loop rules to every failed check. An optional full-suite failure does not become part of the current task unless evidence ties it to the current change and requested scope.
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

- The current development phase uses a single-branch workflow on `main`. Do not create `codex/*`, `agent/*`, `feature/*`, or other development branches unless the user explicitly requests one. Commit routine changes directly to `main` in the primary working directory.
- Detached worktrees created automatically by the platform are for execution isolation only and are not delivery branches. After completion, commit the validated changes to `main` in the primary working directory; do not leave deliverables on a temporary branch or stale worktree.
- Before starting new work, confirm that the primary working directory is on `main` and clean. If the remote must be synchronized, run `git pull --ff-only origin main` only from a clean working tree.
- If the user explicitly approves a temporary branch, delete its local and remote copies after the work is complete and merged into `main` so that it does not become a second development line.
- Do not run `git reset --hard`, `git checkout -- <file>`, history rewrites, or broad deletion unless the user explicitly requests and confirms it.
- Before committing work code, present a commit plan and get user confirmation.
- Do not include unrecognized dirty files in commits.
- Do not push automatically.
- Before running `task.py archive` or `add_session.py`, explain if it may create Trellis bookkeeping commits.

### Documentation Maintenance

- When functionality, business rules, permissions, data models, APIs, configuration, or deployment behavior changes, update the corresponding authoritative documentation in the same task.
- Design documents must describe only the currently implemented or explicitly approved design. Remove or rewrite obsolete designs that conflict with the implementation, and preserve the decision history in archived Trellis tasks.
- Avoid maintaining the same fact in multiple places: `contracts/openapi.yaml` is authoritative for APIs, `contracts/database.md` for the database, `.trellis/spec/` for stable development constraints, and design documents under `docs/` for relationships between the business and the system.
- Before completing or archiving a task, verify that the code, contracts, tests, and design documents are consistent. If no documentation update is needed, state why in the closeout summary.
