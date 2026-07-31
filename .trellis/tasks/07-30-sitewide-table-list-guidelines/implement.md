# 统一全站表格列表展示：实施计划

## 0. 开工门禁

- [x] 用户评审并批准最新 `prd.md`、`design.md`、`implement.md` 后，再运行 `task.py start`。
- [x] 运行 `trellis-before-dev`，读取本任务三份文档及前端视觉、组件、质量规范。
- [x] 确认主工作区仍在 `main`，保留 `.playwright-cli/` 等无关未提交改动，不创建开发分支。
- [x] 逐个完整读取即将修改的表格页面、局部样式和测试；本计划不代替开工时源码确认。

## 1. 先锁定 GEO 失败回归

- [x] 在现有 GEO Playwright 回归中通过 GET route fixture 返回接近合同上限的 `search_platform`、长 `search_query` 和必要的现有字段。
- [x] 在修改页面前增加并运行会失败的断言：
  - 平台文本被平台 `td` 包含；
  - 问题文本被问题 `td` 包含；
  - 两段文本不相交；
  - 平台文本实际发生省略；
  - 行高不被长值撑高；
  - hover 与 focus Tooltip 显示完整平台名和完整问题。
- [x] 记录失败证据，证明测试能稳定复现用户报告，而不是只检查页面外框。

## 2. 修复 GEO 观测列重叠

- [x] 修改 `frontend/src/features/geo-observations/GeoObservationsPage.tsx`：
  - 用带 `min-width:0` 的局部复合单元格替换“观测平台”列中的 Ant `Space`；
  - 保持平台标记固定，文本槽收缩；
  - Tooltip 与键盘焦点由复合根持有，平台标记、留白和文字共享完整值触发范围；
  - “搜索词 / 问题”继续作为主要弹性列；
  - Tooltip 使用未截断原值，保留打开详情的交互。
- [x] 在 `frontend/src/styles/workspace.css` 增加最小 `.geo-platform-cell` 布局规则；不修改全局 Ant `Space`，不增加掩盖问题的层级或 overflow。
- [ ] 在 160–180px 范围内用真实表头、长值、桌面和窄屏确认平台目标宽度，采用满足可读性的最小值（1440px 专项已通过；窄屏随 24 表 E2E 一并被共享夹具阻断）。
- [x] 运行 GEO 定向 Vitest 和 Playwright，确认失败回归转绿。
- [x] 部署后复现并修复 Tooltip 白底白字：在共享 Ant 主题中成对映射 `colorBgSpotlight` 与 `colorTextLightSolid`，并增加真实计算样式对比度断言。

## 3. 建立 24 表逐表展示结论

- [x] 复核归档 24 表源码标记仍与当前实现一致。
- [x] 在本任务 `research/sitewide-display-audit.md` 建立一行一表的实施清单，至少记录：
  - 表格类型；
  - 主要阅读任务；
  - 主身份列；
  - 辅助、状态、数值、时间和操作列；
  - 当前列宽/行高/截断/控件问题；
  - 决定：保留、收紧、改序、移入详情/既有列设置或业务例外；
  - 目标源码和回归证据。
- [x] 不为“统一”删除完成业务任务所必需的信息；没有证据的问题标记为通过，不制造改动。

## 4. 收敛顶级管理列表

- [x] 分批处理内容任务、产品、发布三表、GEO 观测、GEO 问题库、AI 渠道、审计、平台、发布账号和用户。
- [x] 每表只保留一个主要弹性列；复合身份容器补齐 `width:100%/min-width:0`，图标或头像固定，文本槽可收缩。
- [x] 短枚举、状态、数值、时间和操作列使用有界宽度；数值按适用情况右对齐。
- [x] 机器值使用现有等宽和省略规则；普通文本与交互标题分别复用 `TableCellText` 或现有 Tooltip。
- [x] 逐表调整已有搜索、筛选、排序、结果数量、列设置、批量操作和分页的视觉层级；不新增控件能力，不改变请求参数。
- [x] 每完成一组页面即运行对应 Vitest，并在可进入的数据路径运行长文本压力探针；24 表完整循环的既有夹具阻塞单独记录。
- [x] 修正内容任务删除术语：列表菜单与详情按钮显示“删除任务”，确认按钮显示“确认删除”，只读说明不再暴露“物理删除”；服务端动作和删除合同保持不变。

### 4.1 全站长文本合同补齐

- [x] 在 `research/sitewide-display-audit.md` 为 24 张表逐项列出全部可变长文本列，不能只记录已复现的缺陷。
- [x] 非交互文本全部复用 `TableCellText`；交互标题、链接和复合身份的叶子文本节点统一使用 `.table-cell-ellipsis` 与 hover/focus Tooltip。
- [x] 清除仍游离于 `.table-cell-ellipsis` 压力探针之外的局部省略实现；固定短枚举、状态、数字、时间、布尔值和操作保持现状。
- [x] 扩展跨页压力探针，使普通 `td` 与动态矩阵 `th` 中登记的长文本都验证实际 overflow、所属单元格边界和行高。

### 4.2 发布管理操作与固定列补充修复

- [x] 待发布候选增加“取消待发布”，先读取任务当前 `available_actions` 与 revision，再复用既有取消接口；不新增候选删除 API，不删除批准历史。
- [x] 发布记录把可执行删除显示为“删除记录”，不可删除且无其他次级动作时不显示更多菜单。
- [x] 为发布表固定操作列补齐普通及 hover/focus 不透明背景，并让跨页浏览器回归在 hover 后再次断言最终背景。
- [x] 运行发布页 Vitest、lint、typecheck、`git diff --check`，并用 `playwright-cli` 路由夹具验证候选取消、删除菜单和固定列背景。

## 5. 收敛从属、分析和弹窗表

- [x] 处理 AI 作业、内容版本、事实版本、GEO 文章观测结果、AI Header、AI 模型、渠道日志和平台类型：
  - 删除父页面已经提供的重复上下文；
  - 保持紧凑密度；
  - 保证长值、错误摘要和操作不撑高或越列。
- [x] 处理 GEO 平台表现和内容排行，优先数值比较、对齐和标签可读性。
- [x] 保持 GEO 覆盖矩阵动态列、内部滚动和打印边界，只修复经审计确认的单元格展示问题。
- [x] 处理模型发现弹窗的 model ID 收缩和选择动作可见性。

## 6. 最小共享修改

- [x] 复核 `.table-cell-ellipsis` 是否需要补 `min-width:0`；只有能直接服务多个真实页面且不改变语义时修改。
- [x] `TableCellText` 继续提供 hover/focus 完整值；只有测试证明当前合同不足时才最小扩展，禁止创建第二个 Tooltip 文本组件。
- [x] 共享 CSS 只纳入至少三表共用的不变量；头像、图标、双行身份等复合布局优先复用已存在的正确类或使用局部语义类。
- [x] 不全局设置 `table-layout:fixed`，不全局改 Ant `Space`，不新增表格包装器、列工厂或依赖。

## 7. 修复 24 表测试盲区

- [x] 扩展 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`：
  - 导航真实 24 表；
  - 对可见 `.table-cell-ellipsis` 注入无空格长文本；
  - 断言压力值实际 overflow；
  - 断言元素矩形被所属 `td` 包含；
  - 保留页面无横向溢出、表格区域、固定列背景和移动端断言。
- [x] 在 GEO 专项 E2E 保留真实 route fixture 的相邻列、行高和 Tooltip 精确断言。
- [x] 为 `TableCellText` 或已有使用方增加最小 Vitest，验证鼠标和键盘都能看到原始完整值。
- [x] 截图只保留为失败诊断或明确视觉基线，不把无比较截图记作通过证据。
- [ ] 继续运行五类代表表的真实 200% tab zoom，不使用 CSS zoom 或页面缩放模拟替代。

## 8. 文档同步

- [x] 更新 `.trellis/spec/frontend/component-guidelines.md`：
  - 复合单元格必须有父容器和文本槽两级 `min-width:0`；
  - 长文本完整值必须支持 hover/focus；
  - 24 表压力测试必须验证实际 overflow 与单元格几何。
- [x] 若逐表审计形成新的稳定视觉不变量，同步 `.trellis/spec/frontend/visual-system.md`；本次规则属于组件收缩和测试合同，未重复写入视觉系统。
- [x] 更新本任务研究清单和验收证据。
- [x] 不修改 OpenAPI、`contracts/database.md` 或后端文档，因为本任务不改变数据合同。

## 9. 必需验证

先运行最小定向检查：

```bash
npm --prefix frontend exec -- vitest run \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx

PLAYWRIGHT_HTML_OPEN=never npm --prefix frontend exec -- playwright test \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  --project=e2e
```

每批表格完成后运行对应现有页面测试。全部展示修改完成后运行：

```bash
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build

PLAYWRIGHT_HTML_OPEN=never npm --prefix frontend exec -- playwright test \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/list-workbench-convergence.spec.ts \
  --project=e2e

git diff --check
```

浏览器验收使用项目 `playwright-cli`：

1. 打开 GEO 观测页并确认长平台回归 fixture 对应的真实 DOM 几何。
2. 在 1440×1000 与 375×900 检查目标表的页面边界、表格内部滚动和工具栏层级。
3. hover 与键盘 focus 长平台名和长标题，确认 Tooltip 为未截断原值。
4. 运行 `playwright-cli console` 与 `playwright-cli requests`，确认无本任务引入的错误或失败请求。

若本地服务未启动，不能用“服务启动成功”替代真实浏览器调用；必须报告未执行的浏览器验证和剩余风险。

## 10. 可选全量验证

本任务不改后端合同，默认不运行后端测试和合同生成。共享 CSS 或跨页组件改动较大时，可在必需验证通过后运行完整本地 E2E：

```bash
make e2e
```

只有证据表明失败由本任务造成时才纳入修复；不处理无关既有失败。

## 11. 完成检查

- [x] 对照 `prd.md` AC1–AC10 逐项记录文件、测试和浏览器证据。
- [x] 检查最终 diff：没有新表格框架、重复 Tooltip、全局 Ant 覆盖、隐藏关键信息、服务端合同变化或无关重构。
- [x] 确认 GEO 长平台用例能在撤掉修复后失败，防止测试只验证自身。
- [x] 说明 24 表中哪些改动、哪些保持不变及原因。
- [x] 说明评论、JSDoc、测试说明和开发者可见文本的中文文档检查结果。
- [ ] 提交前向用户展示提交计划并等待确认；不自动提交、推送、部署或归档任务。

## 12. 验收证据

- 逐表结论：`research/sitewide-display-audit.md` 已覆盖 24 张表并登记 58 个可变长文本位置；普通文本继续复用 `TableCellText`，交互标题、链接和复合身份的文本叶子统一纳入 `.table-cell-ellipsis` 压力探针。
- GEO 失败证据：修复前专项 Playwright 在真实 DOM 上报“缺少平台或问题量测节点”，证明旧结构无法满足几何合同。
- GEO 通过证据：接近 160 字符的平台名与长问题用例 1/1 通过，覆盖所属 `td`、相邻列不相交、实际省略、52px 行高；复合根、平台标记、文字三种 hover 与复合根 focus 均显示完整值。
- Tooltip 可读性失败/通过证据：新增断言在旧主题映射下测得前景/背景对比度 1:1 并失败；补齐配套前景 Token 后，同一 GEO Playwright 用例 1/1 通过，浅深主题 Token 单测 7/7 通过。
- 组件回归：受影响 6 个 Vitest 文件、78 个用例通过；完整前端 Vitest 25 个文件、173 个用例及 23 个视觉合同用例通过。
- 静态检查：`npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 真实浏览器补充证据：动态矩阵长平台列在 `1440×1000` 与 `375×900` 均为 `table-layout: fixed`、实际截断且不越过所属 `th`；桌面无页面级横向溢出，窄屏只在 `TableRegion` 内滚动，hover/focus Tooltip 均返回完整平台名，控制台 0 error、0 warning。
- 24 表 E2E 阻塞：共享数据初始化 POST `/api/v1/platform-profiles` 返回 422，既有夹具缺少当前合同必填的 `platform_prompt_id`；`--no-deps` 绕过初始化后，独立数据库又没有内容任务，故未进入逐表压力探针和五类 200% 缩放断言。本任务不修改服务端合同或扩大范围修复该夹具。
- 文档检查：新增测试文件含中文文件级说明；新增测试错误、任务文档与稳定规范均使用中文，未新增业务日志或异常文本。
- 内容任务删除文案：修改前新增断言只在 3 个删除交互用例失败；修正后删除定向用例 3/3、内容任务页完整 Vitest 16/16、lint 与 typecheck 通过，并明确断言确认弹窗不显示“物理删除”。
- 发布管理补充修复：发布页 Vitest 15/15、lint、typecheck、生产构建与 `git diff --check` 通过；`playwright-cli` 真实页面路由夹具确认候选取消后退出列表、不可删记录不显示更多菜单、可删记录显示“删除记录”，固定操作列在普通、hover 与键盘 focus 后均保持不透明且只显示“查看记录”，清理夹具请求后控制台 0 error、0 warning。
