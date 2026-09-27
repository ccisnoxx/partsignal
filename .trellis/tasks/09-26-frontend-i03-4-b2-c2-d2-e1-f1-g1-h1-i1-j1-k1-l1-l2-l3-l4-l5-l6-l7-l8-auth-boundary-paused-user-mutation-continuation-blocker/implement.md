# L8 恢复点

## 当前状态

- frozen candidate：`731cc728df3611d34357de3a189319aaf116e679` / tree
  `30565e93b0c70ea4e74a9301feb20a228cff701a`。
- 唯一完整门禁、资源归零、validation checkout 清理均已完成且可信；不得重跑该候选门禁。
- fresh reviewer 确认 L7 click/productAccepted/releaseProduct 所有权、L6 response completion gate 与 L5
  result-known fence 没有阻断，但完整候选因页面级 `authPrincipalBoundary` paused mutation 缺口为
  `BLOCKER`。
- L7、L6、L5、L4、L3、L2、L1、K1 至 D2、相关 sibling、I03-4 与 I03 全部保持
  `in_progress`；总体交付保持 `in_progress`，I04 未创建。

## 下一次恢复顺序

1. 完整读取 `query-client.ts`、MutationCache guard、AuthProvider 内部 auth-boundary mutation owner、
   Users 单行/bulk/edit 三类调用者及对应测试。
2. 先增加离线 pause/retry + same-session ADMIN→ENGINEER→ADMIN ABA 的失败测试，精确证明 API 未调用。
3. 将内部 reconciliation 与页面权限命令拆分为明确 meta/continuation 所有权；所有页面命令在 enqueue
   前绑定 continuation，并在每次发网前 assert。
4. 运行定向 unit/component、类型/静态检查以及 L5/L6/L7 真实栈回归，确认 secret 和资源归零。
5. 形成新 fixed candidate；在全新 `/Users/sc/...` detached checkout 先运行 26/26 sentinel，再且仅一次
   执行 `make verify`。绿色且资源归零后再派发 fresh `critical_reviewer`。

## 禁止事项

- 不把恢复时重新捕获新 epoch 当作旧 mutation 的授权。
- 不只在 response 后丢弃 callback；必须在 API 请求之前 fail closed。
- 不依赖服务端临时 401/403、session 撤销、UI 隐藏、reload、sleep 或放宽断言。
- 不修改 L5/L6/L7 已确认合同，不复用本候选完整门禁，不创建 I04，不执行远程写入。

## 已完成实现

- 先建立 QueryClient offline ABA/retry 和 Users single/bulk/edit 红测；旧实现稳定复现
  mutationFn/API 跨 epoch 调用。
- QueryClient 将 auth session query、AuthProvider internal mutation owner 和 page principal command 拆成
  三个明确 meta。页面命令仍在 `onMutate` 捕获 continuation，并由 `PrincipalMutation`
  包装每次 options 写入，覆盖 pending render、offline resume、retry 和
  `MutationObserver.setOptions` 窗口。
- 定向 unit/component、TypeScript、owned ESLint、L5/L6 System Admin 真实栈、L7 Auth
  Session 真实栈和两次 secret scan 通过；实施前后资源快照逐字一致且全部归零。

## 下一步

1. 更新本 task 的 candidate commit/tree，确认完整 diff 和 `git diff --check`。
2. 只从该新 commit 创建全新 detached validation checkout，先执行 26/26 bind sentinel，
   再且仅一次执行 `make verify`。
3. 门禁绿色、资源归零和代码冻结后，派发 fresh 只读 `critical_reviewer`。
