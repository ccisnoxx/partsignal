# 技术设计

## 1. 设计结论

采用 TanStack Router 的显式 file route：每个登记的 V1 path 自己声明固定 canonical target，统一使用 `replace`。路径文件只做参数保留与已审计 query 转换；共享代码仅限两项真实公共责任：route-local query 转换模型，以及 Auth return-to 安全校验。不会建立规则注册表、通用 redirect engine、legacy 页面组件或第二套业务状态。

公共路由合同审查结论：legacy route 是迁移适配边界，canonical V2 route 仍是资源、权限、search parser 和错误呈现的唯一 owner。ADMIN/ENGINEER 权限不在 redirect 层分叉；legacy route 先归一化地址，目标 `_admin` boundary 再保持现有 403。

## 2. Owner 边界

| 责任 | 权威 owner | 明确不负责 |
| --- | --- | --- |
| legacy path/query 转换 | `frontend-v2/src/routes/` 显式 routes 与 route-local model | Nginx、backend、V1、通用 engine |
| canonical search 校验 | 目标 domain 已有 search parser/model | legacy 自建业务 schema |
| return-to 校验 | `frontend-v2/src/app/auth/return-to.ts` | Login、route loader、API 各自复制 |
| 会话和 must-change | 现有 `_app` auth boundary、Login、Security 页面 | legacy pending state |
| 管理权限 | 现有 `_app/_admin` boundary 与服务端 API | redirect 层隐藏或降级 |
| 未知 SPA path | 根 route `notFoundComponent` | catch-all 首页 redirect |
| 资源错误 | canonical domain 页面 | legacy resolver/猜测 |
| asset 404 | Nginx/static | SPA legacy routes |

## 3. 路由实现

### 3.1 显式 routes

- 相同路径 `/login`、`/`、`/products`、`/products/$productId` 不增 legacy route，只补相应回归验证。
- 其他登记 path 各自建立 TanStack file route，`beforeLoad` 返回 `redirect({ ..., replace: true })`。
- 管理 legacy routes 放在 `_app` 下而不是 `_admin` 下：这样所有角色先获得 canonical URL，随后由 canonical `_admin` boundary 决定 ADMIN 正常进入或 ENGINEER 显示既有 403。
- GEO 静态 `insights`、`insights/print`、`topics` 与动态 `$observationId/correct` 分文件声明，由 Router 的静态优先匹配保证 identity 不混淆。
- 生成的 `routeTree.gen.ts` 只通过现有 Vite/TanStack 构建流程更新。

### 3.2 Query 转换

`src/routes/-legacy-routing.model.ts` 仅放已证实有复用价值的纯转换函数：共享的分页/字符串读取、各领域显式白名单，以及 `/publications` 优先级。文件名前缀 `-` 使其不参与 route generation。它不接收任意 target、不保存路由表，也不执行导航。

转换函数输出 canonical route 已有 schema 形状。无效值交给当前 canonical schema 的既有规则处理；未知或语义不等价字段直接省略。详情 `selected` 只在匹配已登记 `kind` 时生成动态 target；缺失、空值或未知 kind 不猜资源类型。

### 3.3 Publishing 决策边界

优先级固定为：

1. `kind=work|article|issue` 且 `selected` 非空：进入对应详情。
2. `tab=articles`：进入 articles list。
3. `tab=history&status=RESOLVED`：进入 issues list，固定 `status=RESOLVED`。
4. `tab=history` 其余情况：应进入 work list，固定 `status=CLOSED`。
5. 其余：进入 active work list，只传 V2 当前支持的 work status 和分页。

第 4 项已获用户批准：在现有 V2 canonical work search schema 与列表请求 owner 中最小加入 `CLOSED`，直接复用 backend 已支持的同名枚举；不新增 API、lookup、页面或前端推导状态。

## 4. Return-to 数据流

1. `_app.beforeLoad` 读取 Router `location.href`（path + search + hash），调用单一安全 owner 规范化。
2. 未登录时 replace 到 `/login?redirect=<approved legacy href>`。
3. Login 成功：若用户必须改密，保持现有 replace 到 `/account/security`；否则以 `href` replace 到 approved return-to，缺失或无效则 `/`。
4. 返回 legacy URL 后，对应显式 route 再 replace 到 canonical URL。
5. Security 完成改密继续按现有合同回 `/`，不恢复或另存之前的 redirect。

### 4.1 安全规则

- 输入必须是字符串且以单个 `/` 开始；`//` 和反斜杠立即拒绝。
- 用标准 `URL` 和固定哨兵 origin 解析，确认 origin 未变化、username/password/host 未注入。
- 对 path/search/hash 中的编码内容反复 `decodeURIComponent` 到稳定值（设小的固定上限）；任一层畸形编码、`\\`、`//`、编码分隔符或 scheme-like 形式均拒绝，防止一次或多次解码后的开放重定向。
- 拒绝 `/login` 自身作为 return-to，防止登录后自循环。
- 通过时保留原始安全站内 href；失败使用 `/`。
- 不增加依赖，使用浏览器标准库。

## 5. Not Found 与错误流

- 在 `__root.tsx` 增加可访问的根 `notFoundComponent`，聚焦 404 标题并提供返回已知页面的操作。
- 不新增 catch-all redirect route。未登记 path 由 Router 404 处理。
- 已登记动态资源只保留 ID 并进入 canonical route；API 404/403/domain error 沿现有组件流呈现，request ID 和错误码不被 redirect 层拦截。
- Nginx production SPA fallback 继续只返回应用入口；asset 404 和安全头不在本 Task 修改。

## 6. 测试设计

### Unit

- `return-to.test.ts`：合法站内 href、query/hash、`//`、host/scheme、反斜杠、一次/重复编码、畸形编码、login loop、默认 `/`。
- `-legacy-routing.model.test.ts`：各领域白名单、snake→camel、枚举转换、未知字段丢弃、Publishing 优先级与冲突组合。

### Playwright

- 新增 `tests/e2e/legacy-routing.spec.ts`，用表驱动断言每条 legacy path 的最终 pathname/search、ID 保留、refresh、Back/Forward 与无 loop。
- 从现有 `auth-session.spec.ts` 抽取最小登录/session fixture 供两份 spec 复用；domain resource 404 使用现有 fixture 形状，不复制完整业务模拟。
- 覆盖匿名 deep link、合法/恶意 redirect、must-change、ADMIN、ENGINEER 403、未知 path、资源不存在、桌面/移动代表路径。
- 沿用现有 `console.error`、`pageerror`、`requestfailed`、`securitypolicyviolation` 监听。

## 7. 文档与回滚

- 只有实现并验证后才更新三份 V2 文档，明确结果仅为本地证据，不能写成 Staging 已验证。
- 本任务无数据迁移和外部状态；实现回滚由删除新增显式 routes、return-to owner、测试及相应文档增量完成。不得用全局首页 fallback 作为回滚。

## 8. 已批准决策

### D1 canonical work list 支持 `CLOSED`（2026-08-26）

用户已批准在现有 `/publishing/work` search schema 与列表请求 owner 中加入 `CLOSED`。该决定只扩展 canonical 前端筛选能力，使 `tab=history` 能精确转换；不改变 backend/API 或其他 publication 页面。当前没有阻塞实施的用户决策。
