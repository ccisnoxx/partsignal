# P1 本地实施与复测证据

## 口径

- 权威线上基线仍是 desktop 报告 `ibm9s8ga5b`；本地结果不能替代部署后的
  PageSpeed 关闭结果。
- 本地生产脚本使用 Chromium、`1440×1000`、`100ms` RTT、`1.6Mbps` 下行，
  每组五个全新 BrowserContext。
- V8 coverage 是解压源码区间；`estimatedUnusedTransfer` 只是按传输量比例估算，
  不与 Lighthouse 的压缩浪费字节混用。
- 表格中的 `138,611 B` 是 P1 前本地同脚本估算；验收阈值仍以权威 PageSpeed
  的 `137,660 B` 为基线，两者不互换。
- CSS-in-JS 的 `observedUnusedCssSourceBytes` 包含当前未触发的组件状态源码，不是
  网络传输量，也不作为删除 hover/focus/error/disabled/dark/modal/drawer 样式的依据。

## 初始包

| 指标 | P0 本地基线 | P1 当前 | 变化 |
| --- | ---: | ---: | ---: |
| 入口 JS raw | 852.00 KiB | 628.64 KiB | -223.36 KiB（-26.2%） |
| 入口 JS gzip | 276.38 KiB | 207.94 KiB | -68.44 KiB（-24.8%） |
| 初始总 transfer | 276,676 B | 212,518 B | -64,158 B（-23.2%） |
| 入口 CSS transfer | 2,991 B | 3,078 B | +87 B，仍低于 4 KiB |
| 本地估算未用 JS transfer | 138,611 B | 114,163 B | -24,448 B（-17.6%） |
| 观察到的未用 CSS 源码 | 202,334 B | 166,674 B | -35,660 B（-17.6%） |

实际边界来自本地 source map 和调用路径，不来自一次 coverage 猜测：

1. `AntApp`、`zhCN` 和工作台下拉主题控件只服务受保护路由，移到既有懒加载
   `AppLayout`。
2. 登录主题选择改为原生 radio group；外观、三态、键盘箭头和焦点可见性保持，
   不再加载 Ant `Segmented`。
3. 登录玻璃卡片改用原生 `section/h1/h2/p`，表单、验证、输入框和提交按钮仍由
   Ant 管理，不重写认证交互。
4. 认证等待和认证错误改用原生可访问状态；业务页仍复用完整
   `QueryLoading/QueryFailure/NoData`。

继续降低入口依赖需要重写 Ant 登录表单/Input/Form，已经越过“真实冷路由边界”
并扩大认证回归面，因此本地阶段按设计停止。是否达到 `≤100 KiB` 未使用 JS 和
`≤12 KiB` 未使用 CSS，只由部署后的同口径 PageSpeed 报告关闭。

## 长任务、LCP 和加载链

最终五样本：

- 最长 Long Task `64ms`；TBT 中位数 `0ms`、最大 `14ms`。
- 入口 JS 的 PageSpeed 原始 `110/90/75/61ms` 执行任务在本地不再出现。
- 残余 `63–64ms` 任务对应 Long Animation Frame 的渲染阶段，`scripts=[]`，
  位于 `renderStart` 到 `styleAndLayoutStart`，不能伪归因到某个应用函数。
- 五次 `about:blank` 和五次静态 data URL 对照均为零 Long Task；原始
  `181ms Unattributable` 未复现，但仍等待新 PageSpeed 和用户决定后关闭。
- `/auth/me` 每次恰好一个，请求在认证启动画面完成两帧后释放；LCP 元素继续是
  登录安全说明，不隐藏、不替换。
- 本地限速下 FCP 最大 `1.376s`、LCP 最大 `1.504s`；该网络口径不同于权威报告，
  线上 `≤0.8s` 仅由 PageSpeed 复测验收。
- 初始资源只有主题脚本、入口 CSS、入口 JS 和一次 `/auth/me`；没有
  `AppLayout`、改密页或工作台 CSS。
- DOM 从 PageSpeed 的 `128/18/9` 降至 `119/17/9`，CLS 为 `0`。

### 五个原始任务的归因状态

| 原始任务 | 报告可用证据 | 已证明的修改与 after | 当前状态 |
| --- | --- | --- | --- |
| 110ms | 只标记入口 JS URL；报告无 source map、函数名或调用栈 | 匿名入口移除全局 `AntApp`，工作台 Ant 上下文进入既有懒路由；当前五样本不存在同等时长入口执行任务 | 等部署后带 source map 的新 PageSpeed trace；不得猜为某个函数 |
| 90ms | 同上 | 登录主题控件从 Ant `Segmented` 改为原生 radio，工作台控件留在受保护 chunk；当前不存在同等任务 | 同上 |
| 75ms | 同上 | 登录卡片和认证启动的纯展示 Ant 组件退出匿名入口，Form/Input/Button 保留；当前不存在同等任务 | 同上 |
| 61ms | 同上 | 匿名初始 transfer 减少 64,158 B，CSS-in-JS 源码减少 35,660 B；当前残余 63–64ms 为 `scripts=[]` 的渲染阶段 | 同上 |
| 181ms Unattributable | 没有 URL、调用栈或 source map | 五次空白、五次静态对照和五次应用冷启动均未复现 | 等新 PageSpeed；若仍出现再用新 trace 归因，未经用户决定不关闭 |

前三项修改与四个入口任务的具体一一对应关系无法从旧报告恢复；表中顺序只记录
已证实的入口边界变更，不宣称每个修改唯一对应某个历史时长。安全替代方案是发布
经授权的 production source map 后，以新 PageSpeed 的调用栈验证剩余任务；若四项
均消失，则以“入口边界整体消除原任务”关闭，而不是补写不可证实的旧函数名。

## 已执行验证

- `npm run lint`：通过。
- 受影响 Vitest：登录、主题、改密、AppLayout 等 24 项此前通过；最终登录和主题
  定向 8 项通过。
- Chromium `theme.spec.ts + trusted-types.spec.ts`：13 项通过。
- Firefox/WebKit `trusted-types.spec.ts`：各 2 项，共 4 项通过；覆盖登录、改密、
  工作台主题、Markdown 和 Trusted Types。
- `npm test`：24 个 Vitest 文件、142 项通过；Node 视觉和主题启动契约 19 项通过。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；生产构建入口
  `628.64 KiB raw / 207.94 KiB gzip`。
- `PARTSIGNAL_PERF_SAMPLES=5 node scripts/measure-production-performance.mjs`：通过。
- `node deploy/scripts/check-nginx-security.mjs` 与 `git diff --check`：通过。

## 仅能由新 PageSpeed 关闭的诊断

下列项目不因当前分数、不计分或本地脚本通过而跳过。部署后必须逐项记录新报告的
audit id、值和通过状态：

| 诊断 | 本地处理/防回退证据 | 关闭条件 |
| --- | --- | --- |
| 未使用 JavaScript | 入口 gzip -68.44 KiB；本地 coverage 保留 | ≤100 KiB 且较 `137,660 B` 下降≥25% |
| 未使用 CSS | 移除匿名入口 Segmented/Card/Skeleton 注入；未删状态规则 | ≤12 KiB 且较 `17,320 B` 下降≥25% |
| bootup/main-thread/max potential FID | Long Task、LoAF、TBT 五样本 | PageSpeed 各 audit 通过，页面自有任务≤50ms |
| FCP/LCP/Speed Index/Performance | LCP 元素和阶段保留；本地限速仅作比较 | ≤0.8s / ≤0.8s / ≤1.2s / ≥99 |
| cache lifetimes、document latency | 由线上 Nginx/TTFB 决定 | audit 通过，HTML 不长缓存、哈希资产 immutable、TTFB≤200ms |
| CLS culprits、forced reflow、DOM | CLS=0；DOM `119/17/9`；LoAF 无脚本 | 对应 audit 通过且 DOM 不回退 |
| duplicated JS、legacy JS、minification、total weight | Vite 生产构建和真实路由边界 | 对应 audit 通过且总传输≤275 KiB |
| font display、image delivery、unsized images | 无远程字体；登录首屏无内容图片 | 对应 audit 继续通过 |
| third parties、network dependency tree | 初始资源仅同源四项，`/auth/me` 一次 | 对应 audit 继续通过且无新增第三方 |
| viewport | 现有 viewport meta 与多视口 E2E | audit 继续通过 |
