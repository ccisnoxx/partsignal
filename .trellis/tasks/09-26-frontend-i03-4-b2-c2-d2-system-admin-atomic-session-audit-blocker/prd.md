# I03-4-B2-C2-D2 Blocker System Admin 原子 session 失效响应审计

## Goal

最终 clean-checkout make verify 在真实栈 System Admin 场景中因 reset-invalid-session 仍只允许旧 /api/v1/auth/me 401、未允许 D1 后规范化 /api/v1/auth/session 401 而失败；修复并重新建立完整门禁证据。

## Requirements

- 以固定产品候选 `ff018cb90f932e54cacda9cead06c74c7880ab42` 为起点，解释密码重置后页面 reload 为何发出两次 `/api/v1/auth/session` 读取，逐次确认 owner；没有合法 owner 的重复读取必须消除，不能用 allowlist 掩盖请求风暴、迟到 continuation 或跨主体污染。
- 修复 `frontend/tests/e2e/system-admin-real-stack.spec.ts` 中 `reset-invalid-session` 的精确运行时审计合同，使其与 D1 的规范化 `/api/v1/auth/session` 合同一致；不得宽泛允许其他 method、path、phase、status 或未知次数的失败响应。
- 保留对旧 `/api/v1/auth/me` 显式失效会话探针的断言，除非权威认证合同明确要求同步迁移该探针；不要弱化 `AUTH_REQUIRED`、跳转登录、无错误提示或 secret 审计。
- 先运行最小定向验证；修复后的最终结论仍必须由新的 detached clean checkout 单次完整 `make verify` 建立，不得把本轮失败后的局部通过冒充完整门禁。
- 完整门禁通过、资源清理为 0 且 fixed tree 更新明确后，才恢复 D2 的完整候选独立高风险复核和 I03 父链收尾。
- 在 D2 与独立复核通过前，不创建 I04，不 fetch/push，不连接 hostdzire，不执行任何远程写入。

## Acceptance Criteria

- [x] 说明两个 `/api/v1/auth/session` 401 的调用 owner、时序和期望，证明不存在认证跨 snapshot、ABA、重复副作用或请求泄漏。
- [x] `reset-invalid-session` 只允许精确预期的原子 session 401；其他真实栈 runtime error 继续失败。
- [x] System Admin 真实栈定向用例通过，secret scan clean，固定端口、Redis DB 14、隔离数据库和临时对象存储清理为 0。
- [x] 新 detached clean checkout 中单次完整 `make verify` 退出 0 并覆盖全部后续门禁。
- [ ] fresh `critical_reviewer` 对更新后的完整候选与门禁证据给出 `NO BLOCKER`，随后才允许完成 D2/I03 父链并创建 I04。

## Notes

- 触发证据：`/tmp/partsignal-i03-d2-ff018-make-verify.log`（SHA-256 `ff58ff180b8e4455b6a1bd7ace11f270b0ab526a2057f7e213349b1d1231b7fd`），Playwright `15 passed / 1 failed`，失败位置 `frontend/tests/e2e/system-admin-real-stack.spec.ts:774`。
- 父任务 D2 与全部上层任务保持 `in_progress`；本 blocker 最初以 `planning` 保存，等待下一会话按 `trellis-continue` 启动。
- 2026-09-26 已启动为 `in_progress`。无凭据诊断证明第一次 401 来自失效 session reload 后唯一 AuthProvider mount；第二次来自测试 `login()` 在页面已经收敛到 `/login` 后再次执行 `page.goto('/login')`，形成第二个 document mount。没有 focus refetch、第二个 session owner、请求风暴、迟到 continuation 或跨主体写入。
- 最小修复让 `login()` 支持显式跳过导航；reset 恢复路径直接在当前登录页提交，运行时错误只允许精确 `/api/v1/auth/session` 401，并以 phase/origin/method/path/status/attempts/responses 断言恰好一次。显式 `/auth/me` 失效探针及 `AUTH_REQUIRED` 断言保持不变。
- 诊断日志 `/tmp/partsignal-d2-auth-owner-diagnostic.log`：36463 bytes，SHA-256 `d3f179aacd368bbc80e438150450b113f11f923758b7cc97ddb2c51fd10ae585`；其退出 1 是修复前已知 runtime allowlist blocker，secret scan clean 且资源完整清理。
- 修复后定向日志 `/tmp/partsignal-d2-system-admin-targeted.log`：34082 bytes，SHA-256 `59efaeb87bb708ae3d1aaf102c447a2b5d57dbfa602d87ad2bf667ab8be78fae`；System Admin `1/1 passed`、secret scan clean、退出 0。TypeScript、单文件 ESLint 与 runtime helper `13/13` tests 也通过；运行前后四端口、Redis DB 14 和隔离数据库均为 0。
- 新固定候选为 commit `4e739f68f3ef87286d7b22e77ebfd353bafda6e8`、tree `425ec420f117ddf094172bd862ffd059f59cde45`。其唯一一次完整门禁确认真实栈 System Admin `16/16` 通过且该 reset phase 只有一次受控 `/api/v1/auth/session` 401，但随后 fixture Playwright 因独立的 Platform Types CSRF 期望漂移退出 2；本任务因此仍不能完成，后续由同级 blocker `09-26-frontend-i03-4-b2-c2-d2-platform-types-fixture-csrf-blocker` 恢复。
- 后续固定候选 `d168dcd88a30e604ebdfb8f1d6e9739b2afeb32b`、tree `4bace747c00c6ad68fda9c149b4f58c77aa60803` 的全新 detached checkout 唯一一次完整 `make verify` 退出 0，真实栈 System Admin `16/16`、fixture、secret scan、全部生命周期、部署 harness 与 Compose 门禁均通过。
- fresh `critical_reviewer` 确认本 System Admin 修复的单一 owner、精确流量断言、显式 `/auth/me` 探针、`AUTH_REQUIRED`、登录跳转与 secret scan 均成立，但在完整候选中发现独立的跨标签页 session-binding epoch P1 blocker；本任务暂不标记完成。
