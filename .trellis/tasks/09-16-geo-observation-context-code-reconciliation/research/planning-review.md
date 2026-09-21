# Independent Planning Review

- 日期：2026-09-16
- 模式：T5-I6首次独立高风险只读full review；不是重新开启父T5-C已经用完额度的全量第三轮review
- 范围：当前Task PRD/design/implement/audit/两个JSONL，以及为修正真实owner所必需的父T5-C operation matrix、T5-I6 allowlist和T6 release delta
- 运行时验证：未运行PostgreSQL、pytest、frontend tests或`task.py start`；这些属于实施阶段

## Full review finding

### P2：共享content-task consumer缺少release owner

初稿把T5-I6 frontend recovery全部交给T6-G，但T6-G allowlist只覆盖GEO域。三个新增共享operation的真实consumer是`frontend/src/domains/content/content-task-lifecycle.tsx`：当前任意404/409都会自动invalidate detail/list/preview，permanent-delete POST失败后旧preview和确认文本可能继续留在打开的dialog中，用户可以直接再次提交，未满足chain changed的显式刷新/重开/重新确认。

触发条件：`getContentTaskPermanentDeletionPreview`、`deleteContentTask`或`permanentlyDeleteContentTask`从共享GEO chain helper收到`GEO_OBSERVATION_CONTEXT_INCOMPLETE`或`GEO_OBSERVATION_CHAIN_CHANGED`，而只完成T6-G GEO页面投影。

影响：I6 backend code若在content lifecycle consumer修复前发布，会使新code退化为generic 409；permanent-delete POST尤其可能复用旧确认状态，违反no replay/reconfirm gate。

## Repair

- 新增T6-C`frontend-content-task-geo-chain-recovery-reconciliation`，由它独立拥有content lifecycle，不扩大T6-G跨domain allowlist。
- T6-C精确allowlist覆盖`content-task-lifecycle.tsx`、list/detail unit tests、content fixture与list/detail E2E；`content.api.ts`只读复核，因为现有`ContentRequestError`已保留status/code/request ID。
- 冻结preview GET为显式reload且不得使用旧preview；普通DELETE保持blocked/no replay；permanent-delete POST的chain changed使旧preview与确认文本失效，必须显式刷新/重开并重新确认。
- release gate修订为：T5-I5至少等待T6-G；T5-I6同时等待T6-G与T6-C。T6-C不在当前Task实施。
- 修正文案精度：`permanentlyDeleteContentTask`是POST mutation，不再统称为两个DELETE入口。
- required backend gate改为运行完整`test_publication_workflow.py`，避免`-k`遗漏新增共享operation测试。

## Targeted re-review

唯一一次targeted re-review通过：

- T6-C owner、allowlist及unit/typecheck/lint/E2E/diff required checks已冻结，所有目标路径存在。
- T5-I6 release gate已在当前PRD与父T5-C同步为同时等待T6-G和T6-C。
- preview GET、普通DELETE、permanent-delete POST的恢复语义已区分；后者明确使旧preview和确认文本失效。
- 当前任务与父T5-C均运行完整`test_publication_workflow.py`，没有`-k`遗漏新增测试。
- 未发现修订引入的新material矛盾。planning review额度已用完，不允许第三轮。
