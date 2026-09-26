# I03-4-B2-C2-D2-E1-F1-G1 恢复点

## 当前结论

孤儿 `STARTED` 已由 v2 owner/lease + origin-scoped exclusive Web Lock 修复；定向单元、类型、lint 和真实 BrowserContext crash/reload 验证通过。尚未形成新固定候选，也尚未执行新 detached checkout 的唯一一次完整门禁，因此 F1/E1/D2/I03 仍不能完成，I04 不得创建或执行。

## 下一步

1. 补齐定向资源归零证据并审计完整 diff、secret 与 generated drift。
2. 形成新固定 commit/tree，确认候选工作区 clean。
3. 从新固定提交创建全新 detached checkout，bootstrap 后证明只产生 ignored dependency/cache。
4. 记录完整门禁前资源快照，在该 checkout 中只运行一次 `make verify`。
5. 门禁退出 0、门禁后资源为 0 且 checkout identity/cleanliness 不漂移后，派发另一名 fresh `critical_reviewer`。

## 已完成实现与定向证据

- `auth-transition-channel.ts` 将协议升级为严格 v2 marker，以独占 Web Lock 串行命令 owner 和 recovery candidate；2 秒 heartbeat 更新 10 秒 lease，取得锁后的恢复等待上限为一个 lease 周期，重新核对 exact marker 后才合成 `SETTLED`。
- `auth-provider.tsx` 在 `STARTED` 时推进 epoch/generation、终止旧工作、清业务缓存、清 session 并禁用 canonical auth query；仅在所有 transition 收敛后开放一次 canonical read。
- jsdom setup 安装测试专用 FIFO exclusive Web Locks substitute；production 浏览器仍使用原生 Web Locks。
- 单元定向：2 files / 36 tests passed；TypeScript 与精确 ESLint passed。
- 真实栈第三轮：3 passed，包含现有 A→B→A、新 crash/reload 和正常 auth flow；两次孤儿回收各只有一个 canonical session GET，受控 login 各一次且无响应，secret scan clean，harness 输出数据库、存储、Redis 与四端口清理完成。
- 最终真实栈日志：`/tmp/partsignal-i03-g1-auth-real-stack-r3.log`，30,705 bytes，SHA-256 `d7bd64ffa4bfc9cf0ecd3f0168d2efa67d6cffdec4e9e677e2f5e96db0ec613a`；状态文件内容 `0`，SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 定向验证后资源日志 `/tmp/partsignal-i03-g1-targeted-resource-post.log` 为 1,686 bytes，SHA-256 `16b58ab4bdf15f1faa16e2669a4be22f885b32a0f7137d9b95c9585924e3ae16`；全部已知 harness 临时模式、四端口、Redis DB 14、E2E 数据库和 frontend test containers 为 0。

## 禁止事项

- 不以删除 marker、缩短固定 timeout、忽略 `STARTED` 或刷新页面掩盖 owner 缺口。
- 不依赖页面销毁时执行 `finally`、`beforeunload` 或其他非保证回调。
- 不把凭据、用户快照或 session binding 写入 channel/localStorage payload。
- 不复用 `94fd8aae` 的 detached checkout 或完整门禁结果验证修改后的候选。
- 在新复核 `NO BLOCKER` 前不创建 I04，不进行 fetch、push、SSH 或任何远程写入。
