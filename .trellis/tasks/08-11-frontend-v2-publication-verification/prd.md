# Frontend V2 Publication Verification

## 目标

在已验收的 Publication Workspace Core 上完成核验闭环：首次失败形成不可变记录和 `ACTION_REQUIRED`，引导进入内容修正；服务端出现合法批准候选后完成换版、重新登记结果与再核验；通过后进入 `COMPLETED` 并显示只读 PublishedArticle 交接。

## 依赖

- 必须先完成 `frontend-v2-publication-workspace-core` 的 Context、route、core forms、cache 和真实栈 Flow A。
- 本任务复用 Core 的 `PublicationWorkspaceContext`、`PublicationWork`、result form、Timeline、Dialog、RHF 和 query keys，不建立第二个 Verification Context。

## 需求

- VERIFY 只在服务端 `available_actions` 包含 token 时可执行；前端用一个“正文是否与批准内容一致”选择生成一致的 `outcome/content_matches`，失败说明必填。
- 失败响应保留 canonical Work、追加 Verification/Event 并展示 `ACTION_REQUIRED`；不得覆盖、编辑或删除旧核验记录。
- `ACTION_REQUIRED` 提供 Content Task canonical 修正入口；不在 Publication Workspace 编辑批准内容。
- SWITCH 只消费 Context 的 `switch_candidate`，不得读取全部 ContentVersion 或按 status/current pointer 客户端过滤。
- 换版继续携带 `expected_revision`；命令成功后必须重读 Context，显示新绑定 Markdown/hash 和 `CONTENT_VERSION_CHANGED` event。
- 换版不伪造结果已更新；用户使用 Core 的 result form 重新登记真实 URL/title/time/evidence 后再核验。
- PASSED 使 work 和 source ContentTask terminal，创建 canonical PublishedArticle；工作台变为只读并显示成果身份/未来 detail handoff，不实现 PublishedArticle route。
- 完成 verify/switch endpoint 的真实 OpenAPI error responses 与结构化错误 UX。

## Out of Scope

- Content Editor/Review 新能力；只链接已存在的 Content Task/Edit/Review 路由。
- PublishedArticle 列表/详情、GEO Issue、长期监控、删除成果或完整 Phase 4 Publishing checkpoint。
- 自动比较正文、自动判断内容匹配、批量核验、回滚/删除历史。

## 验收标准

- [ ] Verification Dialog 只由 token 打开；PASSED/FAILED payload、revision、CSRF、comment 校验准确，pending 防重。
- [ ] FAILED 产生 `ACTION_REQUIRED`、一条 append-only verification 与 event，Dialog 关闭/焦点恢复且页面保留真实失败证据。
- [ ] 无候选时显示服务端投影的 no-option 和 Content Task 修正入口；不请求版本列表。
- [ ] 有候选且 token 存在时可切换；409 不自动重放并保留 comment/request ID，显式重载才采用最新 Context。
- [ ] 换版后批准 Markdown/hash/version 和 timeline 由新 Context 校准，旧 verification 仍指向旧 content version。
- [ ] 重新登记结果后 PASSED 创建与 work 同 ID 的 PublishedArticle，ContentTask/Work terminal，所有 mutation 消失且页面只读。
- [ ] production-artifact fixture 覆盖失败、无/有候选、switch conflict、再登记、通过、readonly 与 direct refresh。
- [ ] 独立真实栈 Flow B 使用与 Flow A 不同的数据，完整证明 fail → content correction/approval → switch → result → pass。
- [ ] 不新增依赖、Context、global state、自动判断或 PublishedArticle placeholder route。
