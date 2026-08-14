# 实施计划

## 0. Start Gate

- [x] 父规划已批准拆分，Core 子 Task 已创建为 planning。
- [x] Core PRD、design、implement 已形成可 review 版本。
- [x] 用户明确批准本 Core 最新规划并授权 implementation。
- [x] 批准后重新核对 primary workspace 在 clean main、父/Preview均未 start。
- [x] 运行 `task.py start` 指向 Core，再创建唯一临时分支 `codex/frontend-v2-prompt-workspace-core`。

## 1. Ordered Implementation

1. URL/model first：q/promptId/new canonicalization、form/action/error mapping和 tests。
2. DirtyGuard：增加可选 navigation predicate并补默认行为/q-only tests。
3. Prompt API owner：移动 list query owner，新增 Detail/CRUD/error，不保留旧 key alias。
4. Route/nav：ADMIN entry、AdminBoundary route、loader/prefetch、generated route tree。
5. Page：Library、Editor、Bound Platforms、RHF/MarkdownEditor、StickyActionBar、dialogs/focus。
6. Mutation：create/update/delete canonical response、impact refetch、409 reload、precise cache。
7. Platform bind/unbind integration：同一 Prompt keys与 Content action消费者。
8. Component + strict fixture Playwright；四档 responsive和 runtime error audit。
9. Diff self-review、中文 touched-scope pass、报告；提交前提供 commit plan等待确认。

## 2. Required Validation

```bash
npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/design-system/forms/dirty-guard.test.tsx \
  src/design-system/workspace/workspace-kit.test.tsx \
  src/domains/configuration/prompt-workspace.model.test.ts \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/prompt-workspace.spec.ts
git diff --check
```

若 route generation 产生额外测试文件，只把直接受影响的 route/navigation test加入 targeted command。Core无合同/backend变化，不运行 contract/backend suite。

## 3. Optional Validation

```bash
npm --prefix frontend-v2 run e2e
make verify
```

全量 suite与Phase 6 real-stack不是Core completion gate。

## 4. Self-review

- [x] 同一 Prompt list endpoint只有一个 query owner，无 alias或双 cache。
- [x] 无客户端分页/排序/join/资格推导，无 Humanization/Preview scaffolding。
- [x] action/error exhaustive；409不 replay，本地草稿保留。
- [x] DirtyGuard默认行为不变，q-only只在同 editor identity放行。
- [x] create/update/delete只失效矩阵消费者，历史 Job/Version不触碰。
- [x] MarkdownEditor/StickyActionBar原样复用；WorkspaceShell只启用 Base UI `keepMounted` 保留窄屏草稿，无新依赖/通用抽象。
- [x] Core不渲染 Preview占位或 fixture假成功。
- [x] comments/developer-visible text完成中文 touched-scope检查。

## 5. Delivery Gate

- 报告 changed files、Core行为、权限、URL、revision/dirty、cache、实际验证、跳过项和风险。
- 提交前给出 commit plan并等待确认；不自动 push、不建PR。
- 确认后提交、归档、fast-forward合入main、删除Core临时分支。
- Core合入后才允许重新审阅并 start Preview。
