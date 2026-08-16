# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

- 交互密度变更必须保留字段、入口、权限判断、服务端 available actions、确认文案、query key 与 API 载荷。
- 长表单校验复用 Ant Form `errorFields`、`scrollToFirstError` 和显式修订号；保存状态至少区分未修改、未保存、保存中、已保存和失败。
- 留在当前页面的长期保存、删除、启停和显式状态操作使用 `App.useApp().message` 给出短中文成功反馈；简单创建后结果立即可见或立即导航时不重复通知。
- Markdown HTML 只能由 `renderSanitizedMarkdown` 写入 React sink；该边界用 DOMPurify 返回 `TrustedHTML`，页面不得创建 Trusted Types policy 或直接组合 `marked`、DOMPurify 与 `dangerouslySetInnerHTML`。

## 场景：Vite 开发配置选择

### 1. 适用范围

- 修改前端开发命令、Docker Compose 前端服务或 Vite 配置选择时适用。

### 2. 命令签名

```bash
npm --prefix frontend run dev -- [vite arguments...]
vite --config vite.config.ts [vite arguments...]
```

### 3. 合同

- `frontend/vite.config.ts` 是受支持开发入口的权威配置；`dev` 脚本必须显式传入 `--config vite.config.ts`，不得依赖 Vite 自动发现。
- Compose 通过 `VITE_API_PROXY_TARGET=http://api:8000` 连接 API 容器；宿主机未设置该变量时才使用配置内的 `http://localhost:8000` 回退。
- 相邻的本地生成 `vite.config.js` 或 `.d.ts` 即使存在，也不能改变受支持开发命令的配置选择。

### 4. 验证与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| Compose 设置 `VITE_API_PROXY_TARGET` | `/api` 代理到 `api:8000` |
| 宿主机未设置代理目标 | 使用 `localhost:8000` |
| 目录残留旧 `vite.config.js` | 显式配置仍选择 `vite.config.ts` |
| `/api` 返回 Vite 500 和 `ECONNREFUSED` | 对照实际 `configFile`、代理目标、容器内直连和 API 健康，禁止先改 DNS 或硬编码 IP |

### 5. Good / Base / Bad

- Good：`npm run dev` 显式选择 `vite.config.ts`，Compose 代理和真实登录在容器重启后通过。
- Base：隔离 E2E 继续追加相同 `--config` 参数并使用宿主机 API，重复参数不改变隔离边界。
- Bad：裸运行 `vite` 并依赖扩展名优先级，导致被忽略的旧 `.js` 配置遮蔽当前 TypeScript 配置。

### 6. 必需测试

- 解析 `frontend/package.json` 并确认 Vite 收到 `--config vite.config.ts`。
- Compose 前端重启后验证代理健康 200、无会话探测 204、真实登录 200，且新日志无代理 `ECONNREFUSED`。
- 配置入口变更后至少运行一个包含真实登录准备流程的隔离 Playwright 用例，并确认数据库与临时存储清理成功。

### 7. Wrong vs Correct

```jsonc
// Wrong：自动发现可能选择本地旧 vite.config.js。
"dev": "vite --host 0.0.0.0"

// Correct：显式选择受版本控制的权威配置。
"dev": "vite --config vite.config.ts --host 0.0.0.0"
```

---

## Testing Requirements

<!-- What level of testing is expected -->

- 完整前端门禁从仓库根目录运行 `npm --prefix frontend run test`；直接调用 Vitest 时必须以 `frontend/` 为工作目录。记录结果时同时保留通过数、失败数、跳过数和实际耗时；性能上限由具体任务和执行环境约定，不把错误工作目录产生的 jsdom 失败或一次未超限的慢运行写成挂起结论。
- 从仓库根目录运行 Playwright 时使用 `npm --prefix frontend run e2e -- <测试文件> --project=e2e`，让 npm 脚本以 `frontend/` 为工作目录并加载 `frontend/playwright.config.ts`。不得使用 `npm --prefix frontend exec -- playwright test`；当前 npm 会保留仓库根工作目录，表现为只发现空项目而不是应用测试失败。
- 单元测试覆盖更多菜单确认链、章节 `aria-current`、dirty/error/save 状态、次级查询局部失败、URL 恢复与历史同步、pathname 焦点和工作台语义 tone；jsdom 不断言 sticky 坐标或具体颜色。
- E2E 复用现有数据流程，断言代表性产品搜索 URL、事实章节和对象标题、内容任务/审核章节、AI 更多菜单键盘焦点及人工发布 Tab URL。
- 含 API Key、密码或敏感 Header 的 real-stack Playwright 必须由 V1/V2 config owner 在 `PARTSIGNAL_E2E_REAL_STACK=1` 时统一关闭 trace；fixture suite 继续 `retain-on-failure`。不得依赖测试文件逐个覆盖策略，也不得事后编辑 trace、report 或日志掩盖泄漏。
- real-stack 必须使用启动前为空的独占非 0 Redis logical DB；preflight 拒绝同库外部客户端和固定端口占用，cleanup 只删除枚举后确认属于本套件的精确 Celery/Kombu 键，并在进程 `wait` 后证明 Redis 为空和端口释放。禁止 `FLUSHDB`、通配删除或共享 DB 静默清理。
- 长文本表格回归必须用实际触发 `scrollWidth > clientWidth` 的压力值，扫描 `td` 和动态矩阵 `th` 内登记的 `.table-cell-ellipsis`，并断言内容矩形位于所属单元格内、行高有界、交互文本可由键盘到达；代表用例还必须验证鼠标悬停和键盘聚焦都能读取完整值。复合身份的代表用例必须分别从根容器、固定图形和文本叶子触发 Tooltip，并确认焦点停靠在根容器，不能只精确 hover 内部文本。只检查 `overflow:hidden` 计算样式或页面外框不溢出不能证明列边界正确。
- Tooltip 回归不能只断言 `role`、文本内容和 DOM 可见；代表性真实浏览器用例必须读取最终计算后的前景色与背景色，并验证普通文字对比度至少为 4.5:1，防止浮层存在但白底白字或同色不可读。
- 真实浏览器在浅色、深色、跟随系统三种模式下检查 375/768/1024/1440px、实际 200% 缩放和键盘链；宽表只能在 `TableRegion` 内溢出。
- `emulateMedia`、主题或响应式状态切换可能重挂载布局。切换后的几何断言必须重新查询当前已连接节点，并先轮询关键尺寸稳定；不得把旧节点的零尺寸误判为生产 CSS 缺陷。

## 场景：V1/V2 根质量入口与 V2 Foundation Smoke

### 1. 适用范围

- 修改根 `Makefile`、Frontend V2 测试脚本或 Foundation Playwright smoke 时适用。

### 2. 命令签名

```bash
make bootstrap contract-check lint typecheck test-unit build e2e verify
npm --prefix frontend-v2 run e2e -- [Playwright arguments...]
```

### 3. 合同

- 根 `bootstrap`、`contract-check`、`lint`、`typecheck`、`test-unit`、`build` 和 `e2e` 必须顺序保留 V1 命令并运行对应 V2 script；任一命令非零时 target 失败。
- V2 Playwright 由 `frontend-v2/playwright.config.ts` 管理，`webServer` 必须先执行 `npm run build` 再运行 `vite preview`；不得以 Vite dev server 代替 production artifact。
- Foundation smoke 只通过显式 `foundationApi` fixture 隔离匿名 `GET /api/v1/auth/me`，负责 `/` 的 App Shell 与导航入口；其他 API、页面异常、失败请求或失败静态资源均使测试失败。
- 已落地的业务 route 从 Foundation smoke 迁移到独立 production-artifact spec。Products 使用 `products.fixture.ts` 中 generated `ProductListItem`/`ProductCreate`/`Product`/`ProductDetail`/`ProductUpdate` 约束的显式 API projection 与 mutation；未声明 API 必须失败，fixture 不得进入运行时代码，也不得宣称为完整后端业务 E2E。
- Product Detail 只允许 `GET /api/v1/products/{id}/detail` 获取页面 server state。fixture 返回已经定义的 read-model 数据，不复制 backend 选择、join 或 Activity 排序逻辑；浏览器发起 Facts/Content/Publication/GEO/Audit 请求必须作为未声明 API 失败。
- `frontend-v2/vite.config.ts` 必须在保留 Vitest 默认 exclude 的基础上排除 `tests/e2e/**`，避免 Playwright spec 被 Vitest 当成 unit suite。

### 4. 验证与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| V1 或 V2 npm script 失败 | 对应 Make target 与 `make verify` 非零退出 |
| V2 production build/preview 未就绪 | Playwright webServer 启动失败，不执行固定成功测试 |
| 未声明 `/api/v1/**` 请求 | `foundationApi` 记录请求并使 smoke 失败 |
| Products 页面请求 Facts/Versions/Actions join | `productsApi` 记录为未声明请求并使业务 spec 失败 |
| Product Detail fixture 收到第二条跨域 summary 请求 | 测试失败；修复页面 query 边界，不扩展 fixture 模拟客户端 join |
| 预期 404/403/409/503 响应 | 页面必须显示已定义 UX；fixture 只忽略 Chromium 对这些已处理响应的资源 console 文案 |
| route chunk 或普通 API 真实失败 | `requestfailed` 使测试失败；只有测试主动 refresh/Back/Forward 或成功删除导航产生的 `net::ERR_ABORTED` 可排除 |
| Playwright spec 被 Vitest 导入 | V2 unit 门禁失败，修复测试发现边界而非跳过 suite |

### 5. Good / Base / Bad

- Good：`make verify` 同时覆盖 V1/V2；Foundation 验证 App Shell，Products spec 在同一真实 build artifact 上验证业务 route、URL/API mapping 和 375/768/1024/1440。
- Base：Foundation 使用明确 fixture 且不请求业务数据；业务 spec 使用 generated type fixture 并明确前端测试边界。
- Bad：继续让 Foundation 假装验证已落地业务页、在运行时代码加入 mock fallback、客户端 join、过滤未知 console/request failure，或把 fixture 测试宣称为真实业务闭环。

### 6. 必需测试

- `npm --prefix frontend-v2 run e2e -- tests/e2e/foundation-smoke.spec.ts`：两个 project 均通过。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/products-list.spec.ts`：Products route 的 typed fixture、URL 恢复、业务动作、状态、键盘和四档宽度均通过。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/new-product.spec.ts`：新建产品 production artifact 的结构化错误、CSRF/body、pending、DirtyGuard、canonical navigation、列表失效、375/1440 与运行时错误审计均通过。
- `npm --prefix frontend-v2 run e2e -- tests/e2e/product-detail.spec.ts`：单 detail API、summary 有/无、服务端 Activity/action、UPDATE/DELETE、404/403/retry、375/768/1024/1440、keyboard/focus 与运行时错误审计均通过。
- V1/V2 `api:check`、lint、typecheck、test 和 build 分别通过。
- 修改后的根 targets 通过，最后运行 `make verify`。

### 7. Wrong vs Correct

```text
Wrong: Foundation 继续覆盖业务占位页 + Product Detail 客户端 join + 运行时固定成功 fallback + 忽略未知 console/request failure
Correct: production build + vite preview + Foundation/业务 typed fixture 分责 + 单一 ProductDetail read model + 未声明请求/运行时错误直接失败
```

## 浏览器与 jsdom 测试边界

```ts
// 错误：媒体切换前解析元素，重挂载后可能继续量测失效节点。
const content = await page.locator('.app-content').elementHandle();
await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
expect(await content?.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

// 正确：切换后从当前 document 重新查询，并同时保留非零和无文档溢出断言。
await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
await expect.poll(() => page.evaluate(() => (
  document.querySelector<HTMLElement>('.app-content')?.getBoundingClientRect().width ?? 0
))).toBeGreaterThan(0);
expect(await page.evaluate(() => document.documentElement.scrollWidth))
  .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
```

### jsdom 能力边界

- `src/test/setup.ts` 只为 jsdom 明确未实现、且组件库真实调用的浏览器能力提供替身，不得通过过滤 `console` 或虚拟控制台错误隐藏未知问题。
- jsdom 对 `@rc-component/util` 使用的 `::-webkit-scrollbar` 查询会告警后返回宿主元素样式；测试替身只对该已证实调用执行同一回退，其他未知伪元素仍应暴露。伪元素尺寸、布局和视觉正确性仍由 Playwright 验证，不能依赖该替身断言。
- CodeMirror 的 `.cm-content` 是增量渲染的内部 DOM，不得在输入后缓存其 `textContent` 作为受控 Markdown 值。Component unit 使用 Preview、字符/行数或 mutation payload 证明 React controlled value；精确编辑 DOM 行为由 Playwright 验证。

```ts
getComputedStyle(element, pseudoElement === '::-webkit-scrollbar' ? undefined : pseudoElement);
```

修改测试环境替身后，至少运行一个会渲染 Ant Design 表格或弹窗的测试文件，并确认进程输出中没有对应的 `Not implemented` 提示。

---

## Code Review Checklist

<!-- What reviewers should check -->

- 是否出现第二个高频入口、直出危险按钮或无确认的危险菜单项？
- 是否出现 URL 与组件内部两份页码/Tab/筛选状态？
- 次级查询失败是否遮蔽了身份、返回入口或兄弟区块？
- 是否新增运行时依赖、第二套设计系统、状态 Store、通知框架、硬编码主题颜色或业务契约变化？
- 是否完成浅/深/system、响应式、200% 缩放、键盘和焦点恢复验收？
