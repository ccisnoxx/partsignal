# Query Topic Dialog 实时投影

## 目标与用户价值

关闭 `/geo/topics` 的跨标签一致性缺口：查看引用或删除 Dialog 打开后，窗口聚焦触发的 Query Topic exact 列表刷新必须立即更新 Dialog 中的名称、引用、删除资格和 revision；用户不得继续依据打开瞬间保存的旧行快照判断或提交删除。

## 已确认事实

- `queryTopicListQueryOptions(search)` 使用 exact `geoKeys.topicList(params)`，并配置 `refetchOnWindowFocus: 'always'`（`frontend/src/domains/geo/geo.api.ts:156-170`）；它是当前筛选、排序与分页下 Query Topic 行投影的服务端状态 owner。
- 页面当前把查看引用 target 保存为完整 `QueryTopicListItem`，把删除 target 保存为 `id/question/revision`（`frontend/src/domains/geo/query-topic-list-page.tsx:75-82`、`:142-161`）。列表 query 更新不会替换这些本地副本。
- 查看引用 Dialog 直接消费 target 快照中的 `canonical_question/references/deletion`（`frontend/src/domains/geo/query-topic-list-page.tsx:620-650`）；删除 Dialog 直接消费快照中的名称和初始 revision（`:673-741`）。
- 当前列表投影已经包含本任务所需的 `references/available_actions/deletion/revision`，无需请求 Detail、修改公共合同或在浏览器推导权限。
- 稳定状态规范要求删除 intent 只保存稳定 ID、命令和焦点返回点；展示与确认从当前 exact query 投影派生，确认时拒绝 fetching/error/目标缺失/矛盾投影，并使用当次当前 revision（`.trellis/spec/frontend/state-management.md:85-110`）。
- 前序 `09-03-query-topic-conflict-network-reload` 已保证 409 显式 reload 的完整 options 请求不会复用 fresh cache 或点击前在途响应；本任务不得削弱该事实，也不得自动重放 mutation。
- 历史审计将此问题定级为 P1：跨标签新增引用后，本标签页即使聚焦刷新，已打开 Dialog 仍可能显示旧引用、旧删除资格并提交旧 revision。
- 用户已确认：删除 Dialog 打开期间若最新投影撤销 `DELETE` 或出现 blockers，保留 Dialog 并原位切换为最新阻断说明，不自动关闭。

## 需求

### R1：单一服务端投影 owner

- 查看引用与删除 intent 只保存 Query Topic ID、命令语义（如需要）和 `focusReturn`；不得保存名称、revision、references、`available_actions`、deletion 或完整 row。
- 每次 render 只从当前 exact `topics.data.items` 按 ID 解析目标；不得扫描其他分页/筛选 cache、请求 Detail、增加轮询、全局 store 或第二份 canonical 状态。
- 当前 exact query key 改变或目标从该投影消失时，清理 intent；焦点返回只使用仍连接 DOM 的原触发器，不猜测相邻行或 `document.body`。

### R2：查看引用 Dialog 实时更新

- Dialog 打开期间列表投影更新后，标题、三类引用数量、下钻链接与删除条件说明必须使用同一最新行。
- 刷新失败但仍有旧 data 时可以继续显示旧投影，但必须沿用页面已有刷新失败提示；不得把 query error 当成新鲜成功。

### R3：删除确认使用当前资格与 revision

- 删除 surface 只消费最新 `available_actions + deletion + references`，不得按旧引用数、角色或状态补算 DELETE。
- 确认事件必须同步读取当前 exact query 状态与数据；query fetching、query error、目标缺失、`deletion=null`、无 `DELETE` 或 blockers 非空时不得发送 DELETE。
- 允许确认时，将当前行 `id/revision` 固化为本次 mutation variables；不得继续使用 Dialog 打开时的 revision。
- 任意删除 `409` 继续冻结确认并保留真实 ErrorEnvelope/request ID；被动列表更新不得解除冻结，只有用户显式 reload 成功后才能重新确认，且不得自动重放。
- 前序 fresh reload 的网络新鲜度、不复用点击前请求及失败保留冻结语义必须保持。

### R4：边界与兼容性

- 编辑/创建 Dialog 的表单值、dirty 状态、打开时 revision 基线及 409 显式恢复不纳入被动 live projection；列表刷新不得静默覆盖用户输入。
- 不修改 backend、`contracts/openapi.yaml`、generated client、数据库合同、Query Topic 全局 options 缓存策略、权限规则、HTTP 行为或业务状态转换。
- 不启动或吸收 `integrity-error-domain-mapping`。

## 验收标准

- [x] AC1：查看引用 intent 不保存完整行；Dialog 打开后 exact 列表成功刷新时，名称、引用数量、链接和删除条件说明在不关闭重开的情况下更新。
- [x] AC2：删除 intent 不保存名称、revision、references、actions、deletion 或完整行；列表成功刷新后删除 Dialog 使用最新名称、资格、blockers 与 revision。
- [x] AC2a：最新投影出现 blockers 或撤销 `DELETE` 时，已打开删除 Dialog 保持打开并原位显示当前不可删除/引用条件，确认入口不可执行；资格恢复后仍以最新投影重新呈现确认入口。
- [x] AC3：删除确认期间 exact query 正在 fetching、带 error、目标缺失或最新投影不允许无阻断删除时，不发送 DELETE；允许时只发送一次并携带确认瞬间的当前 revision。
- [x] AC4：目标从当前 exact 列表消失或 query key 改变后，旧 intent 不会在后续页面状态中重新出现；断开的行触发器不会被当作焦点返回目标。
- [x] AC5：删除 `409` 后，被动列表刷新即使带来新 revision 也不会解除冻结或自动重放；显式 reload 仍强制发起点击后的 `/api/v1/query-topics` 请求，失败保持冻结，成功后才允许人工再次确认。
- [x] AC6：编辑 Dialog 中已输入的草稿不会因列表被动刷新而重置；既有创建、编辑、引用、删除、键盘焦点和 375/768/1024/1440 无页面级横向溢出行为无回归。
- [x] AC7：只修改 Query Topic 前端页面、其 production-artifact Playwright fixture/spec 与本 Task 文档；backend、OpenAPI、generated client、数据库合同和 `integrity-error-domain-mapping` 均无变化。

## 范围外

- Query Topic 编辑 Dialog 的通用 live form reset；其本地草稿与 revision 冲突恢复继续显式处理。
- 非 Query Topic 页面删除 Dialog 的重构；既有 Platform/Profile/Account/User 模式只作为状态所有权证据。
- 新增通用 Dialog target framework、跨域 helper、全局 store、轮询或额外 endpoint。
- 修改 Query Topic 缓存时长、服务端权限、引用计算、删除事务或错误域映射。
- `integrity-error-domain-mapping`。

## 技术约束

- 采用已有 Platform/Profile/Type/Account 删除 Dialog 的 intent-by-ID 与 exact-query 派生模式，但不抽取跨领域通用层。
- 409 显式恢复继续先执行前序任务建立的 fresh `/api/v1/query-topics` 请求；删除 Dialog 还必须让当前 exact list 投影成功校准后再恢复可确认状态，不能退回本地 revision 副本。
- 所有阻断性产品、范围、UX、兼容性和风险决策均已解决；不存在待实施前回答的开放问题。
