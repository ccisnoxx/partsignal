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
- [x] 已到重写登录 Form/Input 的边界并停止，证据见 `research/local-results.md`。

## 4. 长任务和加载链

- [x] 验证 110/90/75/61ms 入口 JS 执行任务在本地修改后不再出现。
- [ ] 为 110/90/75/61ms 四个历史任务建立逐任务函数级 before/after 映射；旧报告
  没有 source map 或调用栈，只能确认同一入口 URL，需由部署后公开 map 的新
  PageSpeed trace 完成，或由用户明确接受 `research/local-results.md` 的安全替代。
- [x] 以五次空白/静态对照调查 181ms 无法归因任务；最终关闭等待新 PageSpeed。
- [x] 证明 `/auth/me` 单次且不阻塞认证启动画面。
- [x] 记录 LCP breakdown、入口 CSS 和 DOM before/after。

## 5. 验证

```bash
cd frontend
npm exec -- vitest run
npm run typecheck
npm run lint
npm run build
PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e
cd ..
git diff --check
```

- [x] Chromium/Firefox/WebKit 登录、主题、改密和工作台 smoke 通过。
- [ ] 所有性能阈值和原先通过项通过。
- [x] 执行 Trellis check；本地可测高、中问题清零，外部 PageSpeed 门禁保留。
- [x] 更新证据和 README；不提交、推送或部署。
