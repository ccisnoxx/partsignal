# 发布管理 UI/UX 重构生产上线：实施计划

## 0. 启动条件

- [x] 用户批准最终 `prd.md`、`design.md` 和本实施计划。
- [x] 运行 `task.py start`，任务进入 `in_progress`。
- [x] 使用 `trellis-before-dev` 读取任务三份规划、基础设施规范和 Hostdzire Runbook。
- [x] 实施开始后先给出规划文件的精确提交与推送范围，取得用户确认；不把任务创建或规划批准当作 Git 授权。

## 1. 固化发布来源

- [x] 确认本地为主工作目录 `main`，除当前任务规划外没有未识别改动。
- [x] 按用户确认只暂存当前任务 `prd.md`、`design.md`、`implement.md`、`task.json`，运行 `git diff --cached --check` 后提交。
- [x] 推送 `main`，运行 `git fetch origin main`，确认工作树干净且 `HEAD == origin/main`。
- [x] 记录目标 commit、`origin/main`、当前线上 `current` 和部署前公网 `live` / `ready`；不记录敏感响应。

## 2. 必需发布前门禁

从仓库根目录执行：

```bash
git diff --check
(cd frontend && npx vitest run src/features/publications/PublicationsPage.test.tsx)
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
deploy/scripts/smoke.sh https://geo.962850.xyz
```

- [x] 定向组件测试 6/6、lint、typecheck 和生产 build 通过。
- [x] 公网部署前冒烟通过。
- [x] `git diff --name-only <current-commit>..HEAD` 只包含已审核前端与 Trellis 文件，快速发布六个关键路径无变化。
- [x] 只读确认 `hostdzire` 身份、`current`、共享环境权限 `0600`、PartSignal 容器、`nginx -t`、磁盘和内存。
- [x] 任一门禁失败即停止；不为部署修复范围外失败，不重复运行没有受代码或环境变化影响的同一失败检查。

## 3. 快速重部署

从干净且已同步的本地主工作目录执行唯一入口：

```bash
make staging-redeploy-fast
```

- [x] 脚本完成本地来源、归档安全、Hostdzire 环境、六个关键路径、Compose、构建、容器、回环、公网和 Nginx 门禁。
- [x] 记录脚本输出的新 release ID 和目标 commit，确认 `/root/partsignal/current` 原子指向该 release。
- [x] 不手工打包、上传、修改共享环境、设置 fast 绕过参数或重复脚本内部步骤。
- [x] 失败时保留现场并按 `design.md` 判断是否需要兼容应用回滚；不删除 release、镜像、备份或持久数据。

## 4. 公网与登录后只读验收

### 4.1 命令行复核

```bash
deploy/scripts/smoke.sh https://geo.962850.xyz
```

- [x] 公网 `live`、`ready` 和首页通过；ready 中 PostgreSQL 与 Redis 为 `ok`。
- [x] 只读复核 Hostdzire PartSignal 容器、`nginx -t`、磁盘和内存。

### 4.2 真实浏览器

- [x] 使用独占命名会话 `publication-ui-ux-production-release`；凭据仅注入进程内存，不输出、不落盘、不保存 storage state。
- [x] 密码提交前不执行 snapshot 或 screenshot；登录后只访问工作台和 `/publications`。
- [x] 1440×1000 验证三个一级视图、摘要、桌面表格/空态、现有状态、只读成果、历史边界和无页面级溢出。
- [x] 375×900 验证移动列表、关键入口、无页面级溢出和全宽详情 Drawer。
- [x] 只进行导航、筛选和详情开关；不触发发布、核验、关闭、修复、解决或其他写操作。
- [x] 检查 console 与失败请求，退出登录，关闭会话并确认 `playwright-cli list --all --json` 无本任务浏览器；删除本任务临时浏览器产物。

## 5. 10 分钟观察

- [x] 浏览器验收后等待 10 分钟，不进行业务写入。
- [x] 再次执行公网 smoke，并只读检查 API、前端、Worker、Scheduler、PostgreSQL、Redis 与 `fake-oss` 状态。
- [x] 读取部署时间窗的 PartSignal 容器错误摘要；只记录错误码、数量和服务，不记录业务正文或凭据。
- [x] 持续错误或服务异常视为验收失败，按兼容应用回滚边界处理。

## 6. 结果记录与质量检查

- [x] 在任务记录中写入部署 commit、新/旧 release、门禁、浏览器、观察和回滚结论。
- [x] 使用 `trellis-check` 核对 PRD AC1–AC10、Runbook 合规、秘密边界、浏览器清理和 Git diff。
- [x] 运行 `trellis-update-spec` 判断是否有稳定新规则；无新增部署约定时明确记录无需修改规范。
- [x] 确认没有业务代码、合同、数据库、配置或部署脚本变化；若出现则返回规划，不把它夹带进结果提交。

## 7. 可选完整检查

以下检查不是本次普通前端快速发布的默认门禁；只有定向检查暴露共享风险或用户另行要求时执行：

```bash
make verify
make test-deploy-scripts
```

跳过时在收尾中说明：现有 UI 任务已完成更重的业务 E2E，本任务用定向组件、生产 build、脚本门禁和真实公网只读验收覆盖发布风险。

## 8. 收尾

- [x] 向用户给出任务结果文件的精确提交计划并取得确认，不自动提交或推送。
- [x] 提交结果后执行 `trellis-finish-work`，归档任务并记录会话；如果脚本配置不自动提交，按已说明的 Trellis bookkeeping 边界处理。
- [x] 最终工作树干净，报告提交、release、线上状态、未推送提交和残余风险。
