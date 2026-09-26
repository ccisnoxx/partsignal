# I03-4-B2-C2-D2-E1 Blocker 跨标签页 session binding epoch 未推进

## Goal

完整绿色门禁后的 fresh critical review 发现 session_binding 未参与前端认证边界，generation/principal epoch 仅限单标签页，真实共享 Cookie 的跨标签页账号替换与 ABA 仍可让旧主体缓存和迟到 continuation 污染新主体 UI。

## Requirements

- 将服务端公开的 `session_binding` 纳入前端认证边界；binding 改变必须被视为新的 session/principal epoch，即使公开 user 字段与前一快照相同。
- 登录、退出、强制改密、自助改密和其他 session replacement 必须拥有同源跨标签页 transition 通知；通知不得携带 CSRF、Cookie、token、密码或其他凭据。
- 任一标签页获知 transition 时，必须先关闭旧 auth read/command barrier、推进可跨标签页观察的 generation/epoch、取消或拒绝旧 continuation，并清空非 auth QueryCache；之后才允许重新读取 canonical `/api/v1/auth/session`。
- 真实共享 Cookie 的双标签页 ADMIN A→ENGINEER B、A→B→A ABA、迟到 auth/business read、pending mutation callback、callback 内 `await`、paused retry 与 offline resume 都不得恢复旧主体 UI、缓存、导航或副作用。
- 服务端继续最终裁决权限和 CSRF；前端不得依赖 abort、缓存 TTL、焦点刷新、UI 隐藏或静默吞错来掩盖跨标签页交错。
- 同一 session binding 内的普通 snapshot refresh 必须保持正向行为；只有 binding/主体边界变化才清理非 auth 缓存和推进 principal epoch。
- 增加同一 BrowserContext 双 page 的确定性交错测试，实际共享 session Cookie，并延迟/释放旧标签页响应证明 A→B 和 ABA 防护；单个 QueryClient 的顺序 mock 不能替代该证据。
- 修复后形成新的固定 commit/tree，运行受影响定向检查与资源清理；随后必须在全新 detached checkout 中仅运行一次完整 `make verify`，再由 fresh `critical_reviewer` 完整复核。
- 在新的完整门禁和独立复核均为 `NO BLOCKER` 前，D2 与全部 I03 父链保持 `in_progress`；不得创建 I04、fetch/push、连接 Hostdzire 或执行任何远程写入。

## Acceptance Criteria

- [x] `session_binding` 进入 session/principal identity；同 user 但新 binding 不再保留旧业务缓存或旧 continuation。
- [x] 跨标签页 transition owner 覆盖登录、退出、改密和 session replacement，消息不包含凭据且不会形成请求风暴或重复副作用。
- [x] 同一 BrowserContext 双 page 的 A→B 与 A→B→A 测试证明迟到 read/mutation/callback/retry/offline continuation 全部失效，旧主体 UI 与非 auth QueryCache 均不恢复。
- [x] 单标签页原子 session、System Admin 失效恢复、权限降级和同一 binding 普通 refresh 回归保持通过，secret scan clean。
- [ ] 新固定候选在全新 detached checkout 中唯一一次完整 `make verify` 退出 0，门禁前后资源全部为 0。
- [ ] fresh `critical_reviewer` 对总体基线到新候选和完整门禁证据给出 `NO BLOCKER`，之后才允许完成 D2/I03 父链并创建 I04。

## Notes

- 触发候选：commit `d168dcd88a30e604ebdfb8f1d6e9739b2afeb32b`，tree `4bace747c00c6ad68fda9c149b4f58c77aa60803`。
- 本候选唯一一次完整 `make verify` 退出 0；日志 `/tmp/partsignal-i03-d2-r3-d168-make-verify.log` 为 240983 bytes，SHA-256 `4e4adad0f17bb82909d1716215ba5e6fdfd8bac1c4d7f551821cda33cdb4413b`。状态文件 SHA-256 `edf64405e10ca46b29062e55558b8fe58eb9231cd801980c17aeae70026c9d85`。
- 前后资源快照 SHA-256 分别为 `1f1d5404dca9f20098c6288fbd1222c52d8ac145d3b607e94ab9e825773d125c` 与 `b65ae0f5e242a84a15831843a60c2133a0d2db9562e3193b242d5e65c0fed925`；临时资源、四端口、Redis DB 14、E2E 数据库和测试容器均为 0。
- fresh `critical_reviewer` 审计 Bundle `20260926T081303Z-i03-d2-8fa17b6f` 结论为 P1 发布阻断。关键位置为 `frontend/src/app/auth/auth-provider.tsx:109`、`:180`，`frontend/src/app/auth/principal-epoch.ts:16` 与 `frontend/src/app/auth/auth-provider.test.tsx:452`。
- 复核确认本轮 System Admin 与 Platform Types 两项直接修复正确；新 blocker 是完整候选层面的跨标签页状态所有权缺口，不否定本轮绿色门禁事实。
- 已实现 `session_binding` 驱动的 principal identity，以及由 `AuthProvider` 唯一拥有的 BroadcastChannel + localStorage marker `STARTED/SETTLED` 协议；payload 仅含 version、event ID、transition ID 和 phase。命令发送方、接收标签页和只观察到 SETTLED 的恢复路径都会先推进本地 principal epoch并清理非 auth QueryCache，再从原子 session 端点收敛。
- 定向 TypeScript、ESLint、auth/principal Vitest 通过：2 files、30 tests。既有 mutation retry、paused/offline resume 与 callback guard 测试继续通过；新增测试证明同 binding refresh 保留、同 user/new binding 失效、跨标签页 STARTED/SETTLED 去重和 marker 无秘密。
- 最终定向真实栈日志 `/tmp/partsignal-i03-e1-auth-real-stack-final.log`：29901 bytes，SHA-256 `a2dfc68ea44972bd9889327f55e093cae9289c855f554009108444405c96bbff`。同一 BrowserContext 双 page 实际共享 Cookie，完成 ADMIN A→ENGINEER B→ADMIN A；A 的产品 POST 已由服务端返回 201 后延迟到 ABA 完成才释放，旧 callback 未导航或污染新主体。2 tests passed，非幂等流量 phase/method/path/status/count 精确，secret scan clean。
- 定向 harness 每次失败/成功均执行正式 cleanup；固定候选提交前资源日志 `/tmp/partsignal-i03-e1-fixed-resource-precommit.log`：4337 bytes，SHA-256 `4182f4502315615e5f1fdcc7ee71edc29b49cd3a83c6e99031abfe01cac5f25f`。原始 TMPDIR、canonical TMPDIR 与 `/tmp` 的受控临时目录、端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库和 frontend test 容器均为 0。
- 未创建 I04，未执行 fetch、push、SSH、Hostdzire inventory 或任何远程写入。
