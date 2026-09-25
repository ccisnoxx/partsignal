# F02 Token 与核心 primitives

## Goal

完成清单 F02：在本轮候选上核对语义 Token 与实际使用的核心 Base UI primitives，并修复可观察的桌面、窄屏或可访问性缺口。

## Requirements

- 前置：F01 本轮通过。权威：`docs/frontend-v2/04-design-system-and-interaction-spec.md`、`.trellis/spec/frontend/visual-system.md`、`frontend/src/styles/global.css` 与 `frontend/components.json`。
- 保持 light-only 的现行合同；表面、文字、边界、状态、交互、字体、间距、圆角与焦点均由唯一共享 owner 定义，不引入第二套视觉系统。
- 当前实际消费者所需的 Button、IconButton、Input、Dialog、Sheet、Menu、Select、Tabs、Tooltip 等 primitives 使用已安装的 Base UI/shadcn 结构，保留语义、键盘、焦点和窄屏可达性。
- 复用合格实现；仅针对本轮证实的缺口修改。浏览器 fixture 与真实栈证据分开记录。

## Acceptance Criteria

- [x] Token/primitive 静态边界和当前消费者可追溯，未发现需本项修复的合同缺口或已完成最小修复。
- [x] 核心 primitive 直接测试与 production artifact Foundation 375/1440 场景通过；记录焦点、导航及未覆盖宽度。
- [x] 记录实际改动、diff、检查结果和下一步 F03/F05/F06。

## Scope

F02 只验收共享 Token 与核心 primitives；具体产品列表样板归 P01，完整认证归 F03，Shell URL 与 404 归 F04，Table/Workspace/Form 组合归 F05/F06。

## 本轮实际交付与证据

- 现有实现保留：`frontend/src/styles/global.css` 集中定义 light-only 的 surface/text/border/status/interaction/font/radius/focus 角色与 Tailwind 映射；`frontend/components.json` 指向唯一 `design-system/primitives`。Button、IconButton、Input、Dialog、Sheet、DropdownMenu、Select、Tabs、Tooltip 等实际消费者已有 Base UI/shadcn 结构。未引入第二套主题、组件库或运行时假数据。
- 测试修复：`frontend/src/design-system/primitives/core-primitives.test.tsx` 的菜单用例原以 `.toHaveFocus()` 断言首项，但已安装 Base UI 使用 `data-highlighted` 表示键盘当前项，DOM 焦点可停在 trigger。改为断言高亮并以 Enter 激活该项；未修改生产 primitive 行为。
- 首次核心 primitive 测试 10/11，失败为上述断言；修复后 11/11 通过。production artifact `foundation-smoke.spec.ts` 移动与桌面 2/2 通过；`products-list.spec.ts` 两项目共 10/10 通过，含 375/768/1024/1440 无页面根横向溢出和键盘菜单高亮/关闭。Playwright 每次由配置先构建产物并用 preview 服务，属于 fixture 浏览器证据，非真实服务端 E2E。
- F02 修改后 `npm run lint`、`git diff --check` 与 Trellis `task.py validate` 通过；Playwright 内建 production build 通过。未单独测 320px、200% 浏览器缩放或对比度测量；P01 样板与后续具体页面验收继续覆盖视觉风险。
- 下一步 F03 认证与会话；F05 Table Kit 和 F06 Workspace/Form 可在 F02 后按无写入冲突的范围并行推进。
