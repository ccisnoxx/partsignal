# 第二轮全项目回归覆盖矩阵

## 1. 冻结信息

| 项目 | 本轮值 | 状态 |
| --- | --- | --- |
| run-id | `E2E-FULL-20260731-R2-01` | PASS |
| 冻结时间 | `2026-07-31 22:49:42 CST` | PASS |
| 分支 | `main` | PASS |
| 提交 | `84f9dc222ff01a68ff38e6407d96acb65e926eeb`（`chore: record journal`） | PASS |
| 工作区 | 无已跟踪修改；保留既有 `.playwright-cli/` 与 `frontend/.playwright-cli/` 未跟踪诊断产物；本任务目录为新建未跟踪文件 | PASS |
| 数据库迁移 | current=`0033_task_owned_history_delete`，head=`0033_task_owned_history_delete` | PASS |
| 主机运行时 | Python `3.9.6`；Node `v24.16.0`；npm `11.13.0` | PASS |
| 项目运行时 | 后端 Python `3.12.13`；Alembic `1.18.5`；Vite `7.3.6`；Playwright `1.61.1` | PASS |
| 容器运行时 | Docker `29.6.1`；Compose `5.3.1` | PASS |
| 前端受支持命令 | `vite --config vite.config.ts --host 0.0.0.0` | PASS |

历史报告只用于确定优先级。除本文件“开发环境门禁”已经实际执行的项目外，后续覆盖均从 `NOT_RUN` 开始。

## 2. 开发环境门禁

| 门禁 | 证据 | 结果 |
| --- | --- | --- |
| PostgreSQL | `pg_isready` 接受连接，迁移 current=head | PASS |
| Redis | `redis-cli ping` 返回 `PONG` | PASS |
| API | Compose `healthy`；直连 `/api/health/live`、`/ready` 均为 200 | PASS |
| Worker / Scheduler | 缺失的开发进程按 Compose 既有定义启动，二者均为 `healthy` | PASS |
| 前端命令 | 容器进程明确使用 `vite.config.ts` | PASS |
| 同源代理（重启前） | `/api/health/live`=200、`/ready`=200、匿名 `/auth/me`=204 | PASS |
| API 登录（重启前） | 同源 `/auth/login`=200，带会话 `/auth/me`=200 | PASS |
| 浏览器登录（重启前） | `playwright-cli` 真实填写登录页后进入 `/`，一级标题为“总览”；dashboard、GEO、products 请求均为 200 | PASS |
| 前端容器重启 | 1 次轮询后根页与同源 health 恢复；启动日志明确加载 Vite `7.3.6` | PASS |
| 同源代理（重启后） | `/api/health/live`=200、`/ready`=200、匿名 `/auth/me`=204、登录=200、会话=200 | PASS |
| 浏览器会话（重启后） | 原浏览器会话 reload 后仍在 `/`，`/auth/me`、CSRF、dashboard、GEO、products 均为 200 | PASS |
| 代理错误日志 | 本次重启后的 `ECONNREFUSED/proxy error` 数量为 0 | PASS |
| 开发对象存储 | `fake-oss` 启动时 `uv` 因容器 DNS/外网依赖下载失败退出；共享开发栈文件上传不能据此判定通过 | BLOCKED |
| 隔离 E2E 登录与清理 | 确认 5173 释放后运行真实登录 setup 与目标用例，`2 passed (2.0s)`；数据库 `partsignal_e2e_20260731_38409` 与临时存储均输出 `status=deleted` | PASS |
| 全量 E2E 后开发环境恢复 | 全量 E2E 前停止开发前端、Worker、Scheduler；结束后代理 ready=200、匿名 `/auth/me`=204，Worker/Scheduler 均为 `healthy` | PASS |

开发对象存储阻断不影响当前代理、认证或隔离 E2E；后续共享开发栈文件流程必须标记为 `BLOCKED`，或改用隔离 E2E 栈取得独立证据。本任务不修复该环境问题。

浏览器登录页 `/favicon.ico` 404 已由独立新会话稳定复现并登记为 `PS-QA2-UI-001`；它不影响代理与登录门禁，但登录路由功能/UI 结论记为 FAIL。

第一次隔离 E2E 尝试因外层壳命令未实际停止 Compose 前端，隔离 Vite 回退到 5174，Playwright 命中 5173，证据无效；该次结果已明确废弃。修正为显式停止 Compose 前端并确认端口释放后才取得上表有效结果，两个尝试的隔离数据库和临时存储均完成精确清理。

## 3. 当前路由清单

`frontend/src/app/App.tsx` 当前包含 31 个 `<Route>` 声明：26 个带 `path`、2 个 `index`、3 个无路径结构/权限路由。去除通配入口并合并 `/configuration` 的 index 后，冻结 26 个功能路径模式；W0～W6 及第 6 节专项已更新所有功能路径结果，通配入口留待全路由 UI/UX 阶段验证。

| # | 路径模式 | 权限/变体 | 主要功能 | 状态 |
| ---: | --- | --- | --- | --- |
| 1 | `/login` | 匿名；已登录访问 | 登录、校验、错误与跳转 | FAIL（`PS-QA2-UI-001`） |
| 2 | `/change-password` | 已登录；强制改密 | 旧密码、新密码、撤销其他会话 | PASS |
| 3 | `/` | ADMIN / ENGINEER | 总览指标、待办、跳转 | PASS |
| 4 | `/products` | ADMIN / ENGINEER | 查询、新增、详情、管理员删除 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 5 | `/products/:productId` | 有效/缺失/无权 ID | 事实工作区、版本、审核、删除 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 6 | `/tasks` | ADMIN / ENGINEER | 查询、新建、取消、删除、详情 | FAIL（`PS-QA-201`） |
| 7 | `/tasks/:taskId` | 有效/缺失/无权 ID | 生成、人工首稿、自然化、版本 | FAIL（`PS-QA2-FUNC-001`） |
| 8 | `/content/:contentVersionId` | 有效/缺失/无权 ID | 编辑、提交、退回、批准、历史 | PASS |
| 9 | `/publications` | ADMIN / ENGINEER；3 个 Tab | 候选、发布记录、异常待办 | FAIL（`PS-QA-201`、`PS-QA2-UI-002`） |
| 10 | `/publications/:publicationId` | 有效/缺失/无权 ID | 发布详情与工作台返回 | FAIL（`PS-QA2-UI-003`） |
| 11 | `/publication-attentions/:attentionId` | 有效/缺失/无权 ID | 异常详情、修复、解决 | PASS |
| 12 | `/publication-attentions/:attentionId/repair` | 有效/缺失/无权 ID | 修复任务创建上下文 | FAIL（`PS-QA2-FUNC-002`） |
| 13 | `/observations` | ADMIN / ENGINEER | 查询、新建、详情、更正、删除 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 14 | `/observations/insights` | ADMIN / ENGINEER | 指标、排行、覆盖矩阵 | PASS |
| 15 | `/observations/insights/print` | ADMIN / ENGINEER | 打印口径与布局 | PASS |
| 16 | `/observations/topics` | ADMIN / ENGINEER | 问题库、新增 | PASS |
| 17 | `/observations/:observationId/correct` | 有效/缺失/非链尾 ID | 更正预填、逐篇事实、证据 | FAIL（`PS-QA2-FUNC-003`；证据图受 `PS-QA2-ENV-001` 阻断） |
| 18 | `/settings` | ADMIN / ENGINEER | 发布账号查询、新增、编辑、启停、删除 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 19 | `/users` | ADMIN；ENGINEER 直达 403 | 用户、批量、密码、导出、删除 | FAIL（`PS-QA-201`） |
| 20 | `/audit` | ADMIN；ENGINEER 直达 403 | 筛选、分页、详情 | FAIL（`PS-QA2-UI-002`） |
| 21 | `/configuration` | ADMIN；index 重定向 `/configuration/ai` | 配置入口重定向 | PASS |
| 22 | `/configuration/ai` | ADMIN | 渠道查询、新增、测试、启停、删除 | FAIL（`PS-QA-201`） |
| 23 | `/configuration/ai/channels/:channelId` | ADMIN；有效/缺失 ID；5 个 Tab | 渠道、Header、模型、统计、日志 | FAIL（`PS-QA-201`、`PS-QA-203`） |
| 24 | `/configuration/platform-types` | ADMIN | 新增、编辑、删除 | FAIL（`PS-QA-201`） |
| 25 | `/configuration/platforms` | ADMIN | 查询、新增、详情、编辑、启停、删除、导出 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 26 | `/configuration/prompts` | ADMIN；平台/自然化 Tab | 新建、选择、编辑、revision、删除、预览 | PASS |
| — | `*` | 匿名/已登录未知路径 | 重定向 `/` 后执行认证门禁 | PASS |

动态路由后续统一覆盖：有效对象、缺失对象、无权限对象、列表返回、刷新和浏览器后退。查询驱动 Tab/筛选单独验证 URL 恢复，不与路径模式重复计数。

## 4. W0～W6 业务矩阵

| 波次 | 范围 | 重点 | 状态 |
| --- | --- | --- | --- |
| W0 | 认证、用户、平台、Prompt、账号、AI 配置 | 权限、revision、敏感值、禁用、删除 | FAIL（`PS-QA2-UI-001`） |
| W1 | 产品与事实 | Markdown、分级、审核、批准后不可变 | PASS |
| W2 | 内容任务与内容版本 | AI/人工首稿、自然化、快照、重试、审核 | FAIL（`PS-QA2-FUNC-001`） |
| W3 | 发布 | 账号匹配、登记、状态事件、证据、删除 | PASS |
| W4 | 发布异常与修复 | 唯一 OPEN、修复来源、显式解决 | FAIL（`PS-QA2-FUNC-002`） |
| W5 | GEO | 问题、观测、逐篇事实、更正链、洞察、打印 | FAIL（`PS-QA2-FUNC-003`） |
| W6 | 恢复性与一致性 | 重复、并发、网络失败、刷新/重登、最终状态 | FAIL（`PS-QA-201`、`PS-QA2-UI-002`） |

## 5. 自动化基线

| 命令 | 状态 | 数量/耗时 | 备注 |
| --- | --- | --- | --- |
| `make contract-check` | PASS | 0 失败；1.42 秒 | FastAPI 运行时操作、OpenAPI 递归 Schema 与前端生成类型一致 |
| `make test-unit` | PASS | 后端 140、前端 Vitest 175、视觉合同 23；0 失败；236.93 秒 | jsdom 输出 CSS 解析和跨文档导航能力警告，不影响退出码或用例结果 |
| `make test-integration` | PASS | 68 通过、0 失败；88.80 秒 | Compose `backend-test` 在 PostgreSQL、Redis 健康后完成 |
| `make e2e` | PASS | 52 通过、0 失败；289.24 秒 | 独占 5173；数据库 `partsignal_e2e_20260731_39166` 清理后计数为 0，临时存储路径不存在；开发服务已恢复 |
| `make lint` | PASS | 0 失败；3.95 秒 | Ruff、ESLint 与主题颜色检查通过 |
| `make typecheck` | PASS | 0 失败；3.38 秒 | mypy 检查 67 个后端源文件，前端 `tsc -b` 通过 |
| `make build` | PASS | 0 失败；48.47 秒 | 后端与前端测试镜像均构建成功；旧 Docker builder 与 npm audit 输出非阻断警告 |
| `make verify` | NOT_APPLICABLE | — | 当前只重复上述门禁；若后续产生新增证据再运行 |

历史回归补证于 2026-08-01 再执行一次 `npm --prefix frontend run test`：Vitest 175/175、视觉合同 23/23，`real 241.37s`。结合本轮 `make test-unit` 的完整前端结果，`PS-QA-110` 所需连续两次零失败、每次不超过 300 秒已满足。

### 5.1 第 7 节 DELETE 专项增量验证

| 检查 | 状态 | 数量/耗时 | 备注 |
| --- | --- | --- | --- |
| 删除权限/CSRF/不存在探针 | PASS | 13/13 | 新隔离库重跑；匿名、角色、缺失/错误 CSRF 与 404 均符合合同 |
| 合法删除/顺序重复探针 | PASS | 13/13 | 首次 204、重复 404、目标行不存在、唯一成功审计 |
| 同目标并发探针 | FAIL | 11/13 PASS | AI 渠道与 Header 返回双 204 并写双成功审计，见 `PS-QA2-DELETE-001` |
| 定向 PostgreSQL 集成测试 | PASS | 10/10；10.5 秒 | 状态/引用/历史、关联、附件和审计边界 |
| 删除相关前端单测 | PASS | 8 文件、97/97；180.53 秒 | jsdom 既有 CSS/导航能力警告不影响退出码 |
| 删除相关定向 E2E | PASS | 5/5；1.3 分钟 | 身份删除、AI 管理、完整业务流；隔离数据库/存储精确清理，开发服务恢复健康 |

接口与数据库专项为 11 `PASS`、2 `FAIL`；叠加已确认的删除确认焦点、术语和影响说明缺陷后，13 个入口综合为 1 `PASS`、12 `FAIL`。逐接口及统一维度见 `research/table-action-delete-matrix.md`。

### 5.2 第 8 节全路由 UI/UX

| 检查 | 状态 | 数量/证据 | 备注 |
| --- | --- | --- | --- |
| 全路由双视口 | PASS | 26 个功能路径 + 通配入口，54 次扫描 | 0 文档溢出、0 缺失可访问标题、0 移动触控尺寸失败、0 API 4xx/5xx |
| 临界断点 | PASS | `1024×768`、`320×800` | 列表、编辑审核、分析洞察三类代表页通过 |
| 真实 200% 缩放 | PASS | 5 类页面 | 内容任务、发布、GEO、用户、AI 配置无页面溢出或关键操作丢失 |
| 三主题/reduced-motion/对比度 | PASS | light、dark、system | 文字 ≥ 4.5:1、非文字边界 ≥ 3:1，状态非颜色单一表达 |
| 仅键盘与焦点 | FAIL | 登录、导航和基础菜单通过 | `PS-QA-201`、`PS-QA2-UI-002` 仍存在 |
| console/request | FAIL | 2 个主视口稳定复现 | 新增 `PS-QA2-UI-003`；GEO 图片 ORB 归入 `PS-QA2-ENV-001` |

逐路由综合为 9 `PASS`、17 `FAIL`、0 `NOT_RUN`；详细结果与证据复用关系见 `research/ui-ux-matrix.md`。

## 6. 历史回归清单

| 组 | 本轮要求 | 状态 |
| --- | --- | --- |
| `PS-QA-001`～`PS-QA-004` | 复现原步骤，验证产品修复未回归 | PASS（4/4，详见 `research/history-regression-matrix.md`） |
| `PS-QA-101`～`PS-QA-110` | 验证门禁、E2E 隔离、测试漂移与前端全量门禁 | PASS（10/10，详见 `research/history-regression-matrix.md`） |
| 表格/长文本/缩放 | 24 表、58 个槽、跨页与真实 200% | PASS |
| 内容任务术语、发布操作、开发代理 | 删除任务文案、候选/发布记录动作、Vite `/api` 重启稳定性 | PASS |
| 24 表自动化目标定位 | GEO 文章表、模型发现表的弹窗根节点 | FAIL（`PS-QA2-TEST-001`） |
| 全部操作列 | 当前动作、状态投影、键盘、确认/取消、焦点 | FAIL（`PS-QA2-FUNC-001`～`003`、`PS-QA-201`～`203`、`PS-QA2-UI-002`） |
| `PS-QA-201` | Dropdown → `modal.confirm` 取消后的焦点恢复 | FAIL（仍存在） |
| `PS-QA-202` | 用户可见“物理删除”实现术语 | FAIL（仍存在） |
| `PS-QA-203` | AI Header 删除影响说明 | FAIL（仍存在） |
| 第一轮覆盖缺口 | 删除并发、确认期间状态变化、迟到响应/缓存、全部操作列键盘链 | FAIL（覆盖已补齐；见 `PS-QA2-DELETE-001`、`PS-QA-201`、`PS-QA2-UI-002`） |
| 13 DELETE 专项 | 权限、合法/重复/并发、关联副作用、审计、最终状态 | FAIL（`PS-QA2-DELETE-001`；服务端 11/13 PASS，综合 1/13 PASS） |

历史回归的逐编号原步骤、证据和判定见 `research/history-regression-matrix.md`。已修复的 14 项均未回归；`PS-QA-201`～`203` 仍存在，第一轮覆盖缺口已补齐但实际结果包含删除并发与焦点恢复缺陷。
