# 审计记录

## 1. 结论

这是测试编排缺陷，不是 production route、Auth 或 backend permission defect。最小修正是让 fixture E2E 只断言 route boundary 在 child loader 前拒绝 ENGINEER，并删除因此不可达的 fixture server-403 glue；真实服务端权限继续由既有 PostgreSQL integration 证明。

## 2. 复现证据

规划阶段只运行：

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/platform-types.spec.ts \
  --grep "非管理员" \
  --project=foundation-mobile \
  --project=foundation-desktop
```

结果为 `2 failed`，两个 project 都在 `platform-types.spec.ts:146` 超时：期望 GET count `> 0`，实际为 `0`。在该断言前，明确 403 heading 已可见且 Platform Types heading 已不存在。

失败生成的两个精确 trace/error-context 目录已移动到可恢复的 `/Users/sc/.Trash/partsignal-platform-types-e2e-20260817/`，工作区只保留 Playwright 的 `.last-run.json` cache；没有创建或保留新的仓库 artifact。

## 3. Owner 与调用顺序

- `frontend-v2/src/routes/_app/_admin/route.tsx:8-12`：parent `beforeLoad` 从 QueryClient 的 canonical Auth session 读取账号类型；非 ADMIN 抛出 `notFound()`。
- `frontend-v2/src/routes/_app/_admin/route.tsx:25-35`：`notFoundComponent` 保留地址并展示明确 403。
- `frontend-v2/src/routes/_app/_admin/settings.platforms.types.tsx:9-15`：Platform Types list prefetch 位于 child loader；parent 拒绝后不会执行。
- `frontend-v2/tests/e2e/fixtures/platform-types.fixture.ts:89-100`：`setEngineer()` 让 `/auth/me` 返回 ENGINEER，因此当前 GET list 的 ENGINEER 403 分支不可达。
- `backend/tests/integration/test_platform_types.py:47-92,145`：真实 FastAPI/PostgreSQL owner 已断言 ENGINEER 对 list/create/update/delete 全部为 403。

## 4. 最小修正选择

选择：

1. 把场景名称收敛为 route 在业务请求前拒绝；
2. 用同步精确断言确认 Platform Type GET 数为 0；
3. 删除 fixture list handler 的不可达 ENGINEER 403 分支；
4. 删除 `setEngineer()` 中不再需要的 `allowHttpError(403)`。

不选择：

- 不在 403 页面中强制触发 child loader，这会破坏 route 权限边界。
- 不在 E2E 中额外 `fetch`/`page.request` Platform Type API；fixture 403 不是服务端最终权威，且会重复既有 integration 证据。
- 不放宽为 `>= 0`、加 sleep/retry 或删除 route 403 断言。

## 5. 敏感信息与测试产物

该 fixture 不使用真实密码、cookie、Authorization 或生产 secret。普通 fixture suite 仍使用 `retain-on-failure`；成功验证会清理旧失败结果。本任务不新增 trace/video/report 配置或敏感字段记录。

## 6. 影响边界

预计只修改：

- `frontend-v2/tests/e2e/platform-types.spec.ts`
- `frontend-v2/tests/e2e/fixtures/platform-types.fixture.ts`

不需要修改 production、backend、OpenAPI、数据库、Playwright config、runner 或稳定 spec。
