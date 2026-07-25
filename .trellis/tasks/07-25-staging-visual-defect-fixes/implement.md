# 实施计划

## 1. 实现前确认

- [x] 完整读取 PRD、设计、三份研究记录及前端视觉/组件/质量规范。
- [x] 核对 `AIChannelsPage` 列定义、`MetricTile` DOM、移动 CSS 级联、AppLayout/ThemeModeControl/Drawer 尺寸来源和现有 E2E。
- [x] 确认工作区只包含父任务、当前任务和已知用户日志，不改动无关文件。

## 2. 最小实现

- [x] 调整 AI 渠道长文本弹性列、`scroll.x` 和 Ant 6 固定列局部选择器，保留全部字段与操作。
- [x] 在现有 419px 规则中恢复共享带图标指标卡净空，不改变用户/平台两列 Grid 和桌面布局。
- [x] 在现有 991px 壳层断点中把移动顶栏 Ant Button 和默认 Drawer 关闭按钮最小触控框提升到 44×44。

## 3. 回归断言

- [x] 扩展 AI 渠道 E2E，覆盖 1440px 不相交、桌面可见区和窄屏表格内部滚动。
- [x] 扩展列表工作台 E2E，覆盖用户/平台 375px、320px 指标图标与标题/数值不相交。
- [x] 扩展跨页视觉 E2E，覆盖 375px、768px、真实 200% 的 44px 目标与 Escape 焦点恢复。
- [x] 保留既有 Dashboard/GEO 指标净空、页面无横向溢出和主题检查。

## 4. 最小验证

- [x] 运行相关 Vitest。
- [x] 运行 `ai-channel-management.spec.ts`、`list-workbench-convergence.spec.ts`、`dashboard-geo-convergence.spec.ts` 和跨页触控/缩放相关 E2E。
- [x] 运行 `npm --prefix frontend run typecheck`。
- [x] 运行 `npm --prefix frontend run lint`。
- [x] 运行 `npm --prefix frontend run build`。
- [x] 运行 `git diff --check` 并检查无后端、契约、部署、依赖或无关文件变化。

## 5. 人工视觉门禁

- [x] 生成用户 375px、AI 渠道 1440px和共享移动顶栏候选截图。
- [x] 人工确认三项缺陷消失，桌面、深色、跟随系统、320px、375px、768px 和真实 200% 无明显回归。
- [x] 获得用户批准后才更新受影响自动 snapshot；不更新无关基线。

## 6. 交付

- [x] Trellis check 无未解决高/中严重级实现问题。
- [x] 按需要同步稳定规范，只记录已实现事实。
- [x] 提交前展示精确 commit plan 并取得用户确认；不自动推送或部署。

## 7. 已完成验证

- 定向 Vitest：2 条通过。
- 缺陷几何、移动触控和缩放 E2E：5 条通过。
- 浅色、深色、跟随系统及四个工作台快速回归 E2E：3 条通过。
- `typecheck`、`lint`、production build 和 `git diff --check` 通过。
- 独立 Trellis check 未发现高、中严重级问题。
