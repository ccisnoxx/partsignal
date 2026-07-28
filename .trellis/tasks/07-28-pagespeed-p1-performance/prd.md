# P1 性能诊断闭环

## Goal

以首轮基线 `ibm9s8ga5b` 和第一批生产整改后的最新桌面报告 `awwtb4ueds`
为连续证据，在不重写 UI、不改变认证和业务行为的前提下，对未使用
JavaScript/CSS、六个当前长任务、网络依赖链、LCP 渲染延迟、入口 CSS 和 DOM
完成可度量优化和逐项关闭。

## Confirmed Evidence

- 首轮 `ibm9s8ga5b`：入口脚本浪费 137,660 B；Ant CSS-in-JS 浪费
  17,320 B；长任务为 181ms Unattributable 和入口 110/90/75/61ms。
- 最新 `awwtb4ueds`：入口传输 206,737 B，其中浪费 87,786 B；Ant
  CSS-in-JS 仍为 17,360 B，其中浪费 17,320 B。
- 最新六个长任务为 285ms Unattributable，以及入口脚本
  88/68/67/66/63ms；`bootup-time` 为 505ms，其中脚本执行 391ms、解析
  62ms。
- 最新网络链仍为 HTML → 入口 JS → `/api/v1/auth/me`；LCP 元素仍是登录安全
  说明，render delay 约 1.62s。
- 最新 DOM 为 120 节点、最大深度 17、最大子节点数 9。
- `AppLayout` 和业务页已有 `React.lazy`；工作台 CSS 已按路由分离。
- 全局 `AntApp` 只服务受保护工作台中的 `App.useApp()`；主题控件同步包含登录
  `Segmented` 与工作台 Dropdown/Tooltip 分支。

## Requirements

### R1. 证据优先

- 扩展现有生产性能脚本，记录 JS/CSS coverage、资源、longtask、TBT、CLS 和
  可用的 source map/trace 归因。
- 删除、直接导入或动态加载必须有模块和调用路径证据；不得因一次 viewport 未触发
  hover/focus/错误样式就删除 CSS。

### R2. 初始 JS/CSS

- 将仅用于受保护路由的 `AntApp` 和 Ant `ConfigProvider` 下移到现有懒加载
  `AppLayout`；独立改密页按需加载同一主题 Provider。
- 将登录展开主题控件与工作台紧凑控件拆到真实路由边界，避免互相加载依赖。
- 最新 treemap 已证明匿名入口的 Ant Form/Input/Alert/Trigger 是剩余主要冷依赖；
  登录页使用原生可访问表单保留同一认证契约，业务表单继续使用 Ant。
- 继续使用 Vite 和现有 route loaders；不增加 manual chunks、通用分包层或
  bundle analyzer 依赖。
- 首轮后只处理单个未执行贡献至少 5 KiB、且有现有条件/路由边界的模块。

### R3. 长任务

- 最新五个入口脚本长任务必须映射到模块、函数、React commit 或样式注入。
- 最新 285ms 无法归因任务必须用空白页/静态页对照和冷启动调查。
- 不得把无法归因当作浏览器噪声直接关闭。

### R4. 加载链和布局

- `/auth/me` 的会话恢复契约保持；证明它不阻塞首屏且没有重复请求。
- 通过减少 bootstrap 和同步样式工作降低 LCP 延迟，不隐藏或替换 LCP 文本取分。
- 入口 CSS 继续为单个小型外部同源文件，保持缓存和无 FOUC。
- DOM 只有在 trace 证明成本时才改写；不得为数字重做登录视觉。

### R5. 其余诊断

`cache`、CLS culprit、document latency、duplicated JS、font display、forced
reflow、image delivery、legacy JS、third parties、viewport、minification、
total weight、bootup、main-thread 和 unsized image 均须复测并记录。

## Acceptance Criteria

- [ ] AC1：未使用 JS/CSS 诊断在新 PageSpeed 中通过；数值同时满足未使用
  JS≤100 KiB、未使用 CSS≤12 KiB，且均较首轮下降≥25%。
- [ ] AC2：初始总传输≤275 KiB，登录和受保护路由资源边界正确。
- [ ] AC3：页面自有任务最大≤50ms；TBT 中位数≤50ms、单次≤100ms；
  max potential FID≤100ms。
- [ ] AC4：首轮五项和最新六项任务均有 before/after 归因；剩余无法归因任务未经用户决定
  不得关闭。
- [ ] AC5：FCP/LCP≤0.8s、CLS=0、Speed Index≤1.2s、Performance≥99。
- [ ] AC6：入口 CSS≤4 KiB transfer、无 FOUC；DOM 三项不高于当前值。
- [ ] AC7：所有当前通过的性能诊断继续通过，没有用总分掩盖回退。
- [ ] AC8：认证、权限、主题、改密和业务路由行为保持。
