# Frontend V2 Phase 4 Publishing Vertical Slice 抽象回顾

## Goal

审查完整 Publishing vertical slice，确认 Publication domain、Design System/shared 与 route/application composition 的稳定所有权，删除已证实无价值的局部重复，记录不应在本任务修复的产品、合同和跨领域问题，并以可复核算法给出 Phase 4 Exit Gate 判定。

本任务不新增业务能力。审计结论允许是 no-code；只有发现已证实缺陷或可直接删除的局部冗余时，才规划最小修改。

## Scope

### In scope

- `PublicationWork`、`PublishedArticle`、`PublishedContentIssue` 三个资源及其 canonical URL、read model、action、cache、表单、错误与测试所有权。
- `frontend-v2/src/domains/publication/`、`frontend-v2/src/routes/_app/publishing/` 与 Publishing 相关 component、fixture Playwright、real-stack tests。
- 后端 Publication query/projection/schema/router、`contracts/openapi.yaml` 与生成类型的一致性审计。
- 已存在 Design System/shared pattern 的复用与反向依赖审计。
- Phase 4 Product / Engineering / UX / Architecture / Contract / Documentation 六类 Definition of Done。

### Out of scope

- GEO、Workbench、Cutover、未来占位路由或任何新业务能力。
- 新增通用 Workflow、Context、API、Table、Detail、Timeline、Status 或 Action framework。
- 修改业务合同、状态机、数据库、权限或不可变规则。
- 合并 Work、Article、Issue 的业务 model 或 action registry。
- 在本任务内修复后端 Publication read model、OpenAPI 合同或其他跨领域问题；这些只记录 owner、影响和后续 Task。

## Requirements

1. 三个资源必须继续独立，保留三组 canonical URL：`/publishing/work`、`/publishing/articles`、`/publishing/issues` 及各自详情页。
2. route 只负责 params/search/hash、loader/prefetch、metadata 和页面组合；既有跨域 cache callback 仅作为已批准的 application composition 保留，不下沉为跨域依赖。
3. Publication API、query keys、action registries 与错误 owner 必须唯一；不得生成第二 DTO 或兼容层。
4. 页面只消费 `primary_task`、`available_actions` 与 server-projected candidates；不得由 status、role 或多接口结果推导资格。
5. 不得存在浏览器 join、waterfall、当前页本地过滤、静默默认、重复 read model 或未声明 API fallback。
6. Work Workspace、Article Detail、Issue Context 保持单请求 snapshot 边界；Package 与 repair context 只能按需加载。
7. Work、verification、event、Article、issue history 与来源 Content snapshot 的不可变边界必须被合同、代码和真实栈证据共同支持。
8. Work、Article、Issue 三种列表不得抽成万能 DataTable；只复用已有 Table/RowActions primitives。
9. 只有至少两个真实消费者在 DOM、交互、可访问性和 props 上稳定一致时，才允许提升到 Design System/shared。
10. component、fixture Playwright 与 real-stack tests 必须证明不同 failure mode；文件数或表面 DOM 重叠不是删除依据。
11. cache invalidation、409 no-replay、URL state、RHF 与 local transient state 的 owner 必须明确。
12. 任何实施修改必须可独立 review；若预计超过约 10 个主要代码文件，停止并拆分修复 Task。

## Acceptance Criteria

- [ ] `audit.md` 含 15 项固定审计项的 audit matrix，且每项有证据与判定。
- [ ] `audit.md` 含 ownership matrix 与 findings ledger；每个 finding 都记录 severity、`file:line`、observed evidence、impact、current owner、recommended owner、decision、proposed minimal change、validation、defer trigger。
- [ ] findings 的 `decision` 只使用六个允许值。
- [ ] 明确列出应保留在 Publication domain、应保留在 Design System/shared、当前不得提升及可局部删除的实现。
- [ ] 不因名称、文件长度、测试数量或相似 JSX 创建新框架或删除互补测试。
- [ ] `design.md` 定义最小设计、精确文件白名单、依赖方向与 rollback point。
- [ ] `implement.md` 把 frontend 本域修正与 backend/contract 后续 Task 分开，并列出 required validation 与 optional diagnostics。
- [ ] Phase 4 Exit Gate 算法覆盖 Product / Engineering / UX / Architecture / Contract / Documentation 六类 DoD、三组 URL、server-driven actions、单请求 read model、不可变历史、fixture/real-stack、lint/typecheck/tests/build、`make verify`。
- [ ] 未解决的 P0–P2 缺陷或任一 required gate 未通过时，Exit Gate 必须判定为 `NOT_MET`。
- [ ] 规划完成后保持 Task `planning`，不运行 `task.py start`、不创建分支、不修改业务代码，等待用户批准。

## Success Boundary

本任务成功不等于 Phase 4 自动退出。成功意味着审计证据、最小前端修正计划、跨领域 follow-up owner 和 Gate 算法已确定；只有所有阻断 finding 关闭且最终门禁通过，Phase 4 才可判定 `MET`。
