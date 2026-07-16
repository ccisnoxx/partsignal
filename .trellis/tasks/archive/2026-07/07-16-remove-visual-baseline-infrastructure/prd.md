# 移除前端视觉基线链路

## 目标

完整移除前端截图式视觉回归基线及其维护链路，避免继续生成、校验或上传视觉快照，同时保留业务中的事实快照、平台类型快照和生成输入快照。

## 已确认事实

- `frontend/tests/e2e/visual-regression.spec.ts-snapshots/` 包含 196 个受 Git 管理的 PNG，约 26 MB，其中 49 个已有未提交更新；用户已明确授权整目录删除。
- `.github/workflows/visual-baselines.yml` 仅生成并上传 Linux 视觉基线，且当前已有一项未提交的分支修改；用户已明确授权删除整个工作流。
- `frontend/tests/e2e/visual-regression.spec.ts` 是仓库内唯一使用 `toHaveScreenshot`、`AxeBuilder` 和 `@axe-core/playwright` 的测试。
- `frontend/test-results/` 是被 `.gitignore` 忽略的本地 Playwright 失败产物，当前约 4.2 MB。
- Playwright 仍被其他功能 E2E 测试使用，不能删除 Playwright 本身或通用 E2E 配置。

## 需求

1. 删除视觉基线 CI 工作流、视觉回归测试文件、全部受管快照 PNG 和现有本地视觉测试产物。
2. 删除 `test:visual` 命令、截图专用 Playwright 配置、只被视觉测试使用的 `@axe-core/playwright` 依赖及锁文件记录。
3. 删除 README 中视觉基线命令、生成方式和快照路径说明；保留主题、人工界面验收和无障碍要求。
4. 保留其余 Playwright 功能 E2E、主题功能测试和通用测试配置。
5. 不修改数据库、OpenAPI、后端、业务快照字段、事实快照/生成快照界面或相关业务测试。
6. 不覆盖或提交 `.trellis/config.yaml`、`AGENTS.md` 及其他无关改动；视觉工作流和 49 个已修改快照因本次明确授权纳入删除范围。
7. 检查其他活跃 Trellis 任务，移除仍会要求视觉回归或恢复快照链路的待办；归档任务记录保持不变。

## 验收标准

- [x] 仓库中不存在 `.github/workflows/visual-baselines.yml`、`frontend/tests/e2e/visual-regression.spec.ts` 和 `frontend/tests/e2e/visual-regression.spec.ts-snapshots/`。
- [x] 本地 `frontend/test-results/` 已删除。
- [x] 活跃前端源码、配置和文档中不再引用 `test:visual`、`visual-regression`、`visual-baselines`、`toHaveScreenshot`、`snapshotPathTemplate` 或 `@axe-core/playwright`。
- [x] `package.json` 与 `package-lock.json` 不再包含 `@axe-core/playwright`，锁文件保持一致。
- [x] `npm run e2e -- --list` 能发现其余 E2E 测试，且不包含视觉回归用例。
- [x] 前端全量单元测试、lint、typecheck 和 build 通过。
- [x] 业务中的 `snapshot`、`platform_type_snapshot`、`input_snapshot` 及对应界面代码保持不变。
- [x] 本任务目标变更不包含 `.trellis/config.yaml`、`AGENTS.md` 或其他无关文件。
- [x] 其他活跃 Trellis 任务没有视觉基线待办或恢复要求；既有研究结果仅作为历史证据保留。

## 范围外

- 不替换为新的截图、视觉测试服务或其他基线机制。
- 不删除 Playwright、功能 E2E、主题功能测试或人工无障碍验收要求。
- 不清理 Trellis 历史任务中对既往视觉基线工作的记录。
