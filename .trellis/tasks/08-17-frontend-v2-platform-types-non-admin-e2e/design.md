# 技术设计

## 1. 证据分层

```text
production-artifact fixture E2E
  -> canonical ENGINEER Auth session
  -> parent _admin beforeLoad rejects
  -> child Platform Types loader does not run

backend PostgreSQL integration（保持不变）
  -> ENGINEER direct GET/POST/PATCH/DELETE
  -> AdminUser returns real 403
```

route boundary 与 server boundary 都保留，但由各自最接近的 owner 测试，不在一个浏览器导航中要求互斥行为同时发生。

## 2. E2E 修正

`platform-types.spec.ts` 的非管理员场景保留 ENGINEER session、direct URL、403 heading 和业务 heading 缺失断言；把异步 `expect.poll(...).toBeGreaterThan(0)` 改为对 controller requests 的精确 GET count `0` 断言，并把场景名改为描述 route ownership。

不新增 helper、API 请求或等待。若 route 未来错误执行 child loader，请求数会从 0 变为 1，测试立即失败。

## 3. Fixture 删除

`platform-types.fixture.ts` 继续用 `engineer` 控制 `/api/v1/auth/me`。由于 route 拒绝后 list handler 的 ENGINEER 403 分支没有消费者，直接删除该分支；`setEngineer()` 不再登记 403 console allowlist。

ADMIN list、CRUD、409/500 allowlist、strict unexpected request/runtime audit 均保持不变。

## 4. Compatibility 与 rollback

- 没有 runtime、contract、API、权限或数据变化。
- 回滚单位是一个断言/标题与两段 fixture dead glue。
- 若修正后出现 Platform Type GET，停止并调查 route/Auth owner；不得把断言改回大于 0 或扩展 fixture 接受请求。
- 若 backend 真实 403 证据失效，另开 backend permission blocker；本任务不修改服务端。
