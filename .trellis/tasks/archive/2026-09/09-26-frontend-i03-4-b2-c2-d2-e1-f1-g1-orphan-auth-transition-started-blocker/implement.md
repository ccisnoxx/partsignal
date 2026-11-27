# I03-4-B2-C2-D2-E1-F1-G1 恢复点

## 当前结论

孤儿 `STARTED` 已由 v2 owner/lease + origin-scoped exclusive Web Lock 修复；定向单元、类型、lint、真实 BrowserContext crash/reload、固定候选和唯一一次 detached 全仓门禁均通过。但 fresh 独立复核确认 durable terminal reconciliation 与 marker 兼容失败语义仍有三个发布阻断，因此 F1/E1/D2/I03 仍不能完成，I04 不得创建或执行。

## 下一步

1. 进入 H1 子 blocker，把 channel 初始化和 recovery 读到的 durable `STARTED/SETTLED` 都送入同一个权威 reconciliation；不得只依赖即时事件的 Set 加减。
2. 区分“marker key 不存在”与“marker 存在但未知、畸形或不可读”；后者必须推进失效、清业务缓存并保持 auth barrier/显式错误，不能启动 canonical read。
3. 增加 render 读 `STARTED`、effect 前变 `SETTLED`，丢失即时 `SETTLED` 后只靠 durable recovery，以及前一 transition 遗留后发生 T2 的确定性交错测试；各恢复路径精确一次 canonical session read。
4. 对 v1 是否曾进入可运行产物给出可核验证据；若不能证明未部署，则实现明确 migration fence 或双协议协调。
5. 定向验证和资源清理通过后形成另一个固定候选，在又一个全新 detached checkout 中只运行一次完整 `make verify`；通过后派发另一名 fresh `critical_reviewer`。

## 已完成实现与定向证据

- `auth-transition-channel.ts` 将协议升级为严格 v2 marker，以独占 Web Lock 串行命令 owner 和 recovery candidate；2 秒 heartbeat 更新 10 秒 lease，取得锁后的恢复等待上限为一个 lease 周期，重新核对 exact marker 后才合成 `SETTLED`。
- `auth-provider.tsx` 在 `STARTED` 时推进 epoch/generation、终止旧工作、清业务缓存、清 session 并禁用 canonical auth query；仅在所有 transition 收敛后开放一次 canonical read。
- jsdom setup 安装测试专用 FIFO exclusive Web Locks substitute；production 浏览器仍使用原生 Web Locks。
- 单元定向：2 files / 36 tests passed；TypeScript 与精确 ESLint passed。
- 真实栈第三轮：3 passed，包含现有 A→B→A、新 crash/reload 和正常 auth flow；两次孤儿回收各只有一个 canonical session GET，受控 login 各一次且无响应，secret scan clean，harness 输出数据库、存储、Redis 与四端口清理完成。
- 最终真实栈日志：`/tmp/partsignal-i03-g1-auth-real-stack-r3.log`，30,705 bytes，SHA-256 `d7bd64ffa4bfc9cf0ecd3f0168d2efa67d6cffdec4e9e677e2f5e96db0ec613a`；状态文件内容 `0`，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 定向验证后资源日志 `/tmp/partsignal-i03-g1-targeted-resource-post.log` 为 1,686 bytes，SHA-256 `16b58ab4bdf15f1faa16e2669a4be22f885b32a0f7137d9b95c9585924e3ae16`；全部已知 harness 临时模式、四端口、Redis DB 14、E2E 数据库和 frontend test containers 为 0。
- 固定候选 `e35c402efcce990ce3345ab6e89755f11bb008e0` / tree `6f16122f37e79a956798feb9d3552c2df455e945` 的唯一一次完整 `make verify` 退出 0。日志 SHA-256 `f510170ee5fc69ef6e7d6e4cc054a4417abd91eb18b406815518a9be8efe25e5`；门禁前后资源快照逐字节相同，SHA-256 均为 `e2b7931e1626fef71eb9d0535608b799230d4a372a32c94fb5665afb0aaf67a9`。
- fresh critical review 审计 Bundle `20260926T102735Z-i03-g1-final-critical-review-09a780fd` 已闭合并验证通过，但候选结论为 `BLOCKER`；已建立 H1 子任务承接 durable terminal reconciliation、stale transition 淘汰和 marker fail-closed 协议栅栏。

## 禁止事项

- 不以删除 marker、缩短固定 timeout、忽略 `STARTED` 或刷新页面掩盖 owner 缺口。
- 不依赖页面销毁时执行 `finally`、`beforeunload` 或其他非保证回调。
- 不把凭据、用户快照或 session binding 写入 channel/localStorage payload。
- 不复用 `94fd8aae` 的 detached checkout 或完整门禁结果验证修改后的候选。
- 不复用 `e35c402e` 的 detached checkout 或完整门禁结果验证 H1 修改后的候选。
- 在新复核 `NO BLOCKER` 前不创建 I04，不进行 fetch、push、SSH 或任何远程写入。
