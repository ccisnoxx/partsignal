# 前端开发规范

> canonical `frontend/` 的稳定约束与实现指南；旧 V1 和 `frontend-v2/` 均不是受支持源码入口。

---

## 总览

本目录收录前端稳定规范。只读取与当前变更直接相关的指南；待完善模板不进入默认上下文。

---

## 指南索引

| 指南 | 说明 | 状态 |
|-------|-------------|--------|
| [视觉系统](./visual-system.md) | 视觉角色、页面构图、组件交互、主题、响应式与可访问性约束 | 有效 |
| [目录结构](./directory-structure.md) | 模块组织与文件布局 | 有效 |
| [组件规范](./component-guidelines.md) | 组件模式、属性与组合方式 | 有效 |
| [Hook 规范](./hook-guidelines.md) | 自定义 Hook 与数据获取模式 | 模板，默认不读 |
| [状态管理](./state-management.md) | 本地状态、全局状态、服务端状态与可编辑 Workspace 合同 | 有效 |
| [质量规范](./quality-guidelines.md) | 代码标准与禁止模式 | 有效 |
| [类型安全](./type-safety.md) | 类型模式与校验 | 模板，默认不读 |
| [资源动作投影合同](../backend/available-actions-contract.md) | typed `available_actions` 的跨层响应与消费边界 | 有效 |
| [Content Version Detail 不可变详情合同](../backend/content-version-detail-contract.md) | 单一 detail read model、不可变页面与错误/测试边界 | 有效 |

---

## 开发前检查

- 视觉角色、页面结构、主题或可访问性变化时，读取 [视觉系统](./visual-system.md) 的相关章节。
- 组件结构、表格或交互模式变化时，读取 [组件规范](./component-guidelines.md)。
- 质量门禁、响应式或浏览器验收变化时，读取 [质量规范](./quality-guidelines.md)。

---

## 规范完善要求

完善各指南时必须：

1. 记录项目的**实际约定**，不得写成脱离实现的理想方案；
2. 包含代码库中的真实示例；
3. 列出禁止模式及其原因；
4. 记录团队已经遇到的常见错误。

这些指南用于帮助 AI 助手和新成员理解本项目的真实工作方式。

---

**语言**：项目规范默认使用中文。
