# 技术设计

## 1. Current data flow

```text
content_humanization_prompts 无 id=1
  → FastAPI GET 抛出 NOT_FOUND
  → OpenAPI 404 ErrorResponse
  → openapi-fetch 返回 error
  → unwrap 抛出 ApiError(NOT_FOUND)
  → PlatformPromptsPage 将其解释为合法空状态
  → 浏览器仍记录失败资源 404
```

问题不在空状态渲染，而在“合法无记录”被 HTTP 错误承载。前端捕获异常不能消除浏览器已经记录的失败请求。

## 2. Target contract

`GET /api/v1/content-humanization-prompt` 使用以下唯一契约：

- 有记录：`200 application/json`，返回 `ContentHumanizationPrompt`。
- 无记录：`204 No Content`，不返回 JSON。
- 无权限：`403 ErrorResponse`。
- 其他真实错误：沿用现有错误响应。

不使用 `200 null` 或新 envelope，避免增加 schema 和第二套状态字段；不使用控制台 allowlist，
因为它会掩盖真实回归。

## 3. Backend and contract ownership

- `contracts/openapi.yaml:getContentHumanizationPrompt` 新增 204 响应并移除“未配置即 404”的正常路径。
- `backend/app/routers/configuration.py:get_content_humanization_prompt` 在单例不存在时直接返回空的 204
  `Response`；有记录时仍经过 `content_humanization_prompt_out`。
- 数据库、服务层和 PUT 命令不变；未配置仍由“数据库无单例行”这一事实表达。
- `frontend/src/shared/api/schema.d.ts` 只通过 `npm run api:generate` 重新生成，不手工编辑。

## 4. Frontend consumption

TanStack Query 的 `queryFn` 不返回 `undefined`，因此前端边界把 204 映射为局部 `null`：

```text
HTTP 204 → query data null → humanizationMissing=true → 现有空编辑器
HTTP 200 → query data ContentHumanizationPrompt → 现有已配置编辑器
其他错误 → unwrap 抛出 ApiError → 现有失败反馈
```

只修改 `PlatformPromptsPage` 中全局自然化 Prompt 查询与缺失判断。平台 Prompt 仍保留现有
`isNotFound` 分支，不创建通用 helper。

`reloadCurrent` 继续把 `null` 映射为空基线；`savePrompt` 的
`expected_revision: activePrompt?.revision ?? null` 保持首次创建语义。

## 5. Test strategy

- 后端集成测试以空数据库验证 204/空响应体，并继续覆盖 403、首次创建、更新、冲突和审计。
- 前端组件测试模拟 204，验证不是错误态，且空编辑器与首次保存状态存在；另保留真实错误测试。
- Playwright 使用路由级 204 模拟建立确定性的“未配置”浏览器场景，监听
  `console`、`pageerror` 和 `requestfailed`，不得依赖测试库恰好无记录。
- MVP E2E 把初始状态判断从 `200/404 + response.ok()` 改为
  `200/204 + status() === 200`，避免 204 被误判为已配置。

## 6. Compatibility and rollback

- 这是内部 OpenAPI 的显式契约变更；仓库内已确认的直接消费者只有 Prompt 管理页与 MVP E2E。
- PUT、数据库和历史数据不变，无迁移、数据回填或发布前置操作。
- 若契约、UI 空状态或错误反馈任一回归，停止发布并回滚本任务提交即可；无数据回滚步骤。
