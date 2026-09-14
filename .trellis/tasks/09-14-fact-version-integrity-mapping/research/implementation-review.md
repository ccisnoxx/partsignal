# Independent implementation review

- Date: 2026-09-14
- Reviewer: 独立只读 `critical_reviewer`
- Scope: PostgreSQL diagnostics、事务/锁与持久化副作用、HTTP error boundary、Fact Workspace no-replay、文档和文件 owner。
- Review policy: 一次 full review；发现 material finding 后一次 repair pass 与一次 targeted re-review。reviewer 未修改文件。

## Full review findings

独立 review 确认后端 command owner、exact classifier、root rollback、真实 catalog/23505、Product-lock 并发、HTTP no-leak 与持久化快照没有明确 material issue；发现两项前端 P2：

1. pending canonical GET 返回时无条件 `form.reset`，会在慢 GET 期间用户关闭 Dialog 并编辑 Markdown 后静默覆盖新输入。
2. `status >= 500` 只替换显示文案，若 payload 仍携带 `FACT_REVIEW_PENDING`、`REVISION_CONFLICT` 或 `INVALID_STATE_TRANSITION`，旧实现仍可能产生 recovery 并触发 blocker/refetch/专用分支。

reviewer 同时指出：测试没有 runtime broker dispatch spy/counter；当前 service/router 静态调用路径没有 dispatch，因此未发现实际 broker 副作用，但验证报告必须区分静态调用边界与 runtime 计数。

## 唯一 repair pass

- canonical GET 完成时读取当前 `form.formState.isDirty`。有 dirty 草稿时同时跳过 `form.reset` 与 `setBaseRevision`，既保留本地输入，也保留旧 revision 基线，避免把旧草稿伪装成基于新 revision；query read model 与 `available_actions` 仍由 refetch 收敛。
- recovery 增加 `!isServerFailure` 前置条件；任何 5xx 即使带完整 details/request ID 和上述三个领域 code，也只能走 generic server failure。
- 新增 deferred GET 组件回归与 5xx × 三 code model matrix；页面 500 用例使用 `FACT_REVIEW_PENDING` 文本/code 反例，证明不自动 GET、不建立 pending blocker且 POST once。

## Targeted re-review

唯一 targeted re-review 结论：两项 P2 均关闭，未发现修复引入的新 material issue。

- deferred GET 测试真实执行“关闭 Dialog → GET 等待期间编辑 → 释放 GET”，断言 local input 保留、仍基于 Revision 3、canonical 提交动作消失、POST 恰一次。
- `!isServerFailure` 覆盖全部 `status >= 500`；page/Dialog 都只消费 `mapped.recovery`，因此领域 code 不能令 5xx 进入 pending/revision/state recovery。

没有执行第三轮 review。剩余 coverage gap 仅为 execution results 已明确记录的 runtime dispatch spy、可选完整 suite/build 与无关 frontend typecheck 阻断，不构成当前候选的 material finding。
