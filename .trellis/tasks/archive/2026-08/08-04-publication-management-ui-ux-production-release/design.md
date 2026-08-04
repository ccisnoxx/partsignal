# 发布管理 UI/UX 重构生产上线：技术设计

## 1. 设计结论

本任务不设计新的部署系统，只按现有 Hostdzire Runbook 发布已验收提交。目标固定为 `https://geo.962850.xyz`、SSH 别名 `hostdzire`、Compose 项目 `partsignal-staging`、共享配置 `/root/partsignal/shared/.env.staging` 和不可覆盖 release 目录 `/root/partsignal/releases/<release-id>`。

唯一合法发布路径是 `make staging-redeploy-fast`：本次运行时代码只修改发布管理前端页面与样式，没有迁移、环境模板、Compose、Nginx、部署脚本、认证、权限、路由或全局壳层变化。快速脚本会在远端再次逐项比较六个关键路径；任一路径变化都显式拒绝，不能设置参数或改用手工命令绕过。

## 2. 发布来源与版本边界

发布包只能来自经用户确认后提交并推送的 `origin/main`。执行前必须满足：

- 本地为主工作目录 `main`，工作树干净；
- `git fetch origin main` 后 `HEAD == origin/main`；
- 待发布历史包含 UI 工作提交 `72c4dd3` 和本任务规划提交；
- 当前线上回滚点仍为 `mvp-20260803-211435-63d7a5b0bfaa`，或在执行前重新读取并记录其实际值；
- 当前 release 与目标提交之间不存在快速脚本关键路径变化。

Trellis 规划文件会进入发布 commit，但 `git archive` 包含它们不影响运行时。不得用未提交工作树、旧 release、临时 worktree 或手工复制文件制作发布包。

## 3. 部署数据流

```text
本地 clean main == origin/main
  → git archive 目标提交并检查秘密/AppleDouble
  → scp 到 hostdzire 受保护 incoming 路径
  → 创建不可覆盖 release + 链接 0600 共享配置
  → 比较六个快速发布关键路径
  → fast deploy 构建并替换固定 Compose 服务
  → 回环健康 + nginx -t + 公网 live/ready/首页
  → 原子更新 current
  → 本机登录后只读发布管理验收
  → 10 分钟观察与最终只读复核
```

快速路径不执行数据库备份、Alembic 迁移、种子账号创建或 Nginx reload。容器构建或替换可能发生在公网探针通过之前，因此 `current` 未更新不代表运行容器仍是旧版本。

## 4. 浏览器验收边界

使用本任务独占的 `playwright-cli` 会话，从本机访问真实公网域名。登录凭据只把远端共享环境中的 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 单值注入浏览器进程内存；不回显、不写文件、不保存 storage state，提交密码前不抓取 DOM 快照或截图。

登录后只做以下可逆、只读动作：

1. 1440×1000 打开 `/publications`，验证标题、三个一级视图、摘要、桌面表格/空态和首屏几何。
2. 检查现有失败工作、成果和历史状态；数据不存在时接受真实空态，不创建数据。
3. 打开并关闭一个现有详情，验证 URL、Drawer、Escape/关闭按钮与焦点恢复；不点击主动作或更多操作中的命令项。
4. 375×900 重新加载，验证移动列表、44px 关键入口、无页面横向溢出和全宽 Drawer。
5. 检查 console 和失败请求，只报告错误类别与 URL，不输出业务正文或凭据。
6. 退出登录、关闭命名会话并确认没有遗留浏览器进程；删除临时 Playwright 产物。

本任务不生成截图基线。人工批准资产已在 UI/UX 重构任务中登记，上线验收只证明真实部署和关键交互未回归。

## 5. 数据与安全边界

- PostgreSQL 是业务状态唯一来源；快速发布不运行迁移或写入数据库。
- Redis 仍只作为 Celery Broker；不通过 Redis 修复或推断业务状态。
- 共享环境、管理员密码、会话密钥和 AI 加密密钥不得进入仓库、工具输出、任务文档或日志。
- `hostdzire` 是唯一写入目标；`dmit` 只在 Hostdzire 正常而公网异常时用于只读诊断。
- 不修改 Nginx、安全头、CORS、AI 本地 HTTP 策略或对象存储配置。

## 6. 失败与回滚

部署前失败不改变远端。上传后资格门禁失败会保留新 release 供排障，但不允许手工继续。公网探针前容器可能已经替换，因此失败后必须检查固定 Compose 栈，而不能只观察 `current`。

本次没有数据库或状态机变化，上一已验证 release 与当前数据库契约兼容。需要应用回滚时：

1. 读取并验证上一 release 目录和镜像存在；
2. 在上一 release 的 `deploy/` 中用该 release ID 重启 `worker scheduler api frontend fake-oss`；
3. 重做公网、浏览器和主机验收；
4. 全部通过后才原子更新 `current`。

回滚不执行 Alembic downgrade，不修改数据库、不删除新 release、镜像、备份或持久数据。若失败与本次页面无关且线上仍健康，只记录阻塞并停止，不扩大范围修复。

## 7. 记录边界

任务实施记录只保存 commit、release ID、前一 release、命令退出结果、服务健康、页面验收结论和残余风险。不得记录完整环境、凭据、业务正文、用户身份或敏感请求响应。
