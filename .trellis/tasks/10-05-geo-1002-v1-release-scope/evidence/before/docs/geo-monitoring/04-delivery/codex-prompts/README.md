# PartSignal GEO Codex 全部任务提示词

本目录包含 GEO-003 至 GEO-906 的 **69 个**独立提示词文件。

## 目录

- `ALL_PROMPTS.md`：全部任务合并版；
- `R0/`～`R8/`：按阶段拆分的单任务提示词；
- `REVIEW_CHECKLIST.md`：每个任务完成后的人工审查清单。

## 使用方式

1. 确认当前任务未处于 `deferred`，依赖均为 `done`；804～807 当前 post-core 延期，恢复须满足 manifest/ADR-006，不执行历史提示词；
2. 为当前任务创建独立分支；
3. 打开对应 `GEO-NNN.md`；
4. 复制“复制给 Codex”代码块；
5. 审查 diff 和测试证据；
6. 人工接受后复制文件底部的收尾提示词，把任务置为 `done`。

这些提示词基于文档包 V1.0 生成。若 GEO-001/GEO-002 已修改任务或 ADR，以本地仓库当前文件为权威。

当前核心按 R6 → R8 交付，MANUAL 为正式回答级采集方式；R8 的 Browser 条目按[ADR-006](../../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)条件验收。单文件与 ALL_PROMPTS 对应段同步维护，原 Browser 目标保留。
