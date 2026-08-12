# frontend-v2-geo-observation-list 审计记录

## 基线

- 日期：2026-08-12（Asia/Shanghai）
- 开始状态：主工作目录位于 `main`，工作区干净，无活动 Trellis Task。
- Git：`main...origin/main [ahead 140]`，未落后，因此没有执行 pull。
- 当前 planning branch：`codex/frontend-v2-geo-observation-list`。
- Task 未激活，未提交、未 push。

## 已完整阅读

- 根 `AGENTS.md`、`frontend-v2/AGENTS.md`、`.trellis/workflow.md`。
- `docs/frontend-v2/README.md`、02、03 GEO 部分、04、05、06、07、08、09。
- `.trellis/spec/guides/` 的 index、code reuse、cross-layer guides。
- `.trellis/spec/frontend/` 的 index、visual system、component/hook/quality/state/type/directory specs。
- `.trellis/spec/backend/` 的 index、available-actions、error、quality、directory、database specs。
- `.trellis/spec/infra/` 的 index、E2E isolation、CI execution specs。

## Contract/backend

- `contracts/openapi.yaml:2880` 的现有 list operation 使用完整 `GeoObservationList`。
- `contracts/openapi.yaml:7089-7164` 的 legacy/manual schemas 包含 detail-only fields，`GeoObservationList.items` 引用完整 union。
- `backend/app/routers/observation.py`：list/get 为认证读取；create 为 ADMIN/ENGINEER；delete 为 ADMIN。
- `backend/app/services/geo_observation.py`：`geo_observation_query` 做 tail/filter；`geo_observations_out` 装载 Products、recorders、superseded state、祖先附件、文章/内容/平台 URL、citations 与 actions；list/detail 共用。
- action projection 当前只让 current manual observation 获得 CORRECT/DELETE；CORRECT 为 ADMIN/ENGINEER，DELETE 为 ADMIN；命令端重新校验。
- Backend 目前无 GEO list integration test。

## V1

- `frontend/src/features/geo-observations/GeoObservationsPage.tsx` 直接消费完整 list DTO，显示文章结果/证据并提供抽屉、创建、更正、删除与显式“查看详情”。
- V1 是业务行为参考，不符合 V2 canonical/detail/action presentation，不能复制。
- 直接替换旧 list response 会造成 runtime break，因此新 compact endpoint 必须 additive。

## Frontend V2

- 可直接复用：`FilterBar`、`TableShell`、`ColumnHeader`、`Pagination`、`RowActions`、`TableSkeletonRows`、`EmptyTable`、反馈组件与现有 table column-role CSS。
- URL/API/table patterns：`content-task-list.model.ts`、Content Task List route/page；Products 与 Published Articles 提供相同 canonical/prefetch/query patterns。
- Actions：`content-task-actions.ts` 和 `RowActions` 证明 token registry、confirmation Dialog、finalFocus pattern。
- 当前无 `geo` domain/route/navigation item。
- generated V2 schema 与 contract 一致地只包含旧 full list operation。

## E2E

- Fixture：`frontend-v2/tests/e2e/fixtures/*.fixture.ts` 显式 route allowlist，未声明业务 API 501 + teardown assertion；业务 spec 在 production build + Vite preview 上运行。
- Responsive：Playwright projects 固定 375/1440，单 spec 循环 768/1024 是既有 pattern。
- Real stack：`deploy/scripts/e2e-local.sh` 是唯一隔离编排，固定运行 Product/Content/Publishing V2 real-stack specs，再运行 V1，最后由根 target 运行 V2 fixture suite。
- 本 Task 只建立 GEO fixture E2E；真实 GEO flow 在 canonical write/detail/correction surfaces 完成后进入独立 checkpoint。

## 规划结论

1. 当前 full `GeoObservationList` 与 compact blueprint 冲突。
2. 新增 `/api/v1/geo-observations/list-items` + `GeoObservationListPage/Item`，保留 V1 原 endpoint。
3. V2 页面可完全复用现有 list primitives，无新 Design System 抽象或 CSS 方案。
4. URL/API mapping 只有一套，详见 PRD R4。
5. Detail/Correction 只输出 canonical anchor，不注册占位 route。
6. Required validation 分别证明 contract、PostgreSQL read model、V1 generated compatibility、V2 unit/build 与 production-artifact fixture；完整 suites/真实栈为 optional。
