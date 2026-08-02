# 上线前最终发布候选验收报告

## 1. 当前结论

`NO-GO`。报告于 2026-08-03 01:43:22 +0800 完成质量复核。七项必需门禁与关键页面 smoke 已完成，存在三项阻断发现：`make e2e` 因冻结提交缺失 11 张视觉基线而失败；视觉测试源码对 Prompt、GEO 两张移动截图使用 `maxDiffPixelRatio: 0.035`，违反规范统一 `0.02` 的合同；发布“更多操作 → 标记已移除 → 取消”后焦点落到 `BODY`，未回到原触发器。三项发现归为视觉验收合同和发布回焦两个后续修复组；其余六项门禁与其他 smoke 路径通过，但不能抵消任一阻断。

第 4 节精确清理与最终冻结复核已完成并通过；清理成功不能抵消既有 E2E 与关键交互失败，结论仍为 `NO-GO`。

## 2. 冻结提交

| 项目 | 冻结值 | 结果 |
| --- | --- | --- |
| 取证开始时间 | `2026-08-02 15:55:44 +0800 CST` | PASS |
| 七项门禁跨日复核时间 | `2026-08-03 01:05:06 +0800 CST` | PASS |
| 分支 | `main` | PASS |
| 本地 HEAD | `56ae5ac5b660438c2f8a6adfef6c82005e6136b2` | PASS |
| `origin/main` | `56ae5ac5b660438c2f8a6adfef6c82005e6136b2` | PASS |
| 父提交 | `20108f2326f010bebff683cb29c75078d67cfb25` | 记录 |
| 工作区 | 仅 `?? .trellis/tasks/08-02-pre-release-final-candidate-acceptance/` | PASS |
| `git diff --check` | 退出码 0 | PASS |

冻结提交 `56ae5ac` 新增 9 个 `frontend/.playwright-cli/` 诊断文件并删除 11 张视觉基线；用户已确认该提交不是误提交。本任务原样验收，不恢复、更新或忽略这些变化。

## 3. 工具链、合同与配置指纹

| 项目 | 版本或 SHA-256 |
| --- | --- |
| Python | `3.9.6` |
| Node.js | `v24.16.0` |
| npm | `11.13.0` |
| uv | `0.11.19` |
| Docker | `29.6.1` |
| Docker Compose | `5.3.1` |
| PostgreSQL | `16.14` |
| Redis | `7.4.9` |
| `backend/uv.lock` | `ecb76af9a56b73ae6b48b2ad219318808b0f87d69eaa9e1e39a728c262cc8215` |
| `frontend/package-lock.json` | `2d43ac706843d5ebbf88a8379f4792cfdb98939f3e6813505fc7af64b0a593db` |
| `package-lock.json` | `d865786cee223e81104b362bf43519507ff0e50f6dad5d20e86bba4898eb1bb6` |
| `uv.lock` | `265c7e425b7a5e403233fc74e72014b62ed8024648c77765778a0443912f7a3f` |
| `.env`（仅指纹，未读取或输出内容） | `a41948dc4edb90626b57192e5c2729e11bf279abcb98399e6e5e134fefe24e76` |
| `deploy/compose.dev.yaml` | `d0bd8155acc072fd8c95338d89b87a37ebb5f87994ff5f088a96851a285cd1ea` |
| Compose 解析结果（仅指纹） | `a6f3ce4f9bf001ebbf229ee99b7853d5e5e0d54e4be145372c7c8e3db4dec79c` |
| `contracts/openapi.yaml` | `fa12c152528dea90559aa3bf5580a2a9d43d7c540564c6567b4a981085a4531f` |
| `contracts/database.md` | `2eaecabe192c97552b66fd2f6a4d2991abc0c233fa7dca268feb0d1bba8b96ac` |
| 视觉 E2E 源码 | `7da87b9dadbc3f4633dd126521d4fe51e23fcb3d8051a20b99482d280c482fe6` |

Compose 配置执行 `config --quiet` 退出码为 0。上述指纹只用于结束时判断漂移，不包含配置明文。

## 4. 迁移与开发服务基线

- Alembic current：`0033_task_owned_history_delete (head)`。
- Alembic heads：唯一 `0033_task_owned_history_delete (head)`。
- 当前没有遗留名称匹配 `^partsignal_e2e_[0-9]{8}_[0-9]+$` 的数据库。

| 服务 | 状态 | 健康 | 端口 |
| --- | --- | --- | --- |
| API | running | healthy | `127.0.0.1:18000 -> 8000` |
| Frontend | running | 由真实 HTTP 探针确认 | `127.0.0.1:5173 -> 5173` |
| PostgreSQL | running | healthy | `127.0.0.1:55432 -> 5432` |
| Redis | running | healthy | `127.0.0.1:56379 -> 6379` |
| Worker | running | healthy | 无宿主机端口 |
| Scheduler | running | healthy | 无宿主机端口 |

`fake-oss` 未运行；本轮共享开发 smoke 只读，完整写链使用 `e2e-local.sh` 的独立临时存储，因此当前不启动该范围外服务。若后续只读页面出现真实对象请求失败，按 smoke 实际结果记录，不增加 fallback。

### 4.1 HTTP 与代理探针

| 探针 | HTTP | 结果 |
| --- | ---: | --- |
| API `/api/health/live` | 200 | PASS |
| API `/api/health/ready` | 200 | PASS |
| Frontend `/` | 200 | PASS |
| Frontend 同源 `/api/health/live` | 200 | PASS |
| Frontend 同源 `/api/health/ready` | 200 | PASS |
| Frontend 同源、无 Cookie `/api/v1/auth/me` | 204 | PASS |
| Frontend 容器直连 `http://api:8000/api/health/live` | 200 | PASS |

Frontend 容器运行时 `VITE_API_PROXY_TARGET=http://api:8000`；最近 30 分钟前端代理 `ECONNREFUSED/proxy error` 命中 0 条，API `Traceback/ERROR/FATAL` 命中 0 条。

## 5. Playwright 与视觉资产执行前清单

| 项目 | 执行前状态 |
| --- | --- |
| 根 `.playwright-cli/` 文件 | 0 |
| `frontend/.playwright-cli/` 文件 | 35，全部已跟踪 |
| 已跟踪诊断路径清单 SHA-256 | `fc291aef33612071968bf56449636f1ffebec482ea98c17e6026342110e0a193` |
| 已跟踪视觉基线 | 0 |
| 实际视觉基线 | 0 |
| `partsignal-e2e-storage.*` 临时目录 | 0 |

执行前已存在以下内存浏览器会话，均不属于本任务，后续不得关闭或删除：

- `default`：open / chrome / in-memory / headless。
- `obs`：open / chrome / in-memory / headless。
- `visualanchors`：open / chrome / in-memory / headless。

本任务计划使用的 `rc-final-20260802` 尚不存在。

### 5.1 冻结提交已跟踪诊断文件

```text
frontend/.playwright-cli/console-2026-07-19T13-19-41-116Z.log
frontend/.playwright-cli/console-2026-07-19T13-22-00-103Z.log
frontend/.playwright-cli/console-2026-07-22T14-12-56-799Z.log
frontend/.playwright-cli/console-2026-07-22T14-13-40-026Z.log
frontend/.playwright-cli/console-2026-07-22T14-28-53-485Z.log
frontend/.playwright-cli/console-2026-07-22T14-29-31-753Z.log
frontend/.playwright-cli/console-2026-07-31T07-55-01-445Z.log
frontend/.playwright-cli/console-2026-07-31T07-55-42-160Z.log
frontend/.playwright-cli/console-2026-08-01T08-31-13-275Z.log
frontend/.playwright-cli/page-2026-07-19T13-19-13-826Z.yml
frontend/.playwright-cli/page-2026-07-19T13-19-41-487Z.yml
frontend/.playwright-cli/page-2026-07-19T13-19-49-384Z.yml
frontend/.playwright-cli/page-2026-07-19T13-22-00-146Z.yml
frontend/.playwright-cli/page-2026-07-22T14-12-57-078Z.yml
frontend/.playwright-cli/page-2026-07-22T14-13-25-132Z.yml
frontend/.playwright-cli/page-2026-07-22T14-13-40-157Z.yml
frontend/.playwright-cli/page-2026-07-22T14-14-03-395Z.yml
frontend/.playwright-cli/page-2026-07-22T14-16-26-132Z.yml
frontend/.playwright-cli/page-2026-07-22T14-17-49-995Z.yml
frontend/.playwright-cli/page-2026-07-22T14-28-42-601Z.yml
frontend/.playwright-cli/page-2026-07-22T14-28-53-618Z.yml
frontend/.playwright-cli/page-2026-07-22T14-29-04-040Z.yml
frontend/.playwright-cli/page-2026-07-22T14-29-31-860Z.yml
frontend/.playwright-cli/page-2026-07-22T14-29-50-157Z.yml
frontend/.playwright-cli/page-2026-07-22T14-29-57-547Z.yml
frontend/.playwright-cli/page-2026-07-22T14-30-03-204Z.yml
frontend/.playwright-cli/page-2026-07-22T14-30-09-181Z.yml
frontend/.playwright-cli/page-2026-07-22T14-39-26-357Z.yml
frontend/.playwright-cli/page-2026-07-22T14-39-37-294Z.yml
frontend/.playwright-cli/page-2026-07-31T07-55-00-064Z.yml
frontend/.playwright-cli/page-2026-07-31T07-55-01-618Z.yml
frontend/.playwright-cli/page-2026-07-31T07-55-42-291Z.yml
frontend/.playwright-cli/page-2026-07-31T08-12-50-648Z.png
frontend/.playwright-cli/page-2026-07-31T08-13-07-047Z.yml
frontend/.playwright-cli/page-2026-08-01T08-31-13-368Z.yml
```

## 6. 正式门禁矩阵

| 顺序 | 门禁 | 开始—结束（北京时间） | 耗时 | 退出码 | 结果 |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | `make contract-check` | 01:05:45—01:05:47 | 2 秒 | 0 | PASS；FastAPI/OpenAPI 语义与前端生成类型一致 |
| 2 | `make test-unit` | 01:05:56—01:10:16 | 260 秒 | 0 | PASS；141 + 185 + 24 = 350 通过，0 失败、0 跳过 |
| 3 | `make test-integration` | 01:10:28—01:12:01 | 93 秒 | 0 | PASS；70 通过，0 失败、0 跳过 |
| 4 | `make e2e` | 01:14:20—01:19:39 | 319 秒 | 2 | FAIL；51 通过、1 失败，0 跳过 |
| 5 | `make lint` | 01:20:38—01:20:42 | 4 秒 | 0 | PASS；Ruff、ESLint、主题颜色扫描通过 |
| 6 | `make typecheck` | 01:20:47—01:20:50 | 3 秒 | 0 | PASS；mypy 68 个源文件与 TypeScript 通过 |
| 7 | `make build` | 01:20:57—01:21:13 | 16 秒 | 0 | PASS；后端与前端生产镜像构建通过 |

`contract-check` 首次执行的两个底层检查均已成功，但外层取时脚本误用了 zsh 只读变量 `status`，导致证据包装器退出 1；改用 `gate_exit` 后仅为取得可信退出码重新执行同一命令，上表记录第二次完整结果。该事件不是产品门禁失败。

### 6.1 E2E 首个失败与清理

唯一运行失败：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:446`，“九张代表页基线与 Dashboard、内容审核桌面锚点可重复”。Playwright 报告 11 个预期快照不存在并写出 actual；这与冻结提交 `56ae5ac` 有意删除 11 张视觉基线的状态一致。本任务未传 `--update-snapshots`、未修改源码阈值、未增加 fallback，也未把 actual 认可为基线。

质量复核另发现同一测试源码的静态合同不一致：桌面六张、用户移动一张及两张桌面锚点使用 `0.02`，但 Prompt 与 GEO 的移动截图通过条件表达式使用 `0.035`。`.trellis/spec/frontend/visual-system.md` 明确规定 11 张截图固定使用 `maxDiffPixelRatio: 0.02` 且不得扩大阈值；源码旁关于字体换行的注释不能覆盖该权威合同。缺失基线使本轮尚未进入有效像素比较，因此该差异是独立的静态阻断证据，不是本次运行产生的第二个 Playwright 失败计数。

- 本轮数据库：`partsignal_e2e_20260803_36787`，脚本报告 `status=deleted`，结束后实际不存在。
- 本轮临时对象存储：`partsignal-e2e-storage.lsmQMu`，脚本报告 `status=deleted`，结束后实际不存在。
- 共享开发 Redis DB 0：`celery` 队列 0，`unacked*` 键 0。
- API、Frontend、Worker、Scheduler 已恢复；同源 live/ready 为 200，匿名 `auth/me` 为 204。
- `partsignal_e2e_stage3` 与 `partsignal_e2e_table_display` 为执行前既有、且不匹配本轮时间戳命名规则的数据库，未删除、未改动。

E2E 新生成的 11 个未跟踪 actual 文件已记录 SHA-256，并已在第 4 节按完整路径精确清理：

```text
a254a1dcfedf3d0d24342cd66ff6649ddcfd5307b30842eb7f9ee0c71ed4727d  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png
c007102426a341daf9f27e99c76729e5b8b5f9e3644942188aa6825bf58b448d  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png
d1f24af12c8211feb71825b1d33144898d5497847021cdd97897533bf94f6264  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/geo-insights-dark-1440x1000.png
16136feb57248b5b19b62c83d4289184b54f7566a8bcfdcd58f583d93ef36bc7  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/geo-insights-light-1440x1000.png
6650812cd9071a8c33b6532acfa8fa6584ce70d7bee7c4a05891a7b7ad2d4d00  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/geo-insights-light-375x900.png
5b04d24ac8fa146530260fe8509f6257dc68ccef9a00b95400b6591c6da7a4d7  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/prompts-dark-1440x1000.png
3a55d8889ea4eeb0c911c4367baf524b735ee6d7b35ead962a7b39bd8d800be3  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/prompts-light-1440x1000.png
1e1e446a8a551289a9ccd230cd91ab56bc32bc15a05d159d533d1075d70a11ff  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/prompts-light-375x900.png
cdf93177df630ce85f849f362fbdfb0ddc10ba571d77405fd5b21026e5a75fcf  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/users-dark-1440x1000.png
e4db99f21ca8cd26ab372fd01d3f4e6f5df58f034a2217f4050390923637be35  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/users-light-1440x1000.png
4f1eca9a6e2d8130bb1c1860f80c2de5b77288383c5a6f225abfa6592d4eab06  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/users-light-375x900.png
```

## 7. 关键页面 smoke

使用命名内存会话 `rc-final-20260802`、真实同源 API、无 route、无 storage state。凭据只读入浏览器进程内存，未输出或落盘；仅执行登录、导航、筛选、打开/关闭和读取，未写共享业务数据。

| 编号 | 范围 | 结果 | 证据摘要 |
| --- | --- | --- | --- |
| S0 | 匿名登录与保护边界 | PASS | `/login` 页面身份、表单和 204 会话探针正常；匿名访问受保护入口回到 `/login`；管理员登录成功 |
| S1 | 工作台 | PASS | `1440×900` 与 `390×844` 页面身份正确，无页面级横向溢出 |
| S2 | 产品/事实 | PASS | 列表及首个真实详情可达，主要内容存在，无失败请求或 console 异常 |
| S3 | 内容任务 | PASS | 列表及首个真实详情可达，region/表格存在，无失败请求或 console 异常 |
| S4 | 发布 | FAIL | 候选与记录 Drawer 直接关闭均回焦；菜单操作取消后焦点落到 `BODY`，违反必须回原触发器的条件 |
| S5 | GEO | PASS | 观测与分析洞察页面身份、region/表格或真实空态正常；移动端主操作可达，无页面级横向溢出 |
| S6 | AI 与 Prompt | PASS | AI 渠道/详情及 Prompt 页面可达，无失败请求或 console 异常 |
| S7 | 用户与审计 | PASS | 用户、审计列表可达；审计详情关闭后回到原“查看日志详情”按钮 |
| S8 | 移动关键页 | PASS | 登录、工作台、发布、GEO 在 `390×844` 主操作可达；发布 Drawer 可关闭；页面级横向溢出均为 false |

桌面扫描覆盖 `/`、`/products`、首个 `/products/:id`、`/tasks`、首个 `/tasks/:id`、`/publications`、`/observations`、`/observations/insights`、`/configuration/ai`、`/configuration/prompts`、`/users`、`/audit`。逐页捕获 console error/warning、请求失败及 HTTP 4xx/5xx，结果均为空；匿名 `auth/me` 的 204 为预期协议结果。

### 7.1 焦点链结果

| 交互 | 关闭/取消后的活动元素 | 结果 |
| --- | --- | --- |
| 候选 Drawer 直接关闭 | `准备人工发布` | PASS |
| 记录 Drawer 直接关闭 | `查看记录` | PASS |
| 发布更多菜单进入操作后取消 | `BODY` | FAIL |
| 取消后再直接关闭记录 Drawer | 原 `更多操作：…` 按钮 | PASS；不能抵消取消时已发生的失败 |
| 审计详情关闭 | 原 `查看日志详情：…` 按钮 | PASS |

## 8. 当前清理状态

- 命名浏览器会话 `rc-final-20260802` 已关闭；内存会话无持久用户数据。既有 `default`、`obs`、`visualanchors` 仍为 open，未触碰。
- 根 `.playwright-cli/` 本轮生成的 27 个未跟踪文件（7 个 console 日志、20 个页面快照）已按完整路径删除，空目录已移除。
- E2E 生成的 11 个未跟踪 actual 文件已在校验上方路径与 SHA-256 后逐文件删除，空快照目录已移除；未恢复或生成替代基线。
- 本轮时间戳数据库、临时对象存储、Redis `celery` 队列和 `unacked*` 键均为空。

### 8.1 最终冻结复核

复核时间：`2026-08-03 01:34:20 +0800 CST`。

| 项目 | 最终结果 |
| --- | --- |
| 分支 | `main`，PASS |
| HEAD / origin/main | 均为 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2`，PASS |
| 已跟踪与暂存差异 | 均为 0，PASS |
| 依赖锁、`.env`、Compose、合同、视觉 E2E 源码指纹 | 与第 3 节逐项一致，PASS |
| Compose 解析 | 退出码 0；SHA-256 仍为 `a6f3ce4f9bf001ebbf229ee99b7853d5e5e0d54e4be145372c7c8e3db4dec79c` |
| Alembic current / heads | 均为唯一 `0033_task_owned_history_delete (head)`，PASS |
| HTTP | API live/ready、Frontend `/`、同源 live/ready 均为 200；匿名 `auth/me` 为 204 |
| 服务 | API、PostgreSQL、Redis、Worker、Scheduler healthy；Frontend 由真实 HTTP 探针确认 |
| 恢复后日志 | Frontend 代理、API、Worker、Scheduler 异常命中均为 0 |
| 浏览器会话 | 本轮会话不存在；三个执行前既有会话保持 open |
| Git 工作区 | 仅当前任务目录的 `design.md`、`implement.md`、`prd.md`、`report.md`、`task.json` |
| 格式检查 | `git diff --check` 退出码 0；任务文件行尾空白 0 |

关键页面 smoke：`FAIL`。最终清理与冻结复核：`PASS`。最终发布候选结论：`NO-GO`。

## 9. 二元判定

| 判定输入 | 结果 | 判定依据 |
| --- | --- | --- |
| 冻结状态无漂移 | PASS | HEAD、`origin/main`、合同、依赖锁、Compose、迁移头与视觉测试源码均保持冻结值 |
| 七项必需门禁全部通过 | FAIL | 6 项 PASS；`make e2e` 退出码 2，51 通过、1 失败 |
| 关键页面 smoke 全部通过 | FAIL | S0–S3、S5–S8 PASS；S4 发布取消回焦 FAIL |
| 视觉规范与验收源码一致 | FAIL | Prompt、GEO 移动截图使用 `0.035`，权威规范要求 11 张统一 `0.02` |
| 清理完成 | PASS | 本轮数据库、临时存储、浏览器会话、诊断文件和 actual 截图均已精确清理 |
| 无其他未解释阻断异常 | PASS | 除上述三项发现外，未观测到额外 console、网络、代理或服务异常 |

按 `design.md` 的机械判定算法，任一必需门禁或关键 smoke 失败即为 `NO-GO`；视觉验收源码与权威规范不一致又构成额外发布阻断。因此，冻结提交 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2` 不满足进入部署的发布门禁；历史绿色结果、其他门禁通过或清理成功均不能覆盖当前发现。

## 10. 未覆盖项与残余风险

### 10.1 已执行但未形成通过证据

- 11 张视觉基线缺失，视觉 E2E 无法完成预期图与实际图比较；当前候选相对已批准视觉资产是否漂移仍未得到通过证据。
- Prompt、GEO 移动视觉比较阈值为 `0.035`，高于权威规范 `0.02`；即使补回基线，现有源码仍可能放过超过规范上限的视觉差异。
- 发布菜单确认取消后焦点落到 `BODY`，键盘用户会丢失操作上下文；本轮只验证了代表性发布链，不能据此证明其他同类确认链均不存在相同问题。

### 10.2 明确未覆盖

- 未部署生产或预发布环境，未验证 DNS、Nginx、TLS、生产配置和生产数据迁移。
- 未调用真实第三方 AI、真实生产 OSS 或真实第三方发布渠道。
- 未执行性能、容量、稳定性、渗透测试或生产级灾难恢复演练。
- 浏览器部分是关键页面只读 smoke，不替代第二轮全量人工业务验收，也不覆盖所有角色、所有写操作和所有边界组合。

以上未覆盖项不得解释为通过；即使两个当前阻断修复，下一次发布候选报告也只能对其明确执行的范围负责。

## 11. 最小后续任务建议

本轮两个阻断没有共同实现根因，应拆为两个独立修复任务；本报告不创建、不实施：

1. **视觉基线与测试合同一致性恢复**：核对人工批准清单、视觉规范、视觉 E2E 源码与 11 张基线的权威关系；只有取得对应视觉批准后才能恢复或更新资产，并将 11 张截图统一执行规范规定的 `0.02` 阈值。若确需阈值例外，必须另行评审权威规范，不能由测试源码注释自行放宽。验收以新冻结提交上源码与规范一致、`make e2e` 不再出现缺失基线且完整套件零失败为准。
2. **发布确认取消回焦修复**：追踪 Dropdown、确认层与原触发器之间的焦点所有权，在共享所有者存在时只修复一次；补充“更多操作 → 标记已移除 → 取消”及适用同类链的回归，真实浏览器取消后必须回到原 `更多操作：…` 触发器。

完成上述修复后必须形成新的冻结提交，重新运行本任务的七项门禁、关键页面 smoke、清理与冻结复核；不得在当前报告上直接改写为 `GO`。
