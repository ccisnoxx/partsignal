# V2 波次 2 已认证只读验收报告

## 结论

本 run 结果为 `BLOCKED`。ADMIN 登录、工作台和产品列表得到当前运行证据；批量 canonical 路由检查期间独立 Chromium 会话意外关闭，`playwright-cli list --all --json` 随后确认没有浏览器实例。按已批准的会话失效规则，本轮没有自动重登，未继续其余波次 2 路由，也未进入波次 3。

该阻断不能归因为线上产品缺陷：已观察错误来自浏览器工具会话 `Error: Session closed`，当前证据不足以判断页面、浏览器进程或 CLI 连接中的具体根因。

## 运行身份

- Run ID：`20260830-191717-v2-auth-readonly`
- 目标：`https://geo.962850.xyz`
- 浏览器：项目 `playwright-cli` 独立 Chromium 会话 `v2-auth-readonly-191717`
- 页面标题：`PartSignal Frontend V2`
- 环境口径：公网 V2 Staging/预发布运行态；未宣称 Production
- 启动前：`browsers=[]`、`servers=[]`
- 收口后：`browsers=[]`、`servers=[]`

## 已执行步骤

| 步骤 | 状态 | 当前运行证据 |
| --- | --- | --- |
| 登录页稳定状态 | `PASS` | 1440×900 表单、字段标签、显示密码与登录按钮可见；截图 `01-login-1440.png` 已检查 |
| ADMIN 登录 | `PASS` | `POST /api/v1/auth/login` 返回 200；最终进入 `/`；凭据未写入文件、截图或命令参数 |
| UI 角色与改密守卫 | `PASS` | App Shell 显示“系统管理员”；没有强制进入 `/account/security` |
| 字段级认证门禁 | `NOT_RUN` | 会话关闭前没有单独保存 `/auth/me` 的 `account_type` 与 `must_change_password` 脱敏字段证据，不能用 UI 表现替代字段级断言 |
| 工作台 `/` | `PASS` | `GET /api/v1/workbench` 返回 200；导航、面包屑、聚合卡片和健康区渲染；控制台 0 error/0 warning |
| 产品 `/products` | `PASS` | 页面、搜索/筛选/排序/分页与新建入口渲染；当前活动列表为空；无页面级横向溢出 |
| 其余 canonical/ADMIN 路由 | `NOT_RUN` | 路由 sweep 在进入后续路径时浏览器会话关闭，没有完整稳定状态证据 |
| 375 响应式、移动 Sheet 与键盘详情 | `NOT_RUN` | 会话关闭后按门禁停止 |
| 波次 3 TEST 聚合写入 | `NOT_RUN` | 未自动重登，未产生任何测试业务对象 |

## 网络与运行时

- 登录前 `GET /api/v1/auth/me` 返回 204，符合匿名合同。
- 唯一观察到的写请求为获授权的 `POST /api/v1/auth/login`，返回 200。
- 登录后已观察到的业务请求为 `GET /api/v1/workbench`，返回 200。
- 登录完成后的控制台为 0 messages、0 errors、0 warnings。
- 路由 sweep 未返回完整事件汇总，因此没有把未观察路由写成通过。

## 证据限制

- 截图只证明当前可见布局，不能独立证明完整键盘、语义或 WCAG 合规。
- 产品列表为空，因此本轮没有真实详情 ID、行操作或分页边界证据。
- CLI 输出持续提示本地 skill 文档与工具版本不匹配；本任务没有安装或修改工具，避免扩大工作区变化。该提示与 `Session closed` 是否相关尚未证明。
- 波次 3 要求同一受控认证会话和 Staging 正面门禁；本轮会话已丢失，因此没有执行写入。

## 截图索引

1. `screenshots/01-login-1440.png`：登录页稳定状态。
2. `screenshots/02-workbench-1440.png`：ADMIN 工作台。
3. `screenshots/03-products-1440.png`：空产品列表与操作入口。
