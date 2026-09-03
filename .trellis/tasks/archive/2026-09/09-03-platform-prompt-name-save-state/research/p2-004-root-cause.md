# P2-004 根因与回归研究

## 1. 历史运行证据

归档验收 run `20260830-204002-v3-staging-business` 在新建、未绑定、revision 0 的真实 Staging Prompt 上观察到：

- 只修改合法名称并移出焦点；
- 页面显示“有未保存修改 · 基于 Revision 0”；
- “保存 Prompt”为 `aria-disabled=true`，禁用原因是“请先修正表单错误”；
- 页面没有对应字段错误，也没有发出 PUT；
- 再次触碰并填写合法 Markdown 后按钮启用，随后 GET latest detail 与 PUT 200。

该流程最终用 workaround 完成 revision `0 -> 1` 并清理对象，因此运行截图只记录保存后的同一对象；禁用瞬间由 DOM/ARIA 与无 PUT 网络证据确认。

## 2. 当前 owner

`frontend/src/domains/configuration/prompt-workspace-page.tsx` 的 `PromptEditor`：

- `useForm({ mode: 'onChange', resolver: zodResolver(promptFormSchema) })` 持有表单；
- `isDirty` 单独读取；
- `isValid` 只在 `actions.canUpdate && isDirty && form.formState.isValid` 及随后条件分支中读取；
- 保存通过既有 `requestSave -> onReload -> submit` 执行，并提交完整 name/Markdown/revision。

`frontend/src/domains/configuration/prompt-workspace.model.ts` 已正确把 name 与 Markdown 纳入 Zod schema 和 update payload，没有发现名称漏入 dirty/payload 的第二个问题。

现有 component test 已证明 q-only 后名称草稿保持与 DirtyGuard 阻断，说明名称变化能进入 RHF dirty；现有保存测试只编辑 Markdown。现有 E2E 同样只用 Markdown 触发 update。

## 3. 依赖行为与根因判断

当前安装版本为：

- `react-hook-form` 7.85.0
- `@hookform/resolvers` 5.7.1
- `zod` 4.4.3

本地安装包实现 `getProxyFormState` 时，通过属性 getter 把被读取的 formState 字段登记到订阅表。因此，JavaScript 短路不仅影响布尔计算，还可能影响是否订阅 `isValid`。

高置信根因判断：clean 首屏因 `isDirty=false` 未读取 `isValid`，有效性状态的更新在特定调度时序下没有推动编辑器重绘；名称 change 同时触发 dirty/validation 时出现订阅竞争，而第二次 Markdown change 提供了新的有效性更新。这与线上“dirty=true、isValid 路径仍 false、无 field error”的组合一致。

## 4. 当前 HEAD 临时诊断

使用既有 `prompt-workspace.fixture.ts` 和本地 production build/preview，临时运行两条未提交探针：

1. 加载现有未绑定 Prompt，只修改名称；
2. 新建未绑定 Prompt，canonical revision 0 后只修改名称。

两条路径在当前机器均观察到保存按钮 `disabled=false`；第二条独立测试 1 passed。最初一次临时 webServer 配置因启动上下文错误在 60 秒超时，未进入 test、没有产品行为结论；改为从 `frontend/` 显式启动同一 preview 后完成诊断。

结论：P2-004 不是当前 HEAD/当前调度下稳定可复现的 red test，不能宣称本地已复现；这不消除线上已确认的时序缺陷。临时配置和探针文件已删除，preview 已停止，`playwright-cli list --all --json` 为 `browsers=[]`、`servers=[]`。

## 5. 历史差异核对

- `git blame` 显示 `useForm` 与 `canSave` 逻辑都源自 V2 Prompt Workspace 初始实现。
- 从部署源提交 `a663bcce` 到当前 HEAD，相关 Prompt Workspace 页面、component test、E2E 和 fixture 没有修复差异。
- 因此不把当前本地通过归因于源码修复；修复目标是让订阅方式本身不再依赖调度时序。

## 6. 最小修复与测试建议

- 在任何短路条件之前无条件读取 `isDirty/isValid`，后续统一消费局部值。
- 不增加 `trigger()` effect、不重复 Zod 校验、不移除 validity guard。
- component regression 覆盖 direct 未绑定 Prompt 的名称单独保存与 exact PUT/canonical reset。
- production-artifact regression 覆盖历史“新建后只改名称”路径，并在 mobile/desktop 两个项目运行。
- 不修改 API、contract、generated、backend、fixture 业务模型或公网环境。
