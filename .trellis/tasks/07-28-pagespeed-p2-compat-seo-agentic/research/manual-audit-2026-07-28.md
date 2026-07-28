# 无障碍与结构化数据人工审核记录

## 审核元数据

- 审核人：Codex（XX）
- 日期：2026-07-28（Asia/Shanghai）
- 基线：PageSpeed desktop `ibm9s8ga5b`，Accessibility 100，但列出 10 项
  Lighthouse 人工审核和 1 项 structured data 人工审核。
- 主人工环境：Playwright CLI，Headless Chromium 150，
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/150.0.0.0`。
- 视口：1280×800、375×760；另在浏览器中设置 200% zoom，布局视口 640px。
- 场景：登录页、Products 列表、新增产品 Modal、用户 Dropdown、移动 Drawer、
  产品详情 Tabs、打印路由。
- 认证页面通过 Playwright route mock 提供最小合法 API 响应；不访问或修改生产数据。

## 十项人工检查

| Lighthouse audit id | 实际步骤与观察证据 | 发现与处理 | 状态 |
| --- | --- | --- | --- |
| `custom-controls-labels` | 登录主题组读为“主题模式”，含浅色/深色/跟随系统三个 radio；账号、密码、显示密码按钮均有名称；Products 搜索框、Modal 字段和动作按钮均可读出名称 | 未发现缺失 label | Closed |
| `custom-controls-roles` | 验证 radio/radiogroup、button、searchbox、menu/menuitem、dialog、tablist/tab/tabpanel 的实际可访问角色；移动 Drawer 初次为无名称 dialog | 为 Drawer 增加可见标题“主导航”，复测 `getByRole('dialog', {name:'主导航'})` 通过 | Closed |
| `focus-traps` | Modal 从关闭按钮依次 Tab 到字段和动作，再回到关闭按钮；焦点始终位于 dialog 内；Escape 关闭并回到“新增产品” | 未发现 Modal 逃逸 | Closed |
| `focusable-controls` | 登录页键盘序列为主题组选中项→账号→密码→显示密码→登录；Products 1280px 下 19 个可见交互元素均可聚焦；关闭的浮层不进入实际 Tab 序列 | 未发现不可聚焦的可见控件 | Closed |
| `interactive-element-affordance` | 375px 与 1280px 逐项观察按钮、链接、radio、输入框、菜单、Tabs；键盘焦点有 3px token 焦点环，选中与 hover 不作为唯一状态 | 为 Ant 关键控件增加项目边界 `:focus-within` fallback | Closed |
| `logical-tab-order` | 登录与 Products 逐项 Tab；顺序与视觉从上到下、从左到右一致；Modal 顺序为关闭→字段→取消/提交 | 未发现跳跃或正 `tabindex` | Closed |
| `managed-focus` | 路由进入产品详情后焦点位于 `.app-content`；Tabs 通过 ArrowRight/Enter 移动和激活；Modal/Dropdown/Drawer 关闭后检查触发器焦点 | Dropdown 初次 Escape 后焦点丢失；Drawer 菜单内初次需两次 Escape。增加 Dropdown `onOpenChange` 焦点归还和 Drawer 菜单 Escape 捕获，复测均一次关闭并归还焦点 | Closed |
| `offscreen-content-hidden` | 在 375px 检查桌面 sider、关闭 Modal/Drawer/Dropdown；它们不进入键盘序列，打开后仅当前浮层可交互；页面级横向溢出为 0 | 未发现键盘可达的屏外隐藏内容 | Closed |
| `use-landmarks` | 登录页存在 header/main/footer，H1“PartSignal”、H2 登录标题；认证页存在 aside/header/main 且每页恰有一个 H1 | Drawer 原无可访问名称已在 roles 项一并修复 | Closed |
| `visual-order-follows-dom` | 375px 登录页按元素纵坐标核对主题、品牌、表单、安全说明；认证页检查 CSS 计算 `order` 的非零元素数为 0；200% zoom 时 H1 和移动导航可见、页面无横向溢出 | 未发现 CSS/视觉顺序与 DOM 不一致 | Closed |

## 缺陷闭环

| 缺陷 | 根因位置 | 最小修复 | 回归 |
| --- | --- | --- | --- |
| 用户 Dropdown 关闭后焦点落到 document | `frontend/src/app/AppLayout.tsx` 的 Ant Dropdown 没有显式关闭焦点归还 | 保存触发按钮 ref，在 `onOpenChange(false)` 聚焦 | Firefox/WebKit/Chromium 均验证 Escape 后触发器聚焦 |
| 移动 Drawer 无 accessible name | 同文件 Drawer 未设置 `title` | 设置可见 `title="主导航"` | 三浏览器按 name 查询 dialog |
| Menu 聚焦时第一次 Escape 被 Menu 消费 | Drawer 内容中的 Ant Menu 先处理键盘事件 | 在 Drawer 内容边界捕获 Escape 并关闭 | 三浏览器一次 Escape 关闭并归还导航按钮焦点 |

修复后的完整代表矩阵已重跑；没有保留只记录不处理的问题。

## 结构化数据人工检查

1. 源码/产物检查：仓库与当前生产 HTML 未发现
   `application/ld+json`、microdata 或 RDFa。
2. 渲染 DOM 检查：本地认证产品详情页结果为
   `jsonLd=0, microdata=0, rdfa=0`。
3. Schema.org Validator 对 `https://geo.962850.xyz/` 的实际结果为
   “未检测到任何项目”，即 0 个实体，没有无效实体可修复。
4. Google Rich Results Test 已实际提交同一 URL，但匿名页面返回
   “请登录，然后重试”；未使用用户 Google 账号绕过。以当前 PageSpeed 的
   Google 抓取结果、渲染 DOM 检查和 Schema.org Validator 作为独立替代证据。

登录页和认证后业务页面都不构成已证实的公开富结果实体，因此不创建虚构
JSON-LD。本项结论是“0 个结构化实体、0 个无效实体”，不是“待人工检查”。

## 自动回归与验收

- `frontend/tests/e2e/compatibility.spec.ts` 固化 mask/backdrop、显式布局类、
  横向滚动、Modal 焦点、Dropdown 焦点、命名 Drawer、一次 Escape、打印布局。
- Chromium、Firefox、WebKit 各 3/3 通过。
- landmarks、完整 Tab 顺序、屏外内容、视觉/DOM 顺序和 Tabs 的结论来自上表
  逐项人工操作，不宣称已全部转成自动回归。
- 本地验收阈值：10 项状态全部 Closed；所有已发现问题有代码修复和三浏览器
  回归；结构化数据 0 个无效实体。
- 线上验收阈值：获部署授权并发布后，PageSpeed Accessibility 仍为 100；该项
  当前尚未复测，因此 P2 AC5 保持未勾选。

行为变化仅限无障碍名称和键盘焦点管理，不扩大公开面，不需要额外产品授权。
生产部署和 PageSpeed 线上复测仍需部署授权。
