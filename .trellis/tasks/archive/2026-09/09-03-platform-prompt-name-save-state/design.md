# Platform Prompt 名称保存状态修复设计

## 1. 问题模型

`PromptEditor` 的保存资格当前为：

```text
server UPDATE action
AND form isDirty
AND form isValid
AND mutation not pending
AND no revision conflict
```

业务条件本身正确，问题在状态订阅方式。当前代码先读取 `isDirty`，随后在 `actions.canUpdate && isDirty && form.formState.isValid` 中条件读取 `isValid`。React Hook Form 7.85 的 `formState` 是 Proxy；属性 getter 会登记订阅。clean 首屏的 `isDirty=false` 会令表达式短路，因此该 render 不读取、也不订阅 `isValid`。线上已观察到 dirty 已更新但 validity 没有推动保存资格重绘；再次修改 Markdown 触发另一轮校验后才恢复。

当前 HEAD 的本地 production artifact 未稳定复现该竞态，说明它受校验与 render 调度时序影响；历史 Staging DOM/ARIA、无 PUT 和源码证据仍足以确定应修复订阅不变量。

## 2. 设计决策

在 `useForm`/`useWatch` 之后、任何条件表达式之前一次读取所需状态：

```tsx
const { isDirty, isValid } = form.formState;
```

后续 `canSave`、disabled reason、状态文案与 shortcut 全部消费这两个局部值。这样首个 render 就登记 `isValid` 订阅，无论当前 dirty 与否，后续 resolver 有效性变化都能通知编辑器。

该修复位于真实 owner，且不改变表单 schema、默认值、字段 registration、提交 handler 或 mutation。

### 不采用的方案

- 不在 effect 中调用 `form.trigger()`：它增加额外命令式校验与生命周期耦合，没有修复“依赖状态应始终订阅”的根因。
- 不用 `promptFormSchema.safeParse(form.getValues())` 派生第二份 validity：会复制 RHF/resolver 状态，并可能与 errors/submit 分叉。
- 不移除 `isValid` 条件：无效 dirty 表单会错误启用按钮，弱化现有 UX。
- 不 watch `name` 后自行比较 canonical 值：`isDirty` 已是该责任的唯一 owner，无需平行 dirty 逻辑。

## 3. 保存行为保持

名称单独编辑只改变保存资格，不改变保存协议：

```text
合法名称 change
  -> RHF: dirty=true, isValid=true
  -> Save enabled
  -> onReload 读取当前 Detail/revision/绑定范围
  -> 未绑定：一次 PUT(name + unchanged template_markdown + expected_revision)
  -> canonical response reset form/baseRevision
  -> dirty=false, status=未修改 · Revision N
```

绑定 Prompt 继续进入影响范围 Dialog；revision 漂移继续冻结草稿并要求显式 reload；服务端字段错误继续映射至 RHF errors。权限 token、CSRF、cache invalidation 与 Preview 消费者不变。

## 4. 回归设计

### 4.1 Component

在 `prompt-workspace-page.test.tsx` 增加未绑定 Prompt 的名称单独保存用例：

- direct 打开第二个未绑定 Prompt；
- 等待 canonical name/Markdown 与初始 clean 状态；
- 只修改名称，等待 dirty 状态并断言保存可用；
- 点击保存，断言不出现“保存将影响绑定平台”；
- 断言一次 GET latest detail 后只发出一次 PUT；
- exact body 为新名称、未改 Markdown、`expected_revision=2`，并携带既有 CSRF；
- mock 返回 revision 3 后，断言状态为 clean/revision 3、按钮禁用。

测试验证用户可见与请求边界，不断言 Proxy 内部字段或调用顺序细节。

### 4.2 Production artifact

在 `prompt-workspace.spec.ts` 增加独立 fixture 用例，复现历史最短路径：

- 进入新建页并创建未绑定 Prompt；
- canonical URL/response revision 0 稳定后，只修改名称，不触碰 Markdown；
- blur 后断言 dirty 文案与保存按钮可用；
- 点击保存，断言请求数组只有 POST 与一次 PUT；
- PUT exact body 包含新名称、创建时 Markdown 与 `expected_revision=0`；
- 响应后断言 clean/revision 1。

同一 spec 在 `foundation-mobile` 与 `foundation-desktop` 两个项目执行。fixture 未声明 API 仍失败；不引入真实登录、外部服务或公网数据。

## 5. 预计文件

- `frontend/src/domains/configuration/prompt-workspace-page.tsx`
- `frontend/src/domains/configuration/prompt-workspace-page.test.tsx`
- `frontend/tests/e2e/prompt-workspace.spec.ts`
- `.trellis/spec/frontend/state-management.md`
- 本 Task 的 PRD、design、implement、research 与 context manifests

预计不需要修改 `prompt-workspace.model.ts` 或 E2E fixture；如果 exact response 支持确实缺失，只允许在既有 fixture 内增加当前合同所需的最小状态，不得复制 backend 逻辑。

## 6. 不变量

- 表单草稿仍以 `promptId/new=1` 隔离，dirty 时后台数据不得静默 reset。
- mutation response 仍是成功后的 canonical name/Markdown/revision owner。
- 服务端 `available_actions` 仍是 UPDATE 资格 owner；客户端不按角色或状态补动作。
- 不改变 HTTP body/schema、CSRF、revision、影响范围确认、冲突/no replay 或缓存失效。
- 不触及公共合同、generated client、backend、数据库、Makefile、CI、部署或旧管理员密码。
- 保留任务外 dirty/index 原样，提交时只能路径受限暂存本 Task 文件。

## 7. 失败与升级条件

- 若无条件订阅后定向测试发现 validity 仍不能稳定更新，先用组件级 resolver/render 证据定位；不得叠加 `trigger()`、timeout 或手写 validity fallback。
- 若需要改变 RHF 版本、公共 `FormField`/`Input` 或 StickyActionBar API，停止本 Task 并报告独立修复范围。
- 若 required gate 暴露 backend/contract/generated 差异，停止并归因，不在本 Task 顺手修复。
