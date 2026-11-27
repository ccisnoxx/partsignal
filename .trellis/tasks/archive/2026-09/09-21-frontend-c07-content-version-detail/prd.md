# C07 内容历史版本详情

## Goal

验收 `/content/versions/$versionId` 的独立只读详情及真实栈单一读取。

## Requirements

- 前置 C03、C04 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.6 节、`05-business-actions-state-and-api-contract.md` ContentVersionDetail 段、`08-testing-quality-and-acceptance.md` Phase 3.6、OpenAPI 与前端只读 Detail 规则。
- 页面只消费精确 `GET /content-versions/{id}/detail`，展示不可变 Markdown、来源/状态/当前主线、事实链接、生成 lineage、目标版本审核结果/记录、创建和 nullable 更新时间。ID 不匹配时阻断快照展示；无 lineage/review/更新时间时显式空态。
- 所有状态及 source 均只读，不请求 Editor/Review Context 或 GenerationJob，不生成保存、删除、批准、退回等动作；返回所属任务和事实版本使用 canonical 链接。面向用户的标题与导航保持中文界面一致。

## Acceptance Criteria

- [x] 组件检查覆盖单一详情、sanitized Markdown、lineage/审核/空态、URL mismatch 与错误恢复。
- [x] 当前候选浏览器 fixture 覆盖入口、direct/refresh/Back/Forward、状态矩阵、响应式/键盘；隔离真实栈证明真实 HUMAN 版本精确单次 GET 且无写入口。
- [x] 记录实际代码、验收证据及 C08 下一步。

## Notes

- 范围限于 Content Version Detail 页面及直接测试；真实栈复用本地隔离脚本。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`frontend/src/domains/content/content-version-detail-page.tsx` 将面向用户的内容版本标题、事实链接、来源追溯快照标题和返回导航等文案统一为中文；相关组件、fixture 和真实栈断言同步更新。版本读取与不可变状态逻辑无需改动。
- `content-version-detail-page.test.tsx`：1 file / 12 tests 通过，覆盖精确详情 GET、sanitized Markdown、lineage、审核、空态、URL/响应 ID 不一致、错误恢复。`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- 当前候选生产预览 `content-version-detail.spec.ts` 移动/桌面 8/8 通过，含入口/刷新/Back/Forward、六状态及 HUMAN/AI 只读矩阵、375/768/1024/1440、键盘、404/403/retry；fixture 拒绝额外 Context/GenerationJob 请求与 mutation。
- 本轮隔离真实栈 `content-version-detail-real-stack.spec.ts` 1/1 通过：创建真实 HUMAN 版本后页面只发一条精确详情 GET，没有写入口或 Context/Job waterfall。脚本确认 Redis DB14、临时数据库/存储与端口清理；Compose 容器/卷已删除。
- 下一步 C08 汇总人工和 AI Content 连续闭环，复核状态 owner/共享组件边界，再进入 U01 发布工作列表。
