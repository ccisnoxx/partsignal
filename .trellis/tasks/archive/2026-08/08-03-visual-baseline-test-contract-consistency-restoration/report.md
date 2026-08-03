# 视觉基线与测试合同一致性恢复：执行记录

## 1. 第 0～1 节冻结结果

冻结时间：2026-08-03 09:27:07 +0800（北京时间）

### 1.1 Trellis 与 Git

- 开发者：`777`。
- 当前任务：`.trellis/tasks/08-03-visual-baseline-test-contract-consistency-restoration`，来源为当前 Codex 会话。
- 分支：`main`。
- 冻结 HEAD：`484f960e2ed4081d485ce988f72c4d8ea7b84eed`（`chore: record journal`）。
- `origin/main`：`56ae5ac5b660438c2f8a6adfef6c82005e6136b2`；本地相对远端领先 3、落后 0。
- 冻结时工作区只有当前任务目录为未跟踪内容：`prd.md`、`design.md`、`implement.md`、`task.json`；随后仅在同一任务目录新增本执行记录。没有产品代码、测试源码、快照或浏览器诊断产物差异。

### 1.2 服务与端口

| 对象 | 冻结状态 | 证据 |
| --- | --- | --- |
| PostgreSQL | 运行且健康 | Compose `healthy`；`127.0.0.1:55432` 监听；`pg_isready` 返回 accepting connections |
| Redis | 运行且健康 | Compose `healthy`；`127.0.0.1:56379` 监听；`redis-cli ping` 返回 `PONG` |
| Frontend | 运行 | Compose `running`；`http://127.0.0.1:5173` 返回 200 |
| 开发 API | 运行且健康 | Compose `healthy`；宿主机映射端口为 `18000`；直连健康检查返回 200 |
| Frontend `/api` 代理 | 可用 | `http://127.0.0.1:5173/api/health/ready` 返回 200 |
| 隔离 E2E 端口 | 未占用 | `8000`、`4173`、`9001`、`19009` 均无监听进程 |

本节只记录现状，没有启动、重启或停止任何服务；服务就绪不作为后续 E2E 通过证据。

### 1.3 11 个源 blob

- 删除提交：`56ae5ac5b660438c2f8a6adfef6c82005e6136b2`。
- 已验证父提交：`20108f2326f010bebff683cb29c75078d67cfb25`。
- 父提交到删除提交的目标目录差异恰为 11 个删除项，没有新增或修改项。
- 父提交目标目录恰有 11 个 PNG：8 张 1440×1000、3 张 375×900，均为 8-bit RGB、非交错格式。
- 逐项计算的 SHA-256 与 `design.md` 第 3 节清单全部一致；没有缺失、路径后缀错误、尺寸错误或哈希不一致。
- 当前工作区中目标快照目录不存在，符合冻结提交已删除基线的预期；本节没有恢复任何图片。

## 2. 第 2 节恢复结果

恢复时间：2026-08-03 09:30:38 +0800（北京时间）

- 使用 `git restore --source=20108f2326f010bebff683cb29c75078d67cfb25 --worktree -- <11 个显式路径>` 恢复，未恢复整个目录或其他提交内容。
- 目标目录恰有 11 个文件，路径集合与源提交完全一致：8 张 1440×1000、3 张 375×900。
- 工作区文件的 SHA-256 全部与 `design.md` 第 3 节一致；`git hash-object` 也逐项等于源提交的 Git blob 对象。
- `cross-page-visual-convergence.spec.ts` 未修改；本节没有运行 `--update-snapshots`、Playwright 或 E2E。
- `frontend/.playwright-cli/` 是冻结 HEAD 已有的受版本控制目录，本轮差异为 0；根目录 `.playwright-cli/`、其他快照和产品文件均未恢复或修改。

## 3. 第 3 节阈值合同结果

完成时间：2026-08-03 09:33:24 +0800（北京时间）

- `cross-page-visual-convergence.spec.ts` 的移动代表页截图已从按页面选择 `0.02` / `0.035` 改为固定 `maxDiffPixelRatio: 0.02`。
- 删除了只为 Prompt/GEO 放宽阈值服务的 Chromium 字体换行注释；没有新增常量、兼容分支或抽象。
- 静态扫描确认测试源码不含 `0.035` 或按页面阈值条件；三个截图断言块均使用 `0.02`，共同覆盖固定的 11 张基线。
- 截图名称、视口、主题、遮罩、动画、光标、测试名称和 Playwright 配置均未修改。
- `npm --prefix frontend run lint`：通过，耗时 3.95 秒。
- `npm --prefix frontend run typecheck`：通过，耗时 3.02 秒。
- `git diff --check`：通过。目标视觉 E2E 按批准边界留到第 4 节，本节未运行。

## 4. 第 4 节目标视觉用例结果

完成时间：2026-08-03 09:43:18 +0800（北京时间）

- 运行了 `implement.md` 指定的目标视觉命令，并额外设置 `PLAYWRIGHT_HTML_OPEN=never`；没有传入 `--update-snapshots`。
- 首次执行在视觉断言前被环境竞争阻断：开发 Compose `worker` 与隔离 worker 共用 Redis broker，前者消费了隔离任务后在开发数据库中记录“生成作业不存在”，导致共享数据准备的作业在 30 秒内一直为 `PENDING`。该次结果为 `1 failed / 1 did not run`，命令耗时 38.53 秒；没有产生截图差异，隔离数据库 `partsignal_e2e_20260803_45868` 和临时对象存储均输出 `status=deleted`。
- 停止开发 Compose 的 `frontend`、`worker`、`scheduler` 后，Redis `celery` 队列长度为 0；随后不改代码、阈值或基线，原命令重跑通过。
- 有效隔离执行结果：共享数据准备 1.8 秒，目标视觉用例 9.4 秒；Playwright 合计 `2 passed / 0 failed / 0 skipped`，耗时 11.8 秒，命令总耗时 19.58 秒。
- 11 张截图均满足固定 `maxDiffPixelRatio: 0.02`；没有 expected/actual/diff 候选、报批项或快照更新。
- 隔离数据库 `partsignal_e2e_20260803_46128` 与临时对象存储均输出 `status=deleted`；复核后只剩执行前已存在的 `partsignal_e2e_stage3`、`partsignal_e2e_table_display`，临时对象存储目录无残留，`8000`、`4173`、`9001`、`19009` 均已释放。
- 开发 Compose 的 `frontend`、`worker`、`scheduler` 已恢复；Frontend 页面和 `/api/health/ready` 均返回 200，worker 与 scheduler 均恢复为 `healthy`。

## 5. 第 5 节完整 E2E 结果

完成时间：2026-08-03 09:59:27 +0800（北京时间）

- 运行了 `implement.md` 指定的 `make e2e`，并额外设置 `PLAYWRIGHT_HTML_OPEN=never`；没有传入 `--update-snapshots`。
- 为避免第 4 节已确认的共享 Redis 消费竞争，运行前停止开发 Compose 的 `frontend`、`worker`、`scheduler`，并确认 Redis `celery` 队列长度为 0；没有修改产品、测试、配置、阈值或基线。
- Playwright 结果为 `52 passed / 0 failed / 0 skipped`，耗时 5.1 分钟；命令总耗时 314.88 秒，没有首个失败或独立失败。
- 完整套件覆盖 Firefox、WebKit、Chromium 的兼容性、CSP、视觉基线、24 张业务表边界、200% 缩放、键盘焦点、业务状态及主流程；目标视觉用例在完整套件中再次通过，耗时 9.6 秒。
- 隔离数据库 `partsignal_e2e_20260803_47013` 与临时对象存储均输出 `status=deleted`。复核后仍只存在运行前已有的 `partsignal_e2e_stage3`、`partsignal_e2e_table_display`；没有临时对象存储目录残留，`8000`、`4173`、`9001`、`19009` 均已释放。
- 开发 Compose 的 `frontend`、`worker`、`scheduler` 已恢复；Frontend 页面和 `/api/health/ready` 均返回 200，worker 与 scheduler 均为 `healthy`。
- `frontend/test-results`、`frontend/playwright-report`、根目录 `.playwright-cli/` 与 `frontend/.playwright-cli/` 没有 Git 状态差异；精确清理和最终差异复核留到第 6 节执行。

## 6. 第 6 节清理与质量复核结果

复核时间：2026-08-03 10:10:34 +0800（北京时间）

- 本轮 `frontend/test-results` 与 `frontend/playwright-report` 共 38 个可再生文件，分别约 7.8 MB、668 KB，已精确移入系统废纸篓，可恢复；根目录 `.playwright-cli/` 不存在，没有本轮工具诊断产物需要清理。
- `frontend/.playwright-cli/` 全部是冻结 HEAD 已有的受版本控制证据，本轮保持原样，没有删除或修改。
- `git diff --check` 通过；受版本控制源码差异只有 `cross-page-visual-convergence.spec.ts` 的固定 `0.02` 修正，统计为 `1 file changed, 1 insertion(+), 2 deletions(-)`。
- 最终工作区路径边界只有当前任务目录、上述测试源码和目标快照目录中的 11 张 PNG；没有产品 TSX/CSS、主题、API、合同、数据库、迁移、权限、业务行为、部署脚本、Playwright 配置、其他快照或浏览器诊断差异。
- 11 张 PNG 的路径集合、8 张 1440×1000 与 3 张 375×900 的尺寸、SHA-256 均再次与 `design.md` 清单完全一致。
- `trellis-check` 复核通过：任务文档与 `visual-system.md` 合同一致；测试源码没有 `0.035`、调试日志、警告抑制或类型绕过；既有 lint、typecheck、目标视觉 E2E 与完整 E2E 均在本轮修改后通过，无需重复执行。
- 本任务没有引入新的视觉规则，`visual-system.md` 已完整表达 11 张基线与固定 `0.02` 合同，因此不产生重复规范差异。第 4 节记录的共享 Redis 消费竞争属于隔离运行环境风险，不扩大本视觉恢复任务的修改边界。

## 7. 第 7 节最终报告与提交边界

报告编制时间：2026-08-03 10:12:08 +0800（北京时间）

### 7.1 最终验收结论

本任务结论为 **GO（允许提交）**：AC1～AC7 全部通过，视觉基线资产、固定阈值合同、目标视觉用例、完整 E2E、静态质量和清理边界均满足批准方案。该结论只代表本视觉恢复任务可以提交，不替代新冻结提交上的上线前最终发布候选验收。

### 7.2 资产来源与最终 SHA-256

11 张基线均精确来自 Git 提交 `20108f2326f010bebff683cb29c75078d67cfb25`，未使用运行生成的 actual 或 `--update-snapshots`：

| 文件名 | SHA-256 |
| --- | --- |
| `content-review-light-1440x1000.png` | `d476bf23fdaec3b66ad5a747a957b9905722bf2b527da89fa667290eeeb2b68e` |
| `dashboard-light-1440x1000.png` | `c007102426a341daf9f27e99c76729e5b8b5f9e3644942188aa6825bf58b448d` |
| `geo-insights-dark-1440x1000.png` | `06650ab9935e12dba095f67a6b4be65b14d243c392b645ba0a044335ef95010b` |
| `geo-insights-light-1440x1000.png` | `3a5d690dae3c8dd8a6d1a971c7713172445be7642ca6a626e5b675c523b56ad7` |
| `geo-insights-light-375x900.png` | `c082f74b299b01c7159558040f73c5b910a6618acccf430a2c8b4b4bd914d6aa` |
| `prompts-dark-1440x1000.png` | `caf31322293ecd64d44fbbc877ca9a7c284e7a2eebf483f1e7a10e65ad4ea815` |
| `prompts-light-1440x1000.png` | `4ae4691e7dfa6dc45620feb806fe374a51556e963d8b1bebc958904987a9f16d` |
| `prompts-light-375x900.png` | `bbb8b82ad66ce91aecbf356a4830e01495e8fb8740f72e64762be10961c18d81` |
| `users-dark-1440x1000.png` | `1383abbccd99256d73d843db75ad3d94760c5c9c75d64b62fb8a749de8775e14` |
| `users-light-1440x1000.png` | `163a96a99fa2062c6e8c8ef1199c111371b757cbf6200d32e11d585075faa365` |
| `users-light-375x900.png` | `467b6409bc1235cac48ec2d99afeaf243ee2ef287a59848fed6f4507eeb32964` |

### 7.3 必需验证汇总

| 验证 | 结果 |
| --- | --- |
| PNG 数量、尺寸、SHA-256 | 通过：11 张；8 张 1440×1000、3 张 375×900；哈希全部匹配 |
| `npm --prefix frontend run lint` | 通过，3.95 秒 |
| `npm --prefix frontend run typecheck` | 通过，3.02 秒 |
| 目标视觉 E2E | 通过：`2 passed / 0 failed / 0 skipped`；命令 19.58 秒 |
| 完整 `make e2e` | 通过：`52 passed / 0 failed / 0 skipped`；命令 314.88 秒 |
| 隔离资源清理 | 通过：本轮数据库与临时对象存储均删除，隔离端口均释放 |
| `git diff --check` / `trellis-check` | 通过；无范围外差异 |

### 7.4 残余风险与后续边界

- 开发 Compose worker 与隔离 worker 共用 Redis broker 时存在任务竞争；本轮通过停止开发 worker、scheduler 和 frontend 后完成有效验证。该问题不影响已取得的零失败结果，但会影响本地 E2E 可重复性，应在后续独立基础设施任务中隔离 broker/queue，并同步 `e2e-isolation.md`。
- 执行前已有的 `partsignal_e2e_stage3`、`partsignal_e2e_table_display` 数据库不属于本任务，按所有权边界保留。
- 当前结论不是发布 GO；提交后必须在新的冻结提交上重跑“上线前最终发布候选验收”的合同、单元、集成、E2E、lint、typecheck、build 和关键页面 smoke。

### 7.5 精确提交计划

允许提交：

- 当前任务目录中的 `prd.md`、`design.md`、`implement.md`、`report.md`、`task.json`；
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 的单一阈值修正；
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/` 下本报告列出的 11 张 PNG。

明确排除 `.playwright-cli/`、`frontend/.playwright-cli/`、`frontend/test-results/`、`frontend/playwright-report/`、未批准候选、产品代码和所有无关文件。提交信息：`test: 恢复视觉基线与测试合同一致性`。用户已确认按此范围提交，不自动 push。
