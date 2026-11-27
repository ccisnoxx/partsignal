# I1 设计：命令前在途读取与 durable marker 测试隔离

## 根因边界

产品合同已经明确：认证命令取得 owner 并发布 durable `STARTED` 后，新的 canonical session read 必须在网络前被拒绝。失败测试把 `refetchQueries` 放在登录命令启动之后，并等待第二次 GET，因此测试期望与合同相反。

测试真正需要证明的是另一条边界：命令开始前已经发出的旧读取，即使 mock 忽略 abort 并在命令提交后迟到返回，也不能写回旧身份、CSRF、缓存或路由。登录、退出和改密三个场景都应按“先启动并确认旧 GET 在途 → 再启动命令 → 提交 canonical 命令结果 → 最后释放旧 GET”的确定性顺序编排。

## 最小修改所有权

- `frontend/src/app/providers.test.tsx`：重排三项迟到读取测试；每个 case 后清理 durable transition localStorage，防止失败级联。
- `frontend/src/app/auth/auth-provider.test.tsx`：原则上不改产品期望；保留 active command 期间不增加 GET 的精确断言，仅在需要共享测试 helper 时做最小调整。
- `frontend/src/app/auth/auth-provider.tsx` 与 `auth-transition-channel.ts`：当前证据不支持修改。只有定向测试证明现有实现违反已冻结合同，才允许重新评估。

## 验证合同

先执行单文件/相关双文件 Vitest、TypeScript 和精确 ESLint，确认三项真实在途 continuation 与跨 case 隔离。资源归零后形成新固定候选；之后必须换全新 detached checkout，并且只运行一次完整 `make verify`。完整门禁失败不得在同一候选上重跑。
