# 后端开发规范

---

## Overview

只读取与当前变更直接相关的有效规范。未定制模板保留为将来的填写入口，不进入默认上下文。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [数据库开发规范](./database-guidelines.md) | PostgreSQL 迁移、一次性数据清理与初始化契约 | Active |
| [发布管理工作台契约](./publication-workbench-guidelines.md) | 发布聚合、列表投影、两阶段证据与前端数据边界 | Active |
| [Backend 错误处理契约](./error-handling.md) | 唯一约束竞态、AppError、ErrorEnvelope 与 runtime response metadata | Active |
| [质量规范](./quality-guidelines.md) | Starlette TestClient、`httpx2` 测试依赖与客户端回退约束 | Active |
| [AI 配置与生成边界](./ai-configuration-guidelines.md) | 渠道凭据、网络边界、作业快照与真实模型调用 | Active |
| [资源动作投影合同](./available-actions-contract.md) | typed `available_actions`、服务端最终守卫、前端消费与批量投影边界 | Active |
| [Content Version Detail 不可变详情合同](./content-version-detail-contract.md) | compact consistent read、nullable 更新时间、只读前端与跨层测试边界 | Active |

---

## 待定制模板

`directory-structure.md`、`logging-guidelines.md` 当前仍是通用模板。除非任务就是补充这些规范，否则不要读取；填写时只记录已由代码和合同证实的项目约定。

**语言**：项目规范默认使用中文。
