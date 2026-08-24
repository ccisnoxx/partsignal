# Frontend V2 Auth Workbench Request Cancellation Blocker — 实施计划

## 1. 当前状态与启动记录

- Task status=`in_progress`，当前分支为 `codex/frontend-v2-auth-workbench-request-cancellation-blocker`。
- 用户已批准规划、Phase A 安全诊断与诊断后的 Phase B1 test collector owner。
- Phase A 取得唯一四元组证据后停止；Phase B1 已仅在目标 real-stack spec 内完成并通过 Required Validation。
- 实际启动命令为：

```bash
python3 ./.trellis/scripts/task.py start \
  frontend-v2-auth-workbench-request-cancellation-blocker
git switch -c codex/frontend-v2-auth-workbench-request-cancellation-blocker
python3 ./.trellis/scripts/task.py set-branch \
  frontend-v2-auth-workbench-request-cancellation-blocker \
  codex/frontend-v2-auth-workbench-request-cancellation-blocker
```

没有 pull、push、PR 或改写历史；当前尚未提交。

## 2. Phase A — 一次定向诊断

1. 在 `auth-session-real-stack.spec.ts` 增加局部 phase 标记。
2. `requestfailed` 记录只包含 phase、method、pathname、`request.failure()?.errorText`。
3. 保留既有 no-content POST 识别、console/pageerror、真实流程与 secret scan；不加入最终忽略结论。
4. 只运行一次：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/auth-session-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
```

5. 收集以下证据后停止：
   - 精确 phase/method/pathname/errorText；
   - Auth endpoint 状态和最终页面断言；
   - secret scan 无命中；
   - database/storage/Redis/port cleanup 的 `status=dropped|removed|deleted|released`；
   - 本次相关进程已 wait/退出。
6. 更新 `research/audit.md` 与 `design.md`，向用户报告唯一 owner 与最小建议，等待第二次明确批准。

若运行无法唯一归因、出现非预期 errorText、敏感输出或 cleanup 失败，A26 保持 open 并停止。

## 3. Phase B — 经确认的最小修复

### 分支 B1：test collector owner

- 将临时 instrument 收敛为局部 phase owner。
- 只对经证明的 `phase + GET + /api/v1/workbench + exact errorText` 返回预期；所有其他 `requestfailed` 继续失败。
- 保留或补足一个精确 Workbench 成功响应/成功内容断言，防止 HTTP 4xx/5xx 被“工作台”公共 heading 掩盖。
- 不修改 production、其他 spec 或共享 helper。

### 分支 B2：production Auth/query owner

- 先根据诊断证据更新本设计的精确顺序，再改 `auth-provider.tsx`。
- 增加一个最小 `auth-provider.test.tsx`，证明 active/in-flight business query 处理与 auth session 次序，且上一身份 cache 不可见。
- 只有证据证明 transport 必须接收 signal，才修改直接 query owner；不得推广到通用 cancellation 层。

### 分支 B3：无法确认 owner

- 移除临时 instrument，保留研究证据，停止；不让 test 变绿。

## 4. Required Validation

最终代码改变后运行：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/auth-session-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-auth-workbench-request-cancellation-blocker
```

若修改 `AuthProvider`，额外运行：

```bash
npm --prefix frontend-v2 run test -- \
  src/app/auth/auth-provider.test.tsx
```

真实栈通过还必须人工核对：

- login、forced change、Workbench、System 403、logout 与 `/login` 均由真实 UI/服务端完成；
- 未启用 trace/video/storage state；
- secret scan 未发现 password/Cookie/CSRF/header/body/完整 URL；
- database、Redis、storage、进程和端口 cleanup 完整。

不运行完整 `make e2e`、`make verify` 或 Phase 8 recheck；它们属于所有 blocker 关闭后的独立 gate Task。

### 执行结果

- 定向真实栈：`1 passed (1.6s)`；Workbench GET 200、Auth/System 页面与最终 `/login` 断言通过。
- secret scan 无命中；database、Redis、storage、process、port cleanup 完整。
- frontend-v2 typecheck、lint、`git diff --check`、Task validate 全部通过。
- 独立 Trellis quality check 未发现 B1 代码问题，未产生 reviewer edit。
- 未运行 `make e2e`、`make verify` 或 Phase 8 recheck，原因与本节既定边界一致。

## 5. 自审与停止条件

- 搜索并确认没有 `ERR_ABORTED` 全局忽略、Workbench GET 全局忽略、phase 宽泛忽略或 unknown failure fallback。
- 确认 logout 仍清除全部非 auth query，且 session 置空/Router invalidation 不允许上一身份业务数据短暂复用。
- 确认非预期 endpoint/method/errorText/phase、HTTP 错误、console.error 和 pageerror 仍失败。
- 若最终方案需要 backend、合同、数据库、旧 frontend、Workbench aggregate/UI、共享 framework 或其他 spec，停止并重新提交范围审批。

## 6. 建议 commit 范围

- test owner：一个 `test(frontend-v2): classify expected workbench navigation cancellation` 实施提交，只含最终 real-stack collector 变更。
- production owner：一个 `fix(frontend-v2): correct auth business-query cleanup lifecycle` 实施提交，只含 Auth owner 与其 unit test；若真实证据要求 `workbench.api.ts` 传递 signal，必须在第二次批准中明确列出后才加入同一提交。
- Task archive、父 Task metadata 与 journal 属于后续 Trellis bookkeeping；执行 `task.py archive` / `add_session.py` 前另行说明，不夹进实施提交。
