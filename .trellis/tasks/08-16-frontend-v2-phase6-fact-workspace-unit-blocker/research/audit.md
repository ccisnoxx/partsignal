# Frontend V2 Phase 6 Fact Workspace unit blocker 复现与归因

## 1. Baseline and inherited failure

- 日期：2026-08-16（Asia/Shanghai）。
- 基线：clean `main` at `8e685dd725887639e25804c86aa21abc73eee34b`；相对 `origin/main` ahead 225，不 pull/push。
- 前置 Task 已归档；唯一最终候选 `make verify` 在 V2 unit 以 `426 passed / 1 failed` 停止。
- 失败：`fact-workspace-page.test.tsx:197` 期望缓存的 `editor.textContent` `AO## 初始事实`，409 UI 出现后实际为 `LCL## 初始事实`。
- 当前 Phase 6 open P0/P1/P2 为 `0/0/1`，Gate=`NOT_MET`。

## 2. Independent reproduction

| Command | Exit | Actual result | Interpretation |
| --- | ---: | --- | --- |
| `npm --prefix frontend-v2 run test -- src/domains/product/fact-workspace-page.test.tsx` | 0 | `1 passed file / 9 passed tests / 1.77s` | 单文件稳定通过；失败依赖完整 suite 下的 DOM/render timing，不是稳定 production failure |

没有代码或环境变化，因此 planning 不重复运行完整 V2 unit 或 `make verify`。

## 3. Authority evidence

### Production state owner

- `FactWorkspaceEditor` 用 RHF 持有 `body_markdown`；MarkdownEditor 通过 `onChange` 写入 RHF，再由 controlled `value` 回传。
- `saveWorkspace()` 的 409 branch 只设置 field/form error、request ID 和 conflict，不调用 `form.reset()`。
- workspace background update 在 `isDirty` 时直接返回，不覆盖本地草稿。
- 只有 `reloadCanonical()` 显式读取服务端并调用 `form.reset()`。
- 以上与 frontend state-management spec 完全一致。

### Existing browser proof

- `tests/e2e/fact-workspace.spec.ts` 在 Chromium production artifact 中 `fill('## 本地未保存事实')`，409 后精确断言同一文本，再点击显式 reload 并断言 `## 服务端最新事实`。
- 真实浏览器测试使用 CodeMirror 的实际交互表面，不依赖 jsdom 内部渲染帧。

### Unit test fault

- 失败 unit 在 `user.type()` 后立即读取 `.cm-content.textContent`。CodeMirror 的内部 DOM 是 EditorView 对受控 document 的增量/虚拟化投影，不是 RHF value。
- 完整 suite 的两次读取分别得到不完整片段 `AO...` 与 `LCL...`；断言比较的是不同 DOM 帧，而不是业务草稿是否被 reset。
- root owner 是 unit assertion boundary；production 无需修改。

## 4. Sibling scan

同根模式仅发现三处：

1. `fact-workspace-page.test.tsx:192-197` revision conflict；
2. `fact-workspace-page.test.tsx:222-229` background refetch failure；
3. `markdown-editor.test.tsx:107-110` readonly toggle。

其它 `textContent` 用途为静态 heading/table/order projection，不涉及输入后即时捕获，不属于本 Task。

## 5. Planned correction matrix

| Owner | Planned stable evidence | Production change |
| --- | --- | --- |
| Fact Workspace 409 | controlled Preview/统计或 mutation payload + conflict/request ID/dirty + explicit canonical reload | none |
| Fact Workspace refetch | controlled Preview/统计 + refresh error/request ID/dirty | none |
| MarkdownEditor toggle | controlled counter/Preview + readonly semantic | none |
| Frontend quality spec | 禁止以输入后即时 `.textContent` 作为 CodeMirror controlled value 证据 | none |

## 6. Planning conclusion

- B-03 是 P2 unit reliability blocker，root owner 为两个测试文件中的三处同根断言。
- 最小修复不修改 production、API、database、permissions、deploy、dependencies 或 E2E。
- 当前 Gate 仍为 `NOT_MET`；只有实施、完整验证和唯一最终候选门禁全部通过后才可改判。

## 7. Implementation evidence before final gate

- 三处同根断言已改用单次 paste transaction、controlled Preview、字符/行数和 mutation payload；没有 helper、sleep、retry、test ID 或 production accessor。
- MarkdownEditor 目标文件：`1 passed file / 7 passed tests / 685ms`。
- Fact Workspace 目标文件：`1 passed file / 9 passed tests / 1.74s`。
- 完整 Frontend V2 unit：`73 passed files / 427 passed tests / 12.67s`，failed/skipped 均为 `0`。
- `api:check`、typecheck、lint、production build、contract-check 与 diff check 均退出 `0`；build 只有既有大 chunk warning。
- B-03 已关闭，已知 open P0/P1/P2 为 `0/0/0`；最终候选门禁运行前 Gate 仍为 `NOT_MET`。

## 8. Unique final-candidate gate

- 仅运行一次 `make verify`，退出码 `2`，`real 1148.07s / user 1311.68s / sys 116.55s`。
- 已通过：contract、lint/typecheck、backend unit `193 passed / 5.60s`、V1 unit `205 passed / 245.65s`、visual contract `24 passed / 0 failed / 0 skipped`、V2 unit `427 passed / 13.50s`、PostgreSQL integration `116 passed / 144.02s`、backend/V1/V2 build、V2 real-stack `13 passed / 1.1m`、V1 E2E `52 passed / 5.5m`。
- V2 fixture E2E：`355 passed / 27 skipped / 2 failed / 4.5m`；Compose dev/prod config 因前序失败未运行。
- 两个失败是同一 `tests/e2e/geo-insights.spec.ts:27` 场景在 `foundation-mobile` 与 `foundation-desktop` 的结果。第 37 行固定期望 Reset 后回到 `2026-07-15..2026-08-13`，实际为当前 UTC 最近 30 日 `2026-07-18..2026-08-16`。
- production `resetFilters()` 复用 `defaultGeoInsightDates()`；model unit 明确锁定 UTC 30 日默认周期。root owner 是 E2E 固定日期未控制系统时间，不是 GEO production，也不是本 Task 的 Fact Workspace/MarkdownEditor owner。
- 依 stop condition 不扩围、不重跑完整门禁。新 blocker 记为 P2，当前 open P0/P1/P2=`0/0/1`，Phase 6 Exit Gate=`NOT_MET`。

## 9. Cleanup evidence

- Redis DB 14：`0` key、`0` 外部客户端；独占容器已移除，16379 已释放。
- PostgreSQL 临时数据库、E2E container、storage directory、E2E process：均为 `0`。
- `8000/9001/5173/4173/4174/19009`：全部释放。
