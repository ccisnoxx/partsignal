# Playwright 验收记录

## 环境边界

- 本机 Docker daemon 不可用，`docker compose` 无法启动 PostgreSQL、API 与完整 E2E 栈，因此未运行依赖真实后端的 `mvp-flow.spec.ts`。
- 视觉验收使用项目 Vite 页面与 `playwright-cli`，只在浏览器层拦截现有 `/auth/me`、`/auth/csrf`、`/dashboard/summary`、`/geo-metrics` 和闲时 `/products` 请求，返回与冻结契约一致的响应形状；没有修改前端请求、后端契约或业务代码。
- 项目现有 `tests/e2e/theme.spec.ts` 独立运行，4 个用例全部通过。

## 页面与响应式

用户指出首轮截图未充分还原参考图后，页面重新按参考图的窄侧栏、浅色氛围画布、紧凑指标横排、横向状态摘要、左主右辅工作区和表格式待办完成视觉校正。1584×995 视口可在一屏内看到全部核心区域。

| 视口 | 页面宽度 | 文档滚动宽度 | 结果 |
|---|---:|---:|---|
| 1584px | 1584 | 1584 | 通过；与参考图近似画布尺寸，一屏展示全部核心区域 |
| 1440px | 1440 | 1440 | 通过 |
| 1024px | 1024 | 1024 | 通过 |
| 768px | 768 | 768 | 通过 |
| 720px（对应 1440px 画布的 200% CSS 可用宽度） | 720 | 720 | 通过 |
| 375px | 375 | 375 | 通过；修复环境色伪元素造成的 12px 横向溢出后复测 |

`playwright-cli` 的无头浏览器不响应浏览器 UI 缩放快捷键，因此 200% 项只验证了等价 CSS 可用宽度重排；仍需在可交互 Chrome 中补一次真实浏览器缩放检查。

## 主题、动效与玻璃降级

- 浅色、深色截图均完成目视检查；跟随系统模式在 `prefers-color-scheme` 深/浅切换时，`html[data-theme]` 分别更新为 `dark` / `light`。
- `prefers-reduced-motion: reduce` 下 `.page-stack` 的计算样式为 `animation-name: none`、`animation-duration: 0s`。
- 将 `--ps-glass-backdrop` 置为 `none` 后，面板仍有 `rgba(255, 255, 255, 0.92)` 高不透明背景、可见边框和正文颜色；现有主题 E2E 同时覆盖代表性玻璃层禁用模糊后的辨识与操作。

## 键盘、路由与失败恢复

- Tab 顺序依次经过主操作、六个待办处理入口和快捷入口；快捷入口焦点轮廓为 `3px solid`。
- 在“进入产品事实”上按 Enter 后进入 `/products`，返回后“运营总览”主标题可见。
- 将总览摘要请求模拟为 HTTP 503 后，页面显示“加载失败”、HTTP 错误码和“重试”；恢复正常响应并点击重试后总览恢复。
- 注入失败场景前，浏览器控制台为 0 errors / 0 warnings；失败场景产生的请求错误属于预期验证。

## 截图

- `dashboard-light-fidelity-1584.png`
- `dashboard-dark-fidelity-1584.png`
- `dashboard-mobile-fidelity-375.png`
