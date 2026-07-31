# 第二轮全项目回归发现

## 缺陷总表

本轮确认 12 个问题：产品功能/UI 10 个、测试门禁 1 个、开发环境 1 个；P2 共 9 个、P3 共 3 个，P0/P1 为 0。下表补齐角色、错误码/失败信号和主证据索引，详细复现、期望、实际、影响与修复位置见后续各节。

| ID | 类型 / 严重度 | 角色 | 错误码或失败信号 | 主证据 |
| --- | --- | --- | --- | --- |
| `PS-QA2-FUNC-001` | 产品功能 / P2 | ADMIN、ENGINEER | 409 `LEGACY_GENERATION_RETRY_FORBIDDEN` | 真实任务详情、API 与 `ContentTasksPage.tsx:665` |
| `PS-QA2-FUNC-002` | 产品功能 / P2 | ADMIN、ENGINEER | 不适用：提交前已确认页面状态投影错误 | 真实已解决异常、repair context 与 `PublicationRepairPage.tsx:45,64` |
| `PS-QA2-FUNC-003` | 产品功能 / P2 | ADMIN、ENGINEER | 不适用：未执行无效写请求 | 真实非链尾更正页与 `GeoObservationForm.tsx:156,187,331` |
| `PS-QA2-DELETE-001` | 并发/审计 / P2 | ADMIN | 实际 `204/204`，预期 `204/404` | `delete-concurrency-probe.py`、最终数据库与审计核对 |
| `PS-QA-201` | 键盘可访问性 / P2 | ADMIN、ENGINEER | `document.activeElement=BODY` | 候选、产品、AI Header 三条真实浏览器链 |
| `PS-QA2-UI-002` | 键盘可访问性 / P2 | ADMIN、ENGINEER | `document.activeElement=BODY` | 发布记录抽屉与审计详情侧栏真实浏览器链 |
| `PS-QA-202` | 危险操作文案 / P3 | ADMIN | 不适用：界面文案缺陷 | 五类删除确认与对应页面源码 |
| `PS-QA-203` | 业务影响提示 / P2 | ADMIN | 不适用：确认前说明缺失 | AI Header 确认框与 `invalidate_channel_models` 调用链 |
| `PS-QA2-TEST-001` | 测试门禁 / P2 | 测试执行者 | 不适用：错误目标仍可使门禁变绿 | 24 表通用扫描与两张弹窗表精确选择器对照 |
| `PS-QA2-UI-003` | 组件兼容性 / P3 | ADMIN、ENGINEER | Ant Timeline `items.children` 弃用警告 | `ui-route-probe.mjs` 与 `PublicationDetailPage.tsx:61,63` |
| `PS-QA2-UI-001` | 前端资源 / P3 | 匿名用户 | HTTP 404 `/favicon.ico` | 两个独立新会话与开发门禁网络记录 |
| `PS-QA2-ENV-001` | 开发环境 / P2 | 开发者、测试人员 | 容器退出码 1；依赖下载/DNS 失败 | Compose `fake-oss` 状态、日志与 GEO 图片 ORB |

## 已确认发现

### PS-QA2-FUNC-001：终态内容任务仍提供失败作业重试操作

- 类型：功能/操作列逻辑缺陷
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：`/tasks/:taskId` 的“AI 作业”操作列；存在 FAILED 作业的 COMPLETED/CANCELLED 任务，以及旧生成契约等服务端不可重试作业
- 前置条件：任务已进入终态，历史中至少有一条 FAILED 生成作业。
- 最短复现：打开 `/tasks/fecdc328-eb30-48ff-ac7b-b558bba4ece3`；页面同时显示“当前任务为只读状态”“任务已完成，详情保持只读”，但 FAILED 行仍显示可点击“重试原快照”；调用该按钮对应的 retry API。
- 期望：终态任务或其他服务端不可重试作业不提供重试动作；操作列与服务端当前状态一致，必要时说明不可重试原因。
- 实际：前端只判断 `row.status === 'FAILED'` 就渲染按钮；真实 API 返回 409 `LEGACY_GENERATION_RETRY_FORBIDDEN`，作业数保持 7，不产生新作业。
- 根因证据：`frontend/src/features/content-tasks/ContentTasksPage.tsx:665` 未结合任务 `isOpen` 或服务端作业动作；`backend/app/services/content_production.py:520` 起还会校验契约版本、任务 OPEN 状态、事实/产品、源版本和活动作业。
- 影响：用户在明确只读的历史任务中看到无效主动作，点击后只能得到错误；操作列不能表达真实可执行能力，且其他不可重试原因仍可能重复出现。
- 后续建议：修复任务至少先按任务 OPEN 状态隐藏重试；更完整的单一事实源应由服务端对每条作业返回 `RETRY` 可用动作或不可用原因，前端只按该投影渲染。

### PS-QA2-FUNC-002：已解决发布异常仍可进入修复任务创建表单

- 类型：功能/状态操作逻辑缺陷
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：`/publication-attentions/:attentionId/repair` 直达路由
- 前置条件：发布异常已经是 `RESOLVED`，且已经关联修复任务。
- 最短复现：打开 `/publication-attentions/31f00c56-6da5-497e-8fa4-3641bddeba73/repair`；选择事实版本并观察主操作。
- 期望：页面根据服务端 `available_actions=[]` 显示不可创建原因并移除或禁用创建表单；不能把已解决历史呈现为可执行工作。
- 实际：页面展示完整表单和可点击“创建修复任务”；同一上下文明确返回 `status=RESOLVED`、现有 `repair_task_id` 和 `available_actions=[]`。
- 根因证据：`frontend/src/features/publications/PublicationRepairPage.tsx:45` 起只判断事实候选是否为空，`frontend/src/features/publications/PublicationRepairPage.tsx:64` 起无条件渲染创建表单，未消费异常的 `available_actions`；服务端权威投影在 `backend/app/services/publication_queries.py:122`，写入边界还会在 `backend/app/services/publication.py:1067` 拒绝非 OPEN 状态并在已有修复任务时返回 409。
- 影响：用户可从历史详情或收藏链接进入无效操作，填写后只能得到服务端冲突；页面状态与异常详情的“无可执行动作”相互矛盾。
- 后续建议：修复页直接以服务端 `available_actions` 为唯一渲染依据；无 `CREATE_REPAIR_TASK` 时展示只读状态和返回异常详情入口，并补 resolved/已有修复任务用例。

### PS-QA2-FUNC-003：非链尾 GEO 更正页显示错误但仍保留可提交操作

- 类型：功能/状态操作逻辑缺陷
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：`/observations/:observationId/correct` 的非链尾历史记录
- 前置条件：目标人工观测已经被后继记录更正，服务端返回 `available_actions=[]`。
- 最短复现：打开 `/observations/02873242-1024-4fe7-965b-53dc7ac89d94/correct`；页面出现“当前记录不可更正”后检查表单底部和文件输入。
- 期望：错误状态下所有更正输入和提交操作不可用，或仅显示错误与返回入口。
- 实际：页面同时显示错误和未禁用的“追加更正记录”按钮，文件输入也仍可操作；未实际提交写请求。
- 根因证据：`frontend/src/features/geo-observations/GeoObservationForm.tsx:156` 正确识别缺少 `CORRECT` 动作，`frontend/src/features/geo-observations/GeoObservationForm.tsx:187` 仅把错误传给 Ant Form 的 `disabled`；`frontend/src/features/geo-observations/GeoObservationForm.tsx:331` 的提交按钮自行设置 `disabled` 时没有包含 `correctionError`，表单外观禁用没有覆盖原生提交按钮和上传控件。服务端在 `backend/app/services/geo_observation.py:373` 只向链尾人工观测投影 `CORRECT`，并在并发链变化时拒绝写入。
- 影响：错误页仍暗示可以完成更正，键盘和鼠标可触发无效请求；上传控件还可能产生不必要的临时文件。
- 后续建议：在错误状态下不渲染可编辑表单，或由同一个显式布尔值统一禁用提交与上传；补非链尾直达和状态变化回归测试。

### PS-QA2-DELETE-001：AI 渠道与 Header 同目标并发删除会重复返回成功并写入双份成功审计

- 类型：业务逻辑/并发/审计一致性缺陷
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：`DELETE /api/v1/ai-channels/{channel_id}`、`DELETE /api/v1/ai-channel-headers/{header_id}`；同一对象的并发删除请求
- 前置条件：管理员、有效 CSRF、目标存在；两个独立数据库会话同时删除同一 ID。
- 最短复现：在隔离 PostgreSQL 中用 Barrier 同时发起两次相同 DELETE，并在请求完成后读取响应、目标行及该请求 ID 的审计日志。
- 期望：只允许一个请求返回 204 并写入一条成功审计；落后请求应在锁后重新读取目标，返回 404，不能再记录成功。
- 实际：AI 渠道与 Header 均返回 `204, 204`，各写入 2 条成功审计；数据库最终目标行只删除一次。SQLAlchemy 同时报告目标 DELETE 预期删除 1 行、实际匹配 0 行。其余 11 个 DELETE 均为 `204, 404` 且只有 1 条成功审计。
- 根因证据：`backend/app/services/ai_configuration.py:390` 的渠道删除使用 `db.get` 后直接审计和删除，没有目标行锁；同文件 511 行的 Header 删除先读取 Header，再只锁父渠道，等待后没有重新锁定或读取 Header，因而继续处理过期 ORM 对象。579 行的模型删除复用 326 行的统一锁序，本轮正确得到 `204, 404`，可作为权威对照。
- 影响：客户端会得到两个“删除成功”，审计历史虚增；Header 路径还会基于已删除对象重复执行渠道/模型失效逻辑。最终目标行仍为已删除，未发现受保护历史被额外删除，因此定为 P2。
- 证据：`artifacts/full-project-acceptance/E2E-FULL-20260731-R2-01/delete-concurrency-probe.py`；本轮隔离运行输出和最终数据库核对。
- 后续建议：让两个删除入口复用现有目标加锁模式，在持锁后确认目标仍存在，再追加成功审计并提交；补同目标双请求回归，不增加兼容分支。

### PS-QA-201：Dropdown 打开静态确认框后焦点没有回到原触发按钮

- 类型：UI/UX/键盘可访问性缺陷
- 严重程度：P2
- 状态：本轮复现，历史缺陷仍未关闭
- 范围：从表格 `Dropdown` 菜单继续打开静态 `modal.confirm` 的操作；当前源码调用链覆盖内容任务、产品、事实版本、发布候选/记录、GEO 观测、AI 渠道/Header/模型、平台、平台类型、发布账号和用户列表。
- 前置条件：从表格“更多操作”进入需要二次确认的操作。
- 最短复现：聚焦候选、产品或 AI Header 的“更多操作”，打开取消/删除确认框后选择取消；检查 `document.activeElement`。
- 期望：焦点回到原“更多操作”触发按钮，用户可以继续当前位置的键盘操作。
- 实际：三个代表页面都把焦点落到 `BODY`；单独打开并关闭普通 Dropdown 时，13/13 个代表菜单均能正确恢复，问题只出现在菜单到静态确认框的接力链。
- 根因证据：例如 `frontend/src/features/publications/PublicationWorkspace.tsx:269` 从 Dropdown 回调直接调用 `modal.confirm`，触发按钮位于同文件 515 行；产品、AI Header 和其余受影响表使用相同调用模式，没有保存并在确认框关闭后恢复原触发元素。
- 影响：键盘用户取消高风险操作后丢失列表位置，需要从页面起点重新导航；同一根因横跨多个业务操作列。
- 后续建议：在共享的 Dropdown→确认入口统一保存触发元素，并在确认框完全关闭后恢复；不要逐页面增加互不一致的补丁。抽屉/侧栏的独立状态关闭问题另见 `PS-QA2-UI-002`。

### PS-QA2-UI-002：详情抽屉和侧栏关闭后焦点没有回到列表触发按钮

- 类型：UI/UX/键盘可访问性缺陷
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：发布记录详情抽屉；桌面全局审计日志详情侧栏，移动审计 Drawer 存在同源风险
- 前置条件：从列表“查看记录”或“查看日志详情”按钮打开详情。
- 最短复现：打开发布记录抽屉后按 Escape，或打开桌面审计日志详情后点击“关闭日志详情”；检查 `document.activeElement`。
- 期望：焦点回到打开该详情的列表按钮，且当前行位置保持可继续操作。
- 实际：两条链关闭后焦点均落到 `BODY`。
- 根因证据：`frontend/src/features/publications/PublicationWorkspace.tsx:217` 关闭时只清理 URL/状态；`frontend/src/features/configuration/AuditLogPage.tsx:479` 只设置 `selectedId`，504 行条件卸载侧栏，512 行 Drawer 关闭也只清理 ID；`frontend/src/features/configuration/AuditLogDetailPanel.tsx:84` 的关闭按钮只调用 `onClose`。这些路径都没有保存触发器或恢复焦点。
- 影响：键盘用户关闭详情后丢失表格行位置；发布与审计两个高频只读核查流程均受影响。
- 后续建议：由详情打开/关闭状态的共同所有者记录触发按钮，并在 Drawer/侧栏完成关闭后恢复；为桌面侧栏、移动 Drawer 和发布抽屉各保留最小回归用例。

### PS-QA-202：多个删除确认仍使用面向实现的“物理删除”术语

- 类型：UI/UX/危险操作文案缺陷
- 严重程度：P3
- 状态：本轮复现，历史缺陷仍未关闭
- 范围：产品、事实版本、GEO 人工观测链、平台和发布账号删除确认
- 前置条件：以允许删除的角色打开对应表格操作菜单。
- 最短复现：在产品列表打开删除确认框；其标题显示“物理删除产品……”。其余四类当前源码仍包含同一术语。
- 期望：用业务对象、影响范围、不可恢复性和可能被引用阻断等用户语言说明删除，不暴露存储实现术语。
- 实际：`ProductsPage.tsx:63`、`ProductFactsPage.tsx:158`、`GeoObservationsPage.tsx:303`、`PlatformsPage.tsx:255`、`SettingsPage.tsx:169` 仍向用户展示“物理删除”。
- 影响：用户无法从实现术语准确判断业务历史、引用和附件的真实处理范围；同一产品内不同删除确认文案不一致。
- 后续建议：按每种对象的服务端权威副作用改写业务文案，保留对象名、不可恢复性和引用阻断，不建立第二套删除规则。

### PS-QA-203：删除 AI Header 未说明渠道和模型测试状态会失效

- 类型：功能影响提示/UI 文案缺陷
- 严重程度：P2
- 状态：本轮复现，历史缺陷仍未关闭
- 范围：AI 渠道详情的“请求 Header”操作列
- 前置条件：渠道存在至少一个 Header，且用户从操作列选择删除。
- 最短复现：打开 Header 删除确认；确认框只显示“删除 Header……？”和取消/删除按钮。
- 期望：确认前明确说明删除会停用渠道和全部子模型，并清除旧连接/模型测试结论。
- 实际：`frontend/src/features/configuration/AIChannelDetailPage.tsx:428` 只有标题，没有影响说明；服务端 `backend/app/services/ai_configuration.py:511` 删除 Header 后调用 314 行的 `invalidate_channel_models`，会停用渠道和全部模型、把测试状态重置为 `UNTESTED` 并清空最近测试信息。
- 影响：管理员可能把删除单个 Header 误认为局部变化，未预期地中断整个渠道及模型可用性。
- 后续建议：确认框直接说明既有服务端副作用；不要改变删除合同或另加前端推断逻辑。

### PS-QA2-TEST-001：24 表自动化可能用背景表替代两张弹窗表而误判通过

- 类型：测试门禁缺口
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：`cross-page-visual-convergence.spec.ts` 中 GEO 文章观测结果与模型发现弹窗两张表
- 前置条件：弹窗打开时底层页面仍有可见 `.table-region`。
- 最短复现：打开“登记人工观测”弹窗后运行现有通用扫描；首个被检查区域是背景“观测记录列表”，而不是弹窗内“产品文章观测结果”。
- 期望：24 表门禁对每个清单项验证其唯一、明确的表面根节点；缺失目标表时必须失败。
- 实际：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:149` 会遍历页面全部可见 `.table-region`，550 行的主循环在 571/575 行打开弹窗后仍于 582 行调用通用扫描，没有断言目标弹窗表存在，因此背景表可让用例变绿。
- 影响：两张弹窗表即使缺失或发生布局回归，现有“24 张业务表”E2E 仍可能通过。本节已用精确 dialog 选择器独立确认当前两个目标表面通过，但门禁本身仍不可靠。
- 后续建议：清单为每张表登记唯一 root/aria-label，并让扫描只接受该目标；弹窗表先断言目标唯一存在，再检查其几何和长文本。

### PS-QA2-UI-003：发布详情使用已弃用的 Timeline 字段并稳定污染控制台

- 类型：UI 运行时/组件兼容性缺陷
- 严重程度：P3
- 状态：已确认，修复不在本任务范围
- 范围：`/publications/:publicationId` 的状态轨迹
- 前置条件：发布记录包含至少一条状态事件。
- 最短复现：在全新浏览器打开发布详情，分别使用 `1440×1000` 和 `375×900`，等待真实详情请求完成后检查 console。
- 期望：页面无组件弃用或运行时警告；状态轨迹使用当前锁定 Ant Design 版本支持的字段。
- 实际：两个主视口均稳定输出 `Warning: [antd: Timeline] items.children is deprecated. Please use items.content instead.`；页面当前仍能渲染。
- 根因证据：`frontend/src/features/publications/PublicationDetailPage.tsx:61` 的 Timeline item 仍在 63 行使用 `children`；同项目的发布 Drawer、内容审核、审计和产品事实 Timeline 已使用当前 `content` 字段。
- 影响：控制台基线持续存在非预期错误级信号，并留下后续 Ant Design 移除旧字段后的发布详情兼容风险；当前不阻断用户查看，定为 P3。
- 证据：`artifacts/full-project-acceptance/E2E-FULL-20260731-R2-01/ui-route-probe.mjs`，最终稳定运行在两个主视口各复现一次。
- 后续建议：在独立修复任务中把该唯一旧字段改为 `content`，并用发布详情 console 断言防回归；无需新增 Timeline 包装层。

### PS-QA2-UI-001：登录页缺少 favicon 导致稳定 404

- 类型：UI/前端资源缺陷
- 严重程度：P3
- 状态：已确认，修复不在本任务范围
- 范围：匿名登录入口及浏览器首次加载
- 前置条件：新浏览器会话打开 `http://127.0.0.1:5173/login`。
- 最短复现：打开登录页并检查浏览器 console/network。
- 期望：站点图标资源存在，首次加载无非预期 4xx console error。
- 实际：浏览器请求 `/favicon.ico` 得到 404；仓库 `frontend/` 中没有 favicon 文件或 `rel="icon"` 声明。
- 影响：不阻断登录，但产生稳定 console error，浏览器标签缺少品牌标识，也会污染“页面无失败信号”验收。
- 证据：两个独立新会话及开发环境门禁均复现 `Failed to load resource ... /favicon.ico:0`。
- 后续建议：在前端静态资源中加入受版本控制的站点图标并在 HTML 显式声明，补一条静态资源/E2E 断言。

### PS-QA2-ENV-001：共享开发对象存储服务无法启动

- 类型：测试环境阻断
- 严重程度：P2
- 状态：已确认，修复不在本任务范围
- 范围：Compose 共享开发栈的文件上传、下载、附件和清理流程
- 前置条件：当前 `main`、现有 `.env`、Compose 开发栈
- 最短复现：运行 `docker compose --env-file .env -f deploy/compose.dev.yaml up -d --wait fake-oss`，随后检查容器状态和日志。
- 期望：`fake-oss` 持续运行，可供 API 的开发对象存储边界使用。
- 实际：容器退出码 1；bind mount 后的 `uv run` 尝试解析/下载 `hatchling`、`pillow`，容器 DNS/网络请求失败后进程退出。
- 影响：共享开发页面上的文件相关业务不能据此判定通过；代理、认证、数据库、Worker/Scheduler 和非文件页面不受影响。隔离 E2E 自带 `app.dev_storage` 和临时目录，仍可独立验证文件业务。
- 证据：`docker compose ... ps -a fake-oss` 显示 `Exited (1)`；`docker compose ... logs fake-oss` 显示 PyPI DNS/下载失败。
- 第 8 节补充证据：GEO 更正页在桌面和移动视口加载两个既有历史证据图时均得到 `net::ERR_BLOCKED_BY_ORB`；详情和下载 URL API 本身成功，失败集中在共享开发对象存储对象请求。隔离 E2E 的临时存储上传、下载和清理仍通过。
- 后续建议：若必须恢复共享开发页面文件流，另建环境修复任务，检查开发镜像依赖是否完整及 bind mount 后为何触发在线同步；本测试任务不修改镜像、Compose 或依赖。

## 产品与文档决策项

以下两项不计入上述 12 个实现/环境问题，也不改变本轮缺陷严重度统计。

### PS-QA2-DEC-001：内容任务删除验收文档仍描述已被 `0033` 取代的旧条件

- 类型：权威文档口径漂移
- 状态：待后续文档任务处理；本轮按当前数据库合同和实现判定
- 冲突：`docs/deployed-full-functional-acceptance-plan.md:231` 仍写“仅无生成作业且无内容版本时允许”；`contracts/database.md:279-283,338` 已允许 `CANCELLED` 任务连同生成作业、审核记录和未批准内容版本删除，只在批准/被取代内容、发布记录或修复来源存在时阻断。
- 当前判定：13 DELETE 专项按 `0033_task_owned_history_delete` 的当前合同执行并通过任务删除服务端边界，不把旧验收文档当作产品失败。
- 建议：独立更新部署验收文档的状态表和测试数据准备说明；不得反向收窄当前数据库合同或恢复旧限制。

### PS-QA2-DEC-002：是否让全部固定操作统一由服务端 `available_actions` 投影

- 类型：产品/架构决策
- 状态：待产品与技术设计确认；不是本轮预设缺陷
- 已确认事实：内容任务、发布记录、异常和 GEO 等部分页面已有服务端动作投影；另一些固定角色菜单继续由前端状态或角色判断。只有已经产生运行时误导的具体路径才登记为 `PS-QA2-FUNC-001`～`003` 等缺陷。
- 建议：后续先确定是否需要统一服务端动作合同；若不统一，也必须让每个前端固定动作完整复用服务端最终资格并在状态变化后恢复。不得为兼容当前页面再创建第二份权限或状态真相。

## 待复核观察

- 早期最小隔离 E2E 与开发 Worker 并行时出现约 8 小时时钟漂移告警。本次全量 E2E 按隔离规范临时停止开发 Worker/Scheduler，生成、超时和重试场景均通过且未复现该告警；后续仅在验证共享并行运行时再复核，不登记为当前缺陷。

## 证据作废记录

- 第一次隔离 E2E 尝试未正确停止 Compose 前端，隔离 Vite 使用 5174 而 Playwright 仍访问 5173，因此其绿色结果不计入本轮结论。修正端口所有权后重跑，取得 `2 passed` 和精确清理证据。
- 第 7 节第一次定向 E2E 尝试把 Compose 命令保存在单个 shell 字符串中，导致前端、Worker 和 Scheduler 实际未停止；隔离 Vite 回退到 5174，Playwright 访问了共享 5173，出现 3 通过、2 失败及约 8 小时时钟漂移。该次结果全部作废；改用直接 Compose 命令后重跑为 `5 passed (1.3m)`，隔离数据库和临时存储均精确删除，开发服务恢复健康。
- 第 7 节第一次前端定向单测由并行调度返回时未保留会话句柄，无法取得最终退出码，故不计证据；单独可追踪重跑为 8 个文件、97 个用例全部通过。
- 第 8 节尝试把完整路由扫描放入 `playwright-cli run-code` 时，命名会话被工具端关闭；这些尝试未完成扫描，不计页面结论。随后按同一 Playwright 技能降级为任务目录内的项目 Playwright 只读脚本。
- 第 8 节只读脚本首轮使用 400ms 固定等待，产生路由切换 `net::ERR_ABORTED` 和页面稳定前标题缺失，整轮作废。改为等待当前 route、spinner、network 和可访问标题稳定，并仅过滤已证实的导航取消后，最终完成 54 次扫描；保留下来的 Timeline 警告与对象图片 ORB 均在两个视口复现。
