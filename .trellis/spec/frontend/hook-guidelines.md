# Hook Guidelines

> How hooks are used in this project.

---

## Overview

<!--
Document your project's hook conventions here.

Questions to answer:
- What custom hooks do you have?
- How do you handle data fetching?
- What are the naming conventions?
- How do you share stateful logic?
-->

(To be filled by the team)

---

## Custom Hook Patterns

<!-- How to create and structure custom hooks -->

只在多个页面共享同一浏览器机制且没有业务判断时提取 Hook。`useActiveSection(sectionIds: readonly string[])` 使用原生 `IntersectionObserver` 返回当前章节 ID；页面仍拥有章节列表、条件渲染和导航文案。

Hook 必须在所有渲染分支之前调用。观察器不可用时保持首章节，不引入轮询、定时器、内部滚动容器或第二份 DOM 状态。

---

## Data Fetching

<!-- How data fetching is handled (React Query, SWR, etc.) -->

数据获取使用 TanStack Query 和 `shared/api` 中的生成类型、query key 与 query options。自定义 Hook 不得包装单个 query 以隐藏 query key、retry 或错误所有权。

---

## Naming Conventions

<!-- Hook naming rules (use*, etc.) -->

共享 Hook 使用 `useXxx` 命名，文件位于 `src/shared/hooks/`，并提供同目录单元测试。业务专用逻辑默认留在 feature 页面。

---

## Common Mistakes

<!-- Hook-related mistakes your team has made -->

- 不要为了复用一行 `useSearchParams` 抽取全局 URL Hook；不同页面的合法参数和默认值由页面负责。
- 不要在 effect 中同步复制可直接派生的查询参数状态。
- 不要让 Hook 猜测业务恢复路径、权限或缺失字段默认值。
