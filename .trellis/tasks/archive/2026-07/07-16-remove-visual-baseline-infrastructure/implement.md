# 实施计划

## 1. 删除视觉基线主体

- 删除 `.github/workflows/visual-baselines.yml`。
- 删除 `frontend/tests/e2e/visual-regression.spec.ts`。
- 删除 `frontend/tests/e2e/visual-regression.spec.ts-snapshots/` 中全部 196 个受管 PNG。
- 删除被忽略的本地 `frontend/test-results/`。

## 2. 清理入口、配置和依赖

- 从 `frontend/package.json` 删除 `test:visual`。
- 使用 npm 删除 `@axe-core/playwright` 并同步 `frontend/package-lock.json`。
- 从 `frontend/playwright.config.ts` 删除截图路径模板和截图断言配置。
- 从 `frontend/README.md` 删除视觉基线命令与说明，保留主题和人工无障碍验收内容。

## 3. 边界审计

- 搜索活跃前端与 CI 文件，确认不存在 `test:visual`、`visual-regression`、`visual-baselines`、`toHaveScreenshot`、`snapshotPathTemplate` 和 `@axe-core/playwright`。
- 搜索并确认业务 `snapshot`、`platform_type_snapshot`、`input_snapshot` 的源码和契约文件没有变化。
- 检查 Git 差异，确保 `.trellis/config.yaml`、`AGENTS.md` 和其他无关文件未被本任务改动或纳入后续提交。
- 扫描其他活跃 Trellis 任务，移除视觉回归待办和恢复要求；保留并标注既有研究证据，不修改归档任务。

## 4. 验证

在 `frontend/` 运行：

1. `npm run e2e -- --list`
2. `npm test`
3. `npm run lint`
4. `npm run typecheck`
5. `npm run build`

在仓库根目录运行 `git diff --check`，并检查删除统计与残余引用。

## 5. 完成门禁

- 使用 `trellis-check` 完成质量审计。
- 本任务不产生 `.trellis/spec/` 更新：删除的是一次性测试设施，没有新增可复用契约或编码约定。
- 提交前列出精确提交消息和文件范围，等待用户确认；不得自动提交或推送。

## 回滚点

- 删除和配置清理构成一个原子工作变更；验证失败时先修复残余引用，不恢复半套视觉基线。
- 未提交前可依据 Git 差异逐文件恢复；提交后通过独立 revert 恢复完整链路。

## 验证结果

- `npm run e2e -- --list`：通过，发现 2 个文件中的 5 个功能 E2E 用例，无视觉回归用例。
- `npm test`：通过，35/35。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，仅有既有的大分块提示。
- 残余引用、业务层差异和 `git diff --check`：通过。
- 活跃任务长期边界：已更新 `07-12-frontend-cold-cache-performance` 与 `07-13-configuration-center-navigation` 的可执行约束；归档记录未修改。
