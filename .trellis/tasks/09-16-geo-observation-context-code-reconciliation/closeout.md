# T5-I6 关闭及两个父任务核对

日期：2026-10-24。范围：治理状态与证据核对；无源码修改、部署、提交、推送或归档移动。

## T5-I6：已关闭

用户明确接受：“接受 AC11 的历史证据缺口，保留 NOT_CAPTURED，以本轮当前验收记录作为收尾依据，关闭 T5-I6”。据此 review → completed，完成日期为本日，不倒填历史实施日期。

- 历史 AC11 前置 protected-owner 指纹永久 NOT_CAPTURED，原复合 checkbox 保持未勾选。这是明确接受的历史证据例外，不是伪造历史通过。
- 收尾依据：[当前 T6-C/T6-G 验收](../10-24-content-deletion-recovery-acceptance/implement.md)、对应 validation.json/scope-check.json、独立 review，以及历史 implementation-validation.md 的后端定向证据。本轮逐项比较 validation.json 的 12 份源码/测试 SHA-256，均未变化，未重跑。
- 该完成状态只关闭 T5-I6；前后端仍须作为相容候选交付，生产授权和其他发布检查不被豁免。

## 父任务：规划完成，聚合暂不关闭

| 任务 | 已核对事实 | 决定 |
| --- | --- | --- |
| Publication/GEO 合同决策 | PRD 13 项规划 AC 均已勾选；T5-I1..I5 在 archive/2026-09 各有唯一 completed 记录，T5-I6 本轮关闭，直接子项 6/6 completed。 | 保持 planning；不能仅按已登记子项计数宣布原实施计划全部完成。 |
| IntegrityError 领域错误映射 | PRD 13 项规划 AC 均已勾选；13 个直接子项中其余 12 项 completed，Publication/GEO 聚合项仍保留。 | 保持 planning，跟踪下述剩余工作。 |

本次纠正此前仅剩 T5-I6/T6-C 的不完整剩余清单。两份父 PRD 本身是 planning-only 工件，其规划交付已经完成；但一直兼作实施聚合跟踪，原 implement.md 尚有未登记为 child 的后续工作。不能在未移交这些责任时把聚合完成解释为实施线全部通过。

## 实际剩余及可复核依据

1. **T5-G 跨域完成核对**：Publication/GEO implement.md 第 8 节明确要求对 T5-I1..I6 的 code/constraint matrix、文档、实际 diff、真实 PG 证据与独立 review 做跨域一致性核对。搜索活动及归档任务后未找到 `publication-geo-integrity-t5-review-gate` 完成工件；单项 completed 和本轮 T6-C 复核不能替代整个 T5-G。下一步是复用既有证据完成该定向只读矩阵，明确任何失效输入或剩余差异；不是默认重跑后端全套。
2. **T6-P 发布 409 恢复验收**：原 implement.md 第 9 节要求 `REPAIR_TASK_EXISTS` 显式 reload issue workspace/repair context、区分 Work identity/idempotency/context/revision，并修正假码 `PUBLICATION_REVISION_CONFLICT`。当前 `frontend/src/domains/publication/publication-workspace-page.test.tsx:199` 和 `frontend/tests/e2e/fixtures/publication.fixture.ts:852` 仍使用该假码；相关 publication 源码/测试范围搜索无 `REPAIR_TASK_EXISTS` 精确场景。Issue Actions 已有通用 status 409 冻结及显式双 context 重读，Issue Workspace 测试也已覆盖通用 409；因此不能称功能完全未实现，也不能称 exact-code 合同已经验收。下一步是按真实服务端 code 补齐/纠正 fixture，验证恢复分支与 no replay，仅在定向检查证实行为缺口时修复。
3. 顶层 T6 的原 15-consumer 矩阵不能因本轮 GEO/content 完成而自动视为全部通过。应将后续交付证据映射回原 owner；已确认的 T6-P 缺口足以阻止当前聚合关闭，本次不扩大为全仓实现审计。

T5-G/T6-P 在原父任务继续有明确 owner，不创建或启动新实施任务。待这些要求有有效完成证据或用户明确批准其移交/范围处置后，再关闭两个父项；无需重新实现已完成子项。

## 本轮验证

- 读取三个任务 PRD/相关设计和实施门禁，遍历当前与归档 task.json 验证子项唯一性、parent 和 status。
- 复核当前验收源文件 12/12 hash 一致，复用已成功检查；此次无行为变更，不运行测试/构建。
- 检查 JSON、任务链接、AC11 未勾选及 NOT_CAPTURED 保留、allowlist 外文件 hash、HEAD/暂存区及 git diff --check，结果见 closeout-check.json。
- 未把未找到的 T5-G 记录表述为已经证明从未执行；目前证据不足，保持待核对。
