# Wave 0–1 线上只读用例结果

运行标识：`20260830-175056-v2-readonly`  
目标：`https://geo.962850.xyz`  
会话：主执行 `v2-live-readonly-175056`；AC3 复核 `v2-live-readonly-recheck-20260830-ac3`（Chromium，匿名临时 context）  
执行窗口：2026-08-30 17:50:56–17:56:24；AC3 复核 18:10:34–18:11:05（Asia/Shanghai）

## 波次 0：环境与边界

| 用例 | 状态 | 本轮证据 |
| --- | --- | --- |
| 公网首页可达 | PASS | `curl`：HTTP 200，最终 URL `https://geo.962850.xyz/`，`text/html` |
| `/login` 可达 | PASS | `curl`：HTTP 200，最终 URL `https://geo.962850.xyz/login`，`text/html` |
| live health | PASS | `{"status":"ok","checks":null}` |
| ready health | PASS | `{"status":"ok","checks":{"postgresql":"ok","redis":"ok"}}` |
| 页面身份 | PASS | 页面标题 `PartSignal Frontend V2`；登录页可见 `PartSignal`、`登录` 和系统分配账户提示 |
| 环境语义 | PASS | 沿用最新可证实部署材料：release `mvp-20260830-133651-a663bcce`、`.env.staging`、`partsignal-staging`、fake OSS；本报告称为“公网 V2 Staging/预发布运行态”，不写成 Production 通过 |
| 只读边界 | PASS | 未登录、未加载 storage state、未设置 cookie/localStorage、未使用 mock/route、未执行业务写入、未使用 SSH |

## 波次 1：登录页与路由

### 登录页结构和交互

| 用例 | 状态 | 本轮证据 |
| --- | --- | --- |
| 标题、字段和按钮 | PASS | `01-login-1440.yml`：用户名、密码、显示密码、登录均可见；标题为 `PartSignal Frontend V2` |
| 初始焦点 | PASS | 初次打开和刷新后 `activeElement=#login-username` |
| Tab 顺序 | PASS | 375px：用户名 → 密码 → 显示密码 → 登录；无跳过关键控件 |
| Shift+Tab | PASS | 从显示密码反向移动回密码，焦点仍在真实控件 |
| 焦点可见性 | PASS | 用户名和显示密码聚焦时存在可见蓝色 outline/box-shadow；截图与计算样式均有证据 |
| 可访问名称和错误关系 | PASS | `aria-label="显示密码"`/`"隐藏密码"`；空提交后两个输入 `aria-invalid="true"`，分别关联 `login-username-error` 与 `login-password-error` |
| 密码显示切换 | PASS | 点击显示后 `type=password → text`、名称变为“隐藏密码”；再次点击恢复 |
| 空提交（点击） | PASS | 仅点击“登录”，出现“请修正以下问题”、用户名和密码错误，URL 不变；未产生登录 POST |
| 空提交（Enter） | PASS | 用户名聚焦时按 Enter，得到相同字段错误且焦点回到用户名；未产生登录 POST |
| Escape | NOT_APPLICABLE | 页面无真实可关闭浮层，不制造不适用断言 |

### 匿名路由矩阵

受保护路由均安全回到登录页并保留站内 return-to；未知路径稳定显示 404，没有观察到跨域、空白或重定向循环。首轮多份 refresh/direct 文件只保存了登录状态校验过渡快照，因此没有被当作通过依据；独立 AC3 复核等待过渡态结束后重新记录了最终 URL、`h1` 和稳定页面标识，见 `ac3-recheck-20260830.yml`。

| 请求路径 | Direct | Refresh | 实际可观察结果 |
| --- | --- | --- | --- |
| `/login` | PASS | PASS | 保持 `/login`，显示登录表单 |
| `/` | PASS | PASS | `/login?redirect=%2F` |
| `/products` | PASS | PASS | `/login?redirect=%2Fproducts%3Fpage%3D1` |
| `/content/tasks` | PASS | PASS | `/login?redirect=%2Fcontent%2Ftasks%3FarchiveStatus%3DACTIVE%26page%3D1%26pageSize%3D20` |
| `/publishing/work` | PASS | PASS | `/login?redirect=%2Fpublishing%2Fwork%3Fpage%3D1%26pageSize%3D20` |
| `/geo/observations` | PASS | PASS | `/login?redirect=%2Fgeo%2Fobservations%3Fpage%3D1%26pageSize%3D20` |
| `/settings/platforms` | PASS | PASS | `/login?redirect=%2Fsettings%2Fplatforms%3Fpage%3D1%26pageSize%3D20` |
| `/system/audit` | PASS | PASS | `/login?redirect=%2Fsystem%2Faudit...`；站内 return-to 保留，查询由页面规范化 |
| `/tasks` | PASS | PASS | `/login?redirect=%2Ftasks`；仅记录匿名 return-to，不推断登录后落点 |
| `/observations` | PASS | PASS | `/login?redirect=%2Fobservations`；仅记录匿名 return-to |
| `/configuration` | PASS | PASS | `/login?redirect=%2Fconfiguration`；仅记录匿名 return-to |
| `/users` | PASS | PASS | `/login?redirect=%2Fusers`；仅记录匿名 return-to |
| `/audit` | PASS | PASS | `/login?redirect=%2Faudit`；仅记录匿名 return-to |
| `/__v2-readonly-not-found__` | PASS | PASS | 保持未知路径并显示明确 `404 / 页面不存在 / 返回工作台` |
| `/products` → `/content/tasks` → Back | PASS | NOT_APPLICABLE | Back 恢复 `/login?redirect=%2Fproducts...`，无循环 |
| 同一序列 Forward | PASS | NOT_APPLICABLE | 恢复 `/login?redirect=%2Fcontent%2Ftasks...`，稳定显示登录表单，无跨域或循环 |

AC3 复核还确认 console 为 0 messages、0 errors、0 warnings；两个命名会话均已精确关闭，最终浏览器清单为空。

### 响应式、缩放和视觉证据

| 视口/检查 | 状态 | 本轮证据 |
| --- | --- | --- |
| 320×800 | FAIL | 布局本身无页面级溢出且控件均在视口内，但控件高度均为 32px，低于 44px 触控目标合同，见缺陷 `P2-001` |
| 375×900 | FAIL | 布局本身无页面级溢出且控件均在视口内，但控件高度均为 32px，低于 44px 触控目标合同，见缺陷 `P2-001` |
| 768×900 | PASS | 根节点 `scrollWidth=768/clientWidth=768`，表单完整可达 |
| 1024×768 | PASS | 根节点 `scrollWidth=1024/clientWidth=1024`，表单完整可达 |
| 1440×900 | PASS | 根节点 `scrollWidth=1440/clientWidth=1440`，表单完整可达 |
| 200% 真实浏览器缩放 | NOT_RUN | 尝试两次 Chromium `Control+Equal` 后 `innerWidth=375`、`devicePixelRatio=1`、`visualViewport.scale=1`、`body zoom=1`，工具未证明真实 200% 缩放；未用 CSS zoom 冒充 |
| reduced-motion 变体 | NOT_RUN | 当前浏览器 `matchMedia('(prefers-reduced-motion: reduce)').matches=false`；未通过页面 DOM/CSS 模拟 reduced-motion |

截图均来自本轮页面，已逐张检查；通过的关键截图为 `01-login-1440.png`、`02-login-320.png`、`03-login-375.png` 和 `04-unknown-404.png`。截图证明布局和可见状态，不单独证明完整 WCAG 合规。

## 浏览器运行时与网络

| 检查 | 状态 | 脱敏结果 |
| --- | --- | --- |
| Console | PASS | `playwright-cli console`：0 messages，0 errors，0 warnings |
| 静态资源 | PASS | `requests --static` 中观察到的 HTML、JS、CSS 均 HTTP 200 |
| 匿名 session 检查 | PASS | `/api/v1/auth/me` 为预期匿名 `204`；没有认证请求 |
| 业务 mutation | PASS | 交互仅触发客户端校验；请求列表未见登录 POST 或业务写入 |
| CSP/Trusted Types | PASS | HTML 响应含 `content-security-policy`，包括 `trusted-types dompurify` 与 `require-trusted-types-for 'script'`；文档 `typeof trustedTypes="object"`；无 console 错误 |
| pageerror 专用事件清单 | NOT_RUN | 当前 CLI surface 未提供独立 pageerror 列表；页面加载、刷新和路由过程中无可见运行时异常，保留该限制而不把它写成事件级通过 |
| requestfailed 专用事件清单 | NOT_RUN | 当前 CLI surface 未提供独立 requestfailed 列表；可见请求状态均为 200/204，未把工具限制写成事件级通过 |

## 缺陷

### P2-001：移动端登录关键控件高度低于项目合同

- 严重度：`P2/Medium`
- 类型：响应式 / 可访问性 / 触控目标
- URL：`https://geo.962850.xyz/login`
- 前置状态：匿名登录页；Chromium；320×800 或 375×900
- 最短复现：打开登录页，将视口设为 320×800 或 375×900，观察用户名、密码、显示密码和登录控件的 bounding box。
- 预期：依项目视觉系统，移动端关键目标至少 `44×44 CSS px`，关键操作易于触达。
- 实际：用户名输入、密码输入、显示密码按钮和登录按钮高度均为 `32px`；宽度虽足够，但垂直触控目标低于 44px。
- 证据：`02-login-320.yml`、`03-login-375.yml`；截图 `02-login-320.png`、`03-login-375.png`。
- 影响：窄屏触控和低精度指针下，登录与密码显示操作更难稳定命中；不阻断匿名页面键盘操作。
- 建议：由前端登录表单 owner 将移动端关键控件的可命中区域提高至至少 44px，同时保持标签、错误关联和窄屏无横向溢出；修复后重新执行 320/375 截图与键盘回归。

## 未覆盖/延期

- 未提供安全凭据，因此未进入登录后 App Shell、角色权限和业务页面；本报告不继承历史登录后测试结论。
- Firefox、WebKit、真实移动设备、屏幕阅读器、业务状态机和任何写入流程不在本轮范围。
- 页面刷新时短暂出现“正在验证登录状态”过渡，随后稳定回到登录表单；未计为缺陷。
