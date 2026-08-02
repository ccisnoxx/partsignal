# 上线前最终发布候选验收：实施计划

## 0. 启动门禁

- [x] 用户评审并批准 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行：

```bash
python3 ./.trellis/scripts/task.py start 08-02-pre-release-final-candidate-acceptance
```

- [x] 启动后运行 `trellis-before-dev`，完整读取任务文档、测试策略、视觉规范、E2E 隔离规范、Makefile 与相关脚本。
- [x] 不修改产品、测试、合同、配置或视觉资产；任何失败只记录并分流。

## 1. 冻结提交与环境

- [x] 记录北京时间、`git rev-parse HEAD`、`git rev-parse origin/main`、分支与 `git status --short`；要求运行时提交均为 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2`。
- [x] 记录 `56ae5ac` 当前已跟踪 Playwright 诊断文件和视觉基线文件清单；该状态只验收、不修复。
- [x] 记录 Python/Node/npm/PostgreSQL/Redis/Docker Compose 版本、依赖锁哈希及 Alembic current/head。
- [x] 运行 Compose 配置检查，确认开发 API、前端、PostgreSQL、Redis、Worker、Scheduler 的真实健康和同源 `/api` 代理；只按现有开发流程启动缺失服务，不部署或修改配置。
- [x] 记录执行前 E2E 数据库、临时存储、浏览器会话和根 `.playwright-cli/` 文件清单，供退出时精确比对。

## 2. 七项必需门禁

严格按以下顺序执行，每项记录退出码、数量、耗时与首个失败；失败不授权修复，安全独立的后续门禁继续执行：

```bash
make contract-check
make test-unit
make test-integration
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
make lint
make typecheck
make build
```

- [x] `make contract-check`：OpenAPI、FastAPI 运行时 Schema 和前端生成类型一致；退出码 0。
- [x] `make test-unit`：后端 141、前端 185、视觉资产 24，共 350 通过，0 失败、0 跳过；退出码 0。
- [x] `make test-integration`：PostgreSQL/Redis 真实集成边界 70 通过，0 失败、0 跳过；退出码 0。
- [x] `make e2e`：完整 Playwright 套件真实运行，51 通过、1 失败；缺失 11 张冻结视觉基线，退出码 2；数据库与临时对象存储均完成 `E2E_CLEANUP`。
- [x] `make lint`：Ruff、ESLint 与主题颜色扫描通过；退出码 0。
- [x] `make typecheck`：mypy 与 TypeScript 通过；退出码 0。
- [x] `make build`：后端和前端生产镜像构建通过；退出码 0。

## 3. 关键页面 smoke

使用项目 `playwright-cli`，命名内存会话 `rc-final-20260802`，不保存 storage state，不使用 route：

- [x] 匿名 `/login`、受保护入口重定向和同源 `/api` 边界通过。
- [x] 管理员在 `1440×900` 完成工作台、产品/事实、内容任务、发布、GEO、AI、Prompt、用户和审计页面身份及主要 region/空态检查。
- [x] 已执行发布候选/记录 Drawer、发布菜单确认取消和审计详情回焦；候选/记录 Drawer 与审计详情通过，发布菜单取消后焦点落到 `BODY`，本项结果 FAIL。
- [x] 在 `390×844` 复查登录、工作台、发布和 GEO，主操作可达且无页面级横向溢出。
- [x] 对每个页面读取 console 和 requests；无 error/warning、失败请求或 5xx，匿名 `/api/v1/auth/me` 为预期 204。
- [x] 只做登录、导航、筛选、打开/关闭和读取；未写共享业务数据，未输出凭据，未保存 storage state，未配置 route。

## 4. 清理与冻结复核

- [x] 确认本轮 E2E 数据库与临时对象存储均报告 `status=deleted` 且实际不存在。
- [x] 确认命名浏览器会话已关闭并删除本轮临时数据，没有活动 route 或遗留浏览器进程；既有 `default`、`obs`、`visualanchors` 保持不变。
- [x] 精确删除本轮工具新生成且未跟踪的 27 个根 Playwright 诊断文件与 11 个 actual 截图；不触碰 `56ae5ac` 已跟踪文件或其他会话资产。
- [x] 再次核对 HEAD、origin/main、依赖锁、合同、Compose 解析指纹、视觉测试源码与迁移头均未漂移；开发服务恢复执行前边界。
- [x] `git diff --check` 退出码 0；任务文档无行尾空白，工作区仅剩当前任务目录 5 个未跟踪文件。

## 5. 最终报告

- [x] 新增 `report.md`，包含冻结信息、七项门禁矩阵、关键 smoke、失败归因、清理结果、未覆盖项和残余风险。
- [x] 按 `design.md` 算法输出唯一 `GO` / `NO-GO`；任一必需门禁或 smoke 未通过均不得改写为部分通过。
- [x] 当前为 `NO-GO`；已按两个独立根因给出最小后续任务建议，未创建、未修复。
- [x] `GO` 分支不适用；报告已明确当前结果不代表生产部署、真实 AI/OSS、性能、容量或渗透测试通过。

## 6. 质量与提交边界

- [x] 已运行 `trellis-check`：冻结点、门禁数字、浏览器 smoke、清理与二元判定一致；另发现并报告两张移动视觉截图阈值违反权威规范，结论保持 `NO-GO`。
- [x] 已运行 `trellis-update-spec` 判断：不修改稳定规范；`0.02` 视觉阈值、焦点恢复和 E2E 隔离规则均已明确，当前是候选实现/资产偏离规范。
- [x] 提交前已向用户展示报告结论、精确文件范围和验证结果并取得批准；不自动推送。

## 7. 可选项与明确排除

- 不运行 `make verify`：它会重复七项必需门禁；Compose 配置单独只读检查。
- 不运行真实第三方 AI、真实生产 OSS、真实发布、性能、容量、渗透或生产数据写入。
- 不恢复视觉基线、不更新快照、不提交 Playwright CLI 诊断产物。
