# 上线前最终发布候选验收（复验）：执行设计

## 1. 设计结论

本任务只编排现有验收能力，不新增测试框架、产品探针或兼容逻辑。七项 Make 门禁提供自动化证据，项目 `playwright-cli` 提供共享开发环境的关键页面 smoke，任务目录下的 `report.md` 汇总冻结状态并输出唯一 `GO` / `NO-GO`。

规划时的目标候选为本地 `main` 提交 `a568f9503aa181a29aa5dc740cf6d200bcf88998`。正式执行前再次冻结并校验该提交；任务资料不参与运行时代码。`origin/main` 的差异只记录、不自动同步，最终结论只对报告中精确列出的本地提交有效。

## 2. 验收数据流

```text
核对两项修复归档证据
  -> 冻结本地 HEAD、环境、合同、依赖、迁移和服务
  -> 控制开发 Redis 消费者并顺序执行七项 Make 门禁
  -> 恢复开发服务并执行真实同源关键页面 smoke
  -> 精确清理本轮资源与工具产物
  -> 复核冻结状态并生成 report.md
  -> 全部必需项 PASS：GO；否则：NO-GO
```

- 自动化写链只发生在 `deploy/scripts/e2e-local.sh` 创建的独立 PostgreSQL 数据库和临时对象存储中。
- 共享开发 smoke 只执行登录、导航、筛选、打开、关闭和读取，不写共享业务对象。
- 不读取或输出凭据；浏览器使用命名内存会话，不保存 storage state。
- 历史绿色结果只证明前置修复，不替代冻结候选上的本轮门禁。

## 3. 冻结模型

执行开始与结束各采集一次：

| 维度 | 权威值/命令 | 通过条件 |
| --- | --- | --- |
| 候选提交 | `git rev-parse HEAD` | `main` 上的 `a568f9503aa181a29aa5dc740cf6d200bcf88998` |
| 修复包含关系 | `git merge-base --is-ancestor <fix> HEAD` | `e3dbe81` 与 `a778393` 均为祖先 |
| 工作区 | `git status --short` | 除当前任务目录外无差异 |
| 远端参考 | `git rev-parse origin/main` | 记录并在本轮内保持不变；不要求等于 HEAD |
| 合同与依赖 | OpenAPI、数据库合同、lockfile SHA-256 | 前后完全一致 |
| 数据库 | Alembic current/head | 单一 head，执行前后无漂移 |
| 开发环境 | Compose 解析指纹、服务与同源健康探针 | 配置不漂移，所需服务可用并最终恢复 |
| 视觉合同 | 视觉源码与 11 张基线清单/SHA-256 | 前后完全一致，不生成或更新基线 |

若正式启动前 HEAD 已变化，不自动把新提交纳入候选；停止并重新评审。执行期间任何受版本控制运行时文件漂移均使结论为 `NO-GO`。

## 4. 七项门禁设计

固定顺序为合同、单元、集成、E2E、lint、typecheck、build。每项记录命令、北京时间、耗时、退出码、通过/失败/跳过数量和首个权威失败。

E2E 前记录开发 `frontend`、`worker`、`scheduler` 状态；只停止当时正在运行且会占用 5173 或竞争 Redis 队列的这些服务，确认 `celery` 队列为空后运行现有隔离脚本。结束后按执行前状态恢复并验证同源 `/api`、Worker 与 Scheduler。该环境控制不修改代码或配置，也不能掩盖产品失败。

门禁失败不授权修复。只有确认环境发生了会影响结果的变化，才允许重新执行被环境阻断的命令；原始失败和重跑理由必须同时写入报告。

## 5. 关键页面 smoke

### 5.1 会话与证据

- 命名内存会话：`rc-final-rerun-20260803`；桌面 `1440×900`，移动 `390×844`。
- 入口：`http://127.0.0.1:5173`；API 只走真实同源 `/api`。
- 不使用 route、mock、storage state、固定成功脚本或共享数据库补数。
- 优先使用 snapshot、`find`、`console`、`requests` 和精确 `eval`；只在失败需要视觉证据时截图。
- 每页核对身份、主要 region/真实空态、失败请求、5xx、未解释 console error/warning；移动页额外核对页面级 `scrollWidth <= clientWidth`。

### 5.2 S0～S8 矩阵

| ID | 页面/交互 | 必查结果 |
| --- | --- | --- |
| S0 | `/login`、匿名访问受保护入口 | 登录身份正确；受保护数据不泄露；管理员真实登录成功 |
| S1 | `/` 工作台 | 桌面与移动身份、核心区域和快捷入口可达 |
| S2 | `/products` 与首个可用详情 | 列表或真实空态可理解；详情事实与动作投影可加载 |
| S3 | `/tasks` 与首个可用详情 | 任务、作业和内容入口可达；终态无无效动作 |
| S4 | `/publications` | 候选/记录 Drawer 直接关闭回焦；“更多操作 → 标记已移除 → 取消”回到原更多按钮，且无发布命令请求 |
| S5 | `/observations`、`/observations/insights` | 列表、洞察或真实空态可读；移动端无页面级溢出 |
| S6 | `/configuration/ai`、`/configuration/prompts` | 页面可读；敏感值不回显 |
| S7 | `/users`、`/audit` | 管理页身份正确；审计详情关闭后回到原触发器 |
| S8 | 移动登录、工作台、发布、GEO | 主操作可达，Drawer 可关闭，无页面级横向溢出 |

焦点链读取 `document.activeElement` 的可访问名称和标签；任何结果为 `BODY`、已断开节点或非原触发器均为失败。必需对象不存在时记 `BLOCKED`，不通过 mock 或共享业务写入补齐。

## 6. 二元判定

```text
if precondition_failed
   or frozen_state_drifted
   or any(required_make_gate != PASS)
   or any(required_smoke != PASS)
   or cleanup_failed:
    NO-GO
else:
    GO
```

- 必需项的 `FAIL`、`BLOCKED`、`NOT_RUN` 均不等于通过。
- 无法归因的 P0/P1 缺陷按对应门禁或 smoke 失败处理；P2/P3 记录为残余风险，不掩盖明确失败。
- `GO` 只表示本地冻结提交通过本任务范围，不表示已 push、已部署，也不覆盖生产配置、真实第三方、性能或安全专项。

## 7. 清理与证据边界

- E2E 清理同时依据 `E2E_CLEANUP ... status=deleted` 和数据库/目录实际不存在。
- 精确删除本轮 `frontend/test-results`、`frontend/playwright-report`、根 `.playwright-cli/` 新产物和命名会话；不触碰执行前已有文件、其他会话或 `frontend/.playwright-cli/` 已跟踪资产。
- 唯一新增结果文件为任务目录下 `report.md`；不保存大体积日志、凭据或含敏感载荷的网络证据。
- 最终提交边界仅为当前 Trellis 任务目录；不 push、不部署、不创建 release。

## 8. 回滚

本任务不修改运行时代码，因此没有产品回滚。若执行中断，只停止本轮启动的进程、删除本轮拥有的隔离资源并恢复执行前开发服务；禁止清扫共享业务数据。
