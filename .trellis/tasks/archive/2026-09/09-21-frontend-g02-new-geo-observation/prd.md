# G02 新建 GEO 观测

## Goal

验收 `/geo/observations/new` 的权威候选、逐篇显式事实、证据上传、脏草稿保护、冲突恢复和创建后的 canonical ID 交接。

## Requirements

- 前置 G01、F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.2 节、`05-business-actions-state-and-api-contract.md` New GeoObservation、`08-testing-quality-and-acceptance.md` 第 13.8 节、`11-frontend-redevelopment-task-list.md` G02 与 `contracts/openapi.yaml`。
- Product 使用服务端搜索，Query Topic 读取权威集合；选择 Product 后只读取该产品完整合格 Published Article 候选。逐篇 `discovered`、`mentioned` 必须由用户显式选择，`accuracy` 可未判断；创建 payload 不提交 legacy 字段或 `supersedes_id`。
- 截图先经过 upload-intent、对象存储传输、complete，完成后的 FileRecord ID 才进入创建 payload；失败可诊断并可按合同重试。
- 表单保存用户未提交输入，DirtyGuard 覆盖路由和页面离开；同步提交锁与 pending 禁用阻止双 POST。`GEO_PUBLICATIONS_CHANGED` 只在用户显式刷新候选成功后合并仍有效逐篇输入，刷新失败保留冻结和草稿，绝不自动 replay。
- POST 201 后使用响应 ID 进入 canonical Detail，失效 GEO List/Insights、Topic list-items 与对应 Product Detail；后续查询失败不能把已成功的创建当成可重试 POST。

## Acceptance Criteria

- [x] 当前候选的 Product/Topic/Article 读取、loading/empty/error/retry、URL handoff、逐篇显式事实及严格 payload 验收。
- [x] 三阶段证据上传、客户端和结构化服务端错误、DirtyGuard、单次 POST、409 显式刷新及成功 ID handoff 经直接测试和移动/桌面 production preview 验收。
- [x] 记录实际代码、验证、独立复核、残余风险和 G03 下一步。

## Notes

- 不改变 GEO 持久化或创建协议；根合同由主代理维护。G08 再验收完整真实服务闭环，本项 fixture 结果不替代 G08。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`new-geo-observation-page.tsx` 在表单、上传、候选查询和 POST 之间建立提交门禁。候选读取中/失败不可提交；提交时再次读取当前 Product 的精确候选 Query 状态，并核对逐篇 Article ID。409 后只有同一 Product 的显式成功刷新才按 ID 合并事实并解除冻结；失败保留草稿和 request ID。POST 201 后立即保留 canonical ID、重置 DirtyGuard、锁定编辑与二次 POST 并进入 Detail；缓存失效不延迟交接。
- 上传：`geo-evidence-upload.tsx` 的 controller 由新建页拥有，视图跨 1280px 重挂载时保留 upload intent 与 complete 状态。上传中/待校验阻止创建并触发离开保护；complete 失败可重试或放弃，abort 失败保持阻塞。完成附件按最新集合合并，已移除 ID 不会被旧回调恢复。既有 Correction 包装接口保持可用。
- 测试：新增 `new-geo-observation-page.test.tsx`，扩充 upload 组件测试、严格 fixture 和 `new-geo-observation.spec.ts`。四个直接文件 21/21；既有 Correction 页面兼容 5/5。最终 production preview 浏览器移动/桌面 18/18，覆盖 direct/refresh/Back/Forward、候选 loading/empty、显式事实、上传 complete 悬停跨布局、空白表单上传离开保护、单次 POST、409 刷新及响应 ID Detail handoff；四档根宽度无溢出。初次浏览器基线 12/14，两例仅为过期面包屑断言（页面为“新建观测”），测试文案修正后全量通过。
- `npm run typecheck`、production build（由 Playwright webServer 执行）、修改文件定向 ESLint、`git diff --check` 通过；构建仅有既有大 chunk 提示。独立只读高风险复核先发现空白表单上传时离开保护缺口，修复后再次核对确认关闭，未发现新阻断。
- 剩余覆盖缺口：候选删除或重排后的真实 RHF 字段绑定、显式刷新悬停时切换 Product、intent/transfer 阶段跨布局未分别有自动化场景；现有按 ID 合并、Product query key/身份复核及页面级上传 owner 已覆盖实现路径。G02 fixture 不替代 G08 真实栈。下一步 G03 观测详情。
