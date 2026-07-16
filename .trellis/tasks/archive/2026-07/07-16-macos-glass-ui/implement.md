# 实施计划

## 0. 启动门禁

- [x] 用户评审并明确批准 `prd.md`、`design.md`、`implement.md` 后，才运行 `task.py start`。
- [x] 在主工作目录 `/Users/sc/PycharmProjects/partsignal` 确认当前分支为 `main`，且除已评审的 `.trellis/tasks/07-16-macos-glass-ui/` 外没有其他修改；若存在未识别修改，停止并报告，不把它们纳入本任务。
- [x] 确认已评审任务目录已精确同步到主工作目录；后续实现、验证和提交均在主工作目录完成，不把成果留在 detached worktree。
- [x] 加载 `trellis-before-dev` 与 frontend 规范；实现阶段只修改本任务目录、定向同步的 `ui-ux-pro-max` 与本计划列出的 `frontend/` 文件。
- [x] 不创建分支、不自动提交、不推送；完成验证后另行给出提交计划并等待确认。

## 1. 更新并验证 ui-ux-pro-max

目的：确认当前 `ui-ux-pro-max-cli` 与项目 skill 一致。当前 CLI 为 `2.11.0` 且项目数据完整；禁止在主工作目录直接运行会覆盖其他 bundled skill 的 `--force`。若未来 CLI 不再是最新版本，先单独申请全局更新授权。

- [x] 只读核对本机与 registry 版本：

  ```bash
  uipro --version
  npm view ui-ux-pro-max-cli version
  ```

- [x] 在临时目录生成 Codex skill，比较后只同步 `ui-ux-pro-max/`；若无差异，不写项目文件：

  ```bash
  stage_dir=$(mktemp -d)
  (cd "$stage_dir" && uipro init --ai codex --force)
  diff -ru "$stage_dir/.codex/skills/ui-ux-pro-max" .codex/skills/ui-ux-pro-max || true
  rsync -a --delete "$stage_dir/.codex/skills/ui-ux-pro-max/" .codex/skills/ui-ux-pro-max/
  git diff -- .codex/skills/ui-ux-pro-max
  ```

- [x] 完整重读同步后的 `.codex/skills/ui-ux-pro-max/SKILL.md`，再运行检索命令；不得修改或同步其他 `.codex/skills/*`。

- [x] 验证主设计、玻璃风、可访问性与 React 检索均可运行：

  ```bash
  python3 .codex/skills/ui-ux-pro-max/scripts/search.py "B2B admin dashboard macOS integrated workspace frosted glass light dark minimal" --design-system -p "PartSignal"
  python3 .codex/skills/ui-ux-pro-max/scripts/search.py "macOS frosted glass light dark accessibility" --domain style -n 5
  python3 .codex/skills/ui-ux-pro-max/scripts/search.py "glass contrast focus reduced motion" --domain ux -n 8
  python3 .codex/skills/ui-ux-pro-max/scripts/search.py "dashboard responsive table form accessibility" --stack react
  ```

- [x] 不运行 `--persist`，避免生成 `design-system/MASTER.md` 成为第二套视觉来源。
- [x] 若更新后的建议与已批准设计在玻璃边界、对比度或响应式上实质冲突，先更新 `design.md` 并重新请求评审；非实质色值建议由现有可访问性约束裁决。

回滚点：只反向应用 `.codex/skills/ui-ux-pro-max/` 的本任务差异；不恢复旧包作为兼容路径。

## 2. 建立前端基线

在修改前记录以下结果；任何现有失败都先报告，不用主题改造掩盖。

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
```

- [x] 浏览当前登录页、工作台和配置中心，记录浅/深主题、375/768/1024/1440 的现状问题；不保存或提交截图基线。
- [x] 搜索所有旧视觉 token 与选择器调用方：`dataCyan`、`auroraBlue`、`auroraCyan`、`Midnight Signal`、`.app-sider`、`.app-header`、`.form-save-bar`、`.form-section-nav`。

## 3. 重建主题 token

目标文件：`frontend/src/app/theme.ts`、`frontend/index.html`。

- [x] 用 `design.md` 的浅/深调色板替换旧 Midnight Signal 颜色，不保留旧 token 别名或兼容分支。
- [x] 删除 `dataCyan*` 与 Aurora token；品牌用途改用 action token，MetricTile 数据 tone 与 Progress 改用 `chartSeries2`。
- [x] 保留现有 `ThemeMode`、`ResolvedTheme`、存储键、`projectThemes`、`applyProjectTheme()`、`createAntTheme()` 结构。
- [x] 仅增加 `glassSurface`、`glassSurfaceStrong`、`glassBorder`、`glassBackdrop` 四个材质 token，并加入 CSS 变量映射。
- [x] 重新映射 Ant Design 的 Layout、Menu、Button、Card、Table、Modal、Drawer、Dropdown、Input、Select、Tabs、Tag；业务表面保持接近不透明。
- [x] 同步 `frontend/index.html` 的浅/深画布色，不改变首屏主题解析流程。
- [x] 在 `ThemeProvider.test.tsx` 增加一项最小契约测试：浅/深模式切换时玻璃 CSS 变量和画布色同时变化，现有持久化与系统监听测试保持通过。

定向验证：

```bash
npm test -- src/app/ThemeProvider.test.tsx
npm run lint
npm run typecheck
```

回滚点：若 Ant 组件状态出现系统性对比问题，回退本步骤精确 hunks，先调整 token 映射，不在组件文件中加局部颜色。

## 4. 重建一体式工作区与共享视觉

目标文件：`frontend/src/styles/global.css`、`frontend/src/app/AppLayout.tsx`。

- [x] 更新系统字体栈、圆角、动效和共享间距，移除旧 Aurora 背景及卡片上浮效果。
- [x] 将桌面侧栏调整为 248/76px，将工具栏调整为 72px；保留侧栏折叠、路由预取、权限过滤、用户菜单和退出行为。
- [x] 侧栏品牌区固定、菜单区独立纵向滚动；保留登录页双栏/单栏响应式结构，删除装饰渐变和圆环，登录 Card 保持不透明。
- [x] 为侧栏、工具栏、移动 Drawer、Modal/Dropdown、`.form-save-bar`、`.form-section-nav` 应用共享玻璃 token，并同时设置标准与 WebKit `backdrop-filter`。
- [x] 增加不支持 `backdrop-filter` 时的纯 CSS 高不透明表面降级，不添加运行时能力检测。
- [x] Card、Table、Form、MetricTile、Markdown、审核区和配置区保持接近不透明；禁止逐卡模糊。
- [x] 按“框架宽松、业务区中等紧凑”调整页头、页面间距、表格单元格、表单控件、摘要和审核工作区。
- [x] 保留移动 Drawer、表格局部横向滚动、sticky 区域和 200% 缩放操作能力；修复只能放在共享样式，除非浏览器证据证明某个页面需要局部类。
- [x] 保持所有图标来自现有 `@ant-design/icons`，不新增依赖或 Emoji。

定向验证：

```bash
npm test -- src/app/AppLayout.test.tsx src/app/ThemeProvider.test.tsx
npm run lint
npm run typecheck
npm run build
```

回滚点：若布局出现双重滚动或固定区域遮挡，先回退尺寸与定位相关 hunks；不得通过复制桌面/移动两套结构修补。

## 5. 文档与功能测试

- [x] 更新 `frontend/scripts/check-theme-colors.mjs` 的过时说明，颜色守卫逻辑不放宽。
- [x] 更新 `frontend/README.md`：新的双主题名称、玻璃适用范围、主题唯一来源、减少动画和人工验收矩阵。
- [x] 更新 `frontend/tests/e2e/theme.spec.ts`：阻断 React 主模块时验证首屏脚本与 `projectThemes` 一致；继续验证系统主题和减少动画；增加代表性玻璃容器计算样式检查。
- [x] 静态检查 `@supports not` 降级规则，并在浏览器注入禁用 blur 后验证文字、边框和操作仍可辨识；不把 Chromium 表述为真实不支持该属性。
- [x] 不恢复 `test:visual`、`toHaveScreenshot`、PNG 基线或 `@axe-core/playwright`。
- [x] 检查新增或修改的中文注释、JSDoc、日志和异常文本；只更新触及范围中的过时 Midnight Signal 文案，不给明显 CSS 添加机械注释。

## 6. 完整验证

### 6.1 自动检查

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
npm run perf:production
```

从仓库根目录运行完整本地测试栈；该脚本会迁移并写入本地测试数据库，执行前先说明：

```bash
deploy/scripts/e2e-local.sh tests/e2e/theme.spec.ts
```

若 E2E 依赖未就绪，明确记录缺少的本地服务并继续排除环境问题；登录页、工作台和高密度配置页未完成真实验收前，AC6 与任务均不得标记完成。

### 6.2 浏览器验收

对登录页、工作台和至少一个高密度配置页执行以下矩阵：

- [x] 375px：浅色、深色、移动 Drawer、长表单/表格横向边界。
- [x] 768px：浅色、深色、断点切换和工具栏操作。
- [x] 1024px：浅色、深色、侧栏/抽屉边界和内容密度。
- [x] 1440px：浅色、深色、一体式工作区完整层级。
- [x] 200% 缩放：导航、主要操作、弹窗和悬浮保存条仍可见可用。
- [x] 键盘：顺序合理，焦点清晰，图标按钮保留中文可访问名称。
- [x] 减少动画：页面进入、主题切换和组件过渡关闭。
- [x] 玻璃降级：禁用 `backdrop-filter` 后文字、边框和操作仍可辨识。
- [x] 性能：修改前后各运行默认五样本 `perf:production`，不得新增 Long Task；GPU 合成平滑度以 1440px、200% 缩放和真实滚动检查补充。

### 6.3 差异审计

- [x] `git diff -- contracts backend deploy` 无变化。
- [x] `frontend/package.json` 与 `package-lock.json` 无新增运行时依赖。
- [x] `rg` 确认旧 Midnight Signal、旧 Aurora token 和兼容选择器已删除，没有第二套颜色或模糊常量。
- [x] 检查 diff 不包含字段、操作入口、导航层级、路由、权限、API、Query 或业务状态变化。
- [x] 检查普通 Card/Table/Form 未引入 `backdrop-filter`，避免性能与可读性回归。

## 7. 完成门禁

- [x] 对照 PRD 的 AC1–AC9 逐项记录证据。
- [x] 使用 `trellis-check` 完成质量检查。
- [x] 非平凡 Python 代码预计不修改；若 skill 更新带来上游 Python 文件，只作为上游同步内容，不在本任务中重写其注释或逻辑。
- [x] 向用户汇报变更、验证、未覆盖风险和文档更新情况。
- [x] 提交前列出精确文件与提交信息计划，获得用户确认后才提交到主工作目录 `main`；不自动推送。

## 8. 验收证据（2026-07-16）

| AC | 状态 | 证据 |
|---|---|---|
| AC1 | 通过 | 浅/深主题在登录页、工作台、配置页、移动抽屉、弹窗和长表单实测；模糊仅位于设计规定的 L2/L3 共享容器。 |
| AC2 | 通过 | 关键文字与按钮对比度均不低于 4.5:1；系统 Chrome 的 Tab/Shift+Tab 顺序可逆且合理，导航、主题、用户菜单、主操作和内容链接均显示 3px 焦点环。 |
| AC3 | 通过 | 主题单元测试 5 项通过，Playwright 验证首屏浅/深、`system` 实时跟随和减少动画。 |
| AC4 | 通过 | 前端 14 个测试文件、43 项测试全部通过；主题单元测试和功能 E2E 已补充。 |
| AC5 | 通过 | 375/768/1024/1440 浅深矩阵通过；系统 Chrome 原生 200%（DPR 2→4、CSS 视口 1200→600）下工作台、抽屉、弹窗和悬浮保存条无页面横向溢出，抽屉与弹窗保持容器内滚动。 |
| AC6 | 通过 | `api:check`、lint、typecheck、test、build 与本地完整 E2E 栈的主题用例 4/4 通过；真实浏览器覆盖登录页、工作台和高密度配置页。 |
| AC7 | 通过 | `contracts/`、`backend/`、`deploy/`、API、路由、权限、Query、业务状态和依赖清单无差异。 |
| AC8 | 通过 | 框架间距、72px 工具栏与 248/76px 侧栏已实测；表格局部横向滚动、长表单悬浮保存条和配置网格无页面级溢出。 |
| AC9 | 通过 | 桌面侧栏菜单独立滚动且页面无双重横向滚动；移动抽屉、58px 工具栏与内容区使用同一材质体系。 |

自动验证补充：最终生产性能默认五样本的原始冷/热路由中位数为 811.37/44.37ms，生产预取冷/热路由为 65.45/44.08ms，均未记录 Long Task；基线原始冷/热路由为 809.39/43.68ms。构建仍有既存的主 chunk 超过 500kB 警告，本任务未新增依赖或拆包行为。

任务保持 `in_progress`，直至用户确认提交计划并完成提交。
