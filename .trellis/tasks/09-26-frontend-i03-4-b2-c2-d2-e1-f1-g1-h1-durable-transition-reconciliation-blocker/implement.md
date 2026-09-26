# I03-4-B2-C2-D2-E1-F1-G1-H1 恢复点

## 当前结论

H1 已完成 durable terminal reconciliation、stale transition 淘汰和 marker fail-closed 的实现及定向验证，并形成固定候选 `39b1d0f9cc371c2055adae082ce152a255005ab3` / tree `8c2bb5098f89b5cd58cdd138b10c437f0eb48f05`。该候选唯一一次 detached-checkout `make verify` 在 frontend Vitest 阶段退出 `2`，因此已创建 I1 测试合同/隔离 blocker；H1/G1/F1/E1/D2/I03 继续保持 `in_progress`，I04 不得创建。

## 下一步

1. 在 I1 中仅修正 `providers.test.tsx` 的命令前在途读取编排与 durable marker case 隔离，不放宽 H1 产品 barrier。
2. 定向验证和资源清理通过后形成新的固定 commit/tree。
3. 从新固定提交创建另一个全新 detached checkout，只运行一次完整 `make verify`。
4. 只有门禁退出 0、门禁后资源为 0 且 checkout identity/cleanliness 不漂移后，才派发另一名 fresh `critical_reviewer`。

## 已完成实现与定向证据

- `auth-transition-channel.ts` 以判别联合区分 absent、合法、畸形/未知、legacy 和 unreadable；所有通知入口只负责唤醒并重读 durable slot，recovery 看到 terminal/invalid/absent 时同样回放给 Provider。
- channel 只保留一个 recovery contender；新的 durable `STARTED` 取代旧 contender，合法 terminal 或错误状态取消恢复。Web Lock、10 秒 lease、2 秒 heartbeat、STARTED-before-side-effect 和 SETTLED-before-release 合同保持不变。
- `auth-provider.tsx` 删除 remote transition Set，改为单一 durable barrier owner；初始化竞态、仅 terminal 可见与 T1→T2 都能淘汰旧状态。invalid/unreadable/legacy 在网络请求前 fail-closed、失效 epoch、清旧 session/cache 并显示错误。
- 单元定向：TypeScript、精确 ESLint、2 files / 44 tests passed。既有命令期 refresh 测试同步收紧为在网络前拒绝 canonical GET。
- 真实栈第一轮 4/4 通过，但发现仍保留一个未纳入流量审计的合法观察页；修正测试关闭该页后才运行第二轮。最终第二轮 4/4 通过，secret scan clean，正式 harness cleanup 完成。
- 最终真实栈日志 `/tmp/partsignal-i03-h1-auth-real-stack-r2.log`：31,373 bytes，SHA-256 `2fa4ad93af641256ba261cbf10f1cbd8d72937d5314be7fc17d3f482fcbfb615`；状态文件内容 `0`，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 最终定向资源日志 `/tmp/partsignal-i03-h1-targeted-resource-post-final.log`：2,349 bytes，SHA-256 `acf13810d3852cabecd3b64260393666a5641871bb0c5d3a4eb372861d1816e3`；原始 `${TMPDIR}`、canonical realpath 与 `/tmp` 的 13 类 harness 资源、端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库及 PartSignal 测试容器均为 0。
- 固定候选 `39b1d0f9` 的唯一完整门禁在 `providers.test.tsx:292` 首次失败：active login transition 后的第二次 auth GET 被 H1 正确阻断，但旧测试仍等待调用数 2。该超时留下 durable `STARTED`，后续 8 项因同文件未清 localStorage 而级联失败。
- 门禁日志 `/tmp/partsignal-i03-h1-39b1-make-verify.log` 为 25,236 bytes，SHA-256 `1b177a983fc4fd37729876713a8e9e3aa49ce851cd8b269928025fb6c6486651`；顶层退出 `2`。资源前后日志逐字节相同，SHA-256 `b438f95e4daf88e58848c7f8797541c0376567f008296473f5afe4d1822f61f1`；validation worktree 已移除。

## 禁止事项

- 不把 durable `SETTLED` 静默当成“无需动作”。
- 不以清空整个 Set、固定 sleep、页面刷新或删除 marker 掩盖状态所有权缺口。
- 不把未知/畸形/不可读 marker 当成 key 缺失。
- 不复用 `39b1d0f9` 的失败门禁或 detached checkout 验证修改后的候选，也不在同一候选上重跑完整门禁。
- 在新复核 `NO BLOCKER` 前不创建 I04，不进行 fetch、push、SSH 或任何远程写入。
