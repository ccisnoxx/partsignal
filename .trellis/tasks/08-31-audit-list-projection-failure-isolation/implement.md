# Audit 列表投影失败隔离实施计划

## Scope

本计划已获人工批准并完成实施。以下勾选项与验证结果记录本轮实际执行证据；提交仍需单独确认。

## Phase A：冻结 strict action projection

- [x] 在 `audit.model.ts` 增加 domain-local `AuditActionLabelProjection` 判别式结果和唯一 projector。
- [x] projector 只读取现有 `auditActionLabels`；成功结果只含正式中文 label，失败结果不含原 action/token/error text。
- [x] 保持 `auditActionLabels` 登记集合不变；保持现有 `auditActionLabel()` 对未知 action 的严格失败，不增加任何宽松 fallback。
- [x] 在 `audit.model.test.ts` 覆盖已登记成功、未知失败结果不含 token、现有 strict throw 与 facts/changes 合同不变。

## Phase B：隔离单条 AuditRow

- [x] `AuditRow` 只消费判别式结果，不再在 render 阶段调用未捕获的 throwing label path。
- [x] 成功行保持七列、中文标签、click、Enter、Space、`logId`、lazy detail 和既有 ARIA。
- [x] 失败行保持七列与 approved metadata，只在动作单元格显示不含 token 的局部失败状态。
- [x] 失败行不绑定详情交互、不写 `logId`、不请求 detail，不产生失效 tab stop。
- [x] 不改 list query、pagination、canonical search、stale-data 或已经打开的合法 Detail。

## Phase C：隔离动作筛选项

- [x] API actions 逐项 strict projection，只将登记项加入 Select。
- [x] 未登记 API option 只产生动作筛选控件旁的通用可访问反馈，不泄漏 token，不遮蔽其他 filters/list。
- [x] 为 unknown current URL action 建立局部 unavailable selection view-model：保留真实 server filter identity，但 UI 只显示通用失败状态。
- [x] 用户选择 ALL、登记 action 或 Reset 时按现有 URL 合同明确替换/清除；不让 opaque UI sentinel 进入 URL 或 API。
- [x] options transport failure 的 Notice/retry 保持原行为，不能与 projection failure 混合。

## Phase D：组件回归

- [x] component fixture 使用 mixed rows：至少两个登记 action、一个未知 action，并提供彼此不同的 ID。
- [x] 断言页面未进入 route error；合法行分别覆盖 click、Enter、Space 和 lazy detail；失败行没有 detail request。
- [x] 断言失败行仍显示 approved metadata，未知 token、raw JSON、`change_summary`、sentinel 不在 DOM。
- [x] filter options 同时提供登记与未知 action，断言登记项可用、未知项不可选择、局部反馈可访问。
- [x] 以 unknown `search.action` direct URL 验证通用 current-selection 状态、server filter 参数保留和明确清除。
- [x] 在合法 detail 已打开后注入 mixed refresh/stale refresh failure，断言 detail、旧合法 rows、URL 和 retry 表面保持。
- [x] 保持七列、deleted actor、三种 outcome、related entry 三态、focus restore 和越界页测试不退化。

## Phase E：production artifact fixture 与 E2E

- [x] fixture 在 list 中注入一个未知 action，同时保留多个登记 action；在 filter-options 中注入未知 option。
- [x] 未知 action/token 和未登记 payload 使用明确测试 sentinel；raw fixture response 只作为输入证据，不被拼入“浏览器输出无泄漏”的断言对象。
- [x] fixture 继续只允许 auth/CSRF 与 list、filter-options、detail 三个 Audit GET；未知行不得产生 detail GET。
- [x] fixture teardown 继续拒绝未允许的 `console.error`、`pageerror`、request failure 和未声明 API。
- [x] E2E 证明合法行仍可 click/Enter/Space，未知行仅局部失败，pagination/canonical URL/其他 filters/已开 detail/stale data 不受影响。
- [x] 在 375/768/1024/1440、Pane/Sheet、Back/Forward 和焦点恢复矩阵中保持现有行为。

## Required Validation

实现后依次运行以下必需检查：

```bash
npm --prefix frontend test -- src/domains/audit/audit.model.test.ts src/domains/audit/system-audit-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run api:check
npm --prefix frontend run e2e -- tests/e2e/system-audit.spec.ts --project=foundation-mobile --project=foundation-desktop
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-31-audit-list-projection-failure-isolation
! rg -n '[[:blank:]]+$' .trellis/tasks/08-31-audit-list-projection-failure-isolation
```

证据要求：

- Vitest 记录通过/失败/跳过数和耗时。
- Playwright 两个 project 都通过；fixture teardown 无 runtime error、未声明 API 或敏感输出失败。
- `api:check` 证明 OpenAPI generated client 没有 drift；本 Task 不重新生成或修改 schema。
- 检查最终 diff，确认仅包含批准的 Audit domain/tests/fixture 文件与本 Task 文档，没有 backend、contracts、database、AI Runtime 或用户脏文件。
- 对 touched TypeScript/测试做中文注释、错误和开发者可见文本检查；只补充非显而易见的投影边界说明，不为机械代码添加注释。

## Optional Validation

```bash
npm --prefix frontend run test
make verify
```

完整前端单测与仓库级 `make verify` 只在共享测试、release readiness 或实现实际影响超出当前 Audit domain 时升级为必需。目标 E2E 已经通过 production build + Vite preview 运行，常规实现不额外重复单独 build。

不运行 backend、数据库迁移或真实栈写流程：本 Task 不改变 API、服务端 action 生成、权限、持久化或生产数据。若 required validation 发现这些边界有 drift，停止实现并回到合同 review，不在本 Task 内扩 scope。

## Actual Validation Result

- `npm --prefix frontend test -- src/domains/audit/audit.model.test.ts src/domains/audit/system-audit-page.test.tsx`：2 files、10 tests 全部通过，2.34s。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run api:check`：通过，OpenAPI generated client 与根合同一致。
- `npm --prefix frontend run e2e -- tests/e2e/system-audit.spec.ts --project=foundation-mobile --project=foundation-desktop`：10/10 通过，12.8s。
- `task.py validate`、Task 文档尾随空格检查和限定六文件 `git diff --check`：通过。
- 未运行 optional 全量 Vitest 或 `make verify`；定向 unit、类型、lint、API 同步和 production-artifact E2E 已直接覆盖本 Task 边界。
- `.trellis/spec/` 未更新：现有 System Audit state spec 已定义三 query 独立、未知投影局部失败、七列与禁止 raw JSON；本次没有公共 API、数据库、权限或跨域合同变化。

## Review 与启动 Gate

- [x] 人工确认“坏行不得打开 Detail”的决定。
- [x] 人工确认 unknown current URL action 的保留/清除交互。
- [x] 人工确认 failure surface 可见文案与非泄漏断言。
- [x] 人工批准后运行 `task.py start`，再开始产品代码修改。
- [ ] 提交前另行给出 commit plan 并取得确认；不自动提交或推送。
