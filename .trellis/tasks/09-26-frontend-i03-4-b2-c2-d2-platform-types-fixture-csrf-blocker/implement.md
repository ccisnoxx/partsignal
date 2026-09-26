# I03-4-B2-C2-D2 Platform Types fixture CSRF 修复记录

## 根因

- `platform-types.fixture.ts` 作为独立 production-artifact fixture，通过原子 `/api/v1/auth/session` snapshot 发放 `platform-types-csrf`。
- CRUD 请求实际正确携带该 token；`platform-types.spec.ts` 的三项期望误用了相邻 `platforms.fixture.ts` 的 `platforms-e2e-csrf`。
- 完整门禁在 mobile 与 desktop 执行同一场景，因此同一断言漂移报告两次失败；不存在运行时代码、请求次数或 session owner 错误。

## 最小修复

只将 POST、PATCH、DELETE 的三处 `csrfToken` 期望改为 `platform-types-csrf`。保留：

- 精确 method 与请求集合；
- create/update body；
- update/delete canonical revision；
- 独立 fixture 的原子 session snapshot；
- 未声明 API、运行时错误与 secret artifact 审计。

## 定向验证

- `node_modules/.bin/eslint tests/e2e/platform-types.spec.ts`：退出 0。
- `npm --prefix frontend run e2e -- tests/e2e/platform-types.spec.ts`：12/12 passed，secret scan clean，退出 0。
- 定向前后已知临时目录、端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库和 frontend test 容器均为 0。
- 定向通过不替代新的 detached clean-checkout 单次完整 `make verify`。
