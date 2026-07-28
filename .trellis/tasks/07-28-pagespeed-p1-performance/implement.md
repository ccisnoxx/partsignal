# 实施计划：P1 性能诊断闭环

## 1. 基线和测量

- [x] 扩展生产性能脚本，加入 coverage、资源、TBT、longtask 和归因输出。
- [x] 保存同口径五样本 baseline 和五次 longtask 对照。
- [x] 为每个 PageSpeed 性能诊断建立关闭记录。

## 2. 已确认最小分包

- [x] 将 `AntApp` 从全局 ThemeProvider 下移到懒加载 AppLayout。
- [x] 拆分登录展开主题控件与工作台紧凑主题控件。
- [x] 修复展开主题控件 Tab 可达性并增加回归测试。
- [x] 构建后确认匿名入口不请求工作台专属依赖。

## 3. Coverage 驱动优化

- [x] 复测未使用 JS/CSS，按模块和组件状态记录贡献。
- [x] 只处理单个≥5 KiB且存在真实路由/条件边界的冷模块。
- [x] 未删除共享组件状态 CSS；主题、焦点、错误、禁用和业务 overlay 由既有测试保留。
- [x] 最新生产 treemap 证明 Ant Form/Input/Alert/Trigger 是匿名入口主要冷依赖后，
  将登录表单替换为原生可访问控件；认证 API、校验、显隐、错误和跳转行为保持。
- [x] 将 Ant ThemeConfig/locale 移入受保护路由按需加载的 `AntThemeProvider`。

## 4. 长任务和加载链

- [x] 验证 110/90/75/61ms 入口 JS 执行任务在本地修改后不再出现。
- [x] 用户接受历史闭环规则：旧报告没有 source map/调用栈，不伪造四项
  函数级 before；若新的 source-map-enabled PageSpeed 中四项全部消失，按
  “入口边界整体消除”关闭，若仍存在则按新 trace 逐项归因。
- [x] 第一批部署后执行一次 source-map-enabled PageSpeed；旧 110/90/75/61ms 四项
  全部消失，按“入口边界整体消除”关闭。新报告仍有
  285/88/68/67/66/63ms 六项，已保存为下一轮逐项归因基线。
- [x] 以五次空白/静态对照调查首轮 181ms 无法归因任务；第一批部署后的新报告中
  该任务已消失，历史项关闭。
- [ ] 最新 285ms 无法归因任务等待第二轮部署后的唯一一次 PageSpeed；若仍存在，
  只对该新 trace 做定向归因。
- [x] 证明 `/auth/me` 单次且不阻塞认证启动画面。
- [x] 记录 LCP breakdown、入口 CSS 和 DOM before/after。

## 5. 验证

- 已完成的 coverage、longtask、定向测试和浏览器证据不再重复。
- 用户要求停止把时间消耗在重复测试上；本候选不再运行本地性能脚本、全量测试或
  E2E，只有代码发生新的实质变化时才执行一个最相关的定向检查。
- 唯一发布候选只构建一次；部署后先跑一次 source-map-enabled PageSpeed。
  全部阈值通过即关闭，只有仍失败的 audit 才进入定向 trace、修改和复测。

- [x] Chromium/Firefox/WebKit 登录、主题、改密和工作台 smoke 通过。
- [ ] 所有性能阈值和原先通过项通过。
- [x] 执行 Trellis check；本地可测高、中问题清零，外部 PageSpeed 门禁保留。
- [x] 更新任务证据与前端视觉规范；不提交、推送或部署。
