# 设计：P2 兼容性、SEO 与 Agentic

## Baseline 兼容设计

### `:has()`

- header 包含 kicker 的布局由渲染组件直接提供稳定 class。
- Products Modal 使用 Ant `rootClassName`，不通过 `body:has()` 识别页面。
- 打印路由由 AppLayout 根据明确 route 提供 `app-shell-print`。
- 删除项目 CSS 中桌面、移动和打印的全部 `:has()`。

Ant 自有 `:has()` 不直接修改 node_modules；通过 Firefox/WebKit 的表单、Select、
focus 和长标签行为验证其正常降级。发现功能问题时在项目边界用稳定 class 或
`:focus-within` 修复，不改依赖分发文件。

### 其他功能

- React 中存在 `scrollend` 支持代码，但项目无 `onScrollEnd`；实际滚动流程必须
  在三浏览器通过。
- Ant `text-wrap: balance` 不支持时按 CSS 规范退化为普通换行，验证长中英文标签。
- 继续复用 global/workspace 的 `@supports not(backdrop-filter)`。
- 登录纯装饰点阵采用 fallback-first：默认 `display:none`，仅在
  `@supports(mask-image)` 时显示并应用 mask，避免无法模拟的否定分支成为唯一
  降级实现。
- Firefox 通过原生 preference 关闭 `backdrop-filter` 后实际执行不透明背景降级；
  普通 Firefox/WebKit/Chromium 继续验证增强路径。

## Production source map

使用 Vite `build.sourcemap: true`，不使用 `hidden` 或
`sourcemapExcludeSources`。Nginx 与普通哈希资产同源公开 `.map`，设置 JSON
Content-Type、`nosniff` 和 immutable。

访问控制与 PageSpeed 匿名抓取不兼容，因此设计明确选择公开完整 map；修改
`vite.config` 前必须取得用户授权。

构建门禁遍历 map，检查 JSON 可解析、sources/sourcesContent 数量一致、无
`.env`/凭据/私钥/绝对本机路径。客户端源码本身若含秘密，应修复源码，不能靠
隐藏 map。

## SEO 和 llms

经授权后固定为：

```html
<meta name="robots" content="index,follow" />
<meta
  name="description"
  content="PartSignal 是面向已授权用户的多平台 GEO 内容运营系统，提供内容运营、发布与效果观测入口。"
/>
```

`robots.txt`：

```text
User-agent: *
Allow: /
```

`llms.txt`：

```markdown
# PartSignal

PartSignal 是面向已授权用户的 GEO 内容运营系统。

- [PartSignal 入口](https://geo.962850.xyz/)
- [PartSignal 登录](https://geo.962850.xyz/login)
```

不添加 API、权限模型、账号类型、内部主机、训练许可声明或私有文档。
README 同步说明登录入口公开可发现，但业务数据仍由认证/权限保护。

## 无障碍人工矩阵

矩阵固定覆盖：

1. custom controls labels；
2. custom controls roles；
3. focus traps；
4. focusable controls；
5. interactive element affordance；
6. logical tab order；
7. managed focus；
8. offscreen content hidden；
9. landmarks；
10. visual order follows DOM。

代表场景包括登录、主题选择、导航、表格操作、表单错误、Modal、Drawer、
Dropdown、Tabs、路由切换、375/1440 视口、200% zoom 和打印。自动 role/name/
Tab/axe 断言与人工证据同时保留。

## 结构化数据

登录页没有公开富结果实体，不创建未经证实的 JSON-LD。生产 HTML 通过 Google
Rich Results Test、Schema.org validator 和源码搜索，记录 0 实体/0 错误。
如果 Rich Results Test 匿名入口要求登录，不借用用户账号；记录实际失败原因，
并以当前 PageSpeed 的 Google 抓取结果、渲染 DOM 与 Schema.org Validator
作为三份独立证据。如果依赖或后续代码实际生成实体，则改为验证和修复全部错误。

## 回滚与授权

- Baseline fallback 和无障碍修复不扩大公开面，可先本地实施。
- SEO、llms、source map 在修改代码前集中请求一次确认。
- 回滚可恢复 noindex/robots 并删除 llms/map，但不能召回搜索或第三方缓存。
