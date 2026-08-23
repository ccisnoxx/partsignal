# 技术设计

## 1. 设计目标

本 Task 不设计或修改生产架构，只设计验证证据的顺序、所有权与落盘方式。候选代码固定为启动时 `main` 的 `24cc8f81`；验证期间只允许 Trellis evidence 变化，任何产品/测试/runner 改动都使当前候选失效并要求停止。

## 2. 验证流水线

```text
Git / environment preflight
        ↓
独立 Make stages（同一 owner，非 fail-fast 诊断）
        ↓ all PASS
唯一一次 make verify（最终 fail-fast gate）
        ↓ exit 0
07/08 + parent/current Task evidence → Phase 7 MET
```

独立阶段不是复制测试：它直接调用根 Make target，使 unit、integration、build、real-stack/fixture E2E 和 Compose config 都能在最终 fail-fast gate 前被观察。四个 blocker 的定向命令不再运行。

## 3. 状态与证据 owner

| 事实 | Owner |
| --- | --- |
| candidate SHA 与 dirty set | Git |
| stage 命令与顺序 | 根 `Makefile` |
| API/generated drift | `make contract-check` |
| 静态质量 | `make lint`、`make typecheck` |
| backend/V1/V2 unit | `make test-unit` |
| PostgreSQL integration | `make test-integration` |
| 三套 production artifact | `make build` |
| V2 real-stack、V1 E2E、V2 fixture E2E 与 cleanup | `make e2e` / `e2e-local.sh` |
| 最终 Phase Gate | 唯一一次 `make verify` |
| 迁移/验收现状 | docs 07/08 |
| 历史 NOT_MET 与最终结果 | 父 Task + 当前 Task evidence |

不创建第二个 runner、聚合脚本、结果 parser、retry wrapper 或 secret scanner。

## 4. 结果分支

### PASS

全部独立阶段退出 `0` 后运行唯一最终 gate；若 `make verify` 也退出 `0`：

1. 记录每个阶段的实际结果、计数、耗时与 cleanup。
2. 在 07 Phase 7 追加 System abstraction review、四 blocker 和最终 gate 的完成证据，明确 Phase 7 `MET` 且不开始 Phase 8。
3. 在 08 新增 System abstraction/Phase 7 Exit Gate 验收小节，记录最终候选、各 suite 结果和敏感资源清理。
4. 在父 Task 追加 Recheck 后续证据并把当前 gate metadata 更新为 `MET`，但保留首次审计 `NOT_MET` 的历史说明。
5. 更新当前 Task evidence；报告 docs/Trellis-only commit plan 与后续 archive plan，等待批准。

### FAIL

任一独立阶段非零、无法安全运行，或最终 gate 非零：

1. 继续完成仍安全且独立的诊断阶段，形成同一批 owner 清单。
2. 不修改失败代码/测试/环境，不运行或重跑最终 gate。
3. 07/08 不标记 `MET`；当前 Task 与父 Task 记录 `NOT_MET`、失败阶段和建议的独立 blocker。
4. 报告 evidence-only commit plan，等待批准。

## 5. 文档与兼容边界

- 成功时只更新 07/08 和未归档的父/当前 Task evidence；不改 01/04/05/06/09、OpenAPI、database contract 或稳定 spec，因为 Recheck 不引入新架构/合同。
- 失败时默认只更新 Task evidence；不把临时失败重复写入长期设计文档。
- 已归档任务保持只读，不改写历史结论。

## 6. 停止与回滚

- 遇到未知资源 owner、敏感信息泄露、cleanup 失败、合同/权限/数据库 blocker 或任何需要代码修复的情况立即停止扩展动作。
- 不使用 reset-hard、checkout、broad delete、FLUSHDB、kill-all 或历史改写。
- 文档回滚只反向撤销当前 Task 明确 hunks；测试创建的资源由现有 runner 精确 cleanup。
- 一旦 candidate source SHA 变化，当前阶段结果不能与旧 SHA 拼接为同一 Gate；必须停止并重新规划新的候选验证。

## 7. 实际决策

PASS 路径已触发：独立阶段全部通过后，候选 SHA 保持不变，唯一一次最终 `make verify` 退出 `0`。因此只按既定成功分支同步 07/08 与父/当前 Task evidence，未修改生产架构、合同、测试或 runner。
