# P1 本地实施与复测证据

## 最新生产报告驱动的第二轮候选

第一批整改后的权威桌面报告为 `awwtb4ueds`，其匿名入口仍有 87,786 B 未使用
JavaScript、17,320 B 未使用 CSS，以及 285/88/68/67/66/63ms 六个长任务。
source map treemap 将主要浪费定位到 React DOM、React Router、rc-field-form、
rc-trigger、Input、Alert 和 Tooltip；因此第二轮跨过先前“保留 Ant 登录表单”
的停止线，但只修改匿名登录与 Ant 主题加载边界，不重写工作台 UI。

| 指标 | 第一批生产对应本地构建 | 第二轮本地候选 | 变化 |
| --- | ---: | ---: | ---: |
| 入口 JS raw | 628,685 B | 319,840 B | -308,845 B（-49.1%） |
| 入口 JS gzip | 207,007 B | 102,800 B | -104,207 B（-50.3%） |
| 本地匿名初始 transfer | 212,565 B | 107,614 B | -104,951 B（-49.4%） |
| 本地估算未用 JS transfer | 约 114,017 B | 约 64,150 B | -49,867 B（估算口径） |
| 本地观察未用 CSS 源码 | 约 17,517 B | 4,636 B | -12,881 B（状态源码口径） |

第二轮结构完成后的 6× CPU 定向样本中，入口模块执行约 49.8ms，React scheduler
约 29.2ms + 6.7ms，TBT 为 16ms；最大 66ms 事件没有脚本归因，位于渲染/样式帧。
默认 CPU 单样本为 0 个 Long Task、TBT 0。该证据只证明本地候选方向与边界，
不代替部署后的新 PageSpeed，也不把 scriptless 事件伪归因到应用函数。

已通过的最终候选验证为：受影响 Vitest 4 文件 28 项、生产预览定向 E2E 3 项、
`npm run lint`、TypeScript 生产构建和生产资产检查。用户要求此后不再重复运行测试、
全量性能脚本或 PageSpeed；生产部署获批后只运行一次桌面 PageSpeed。

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
| 入口 JS raw | 852.00 KiB | 628.69 KiB | -223.31 KiB（-26.2%） |
| 入口 JS gzip | 276.38 KiB | 207.99 KiB | -68.39 KiB（-24.7%） |
| 初始总 transfer | 276,676 B | 212,565 B | -64,111 B（-23.2%） |
| 入口 CSS transfer | 2,991 B | 3,078 B | +87 B，仍低于 4 KiB |
| 本地估算未用 JS transfer | 138,611 B | 114,187 B | -24,424 B（-17.6%） |
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

本段记录的是第一轮停止点；最新生产 treemap 提供了更强证据后，第二轮已用原生
可访问登录表单和受保护 Ant ThemeProvider 处理该边界。是否最终关闭未使用
JS/CSS 诊断，只由部署后的同口径 PageSpeed 报告决定。

## 长任务、LCP 和加载链

最终五样本：

- 五个正式样本没有 `>50ms` Long Task；TBT 中位数和最大值均为 `0ms`。
- 入口 JS 的 PageSpeed 原始 `110/90/75/61ms` 执行任务在本地不再出现。
- 残余 Long Animation Frame 最大 `153.3ms`，`blockingDuration=0` 且
  `scripts=[]`，耗时位于渲染/样式阶段，不能伪归因到某个应用函数或冒充
  PageSpeed Long Task 已关闭。
- 五次 `about:blank` 和五次静态 data URL 对照均为零 Long Task；原始
  `181ms Unattributable` 未复现，但仍等待新 PageSpeed 和用户决定后关闭。
- `/auth/me` 每次恰好一个，请求在认证启动画面完成两帧后释放；LCP 元素继续是
  登录安全说明，不隐藏、不替换。
- 本地限速下五样本 FCP 最大 `1.368s`、LCP 最大 `1.492s`；该网络口径不同于权威报告，
  线上 `≤0.8s` 仅由 PageSpeed 复测验收。
- 初始资源只有主题脚本、入口 CSS、入口 JS 和一次 `/auth/me`；没有
  `AppLayout`、改密页或工作台 CSS。
- DOM 从 PageSpeed 的 `128/18/9` 降至 `119/17/9`，CLS 为 `0`。

### 首轮五个原始任务的归因状态

| 原始任务 | 报告可用证据 | 已证明的修改与 after | 当前状态 |
| --- | --- | --- | --- |
| 110ms | 只标记入口 JS URL；报告无 source map、函数名或调用栈 | 匿名入口移除全局 `AntApp`，工作台 Ant 上下文进入既有懒路由；当前五样本不存在同等时长入口执行任务 | 等部署后带 source map 的新 PageSpeed trace；不得猜为某个函数 |
| 90ms | 同上 | 登录主题控件从 Ant `Segmented` 改为原生 radio，工作台控件留在受保护 chunk；当前不存在同等任务 | 同上 |
| 75ms | 同上 | 第一轮移除纯展示 Ant 组件；第二轮按最新 treemap 将剩余登录 Form/Input/Button 替换为原生可访问表单 | 首次 source-map-enabled PageSpeed 中原时长已消失，按用户确认的入口边界规则关闭 |
| 61ms | 同上 | 第二轮匿名初始 transfer 降至 107,614 B；6× CPU 入口模块约 49.8ms | 同上 |
| 181ms Unattributable | 没有 URL、调用栈或 source map | 五次空白、五次静态对照和五次应用冷启动均未复现，第一批部署后的新报告亦不存在该时长 | 历史项关闭；最新 285ms 作为独立新任务继续追踪 |

前三项修改与四个入口任务的具体一一对应关系无法从旧报告恢复；表中顺序只记录
已证实的入口边界变更，不宣称每个修改唯一对应某个历史时长。安全替代方案是发布
经授权的 production source map 后，以新 PageSpeed 的调用栈验证剩余任务；若四项
均消失，则以“入口边界整体消除原任务”关闭，而不是补写不可证实的旧函数名。

### 最新六个任务的归因状态

| 最新任务 | 当前证据与最小处理 | 关闭条件 |
| --- | --- | --- |
| 285ms Unattributable | 报告无 URL/调用栈；本地 6× CPU 最大 66ms 事件为 `scripts=[]` 的渲染/样式帧，不能视作同一任务或伪归因 | 第二轮部署后的 PageSpeed 中消失；若仍存在，只对新 trace 做定向归因 |
| 88/68/67/66/63ms 入口脚本 | source map treemap 指向匿名入口的 React DOM、Router、rc-field-form、rc-trigger、Input、Alert、Tooltip；原生登录与受保护 Ant ThemeProvider 将入口 gzip 从 207,007 B 降至 102,800 B，本地 6× CPU 入口模块约 49.8ms | 第二轮 PageSpeed 五项全部消失则按入口边界整体关闭；任何剩余项继续按新 trace 逐项归因 |

## 已执行验证

- `npm run lint`：通过。
- 受影响 Vitest：登录、主题、改密、AppLayout 等 24 项此前通过；最终登录和主题
  定向 8 项通过。
- Chromium `theme.spec.ts + trusted-types.spec.ts`：13 项通过。
- Firefox/WebKit `trusted-types.spec.ts`：各 2 项，共 4 项通过；覆盖登录、改密、
  工作台主题、Markdown 和 Trusted Types。
- `npm test`：24 个 Vitest 文件、142 项通过；Node 视觉和主题启动契约 19 项通过。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；当前生产构建入口
  `628.69 KiB raw / 207.99 KiB gzip`。
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
