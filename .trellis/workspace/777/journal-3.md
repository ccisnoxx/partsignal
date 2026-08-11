# Journal - 777 (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-08-11

---



## Session 115: 完成 Frontend V2 Publication Workspace Core

**Date**: 2026-08-11
**Task**: 完成 Frontend V2 Publication Workspace Core
**Branch**: `codex/frontend-v2-publication-workspace-core`

### Summary

实现固定查询的 Publication Workspace Context、V2 工作区 Core 动作、Evidence 两阶段上传、DirtyGuard、合同与真实栈 E2E；全部目标门禁通过。

### Main Changes

- 新增 `PublicationWorkspaceContext`，在 `REPEATABLE READ` 中以固定 5 条查询返回工作区快照，并同步 OpenAPI 与两套生成类型。
- 实现 V2 Publication Workspace 六个 canonical hash、Core 动作、按需发布包、Evidence 两阶段上传、409 保留与 DirtyGuard。
- 补齐组件、production-artifact、真实栈 Flow A 和权威规范；无数据库持久化结构变更。

### Git Commits

| Hash | Message |
|------|---------|
| `1035878` | (see git log) |

### Testing

- Backend PostgreSQL 目标集成测试 2/2、Ruff、`make contract-check` 通过。
- Frontend 目标测试 11/11、ESLint、TypeScript、production build 通过。
- Production-artifact E2E 8/8、真实栈 V2 8/8、旧版回归 52/52；临时数据库和对象存储已清理。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 116: Frontend V2 Publication Verification

**Date**: 2026-08-11
**Task**: Frontend V2 Publication Verification
**Branch**: `codex/frontend-v2-publication-verification`

### Summary

完成 Publication Verification/Switch 闭环、后端动作投影与合同测试；真实栈 Flow B 因现有 Content 修订入口缺失按设计记录阻塞。

### Main Changes

- 实现 Verification FAILED/PASSED、精确候选换版、409 显式重载和完成态只读交接。
- 修正换版后服务端动作投影：必须重新登记结果后才恢复核验。
- 更新 OpenAPI、生成类型、后端/前端测试、production E2E 和 Publication 权威 spec。

### Git Commits

| Hash | Message |
|------|---------|
| `6c664fd` | (see git log) |

### Testing

- Contract check、Frontend V2 lint/typecheck/build 通过。
- 后端单元测试 11 个、独立 PostgreSQL 目标集成用例、前端目标组件测试 15 个通过。
- Publication production E2E mobile/desktop 共 10 个通过；真实栈 Publication Flow A 通过。
- 真实栈 Flow B 因现有 Content Task/Edit 不开放批准版本修订而按设计停止，缺口已记录在归档任务的 `implement.md`。

### Status

[OK] **Completed**

### Next Steps

- 父任务后续决定是否单独扩展 Content workflow，以解除真实栈 Flow B 前置缺口。
