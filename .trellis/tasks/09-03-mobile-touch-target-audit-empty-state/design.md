# 移动端触控目标与审计空态修复设计

## 1. 设计边界

本任务修复两个由既有公网验收直接量化的移动端 presentation 缺陷，但不把它们合并成全站 design-system 重构：

1. `P2-001` 的已证实 owner 是 `LoginPage` 使用默认 32px primitive；以登录页调用方的响应式 class 修复。
2. `P2-003` 的已证实 owner 是系统审计表格在移动端仍继承 `.ps-table { min-width: 52rem; }`；以既有 `audit-list-table` feature class 修复。

共享 `Input`、`Button`、`TableShell`、`EmptyTable` 的公共 API 与全局默认行为保持不变。

## 2. 登录页触控目标

### 2.1 实现

在 `LoginPage` 四个实际交互边界上加入同一响应式高度语义：

```text
mobile: h-11 (44px)
md and above: h-8 (32px)
```

覆盖对象是用户名 `Input`、密码 `Input`、显示/隐藏密码 `Button` 和提交 `Button`。项目 `cn()` 使用 `tailwind-merge`，调用方 `h-11 md:h-8` 会覆盖 primitive 的默认 `h-8`，又不会改变其他消费者。

不新增 wrapper、variant 或认证专属 primitive：只有一个页面的四个控件需要该已证实规则，直接调用方是最小且清晰的 owner。按钮宽度、输入 flex 行、标签、ARIA、表单状态和事件处理全部不变。

### 2.2 断点

项目 `md` 断点从 768px 开始。320px/375px 使用 44px；768px/1440px 恢复 32px，以浏览器几何同时证明移动修复和桌面密度未漂移。

## 3. 系统审计空态

### 3.1 根因

`TableShell` 把 `audit-list-table` 赋给原生 table。移动端隐藏 date、numeric 与 metadata 列后，只剩 primary 与 status 可见，但 table 本身仍被全局 `min-width: 52rem` 撑开。`EmptyTable colSpan={7}` 于是按宽 table 居中，初始滚动位置看不到状态内容。

### 3.2 实现

在现有 `@media (max-width: 767px)` 内增加：

```css
.audit-list-table {
  min-width: 100%;
  table-layout: fixed;
}

.audit-list-table [data-column-role='primary'] {
  min-width: 0;
  width: auto;
}
```

该模式与同文件的 Platform/AI Channel/User feature table 移动规则一致。空态的跨列单元格会按 region 宽度布局；非空移动列表仍显示动作与结果，metadata/date 继续由共享断点规则隐藏。桌面不匹配该 media query，仍保留 52rem 宽表格与完整七列。

不修改 `EmptyTable` 对齐方式，不移除 `.ps-table-region` 的 `overflow-x: auto`，不更改其他业务表格。

## 4. 回归设计

### 4.1 登录几何

扩展 auth production-artifact E2E，在匿名 `/login` 上读取四个控件的 `boundingBox()`：

- `foundation-mobile` 内循环 320px、375px，断言每个高度至少 44px。
- `foundation-desktop` 内循环 768px、1440px，断言每个高度保持 32px。
- 继续由既有 fixture 证明无公网认证、无外部写入、CSP 与运行时错误合同。

现有 `LoginPage` Vitest 继续证明校验、exact payload、密码切换、pending 和错误行为；本任务不把 jsdom 当作几何证据。

### 4.2 审计空态几何

扩展 system audit production-artifact E2E，使用现有合法筛选组合制造空列表，不改 fixture 数据模型：`module=CONFIGURATION` 与 `outcome=FAILED` 在现有确定性样本中无交集。

在 320px、375px 下：

- 等待“未找到审计日志”空态稳定可见；
- 比较空态 `role=status` 的矩形与 `role=region[name=系统审计日志]` 的矩形，断言状态内容的左右边界位于 region 初始可见矩形内；
- 断言 table 宽度不超过 region client width，并复用页面根无横向溢出断言；
- 验证“重置筛选”动作仍可见且可聚焦。

现有 System Audit Vitest/E2E 继续覆盖七列、查询参数、详情 lazy load、键盘、失败重试、越界与 ENGINEER 403。

## 5. 文件与所有权

预计只修改：

- `frontend/src/domains/auth/login-page.tsx`
- `frontend/src/styles/global.css`
- `frontend/tests/e2e/auth-session.spec.ts`
- `frontend/tests/e2e/system-audit.spec.ts`

只有在现有组件测试因行为回归需要补强时，才触及对应 `login-page.test.tsx` 或 `system-audit-page.test.tsx`；不得为了测试 class 实现细节而新增脆弱断言。

## 6. 不变量

- 不改变 API 请求、payload、query 参数、权限、事务、状态转换或服务端最终权威。
- 不改变公共合同、generated client、backend 或数据库。
- 不登录公网、不修改旧管理员密码；本地 fixture 不保存秘密。
- 不修改或归档第二个 Prompt Task、现有 baseline Task 或任何 `integrity-error-domain-mapping` Task。
- 保留现有任务外 dirty/index 状态，提交时仅暂存本任务文件。

## 7. 失败与升级条件

- 若 production build 证明调用方 class 不能稳定覆盖 primitive，先报告证据并重新评估认证页局部样式 owner；不直接修改全局 primitive。
- 若 feature-table 收窄导致移动非空行不可读或动作不可达，先调整审计列宽/隐藏策略；不得通过全局左对齐空态或取消 TableShell scroll 隐藏问题。
- 若 required gate 暴露合同、generated、backend 或业务逻辑修改需求，停止本任务并建议独立 Task。
