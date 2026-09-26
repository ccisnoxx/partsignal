# I03-4-B2-C2-D2 Blocker Platform Types fixture CSRF 断言漂移

## Goal

固定候选 4e739f68 的唯一一次 detached clean-checkout make verify 在 fixture Playwright 中发现 Platform Types CSRF 期望仍指向旧 platforms-e2e-csrf，而独立 fixture 的原子 session 明确发放 platform-types-csrf；mobile/desktop 各失败一次，阻断 D2、最终独立复核、I03 收尾与 I04。

## Requirements

- 以失败的固定候选 commit `4e739f68f3ef87286d7b22e77ebfd353bafda6e8`、tree `425ec420f117ddf094172bd862ffd059f59cde45` 为起点，只修正 Platform Types fixture 与测试之间的精确 CSRF 断言漂移。
- 权威 fixture `frontend/tests/e2e/fixtures/platform-types.fixture.ts` 的原子 session response 发放 `platform-types-csrf`；创建、编辑和删除请求必须继续携带该 session snapshot 的 token，不得改回其他 fixture 的 `platforms-e2e-csrf`，也不得弱化 CSRF 断言。
- 先运行 Platform Types fixture Playwright 的精确定向验证并完成资源清理；不得把局部通过冒充完整门禁。
- 修复后形成新的固定候选 commit/tree，并从其创建全新 detached clean checkout；完整 `make verify` 仍只允许执行一次。
- 只有新的完整门禁退出 0、资源清单归零、工作区边界成立且 fresh `critical_reviewer` 给出 `NO BLOCKER`，才允许完成 D2/I03 父链并创建 I04。
- 本 blocker 通过前禁止 fetch/push、SSH、Hostdzire inventory 或任何远程写入。

## Acceptance Criteria

- [x] Platform Types 的 POST/PATCH/DELETE 精确断言均期望 `platform-types-csrf`，同时保留 method、body、revision 与请求次数边界。
- [x] mobile/desktop 定向 fixture Playwright 通过，secret scan clean，固定端口、Redis DB 14、隔离数据库和测试临时资源为 0。
- [ ] 新固定候选在全新 detached clean checkout 中单次完整 `make verify` 退出 0。
- [ ] fresh `critical_reviewer` 对新候选与完整门禁证据给出 `NO BLOCKER`。

## Notes

- 触发日志：`/tmp/partsignal-i03-d2-r2-4e739-make-verify.log`，245723 bytes，SHA-256 `d52a1a14bb86a4b892c5eecba6eef45e57184f88675a5cfd5f73ad2ec1582b21`；状态文件 19 bytes，SHA-256 `fe09bb5a2d9b5bb78670211d06b81f74237b9938d4ba7c62749f7d8b63c01202`，顶层退出 `2`。
- fixture Playwright 结果：492 passed、34 skipped、2 failed；同一测试在 mobile/desktop 各失败一次。实际值均为 `platform-types-csrf`，期望值均为 `platforms-e2e-csrf`；secret scan clean。
- 最小诊断确认 `platform-types.fixture.ts` 独立定义 `platform-types-csrf`，而失败测试的三处期望误用了 `platforms.fixture.ts` 的 token。失败属于精确测试期望漂移，不是本轮原子 session 修复回归，但仍是完整门禁 blocker。
- 门禁前资源快照 `/tmp/partsignal-i03-d2-r2-resource-pre.log`：4371 bytes，SHA-256 `3077522aacfeb529acd6be0e67db260f7c6f3d7261a0b22fd04d11b75d32c463`；门禁后资源快照 `/tmp/partsignal-i03-d2-r2-resource-post.log`：4372 bytes，SHA-256 `85628553132c4093088c9e9e17bd5b21bb0157bd37f3d8e6523a54dad50c047c`。已知临时目录、四个端口、Redis DB 14、隔离数据库和 frontend test 容器均为 0。
- validation、候选和原检出区均未发生产品代码漂移；未派发最终复核，未创建 I04，未执行 fetch、push、SSH 或任何远程操作。
- 2026-09-26 最小修复只替换 `platform-types.spec.ts` 三项写请求的 CSRF 期望；method、body、canonical revision、请求集合和 fixture 均未改变。单文件 ESLint 退出 0。
- 定向命令 `npm --prefix frontend run e2e -- tests/e2e/platform-types.spec.ts`：12/12 passed（mobile 6、desktop 6），`E2E_SECRET_SCAN status=clean`，退出 0。日志 `/tmp/partsignal-d2-platform-types-targeted.log`：3471 bytes，SHA-256 `6276cdc9d2b4e0bdcd0e85e87310bd1a0ac58d7459c641d539ca43f6fca3a1ba`；状态文件 SHA-256 `0e422042111170d0260c3180570f81bd6fda31bdb600c8a2d7a0f375e0f7d73e`。
- 定向前资源快照 `/tmp/partsignal-d2-platform-types-resource-pre.log`：4378 bytes，SHA-256 `0063538b89b44cc8268a5a5ad384d5baa7f1913b1ba0e141992bd10b653e8efd`；定向后快照 `/tmp/partsignal-d2-platform-types-resource-post.log`：4379 bytes，SHA-256 `84167417af2f1f04c818bd33b05465783d5a5a08a50d08dc163c687feb88a21a`。全部受控资源为 0。
