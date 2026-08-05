# 审计并修复全站表格列宽：实施计划

## 0. 开工门禁

- [x] 用户审批最新 `prd.md`、`design.md`、`implement.md` 后再运行 `task.py start`。
- [x] 运行 `trellis-before-dev`，重读本任务三份文档与前端视觉、组件、质量规范。
- [x] 确认主工作区仍在 `main`；保留用户改动，不创建分支，不提交或推送。
- [x] 完整读取每个即将修改的组件、列定义、局部样式和对应测试。

## 1. 固化当前审计基线

- [x] 复核 `research/table-width-audit.md` 与 `sitewideTableInventory` 当前 25 项一致。
- [x] 为每张表记录固定列宽总和、主列余量、`scroll.x`、选择列、条件/可选列和移动替代结构。
- [x] 对四类代表高风险表执行真实浏览器几何量测；其余空数据页面按列合同、fixture 与已有回归核对。
- [x] 没有真实缺陷且合同成立的表标记“保持”，不得顺手调整。

## 2. 先补失败回归

- [x] 扩展 `expectTableRegionBounded`，检查稳定有界控件被所属单元格包含、未裁切且短文本单行。
- [x] 用人工观测登记表确认旧问题已复现，当前“已发现/已提及”在 1440px 与 375px 均单行。
- [x] 用用户列表、平台列表和 AI 请求 Header 各覆盖一种高风险结构，确保测试不是只识别 Checkbox。
- [x] 探针只扫描 Button、Tag、Checkbox、Select 与 time，保留复合身份、错误摘要、动态矩阵和移动卡片的既有例外。

## 3. 分批修复确认缺陷

### 3.1 GEO 表

- [x] 保留并复核 `GeoObservationForm.tsx` 当前文章/平台/发现/提及列宽修复。
- [x] 验证 GEO 观测记录可选列；未复现控件越界或页面溢出，保持现有可见列逻辑。
- [x] 修复 GEO 问题库 `scroll.x` 与 990px 固定列总和不一致的问题。
- [x] 按 RateBar 的真实 96px 内容需求修复 GEO 平台表现指标列，并分别对齐交互/打印 `scroll.x`。

### 3.2 内容、产品与发布表

- [x] 处理内容任务主身份余量、AI 作业全固定列、内容版本首列余量。
- [x] 处理产品事实表固定列总和大于 `scroll.x`、品牌/类别/操作列分配失衡。
- [x] 收紧事实版本短列和操作列并对齐 `scroll.x`。
- [x] 发布工作、发布成果、内容问题与待开始发布未复现有界字段缺陷，保持现有移动卡片边界。

### 3.3 配置、审计、账号与用户表

- [x] 处理 AI 渠道主列余量、请求 Header、模型列表、渠道日志与模型发现弹窗。
- [x] 处理平台列表、发布账号和用户列表；全局审计日志当前列合同可读且未复现控件缺陷，保持。
- [x] 平台类型表总宽与 `scroll.x` 一致，未复现操作换行，保持。

每组只调整现有列宽、弹性列与 `scroll.x`；不得改变字段、操作、数据或引入共享配置。

## 4. 定向验证

每批运行对应已有 Vitest；形成动态列宽计算时增加一个最小单元测试。至少运行：

```bash
npm --prefix frontend exec -- vitest run \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/users/UserManagementPage.test.tsx
```

实际受影响文件的现有测试必须补入命令；不为纯数值一行调整机械新增 jsdom 宽度断言。

## 5. 必需质量门禁

```bash
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run typecheck

PLAYWRIGHT_HTML_OPEN=never npm --prefix frontend run e2e -- \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep "全站 25 张业务表|200% tab zoom"

git diff --check
```

真实浏览器验收：

1. 使用项目 `playwright-cli` 独立命名会话；不得使用 `default`。
2. 在 1440×1000 和 375×900 检查至少四类代表表：人工观测输入矩阵、用户列表、平台列表、AI 请求 Header。
3. 量测短标签文本矩形数、控件与所属单元格边界、表格局部滚动和页面根宽度。
4. 检查控制台 error/warning；关闭本任务全部会话并确认无残留。

## 6. 可选验证

本任务不改后端或合同，默认不运行后端测试。下列检查只在共享 CSS/组件发生修改、完整发布前验收或证据指向构建问题时运行：

```bash
npm --prefix frontend run build
make e2e
```

可选检查失败只有在证据表明由本任务造成时才进入修复范围。

## 7. 文档与完成检查

- [x] 更新 `research/table-width-audit.md` 的每张表最终结论与浏览器证据。
- [x] 按 `trellis-update-spec` 更新前端规范，限定表格图标按钮尺寸选择器必须使用 `.ant-btn-icon-only`。
- [x] 最终 diff 检查：无第二套表格模型、无运行时测量、无字段/动作变化、无隐藏 fallback、无无关重构。
- [x] 纯列宽与选择器修复不增加机械代码注释；已更新前端开发规范和任务研究记录。
- [ ] 提交前展示提交计划并等待用户确认；不自动推送。
