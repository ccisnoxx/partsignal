# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

服务端状态由 TanStack Query 持有；可分享、可恢复的集合视图状态由 React Router 查询参数持有；表单编辑、弹窗开关和短暂输入草稿保留在页面内。不得新增全局 Store 来保存这些状态。

---

## State Categories

<!-- Local state, global state, server state, URL state -->

- **服务端状态**：使用既有 query key、stale time 和显式失效规则。
- **URL 视图状态**：搜索、Tab、分页和“显示停用账号”等可恢复视图写入查询参数。当前参数包括产品 `q/page`、任务与观测 `page`、人工发布 `tab/candidates_page/attentions_page/records_page/window_days/record_status/attention_trigger/candidate_platform/candidate_search/candidate/record`、用户 `inactive/page`。人工发布状态筛选必须从摘要响应的真实状态键和 OPEN attention 触发值派生，不能在页面维护第二份运行时枚举。
- **页面本地状态**：Modal、Dropdown 目标、Ant Form 实例、dirty/error section 和尚未提交的输入。
- **主题状态**：只由 `ThemeProvider` 维护，禁止页面复制主题状态。从显式主题切回 `system` 时立即重新读取当前 `matchMedia` 结果，不沿用离开系统模式前的解析值。

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

只有跨路由且无法由 URL、TanStack Query 或现有 Provider 明确拥有的状态才考虑全局状态。新增全局 Store、事件总线或通知框架需要独立设计批准；普通集合筛选、分页和表单状态不满足该条件。

---

## Server State

<!-- How server data is cached and synchronized -->

- 复合详情先确定身份查询。身份查询失败可以阻断整页；次级查询必须在所属区块处理 loading/error/retry，不得用空数组或默认对象伪造成功。
- 产品事实以 `product + draft` 为身份，`versions` 只影响版本 Tab；内容任务以 `task` 为身份，`options/jobs/versions` 分别属于生成输入、生成作业和内容版本区块。
- 长期保存成功后使用 mutation 返回值更新 Ant Form 的 `expected_revision`，再失效原 query key；不得继续提交旧修订号，也不得新增兼容 fallback。

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- 不要让 Ant Table 内部页码和 URL 页码并存。Table 必须受控于查询参数，前进/后退直接驱动 UI。
- 查询参数只保存视图，不保存权限、业务状态或表单正文；无效正整数和未知 Tab 使用 `replace` 回到既有默认值。
- 不要因一个次级查询失败而隐藏已成功加载的身份、返回入口或兄弟区块。
