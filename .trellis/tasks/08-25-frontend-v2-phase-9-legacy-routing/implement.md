# 实施计划

## 当前状态

最终规划、实现与 Required Validation 均已完成。当前停止在 commit plan 审批前，没有提交、推送、部署、合并或 Staging 操作。

## Phase 0：规划闸门

- [x] 用户批准现有 V2 `/publishing/work` 最小扩展 `status=CLOSED`。
- [x] 已按决定更新 PRD、设计、矩阵和验收范围。
- [x] 用户明确确认整体规划。
- [x] 执行 `python3 ./.trellis/scripts/task.py start frontend-v2-phase-9-legacy-routing`。

Phase 0 已完成。

## Phase 1：Auth 与根 404（已完成）

1. 新增唯一 return-to 校验 owner 及最小 unit test。
2. `_app` 未登录跳转携带 approved `location.href`；Login 成功按 approved href replace，must-change 保持优先进入 Security。
3. 保持 Security 完成后回 `/`，不增加 pending 状态。
4. 根 route 增加显式、可访问的 404；不增加 catch-all 首页 redirect。

完成条件：合法站内 deep link 可恢复；外部/编码绕过与 login loop 回安全默认；未知 route 显示 404。

## Phase 2：Legacy routes 与 query（已完成）

1. 新增 route-local query 转换 model 和 unit test；仅实现 `research/audit.md` 白名单。
2. 按矩阵增加 Auth、Content、GEO、Configuration、System、Publishing 显式 routes，全部 replace。
3. 保持相同路径 Product routes 不变，增加 Detail→Facts 回归覆盖。
4. 仅在现有 publication work search/request owner 加入已批准的 `CLOSED`，直接复用 backend 枚举；不增加其他 publication 能力。
5. 运行现有 route generation；只接受生成器对 `routeTree.gen.ts` 的修改。

完成条件：每个获准 legacy 输入只有一个 canonical 结果；未知 query 不透传；无 API、lookup、backend/Nginx 变化。

## Phase 3：Browser 合同（已完成）

1. 抽取现有 auth-session spec 的最小可复用 fixture，保持原测试行为。
2. 新增 `legacy-routing.spec.ts`，表驱动覆盖全部 pathname、query 与 ID。
3. 覆盖 direct、refresh、Back/Forward、replace/no-loop、匿名 return-to、恶意 redirect、must-change、角色权限、未知 path、资源错误。
4. 覆盖桌面/移动各一条代表 redirect，并复用现有 runtime/CSP 错误监听。

完成条件：目标 E2E 无 console/page/request/CSP 未解释错误，canonical 地址与页面权限/错误状态一致。

## Phase 4：文档与一致性（已完成）

1. 更新 `02-information-architecture-and-routing.md`：冻结实际 matrix、return-to、404 owner。
2. 更新 `07-migration-plan.md`：记录 Phase 9 本 Task 的实际完成与剩余工作。
3. 更新 `08-testing-quality-and-acceptance.md`：记录本地测试合同与真实证据，不声称 Staging 已测。
4. 回填本任务 artifacts 的实际 changed files、验证结果、残余风险与未实现项。

## Required Validation

按变更相关性执行：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e -- tests/e2e/legacy-routing.spec.ts tests/e2e/auth-session.spec.ts
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-phase-9-legacy-routing
```

实际结果：

- Vitest：`83 files / 489 passed`。
- Playwright：`legacy-routing.spec.ts + auth-session.spec.ts` 在 mobile/desktop 共 `16 passed`。
- TypeScript typecheck：通过。
- ESLint `--max-warnings 0`：通过。
- Vite production build：通过；仅有既有 `markdown-editor` chunk 超过 500 kB 的非阻断 warning。
- `git diff --check` 与 Trellis Task validate：通过。

不默认运行 backend suite、`make e2e`、`make verify`、SSH 或 Staging 检查。只有实际 route/build 证据表明 production artifact 或安全头受影响时，才补现有最小安全检查。

## 预计修改文件

### 应用代码

- `frontend-v2/src/app/auth/return-to.ts`（新）
- `frontend-v2/src/app/auth/return-to.test.ts`（新）
- `frontend-v2/src/routes/__root.tsx`
- `frontend-v2/src/routes/_app/route.tsx`
- `frontend-v2/src/routes/login.tsx`
- `frontend-v2/src/routes/-legacy-routing.model.ts`（新）
- `frontend-v2/src/routes/-legacy-routing.model.test.ts`（新）
- `frontend-v2/src/routes/_app/change-password.tsx`（新）
- `frontend-v2/src/routes/_app/tasks/index.tsx`、`_app/tasks/$taskId.tsx`（新）
- `frontend-v2/src/routes/_app/content/$versionId.tsx`（新）
- `frontend-v2/src/routes/_app/observations/index.tsx`、`insights.tsx`、`insights/print.tsx`、`topics.tsx`、`$observationId/correct.tsx`（新）
- `frontend-v2/src/routes/_app/settings/index.tsx`（新）
- `frontend-v2/src/routes/_app/configuration/index.tsx`、`ai.tsx`、`ai/channels/$channelId.tsx`、`platform-types.tsx`、`platforms.tsx`、`prompts.tsx`（新）
- `frontend-v2/src/routes/_app/users.tsx`、`_app/audit.tsx`（新）
- `frontend-v2/src/routes/_app/publications.tsx`（新）
- `frontend-v2/src/routeTree.gen.ts`（生成）

### 已批准的 D1 修改

- 现有 publication work search schema/model、route 与必要测试（以实施时检索到的实际 owner 为准，不另建 wrapper）。

### E2E 与文档

- `frontend-v2/tests/e2e/fixtures/legacy-routing.fixture.ts`（新；严格、无领域成功模拟）
- `frontend-v2/tests/e2e/auth-session.spec.ts`
- `frontend-v2/tests/e2e/legacy-routing.spec.ts`（新）
- `docs/frontend-v2/02-information-architecture-and-routing.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 本任务 `prd.md`、`design.md`、`implement.md`、`research/audit.md`

文件清单是审计后的预期边界，不授权无关清理。实施时若现有 Router 命名规则要求合并目录 index，只做等价的最小调整并在任务记录中说明。

## 交付停止点

- Required Validation 已完成，当前停止；不部署、不推送、不合并、不启动下一 Task。
- 提交前展示 exact commit plan，等待用户确认。
- 完成报告须区分 implemented 与 blocked 映射，并明确 Staging 未验证、branch/commit/merge 状态和残余风险。
