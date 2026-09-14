# Independent High-risk Review

- Date: 2026-09-14
- Mode: 一次 full read-only review + 一次 targeted re-review
- Scope: `prd.md`、`design.md`、`implement.md`、`research/decision-synthesis.md`、两个 JSONL 及直接相关 service/ORM/migration/contract/test evidence
- Runtime validation: 未运行后续实施命令、真实 PostgreSQL diagnostics 或并发实验；这些由 T5-I1..I6 required checks负责。

## Full review findings

1. P1：初稿把 Repair Task 的 source 解绑与原 Article 来源 ContentTask 的 OPEN/CANCELLED、revision 恢复混为同一 state owner。
2. P1：初稿把“完整 ordinary winner没有 GEO source”与“winner/source identity不完整”一起归为 unknown，导致 GEO race 与 precheck不同义。
3. P2：T5-I4缺普通 ContentTask 回归，若干后续 Task和 T6 的命令/文件边界不够精确。

## Repairs

- PRD/design/implement/research 已明确：Repair Task仅 source置 NULL且 state/revision不变；原 Article 来源 ContentTask才按平台恢复 OPEN/CANCELLED、`revision + 1`并保留 `archived_at`。
- GEO 规则已改为：完整 ordinary winner（无 GEO source）返回 `IDEMPOTENCY_CONFLICT`；winner不存在、必要 ContentTask identity缺失或已存在 GEO source自身不完整才 unknown。
- T5-I4纳入 `test_content_task_creation.py`；T5-I2..I6补全可执行 required/optional命令；T6拆为 T6-P/T6-G并冻结 allowlist、验证、停止/回滚和 release-atomic gate。

## Targeted re-review result

三项 finding 均已关闭，修订范围未发现新的实质合同矛盾。独立 review额度已用完：后续若 planning再发生 material变更，必须报告而不能启动第三轮 review。
