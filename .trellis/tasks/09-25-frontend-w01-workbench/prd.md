# W01 工作台

## Goal

验收 `/` Workbench 只消费单一服务端 aggregate，并完整呈现六类待办、关注队列、四域健康与 GEO 摘要及 canonical 操作入口。

## Requirements

- 前置 P08、C08、U07、G08、A11、S03 均已按本轮证据完成。权威为 Workbench blueprint、`08-testing-quality-and-acceptance.md`、任务清单 W01、OpenAPI 与数据库合同。
- 页面不得请求或拼接多个业务 endpoint，不在浏览器重算 count、资格、排序、健康状态、rate 或 href；nullable rate 与合法 zero 必须分开显示。
- 覆盖 loading/empty/fatal/retry、键盘顺序、四档响应式、长内容/关注项密度和浏览器 200% 放大下的可用性。
- 复用本轮 P/C/U/G real-stack 的自然状态检查点，不新增重复真实业务命令；当前认证/production artifact 另以本轮测试确认。

## Acceptance Criteria

- [x] model/page 与 PostgreSQL integration 证明 aggregate 映射、身份/顺序、固定查询、角色和错误合同。
- [x] production fixture 证明唯一 Workbench GET、canonical href、四档布局、键盘、empty/error/retry，并取得实际浏览器 200% 放大证据。
- [x] 记录实际代码、验收证据、独立复核、残余风险及 I01 后继；检查 diff/工作树。

## Notes

- 设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- 本项未修改 Workbench 生产文件。`workbench.api.ts` 只请求 `/api/v1/workbench`；page/model 直接消费六类 count、关注队列、四域 health、GEO window/rate 与服务端 href，只做穷尽展示映射、日期和百分比格式化，不重算数量、资格、健康、rate、顺序或链接。
- 当前直接测试 `workbench.model.test.ts` + `workbench-page.test.tsx` 为 2 files / 6 tests；覆盖所有映射、原样 href、nullable 与合法 zero、单次 GET、loading/fatal/request ID/retry/empty。
- 当前 PostgreSQL `test_workbench.py` 为 3/3；覆盖 ADMIN/ENGINEER 共享读取、repeatable-read aggregate、六类真实计数、GEO current-tail rate、稳定 attention 顺序/上限、安全摘要及 dense 数据固定查询次数。
- 当前 production fixture mobile+desktop 为 4/4；strict fixture 只允许 auth/CSRF 与唯一 Workbench GET，拒绝额外业务 API，并覆盖 canonical links、关注顺序、四档 375/768/1024/1440 根无横向溢出、完整 Tab 顺序、loading/error/retry/empty/zero/null。
- 使用本机 Microsoft Edge 打开当前 production artifact 和只读本地 Workbench 响应，浏览器自身 UI 明确显示 `缩放: 200%`。六类 count、关注队列、流程健康和 GEO 摘要均可纵向滚动访问，卡片/文案/操作无可见水平裁切或横向滚动；Tab 后焦点落到“查看事实审核”并显示可见焦点环。验收后已恢复 100%、关闭临时标签与 mock 服务，8000/4174 端口释放。
- P08/C08/U07/G08 本轮 real-stack 自然状态检查点分别保留事实审核、内容审核、发布准备/核验/问题、GEO 当前尾/count/rate 的真实 aggregate、唯一关注项与 canonical href 断言；S03 当前 real-stack 也证明认证后 Workbench 可用。本项未复制这些业务 mutation。
- `git diff --check` 通过，原检出区保持干净。独立只读 review 结论为 **NO BLOCKER**；记录的覆盖限制是四档自动化只测根 overflow、PostgreSQL 未逐条断言所有 href，以及未新增独立 Workbench real-stack spec，这些分别由 200% 实机、strict fixture 与 owner real-stack 检查点补足。W01 已满足 I01 前置。
