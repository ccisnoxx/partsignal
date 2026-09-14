# Planning review：FactVersion IntegrityError mapping

- Review type：独立只读 full planning review + 唯一一次 targeted re-review
- Date：2026-09-14
- Scope：本 Task 的 PRD、design、implement、JSONL manifests、全部 research；父任务/合同 owner 的相关 planning；backend/frontend stable specs；current-head command 与 Fact Workspace 状态边界
- Implementation：未执行

## Full review 结论

独立 reviewer 确认后端 authoritative owner、精确 PostgreSQL diagnostics 分类、unknown/default 500、command root rollback、Product-lock 正常并发与 exact sentinel 分离均无明确阻断问题；发现两项 P2 planning finding。

### P2-1：Dialog 生命周期会丢失 pending blocker

初稿把 pending blocker 放在 `SubmitReviewDialog`，但刷新失败时 query 保留含 `SUBMIT_REVIEW` 的旧 workspace；用户关闭 Dialog 会卸载其状态，再次打开即可发出第二次 POST。这违反 pending 后 no-replay，并使“Dialog 内禁止二次提交”的测试不足以覆盖页面入口。

修复：

- blocker owner 提升为按 `productId` 隔离的 `FactWorkspaceEditor`；
- 页面提交入口、Dialog confirm 和实际 submit handler 共同消费同一 blocker；
- 关闭/重开 Dialog 或再次触发旧页面 action 不解除 blocker，POST 仍恰一次；
- refetch 失败保留原 pending message、request ID、input 与 blocker；
- 只有真实 canonical refetch 成功后才清理临时 blocker，并由服务器 `available_actions` 重评动作；
- A 产品 blocker 不得泄漏到 B 产品。

对应收敛位置：`prd.md` R8/AC10-AC11、`design.md` 5.2/测试结构、`implement.md` Phase B。

### P2-2：其他 code generic 与既有 INVALID_STATE_TRANSITION 冲突

初稿设计把 pending/revision 之外的“其他 code”全部写为 generic，但 current-head `submitReview` 对结构完整的 `INVALID_STATE_TRANSITION` 有独立 `onReload()` 行为，PRD 又要求保留它。该歧义可能让实施误删已有恢复分支。

修复：

- 结构完整的既有 `INVALID_STATE_TRANSITION` 明确保留为独立 canonical refetch decision；
- 它不获得 pending blocker 或 revision-conflict 语义；
- 除该既有分支外的 unknown code 才走 generic summary；
- malformed payload、缺失/空 request ID 仍安全 fallback；
- model/page required regression 单独覆盖该分支。

对应收敛位置：`prd.md` R9、`design.md` 5.1/5.3/测试结构、`implement.md` Phase B。

## Targeted re-review

唯一一次 targeted re-review 只复核上述两项修复，结论：两项 P2 均已关闭，无剩余 material finding。

reviewer 特别确认：

- editor-owned blocker、关闭/重开 no-replay、真实 refetch success 后才按 `available_actions` 重评，以及 `productId` 隔离均已形成可验收要求；
- `INVALID_STATE_TRANSITION` 独立 refetch、unknown code generic 与 malformed fallback 的边界已在三份规划中一致。

## 非阻断 caveat

- fresh `0043` PostgreSQL planning probe 只冻结 catalog/diagnostics；实施仍须在自己的 fresh-head fixture 中重复并证明 service、HTTP、rollback、Session reuse 与零 skip。
- research 中出现过“独立连接 competitor”的早期候选建议；最终实施以 `design.md` 的同 root transaction one-shot sentinel 为准，避免 FK 与 Product `FOR UPDATE` 造成测试等待/死锁。正常 Product-lock 并发另设独立双 Session 用例。
- 两类目标 unique failure 都发生于首个 FactVersion flush、早于候选 FactReviewRecord；其零残留断言仍须与 catch 覆盖后续 FactReviewRecord/commit 失败窗口的 owner 结构证据一起审查，不能把首个 flush 用例误称为所有晚期异常的动态证明。

## 最终 planning review 状态

Planning review 通过：无 material finding。后续仍必须等待用户明确批准实施，且不得用本 review 代替 implementation review。
