# Frontend 重新开发完整任务清单

## Goal

补全新一轮前端开发的端到端任务清单、Trellis 使用方式和新会话入口；仅修改规划文档。

## Requirements

- 将 `docs/frontend-v2/02-information-architecture-and-routing.md` 的全部 canonical 页面与必要的 Foundation、领域闭环、legacy route、集成及发布边界整理为完整编号 backlog。
- 每项写明独立交付、前置任务和可观察验收，说明未来会话如何据此建立 Trellis 任务并直接实施。
- 修正 `10-frontend-redevelopment-plan.md` 的入口描述，避免把 R00 的轻量清单与 `/products` 页面卡误写为整轮开发的任务清单；将新文档加入 README 索引。
- 本任务仅修改规划文档，不修改前后端代码、公共合同、部署或远端状态；保留其他会话的未提交改动。

## Acceptance Criteria

- [x] 全部 canonical 路由都由任务清单明确覆盖，跨域与 Foundation 工作有独立编号及前置关系。
- [x] 新会话入口明确要求按完整清单规划并实施，不停在启动盘点或创建空任务。
- [x] 当前 V2 与历史迁移的状态语义准确，未将历史已完成结果冒充本轮候选的验收。
- [x] README 与文档相对链接可用，diff 只包含本任务规划资料，Markdown/任务校验通过。

## Source

- `docs/frontend-v2/01-technical-architecture.md` 至 `10-frontend-redevelopment-plan.md`
- 根 `AGENTS.md`、`frontend/AGENTS.md`、`.trellis/workflow.md`
