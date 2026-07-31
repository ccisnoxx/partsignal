# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

- 交互密度变更必须保留字段、入口、权限判断、服务端 available actions、确认文案、query key 与 API 载荷。
- 长表单校验复用 Ant Form `errorFields`、`scrollToFirstError` 和显式修订号；保存状态至少区分未修改、未保存、保存中、已保存和失败。
- 留在当前页面的长期保存、删除、启停和显式状态操作使用 `App.useApp().message` 给出短中文成功反馈；简单创建后结果立即可见或立即导航时不重复通知。
- Markdown HTML 只能由 `renderSanitizedMarkdown` 写入 React sink；该边界用 DOMPurify 返回 `TrustedHTML`，页面不得创建 Trusted Types policy 或直接组合 `marked`、DOMPurify 与 `dangerouslySetInnerHTML`。

---

## Testing Requirements

<!-- What level of testing is expected -->

- 单元测试覆盖更多菜单确认链、章节 `aria-current`、dirty/error/save 状态、次级查询局部失败、URL 恢复与历史同步、pathname 焦点和工作台语义 tone；jsdom 不断言 sticky 坐标或具体颜色。
- E2E 复用现有数据流程，断言代表性产品搜索 URL、事实章节和对象标题、内容任务/审核章节、AI 更多菜单键盘焦点及人工发布 Tab URL。
- 长文本表格回归必须用实际触发 `scrollWidth > clientWidth` 的压力值，扫描 `td` 和动态矩阵 `th` 内登记的 `.table-cell-ellipsis`，并断言内容矩形位于所属单元格内、行高有界、交互文本可由键盘到达；代表用例还必须验证鼠标悬停和键盘聚焦都能读取完整值。复合身份的代表用例必须分别从根容器、固定图形和文本叶子触发 Tooltip，并确认焦点停靠在根容器，不能只精确 hover 内部文本。只检查 `overflow:hidden` 计算样式或页面外框不溢出不能证明列边界正确。
- Tooltip 回归不能只断言 `role`、文本内容和 DOM 可见；代表性真实浏览器用例必须读取最终计算后的前景色与背景色，并验证普通文字对比度至少为 4.5:1，防止浮层存在但白底白字或同色不可读。
- 真实浏览器在浅色、深色、跟随系统三种模式下检查 375/768/1024/1440px、实际 200% 缩放和键盘链；宽表只能在 `TableRegion` 内溢出。
- `emulateMedia`、主题或响应式状态切换可能重挂载布局。切换后的几何断言必须重新查询当前已连接节点，并先轮询关键尺寸稳定；不得把旧节点的零尺寸误判为生产 CSS 缺陷。

```ts
// 错误：媒体切换前解析元素，重挂载后可能继续量测失效节点。
const content = await page.locator('.app-content').elementHandle();
await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
expect(await content?.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

// 正确：切换后从当前 document 重新查询，并同时保留非零和无文档溢出断言。
await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
await expect.poll(() => page.evaluate(() => (
  document.querySelector<HTMLElement>('.app-content')?.getBoundingClientRect().width ?? 0
))).toBeGreaterThan(0);
expect(await page.evaluate(() => document.documentElement.scrollWidth))
  .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
```

### jsdom 能力边界

- `src/test/setup.ts` 只为 jsdom 明确未实现、且组件库真实调用的浏览器能力提供替身，不得通过过滤 `console` 或虚拟控制台错误隐藏未知问题。
- jsdom 对 `@rc-component/util` 使用的 `::-webkit-scrollbar` 查询会告警后返回宿主元素样式；测试替身只对该已证实调用执行同一回退，其他未知伪元素仍应暴露。伪元素尺寸、布局和视觉正确性仍由 Playwright 验证，不能依赖该替身断言。

```ts
getComputedStyle(element, pseudoElement === '::-webkit-scrollbar' ? undefined : pseudoElement);
```

修改测试环境替身后，至少运行一个会渲染 Ant Design 表格或弹窗的测试文件，并确认进程输出中没有对应的 `Not implemented` 提示。

---

## Code Review Checklist

<!-- What reviewers should check -->

- 是否出现第二个高频入口、直出危险按钮或无确认的危险菜单项？
- 是否出现 URL 与组件内部两份页码/Tab/筛选状态？
- 次级查询失败是否遮蔽了身份、返回入口或兄弟区块？
- 是否新增运行时依赖、第二套设计系统、状态 Store、通知框架、硬编码主题颜色或业务契约变化？
- 是否完成浅/深/system、响应式、200% 缩放、键盘和焦点恢复验收？
