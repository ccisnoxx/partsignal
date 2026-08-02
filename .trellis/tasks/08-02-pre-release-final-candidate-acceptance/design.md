# 上线前最终发布候选验收：执行设计

## 1. 设计结论

本任务是只读验收编排，不新增测试框架或产品探针。`Makefile` 七项现有命令提供自动化证据，项目 `playwright-cli` 提供共享开发环境的关键页面 smoke，Trellis `report.md` 汇总冻结状态和二元发布建议。

运行时唯一权威为冻结提交 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2`。任务资料不参与运行时代码；任何其他文件变化都会使证据失效。

## 2. 验收边界与数据流

```text
冻结 HEAD/origin/config/migration
  -> 七项 Make 门禁（独立记录，失败不修）
  -> 开发同源关键页面 smoke（只读交互）
  -> E2E/浏览器/临时文件清理核对
  -> report.md 门禁矩阵
  -> 全部必需项 PASS：GO；否则：NO-GO
```

- 自动化写链只发生在 `e2e-local.sh` 创建的独立 PostgreSQL 数据库和临时对象存储中。
- 共享开发浏览器 smoke 只登录、导航、筛选和打开/关闭，不写业务对象。
- 不读取或输出真实凭据；浏览器使用命名内存会话，不保存认证状态文件。
- 不把历史 `52 passed`、容器健康或构建成功单独当作当前发布候选通过。

## 3. 冻结模型

执行开始与结束各采集一次：

| 维度 | 权威值/命令 | 漂移处理 |
| --- | --- | --- |
| Git | `git rev-parse HEAD`、`git rev-parse origin/main` | 任一变化即 `NO-GO` |
| 分支与差异 | `git branch --show-current`、`git status --short` | 除任务目录外有变化即停止取证 |
| 合同与依赖 | OpenAPI、lockfile 均来自冻结提交 | 不生成并提交替代文件 |
| 数据库 | Alembic current/head | 不一致先记环境失败，不自动改业务数据 |
| Compose | `deploy/compose.dev.yaml` 当前解析结果与服务健康 | 配置解析失败或关键服务不健康即 `NO-GO` |
| 视觉资产 | 冻结提交当前已跟踪文件集合 | 不恢复、不生成、不扩大阈值 |

`56ae5ac` 的诊断文件与视觉基线删除已由用户确认为有意状态；设计只保证它们被真实门禁消费，不对其正确性预先背书。

## 4. 七项门禁设计

七项命令顺序固定为合同、单元、集成、E2E、lint、typecheck、build。顺序执行避免并发资源竞争污染耗时、数据库或浏览器结论。

每项记录：

- 命令与冻结提交；
- 北京时间开始/结束、实际耗时和退出码；
- 测试通过/失败/跳过数量；
- 首个权威失败及失败类别：产品、测试资产、合同、环境或清理；
- 后续门禁是否仍可安全继续。

失败归因不授予修复权限。除非环境发生了明确且预期影响结果的变化，否则同一失败不重跑。

## 5. 关键页面 smoke 设计

### 5.1 会话与视口

- 命名会话：`rc-final-20260802`，默认内存 profile。
- 桌面：`1440×900`；移动：`390×844`。
- 基础入口：`http://localhost:5173`；所有 API 必须通过同源 `/api` 代理。
- 不使用 `route`、storage state、页面脚本固定成功或数据库补数据。

### 5.2 页面矩阵

| ID | 页面/交互 | 必查结果 |
| --- | --- | --- |
| S0 | `/login`、匿名访问 `/` | 登录页身份正确；受保护页不泄露数据 |
| S1 | `/` 工作台 | 标题、核心区域和快捷入口可见；同源 API 无 5xx |
| S2 | `/products` 与首个可用详情 | 列表/空态可理解；详情事实与操作投影可加载 |
| S3 | `/tasks` 与首个可用详情 | 任务、作业、内容入口加载；终态无无效动作 |
| S4 | `/publications` | 列表/Tab 可达；候选/记录 Drawer 直接关闭和菜单确认取消后焦点回原触发器 |
| S5 | `/observations`、`/observations/insights` | 观测列表、洞察图表或明确空态可读；无页面级溢出 |
| S6 | `/configuration/ai`、`/configuration/prompts` | 渠道与 Prompt 页面可读；敏感值不回显 |
| S7 | `/users`、`/audit` | 管理页身份正确；审计详情关闭后回焦 |
| S8 | 移动登录、工作台、发布、GEO | 主操作可达，Drawer 可关闭，页面无横向溢出 |

列表无数据时验证真实空态；需要对象才能完成的必需焦点链若无法建立，记为 `BLOCKED`，不通过 mock 或共享数据库写入补齐。

### 5.3 浏览器证据

- 优先使用 snapshot、`find`、`console`、`requests` 和精确 `eval`；只在失败需要视觉证据时截图。
- 检查 `document.activeElement`、页面级 `scrollWidth/clientWidth`、主标题/region 和失败请求。
- 关闭会话前确认没有活动 route，随后关闭并删除本轮会话数据。

## 6. GO / NO-GO 算法

```text
if frozen_state_drifted
   or any(required_make_gate != PASS)
   or any(required_smoke != PASS)
   or cleanup_failed
   or unexplained_P0_or_P1_exists:
    NO-GO
else:
    GO
```

- `FAIL`、`BLOCKED`、`NOT_RUN` 对必需项均不等于通过。
- 历史绿色结果不能覆盖当前红灯。
- 非阻断 P2/P3 可作为残余风险，但不能掩盖规范、门禁或 smoke 的明确失败。

## 7. 证据、清理与提交

- 唯一新增结果文件为任务目录下 `report.md`；不保存大体积原始日志或含秘密网络载荷。
- E2E 清理依据 `E2E_CLEANUP ... status=deleted` 及资源不存在复核。
- Playwright CLI 只清理本轮新生成的根目录诊断文件和命名会话，不触碰冻结提交已跟踪文件。
- 最终提交只包含当前 Trellis 任务目录；任务不推送、不部署。

## 8. 回滚

本任务不修改运行时代码，无产品回滚。若执行污染共享环境，只停止本轮启动的会话/进程并恢复执行前服务边界；不得通过删除共享业务数据完成清理。
