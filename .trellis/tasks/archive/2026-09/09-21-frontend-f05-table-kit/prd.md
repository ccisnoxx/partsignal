# F05 Table Kit 与行操作 Pattern

## Goal

完成清单 F05：在真实消费者上验收 TableShell、FilterBar、Pagination、RowActions 和窄屏表格组合能力。

## Requirements

- 前置：F02 本轮通过。来源：`11` F05、`04` Data Table Kit、`.trellis/spec/frontend/visual-system.md` 与组件规范。
- 共享 Table Kit 只处理通用语义和交互；业务筛选、动作 token 与 URL schema 由 Domain/Route 持有，不创建万能 DataTable。
- 行最多一个 Primary；对象主单元格进入详情；其他动作使用 overflow，危险动作确认；移动端保留关键状态和操作，宽表只在命名 region 内滚动。
- 已有实现可复用；本轮检查 unit/component 和已通过的 Products production artifact 证据，实际缺口只在所属文件内修复。

## Acceptance Criteria

- [x] Table Kit 组件边界与真实 Product 消费者符合上述语义、URL 和响应式合同。
- [x] `table-kit.test.tsx` 直接测试通过；Products List production artifact 的本轮 10/10 证据仍有效（若修改相关代码须重验）。
- [x] 记录实际改动、验证、未覆盖项和 F07/P01 下一步。

## Scope

写入范围仅 `frontend/src/design-system/data-table/`；本任务 Trellis 记录由主代理维护。Product 业务逻辑与 route、其他 Domain、根合同不在本任务修改范围。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`row-actions.tsx` 对同时带 `href` 与 `confirmation` 的 overflow action 显式报错，防止链接绕过确认。`table-kit.test.tsx` 增加此合同边界的直接测试。现有业务调用中，链接无确认，需确认的动作走命令。
- `npm run typecheck` 通过；`table-kit.test.tsx` 12/12 通过；改动后生产 artifact 的 `products-list.spec.ts` 10/10 通过，联合 legacy 路由场景 22/22 通过；`npm run lint`、`git diff --check` 通过。
- 独立只读复核检查实际 diff、类型与 Product、Content、Publication、GEO、配置及 Identity 调用构造，未发现可触发的回归；复核者未另行重跑测试，未穷举生产服务端 projection。
- 下一步：F07 汇总质量入口；P01 在该组件基础上验收产品列表视觉样板。

后续 P01 视觉复核发现 Product 消费者在 375px 把状态留在局部横向滚动区域外；P01 已以页面专属布局和状态摘要补齐，并增加 320/375/768/1024/1440 的可见性断言。F05 原有 10/10 浏览器结果只证明无页面根溢出，没有证明状态首屏可见，这一覆盖缺口以 P01 的新证据关闭。
