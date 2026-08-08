# 实施计划

## 精确文件范围

计划新增：

- `frontend-v2/src/design-system/data-table/types.ts`
- `frontend-v2/src/design-system/data-table/table-shell.tsx`
- `frontend-v2/src/design-system/data-table/table-toolbar.tsx`
- `frontend-v2/src/design-system/data-table/filter-bar.tsx`
- `frontend-v2/src/design-system/data-table/column-header.tsx`
- `frontend-v2/src/design-system/data-table/table-pagination.tsx`
- `frontend-v2/src/design-system/data-table/row-actions.tsx`
- `frontend-v2/src/design-system/data-table/bulk-action-bar.tsx`
- `frontend-v2/src/design-system/data-table/empty-table.tsx`
- `frontend-v2/src/design-system/data-table/table-skeleton.tsx`
- `frontend-v2/src/design-system/data-table/server-table.demo.tsx`
- `frontend-v2/src/design-system/data-table/table-kit.stories.tsx`
- `frontend-v2/src/design-system/data-table/table-kit.test.tsx`

计划修改：

- `frontend-v2/package.json`
- `frontend-v2/package-lock.json`
- `frontend-v2/src/styles/global.css`
- `.trellis/tasks/08-09-frontend-v2-table-kit/{task.json,prd.md,design.md,implement.md}`

不创建 `index.ts`、生产 demo route、Checkbox primitive、通用 data hook、search schema、action registry 或 Playwright Test 文件；现有 `.storybook` 与 Vitest 配置不修改。上述范围以外文件默认禁止修改。

## 实施顺序

1. 重新确认本地 `main` 干净且包含 App Shell 修复；本地领先 origin 时保持现状。
2. 从本地 `main` 创建并切换到 `codex/frontend-v2-table-kit`，再运行 `task.py start frontend-v2-table-kit`。
3. 使用 `trellis-before-dev` 读取任务文档和适用 frontend specs。
4. 安装唯一新依赖 `@tanstack/react-table`，只接受 npm 写入的 package/lock 结果。
5. 实现公共类型、TableShell、ColumnHeader 和 role/responsive CSS，固定 144px action zone。
6. 实现受控 FilterBar、Toolbar 和 Pagination，不接入 Router、Query 或 domain。
7. 使用现有 primitives 实现 RowActions、BulkActionBar、EmptyTable 和 TableSkeleton。
8. 实现仅供 story/test 导入的 controlled demo server table；fixture 逻辑不抽成 adapter/hook。
9. 补齐 component tests 与 Storybook 场景，运行必需验证。
10. 使用命名 `playwright-cli` session 完成视觉和键盘 QA，关闭并确认 session 清理。
11. 执行 `trellis-check`、spec 更新评估、最终 diff 与范围审计；报告结果和 commit plan，等待确认。

## Storybook 场景

- `Empty`：0 rows、无筛选。
- `FilteredEmpty`：0 rows、存在搜索/筛选条件。
- `SingleRow`：1 row、普通对象链接、一个 Primary 和 overflow。
- `ServerControlled50Rows`：50 rows，受控 sort/filter/page/selection。
- `Loading`：稳定 skeleton rows。
- `Error`：显式错误，不回退为空表或假数据。
- `LongTitle`：主列超长文本仍保持行高和局部溢出。
- `OnlyOverflow`：无 Primary，仅更多菜单。
- `NoAction`：144px action zone 保留但无交互控件。
- `DisabledAndDestructive`：可解释 disabled 与确认后才执行 danger command。
- `Narrow375`：高优先级列和受控局部横向滚动。

## 测试矩阵

- TableShell：region/table 语义、可访问名称、焦点入口、role attributes。
- ColumnHeader：不可排序、升序、降序、键盘切换和 `aria-sort`。
- FilterBar：受控 value、submit/reset 回调，不产生 Router 或内部 page state。
- Pagination：首末页边界、页大小变更、0 items。
- RowActions：单一 Primary、普通 href、only overflow、no action、菜单键盘、Escape 焦点恢复、disabled reason、danger confirmation、确认前不执行、事件不冒泡。
- BulkActionBar：0 selection 隐藏、计数、clear、secondary command、danger confirmation。
- 状态：loading、empty、filtered empty、error 的语义和文案互不混淆。
- Demo：0/1/50 rows；排序、搜索、分页、selection 全受控；筛选变化回 page 0；long title 不产生页面级溢出。
- 几何、sticky、真实 overflow 和 visible focus 不在 jsdom 伪造，交给浏览器验证。

## 必需验证

```bash
npm --prefix frontend-v2 run test -- src/design-system/data-table/table-kit.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run build-storybook
git diff --check
git diff --exit-code main -- frontend backend contracts Makefile .github deploy
```

最后一条只验证明确禁止范围无变化；`frontend-v2/` 与当前 Trellis Task 文件允许存在预期 diff。

## 可选验证

```bash
npm --prefix frontend-v2 run api:check
make contract-check
make verify
```

仅在证据表明 OpenAPI、共享仓库门禁或旧前端受到影响时运行；默认跳过，因为本 Task 不改 contracts、后端、CI、部署或 V1。

## `playwright-cli` 视觉验证

唯一 session：`frontend-v2-table-kit`。

1. 启动 Storybook并打开 Table Kit stories。
2. resize 至 375、768、1024、1440；断言页面根无横向溢出，TableShell 在需要时满足 `scrollWidth > clientWidth`。
3. 量测 actions header/cell 为 144px，验证 sticky action zone、长标题边界和 `ColumnRole` 响应式可见性。
4. 仅键盘验证搜索、排序、selection、Primary link、overflow menu、disabled reason、danger confirmation 和 pagination；检查 Escape、focus trap 与触发器焦点恢复。
5. 检查 loading、empty、filtered empty、error、only overflow、no action、narrow stories 和浏览器 console。
6. 执行 `playwright-cli -s=frontend-v2-table-kit close`，再用 `playwright-cli list --all --json` 确认该 session 不再 open；不得使用 `close-all` 或 `kill-all`。

## 失败归因与停止条件

- 每个失败先证明由当前 diff 引入且属于本 Task；无影响代码、配置或环境变化时不得重复运行同一失败命令。
- 依赖安装出现 peer/API 不兼容时停止并保留 npm 错误证据；不添加 adapter、第二个表格库或猜测性版本兼容层。
- 若实现必须识别 domain status、业务 action token、真实 URL schema 或 API 数据，则停止并移交 domain Task。
- 若 144px action zone 与 375px 可用性冲突，保留 144px 和 TableShell 局部滚动，不缩小操作区或制造页面级溢出。
- 浏览器 session 无法正常关闭时报告状态并停止；未经用户确认不得全局 kill。
- 最终 diff 出现旧前端、后端、contracts、CI、部署、生产 route 或其他 domain 文件时停止交付并移除越界改动。

## 回滚点

依次保留四个可审计边界：依赖变更；结构/类型；actions/state；demo/story/test。只反向撤销当前 Task 拥有的文件和 package 条目，绝不 reset、回退或覆盖本地 `main`。

## 完成门禁

- 三份规划文档已获用户批准且 task status 为 `in_progress`。
- 所有 PRD 验收项均有自动化或真实浏览器证据。
- 必需验证全部通过，范围审计无越界文件。
- `frontend-v2-table-kit` session 已关闭。
- 完成 `trellis-check` 与 spec 更新必要性评估。
- 仅报告 commit plan；不得 commit、merge、push、archive或开始下一 Task。
