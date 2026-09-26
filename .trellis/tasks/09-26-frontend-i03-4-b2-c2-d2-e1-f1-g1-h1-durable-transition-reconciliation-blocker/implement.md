# I03-4-B2-C2-D2-E1-F1-G1-H1 恢复点

## 当前结论

H1 已完成 durable terminal reconciliation、stale transition 淘汰和 marker fail-closed 的实现及定向验证。尚未形成新的固定 commit/tree，也未运行新 detached checkout 的唯一一次完整门禁，因此 H1/G1/F1/E1/D2/I03 仍保持 `in_progress`，I04 不得创建。

## 下一步

1. 完成最终 diff、tracked/untracked、secret 与 generated drift 审计，并记录完整定向资源归零证据。
2. 创建新的固定 commit/tree，确认候选工作区 clean。
3. 从新固定提交创建全新 detached checkout；bootstrap 后确认仅产生 ignored dependency/cache。
4. 记录完整门禁前资源快照，在该 checkout 中只运行一次 `make verify`。
5. 门禁退出 0、门禁后资源为 0 且 checkout identity/cleanliness 不漂移后，派发另一名 fresh `critical_reviewer`。

## 已完成实现与定向证据

- `auth-transition-channel.ts` 以判别联合区分 absent、合法、畸形/未知、legacy 和 unreadable；所有通知入口只负责唤醒并重读 durable slot，recovery 看到 terminal/invalid/absent 时同样回放给 Provider。
- channel 只保留一个 recovery contender；新的 durable `STARTED` 取代旧 contender，合法 terminal 或错误状态取消恢复。Web Lock、10 秒 lease、2 秒 heartbeat、STARTED-before-side-effect 和 SETTLED-before-release 合同保持不变。
- `auth-provider.tsx` 删除 remote transition Set，改为单一 durable barrier owner；初始化竞态、仅 terminal 可见与 T1→T2 都能淘汰旧状态。invalid/unreadable/legacy 在网络请求前 fail-closed、失效 epoch、清旧 session/cache 并显示错误。
- 单元定向：TypeScript、精确 ESLint、2 files / 44 tests passed。既有命令期 refresh 测试同步收紧为在网络前拒绝 canonical GET。
- 真实栈第一轮 4/4 通过，但发现仍保留一个未纳入流量审计的合法观察页；修正测试关闭该页后才运行第二轮。最终第二轮 4/4 通过，secret scan clean，正式 harness cleanup 完成。
- 最终真实栈日志 `/tmp/partsignal-i03-h1-auth-real-stack-r2.log`：31,373 bytes，SHA-256 `2fa4ad93af641256ba261cbf10f1cbd8d72937d5314be7fc17d3f482fcbfb615`；状态文件内容 `0`，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 最终定向资源日志 `/tmp/partsignal-i03-h1-targeted-resource-post-final.log`：2,349 bytes，SHA-256 `acf13810d3852cabecd3b64260393666a5641871bb0c5d3a4eb372861d1816e3`；原始 `${TMPDIR}`、canonical realpath 与 `/tmp` 的 13 类 harness 资源、端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库及 PartSignal 测试容器均为 0。

## 禁止事项

- 不把 durable `SETTLED` 静默当成“无需动作”。
- 不以清空整个 Set、固定 sleep、页面刷新或删除 marker 掩盖状态所有权缺口。
- 不把未知/畸形/不可读 marker 当成 key 缺失。
- 不复用 `e35c402e` 的完整门禁或 detached checkout 验证修改后的候选。
- 在新复核 `NO BLOCKER` 前不创建 I04，不进行 fetch、push、SSH 或任何远程写入。
