# Frontend 重新开发方案归档

## Goal

将前端重新开发启动方案写入 docs/frontend-v2 并纳入索引，供后续会话恢复；本任务只交付规划文档。

## Requirements

- 将本次对话确定的前端重新开发方案写为 `docs/frontend-v2/` 下的持久 Markdown 文档，并纳入该目录的 README 索引。
- 明确当前 canonical V2 与历史迁移计划的边界、权威资料、工作区保护、启动盘点、交付顺序、单页开发循环、分层验证和新会话恢复方式。
- 本任务仅交付规划资料；不修改前后端代码、API/数据库合同、部署配置或远端环境，不代表后续实施任务已完成。

## Acceptance Criteria

- [x] 新文档可独立回答后续会话从哪里开始、先交付什么、如何判定页面完成，以及何时扩大验证。
- [x] README 可从目录索引和开发使用方式找到新文档；旧 `07` 的历史定位保持准确。
- [x] 文档与 `01`–`09`、根/前端 AGENTS 和当前 canonical 源码事实一致，不把规划写成已实施。
- [x] 最终 diff 只包含本任务文档，`git diff --check` 与必要的链接检查通过；保留其他任务已有改动。

## Source

- `docs/frontend-v2/README.md`
- `docs/frontend-v2/01-technical-architecture.md` 至 `09-architecture-decisions.md`
- 根 `AGENTS.md`、`frontend/AGENTS.md`、`.trellis/workflow.md`
