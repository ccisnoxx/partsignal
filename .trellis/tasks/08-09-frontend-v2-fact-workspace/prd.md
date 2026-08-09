# Frontend V2 Phase 2.5 — Fact Workspace

## 目标

交付可独立 review 的 `/products/$productId/facts` vertical slice，让工程人员在单一、一致的产品事实工作台中查看产品上下文，编辑唯一 Markdown 事实源，保存带 revision 的草稿，并由服务端原子创建不可变 `PENDING_REVIEW` snapshot。

## 已确认事实

- Product Detail 已进入本地 `main`，上一 Trellis task 已归档。
- 当前 Facts API 仅返回正文、分级、revision 和动作，不能通过单请求绘制完整工作台。
- PostgreSQL 当前只保留 `facts_body_markdown`、`facts_classification`、`facts_revision` 和不可变 FactVersion；revision `0025` 已删除 Evidence 子图。
- 现有 Workspace Kit、Form Kit、DirtyGuard、MarkdownEditor 和 StickyActionBar 可直接复用。
- 服务端已用 `expected_revision` 和行锁保护保存、提交；提交会创建 `PENDING_REVIEW` FactVersion。

## 需求

1. 页面只通过一个 Facts read-model 请求获取 Product Context、正文、classification、revision、workflow stage、批准/待审核摘要和 `available_actions`。
2. Markdown 是唯一事实编辑源；不得恢复 Evidence URLs、旧 Evidence 表或第二个可编辑事实来源。
3. 保存必须提交 `expected_revision`，成功后采用服务端 canonical response；冲突时保留本地内容，只有用户明确重新加载才丢弃。
4. 提交审核仅对已保存、clean 的表单开放；服务端创建不可变 `PENDING_REVIEW` snapshot，页面停留当前路由并刷新服务端动作。
5. 页面不得根据 status 推导业务动作；`SAVE`、`SUBMIT_REVIEW` 只来自服务端 typed `available_actions`。
6. RETIRED 产品只读，服务端动作投影为空，保存与提交均由服务端以 `INVALID_STATE_TRANSITION` 拒绝。
7. 支持 loading、empty、404、403、普通 error、422、revision conflict 和成功反馈，并保留 request ID。
8. DirtyGuard 同时保护应用内导航和浏览器离开；背景 refetch 不得覆盖 dirty 表单。
9. 满足键盘、焦点、ARIA 和 375/768/1024/1440 响应式要求。
10. 变更遵循 contract-first：OpenAPI → backend → generated clients → frontend；不新增依赖。

## 验收标准

- [ ] 直接访问 `/products/{id}/facts` 只发一个 Workspace GET 即可绘制全部上下文。
- [ ] ACTIVE 空工作区可编辑并保存；canonical revision 更新，dirty 状态清除。
- [ ] stale SAVE/SUBMIT 返回 `REVISION_CONFLICT`，本地 Markdown 保留，显式 reload 后才采用最新服务端值。
- [ ] 保存后的草稿可提交审核，返回 `PENDING_REVIEW vN`，页面不跳转 Fact Review，refetch 后服务端动作与 pending 摘要更新。
- [ ] 后续 Workspace 保存不会修改既有 FactVersion snapshot；已有 pending 时不可重复提交。
- [ ] RETIRED 工作区只读且无动作，服务端拒绝绕过 UI 的保存/提交请求。
- [ ] 空白 Markdown 和空白 change summary 在服务端边界失败，合法 Markdown 原样保存。
- [ ] DirtyGuard、错误状态、成功 live feedback、keyboard/focus 和四档响应式行为有自动化覆盖。
- [ ] OpenAPI、runtime schema、V1/V2 generated clients、backend 和 frontend 类型一致。
- [ ] required validation 全部通过，diff 不包含 Fact Review、数据库迁移、新依赖或无关修改。

## 排除项

- Fact Review、Fact Version Detail、Fact History 或其他业务页面。
- APPROVE、REQUEST_CHANGES 等审核动作。
- Evidence URL、Evidence 表或 evidence link。
- 自动 merge、diff editor、协同编辑、缓存或通用 Workspace 配置框架。
- commit、push、merge、task archive 或删除临时分支；这些操作需按 Git 确认门禁单独执行。
