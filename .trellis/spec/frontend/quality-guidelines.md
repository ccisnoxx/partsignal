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

---

## Testing Requirements

<!-- What level of testing is expected -->

- 单元测试覆盖更多菜单确认链、章节 `aria-current`、dirty/error/save 状态、次级查询局部失败、URL 恢复与历史同步、pathname 焦点和工作台语义 tone；jsdom 不断言 sticky 坐标或具体颜色。
- E2E 复用现有数据流程，断言代表性产品搜索 URL、事实章节和对象标题、内容任务/审核章节、AI 更多菜单键盘焦点及人工发布 Tab URL。
- 真实浏览器在浅色、深色、跟随系统三种模式下检查 375/768/1024/1440px、实际 200% 缩放和键盘链；宽表只能在 `TableRegion` 内溢出。

---

## Code Review Checklist

<!-- What reviewers should check -->

- 是否出现第二个高频入口、直出危险按钮或无确认的危险菜单项？
- 是否出现 URL 与组件内部两份页码/Tab/筛选状态？
- 次级查询失败是否遮蔽了身份、返回入口或兄弟区块？
- 是否新增运行时依赖、第二套设计系统、状态 Store、通知框架、硬编码主题颜色或业务契约变化？
- 是否完成浅/深/system、响应式、200% 缩放、键盘和焦点恢复验收？
