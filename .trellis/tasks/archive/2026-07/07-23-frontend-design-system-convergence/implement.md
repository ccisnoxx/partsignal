# 实施计划

## 0. 启动门禁

- [x] 用户评审并明确批准本任务最新 `prd.md`、`design.md`、`implement.md` 后，才运行：

  ```bash
  python3 ./.trellis/scripts/task.py start 07-23-frontend-design-system-convergence
  ```

- [x] 启动后读取 `trellis-before-dev`，并完整读取本任务三份规划文档、`.trellis/spec/frontend/index.md`、用户原型总结、`theme.ts`、`global.css` 和四个现有共享组件。
- [x] 只修改 `.trellis/spec/frontend/visual-system.md` 与 `.trellis/spec/frontend/index.md`；保留工作区所有其他已有变更。
- [x] 不创建分支，不执行提交或推送；提交仍需另行给出计划并获得用户确认。

## 1. 编写唯一视觉规范

- [x] 新建 `.trellis/spec/frontend/visual-system.md`，使用中文可执行规则。
- [x] 写明规范、运行时主题、全局 CSS、共享组件和业务页面的所有权顺序。
- [x] 写明 PartSignal 的核心视觉方向及玻璃效果的允许边界。
- [x] 覆盖颜色角色、字体、布局、间距、圆角、阴影和表面尺度。
- [x] 定义数据列表、编辑审核、分析洞察三类页面，以及总览、认证、设置的适用例外。
- [x] 定义卡片、表格、表单、编辑器、按钮、状态、图标、图表和动效规则。
- [x] 定义浅色/深色、响应式、键盘、焦点、对比度、200% 缩放和 reduced-motion 验收。
- [x] 写明必须复用 Ant Design、`@ant-design/icons`、系统字体和现有共享组件。
- [x] 写明业务页面不得自行生成新配色、字体、Token、主题、卡片体系或推测性抽象。
- [x] 列出营销官网、聊天机器人、赛博朋克、廉价 AI 渐变、全玻璃、巨大 KPI、过度圆角、3D 图表和虚构数据等禁止模式。

## 2. 更新规范索引

- [x] 在 `.trellis/spec/frontend/index.md` 增加 `visual-system.md` 链接、说明和有效状态。
- [x] 保留其他前端指南“待完善”状态；按项目语言规则仅翻译本次触及的索引内容，不补写或重构其他指南。
- [x] 索引明确视觉任务在实现前必须读取该规范。

## 3. 验证

- [x] 检查目标章节和硬约束均可检索：

  ```bash
  rg -n "唯一|theme.ts|global.css|数据列表|编辑审核|分析洞察|浅色|深色|可访问性|不得自行生成" \
    .trellis/spec/frontend/visual-system.md .trellis/spec/frontend/index.md
  ```

- [x] 检查没有创建第二份设计系统：

  ```bash
  test ! -e design-system/MASTER.md
  ```

- [x] 检查 Markdown 基础格式和空白错误：

  ```bash
  git diff --check -- \
    .trellis/spec/frontend/visual-system.md \
    .trellis/spec/frontend/index.md
  ```

- [x] 只读检查精确差异：

  ```bash
  git diff -- \
    .trellis/spec/frontend/visual-system.md \
    .trellis/spec/frontend/index.md
  ```

- [x] 对照 PRD AC1–AC8，检查没有模糊措辞、重复权威、未经证实的兼容规则、页面代码修改或新增依赖。
- [x] 本任务只改文档，不运行前端单测、构建或 E2E；原因是没有运行时代码、配置或用户界面变化。

## 4. 完成边界

- [x] 使用 `trellis-check` 复核规范完整性、范围和索引可发现性。
- [x] 向用户报告新增规范、索引更新、验证结果和“前端实现未改动”。
- [x] 如需提交，先列出精确文件和建议提交信息，获得用户确认后再提交到 `main`；不自动推送。

## 5. 实施与验证记录（2026-07-23）

- 新增 `.trellis/spec/frontend/visual-system.md`，固化视觉权威、三类页面结构、组件、主题、响应式、可访问性和禁止模式。
- 更新 `.trellis/spec/frontend/index.md`，增加有效入口、开发前检查，并按项目规则将触及的索引内容统一为中文。
- `trellis-check` 修正了总览近期动态的数据契约边界、移动端 `44 × 44 CSS px` 操作目标，以及状态和圆角 Token 的明确映射。
- 定向 `rg`、`test ! -e design-system/MASTER.md`、`git diff --check` 和新文件 `git diff --no-index --check` 均通过。
- 未运行前端测试、构建或 E2E：本任务没有修改运行时代码、配置、依赖或用户界面。
- 共享工作区仍存在其他任务的未提交改动；本任务未修改或回退这些内容。
