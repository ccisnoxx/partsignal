# 修复 Platform Prompt 名称编辑保存状态

## 目标与用户价值

修复公网 V2 验收确认的 `P2-004`：管理员在已保存且合法的 Platform Prompt 上仅修改名称时，页面已经显示“有未保存修改”，但“保存 Prompt”可能仍错误禁用并提示“请先修正表单错误”。

修复后，名称和 Markdown 任一合法变更都必须稳定进入同一保存资格判断；名称单独编辑可直接提交，既有 revision、影响范围确认、冲突保留和 canonical reset 行为保持不变。

## 已确认事实

- 已归档公网验收在一个新建、未绑定、revision 0 的 Prompt 上确认：仅把合法名称改为带 `-Edited` 的值后，`isDirty` 已生效，但保存按钮仍为 `aria-disabled=true`，页面没有字段错误，也没有发出 PUT；触碰合法 Markdown 后按钮才启用。
- `PromptEditor` 使用 React Hook Form + Zod；保存资格同时依赖服务端 `UPDATE` 动作、`isDirty`、`isValid`、非 pending 和无 revision conflict。
- 当前表达式在 `isDirty=false` 时短路，不读取 `formState.isValid`。React Hook Form 的 `formState` 通过属性读取建立订阅，因此首屏可能没有订阅后续保存资格所需的有效性状态。
- 当前 HEAD 的本地 production artifact 在“加载未绑定 Prompt 后只改名称”和“新建后只改名称”两条临时诊断路径上都观察到按钮正常启用；P2-004 在当前调度时序下不是稳定本地复现。本任务不得把该结果改写成“当前稳定失败”，但仍需消除已由线上证据确认的条件订阅竞态并固化回归。
- 从部署源提交 `a663bcce` 到当前 HEAD，Prompt Workspace 页面及其现有 unit/E2E 没有相关修复；现有 E2E 的 update 只覆盖 Markdown 编辑。

## 范围内要求

### R1 表单状态订阅

- `PromptEditor` 必须在 render 的稳定位置无条件读取保存资格依赖的 `isDirty` 与 `isValid`，不得让逻辑短路决定是否订阅 `isValid`。
- React Hook Form 继续是 dirty、validity、errors 和 submit 的唯一表单状态 owner；不得新增并行布尔值、手写 Zod 解析状态、隐藏 fallback 或自动保存。
- 名称、Markdown、权限 token、pending、conflict 和 revision 的现有保存条件保持不变；无效名称或空 Markdown 仍必须阻止提交并展示真实字段错误。

### R2 名称单独编辑与保存

- 对一个已保存、可更新、名称与 Markdown 均合法的未绑定 Prompt，只修改为另一个合法名称后，页面必须显示 dirty 状态且“保存 Prompt”稳定可用。
- 提交仍调用既有 `PUT /api/v1/platform-prompts/{platform_prompt_id}`，body 精确包含新名称、未改变的 canonical Markdown 和当前 `expected_revision`。
- 未绑定 Prompt 不出现影响范围确认；绑定 Prompt 的既有确认流程不变。
- 成功后采用 mutation canonical response 重设表单，清除 dirty，并显示递增后的 revision；失败、字段冲突与 revision conflict 不得 optimistic success 或自动重放。

### R3 回归证据

- 组件测试直接覆盖名称单独编辑、按钮资格、未绑定直提、exact PUT payload 和成功后的 canonical reset。
- production-artifact Playwright 使用既有 typed fixture 覆盖“新建 Prompt → 只改名称 → 保存”的历史路径；不得登录公网、使用旧管理员密码或依赖真实业务数据。
- 保留既有 Markdown update、DirtyGuard、绑定影响确认、revision conflict、create/delete 和 Preview 测试。

## 非目标

- 不修改 Prompt API、OpenAPI、generated client、backend、数据库合同或审计合同。
- 不改变权限、业务 HTTP 行为、revision 规则、绑定影响、事务、状态转换或缓存失效范围。
- 不修改公共 Form/Input/StickyActionBar primitive，不新增全局 Store、表单 wrapper 或通用 validity helper。
- 不部署、不登录公网、不修改或复用旧管理员密码。
- 不创建或启动 `integrity-error-domain-mapping`。

## 验收标准

- [x] `PromptEditor` 从首个 render 起无条件订阅 `isDirty` 与 `isValid`，保存资格不再受 JavaScript 短路订阅时序影响。
- [x] 已保存的未绑定 Prompt 只修改为合法名称时，dirty 状态可见且“保存 Prompt”可用，无需触碰 Markdown。
- [x] 名称单独保存只发出一次 PUT，精确提交新名称、未变 Markdown、当前 `expected_revision` 和既有 CSRF；不出现绑定影响确认。
- [x] 保存成功后采用 canonical response，dirty 清除，按钮恢复禁用，revision 按响应前进。
- [x] 空名称、空 Markdown、无 `UPDATE`、pending 和 revision conflict 仍阻止保存；既有错误与显式 reload/no replay 合同不变。
- [x] 既有 Markdown update、绑定影响确认、create/delete、DirtyGuard 和 Preview 相关定向测试继续通过。
- [x] production-artifact Playwright 在 mobile/desktop 两个项目中覆盖“新建后只改名称”闭环，且不使用公网凭据或真实服务。
- [x] 变更只落在 Prompt Workspace owner、对应 unit/E2E、frontend 状态规范与本 Task 文档；没有合同、generated、backend、数据库、Makefile、CI 或业务设计文档变化。
- [x] Required Validation 全部实际通过；未运行的 optional suites 明确记录为 `NOT_RUN`，不得写成通过。

## 约束与风险

- 当前 HEAD 本地诊断正常并不否定公网历史失败；实现与 Review 必须准确表述为消除条件订阅竞态，不得声称已在当前 HEAD 稳定得到 red test。
- 不以 `useEffect(() => trigger())` 增加命令式校验周期；订阅缺失应在 render 所有者修复。
- 不移除 `isValid` 门禁或把按钮常态启用后依赖 submit 拦截，这会改变无效表单的既有交互合同。
- 若实施中发现必须修改公共 primitive、合同、backend 或生成产物才能修复，应停止并报告，不得扩大本 Task。
