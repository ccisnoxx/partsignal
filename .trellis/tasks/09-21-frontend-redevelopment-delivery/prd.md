# 前端重新开发总体交付

## Goal

以 `docs/frontend-v2/10-frontend-redevelopment-plan.md` 和 `11-frontend-redevelopment-task-list.md` 为本轮执行基线，在本地候选工作区逐项交付、验证完整前端清单，并保留可恢复的集成记录。

## Requirements

- R00 至 I03 按清单前置关系建立可独立审查的子任务；已有实现须有本轮直接验收证据才能复用。I04 的发布与远端部署另行确认范围。
- `frontend/` 为唯一 canonical 源码；遵守根 `AGENTS.md`、`frontend/AGENTS.md`、`contracts/openapi.yaml`、`contracts/database.md` 及相关前端蓝图。
- 候选工作区从 `9100774b0e124d1d834f8c726cf85f2c0e171e5e` 开始，路径为 `/Users/sc/.codex/worktrees/frontend-redevelopment/partsignal`。原工作树在启动时干净，另有 GEO 后端活动任务，本任务不接管其改动或会话指针。
- 每项记录实际代码、测试或浏览器证据、未验证边界和下一编号；fixture、真实栈、production artifact 分别标识。历史 V2 Gate 只作参考，不计入本轮结果。
- 不自动提交、归档、接替源码、发布或执行远端操作。

## Integration Acceptance

- [ ] `11` 的全部本地交付编号均有独立本轮验收与清晰前置关系；发现的合同缺口在权威 owner 解决。
- [ ] `02` 的 canonical route、关键业务闭环、四档响应式、键盘与焦点、错误合同、类型和生产构建按 `08` 的适用标准通过。
- [ ] I03 核对唯一 `frontend/`、构建与部署引用以及恢复点；真实失败与未运行项如实记录。
- [ ] I04 仅在另行确认发布范围后进行，不纳入本地完成判断。

## Sources

- `docs/frontend-v2/10-frontend-redevelopment-plan.md`
- `docs/frontend-v2/11-frontend-redevelopment-task-list.md`
- `docs/frontend-v2/README.md`
- 根及 `frontend/AGENTS.md`
