# Generated Client、Cookie Sentinel 与隔离审计

## Generated client

canonical generator 为 `npm --prefix frontend run api:generate`；`api:check` 在临时目录重生成并逐字节比较。预期 162 个 operation 的 `parameters.header` 新增 optional `"X-Request-ID"?: string`，已有 required CSRF/Idempotency Header 保持；新增 `responses[400]`；每个 response headers 新增 required string，CSV `Content-Disposition` 保留。

`openapi-fetch<paths>` 以 generated paths 提供类型；optional Header 不要求现有调用传参。当前 `operations[...]` consumers 只读取 query 类型，没有构造完整 header object。full typecheck 覆盖全部 consumers，另运行直接消费 generated operations/query 与 shared API 的 targeted tests。`schema.d.ts` 不得手改。

## Cookie sentinel

login 当前两个 `set_cookie()`：session Cookie 为 configured name/token、Max-Age=session TTL、Path=/、SameSite=lax、HttpOnly、Secure=settings；CSRF Cookie 为 configured name/token、同 TTL/Path、SameSite=strict、非 HttpOnly、同 Secure。logout 两个 `delete_cookie()` 产生独立删除 Header，当前语义含 Max-Age=0、Expires、Path=/、SameSite=lax。

现有 integration 覆盖会话流程但没有逐 raw occurrence 锁定。新测试读取 `raw_headers`/`headers.get_list("set-cookie")`，断言恰有两项并分别解析属性；不得 join。OpenAPI 不声明 `Set-Cookie`，因为单值 Header Object 无法无损表达多个实例。

## Request-context 测试差距

现有测试覆盖一个 100 字符值、空、101 和 DEL；缺少缺失 Header UUID、独立 1 边界、non-ASCII、控制字符、正常与 endpoint 422。non-ASCII 使用 raw bytes（如 `b"\xff"`），避免 TestClient 的 Unicode string ASCII 编码错误遮蔽 middleware。

## Dirty isolation

任务创建后 staged 路径为 543，NUL path-list SHA-256 为 `f1879d467c51e3032e7735f7b23f086ced78000fb597d4737a4fc7b7b4c15c56`。范围外 unstaged 为 `.gitignore`、`backend/app/schemas/configuration.py`；父 task.json 新 child 是本 Task 唯一允许的既有文件变更。当前指针仍为 `08-30-v2-live-readonly-acceptance`。

实施首步重新把 index binary diff/路径清单保存到 `mktemp`，每个 gate 后 `cmp`；不运行全局 formatter、`git add -u` 或 `git add -A`。获准提交时使用显式 pathspec/`git commit --only`，不消费既有 staged 删除。
