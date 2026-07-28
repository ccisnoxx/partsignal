# 按部署文档重新部署上线：技术设计

## 1. 发布路径决策

目标数据库仍为 `0028`，待发布版本新增 `0029/0030`；迁移目录属于快速发布六个固定门禁路径，且 `0029` 物理删除两个已有非空值的列。因此唯一合法路径是 Hostdzire 完整发布。

部署目标固定为文档中的 `https://geo.962850.xyz` 与 Compose 项目 `partsignal-staging`。最终 release commit 不在规划阶段冻结：必须等待其他并行任务把当前工作树恢复为干净状态，再以用户批准推送后的 `origin/main` 为唯一来源。

## 2. 发布前基线

执行前记录但不输出敏感内容：

- 本地 `HEAD`、`origin/main` 和零脏文件断言。
- 远端 `current`、Alembic revision、容器健康、Nginx 版本与配置检查。
- 人工观测数、人工逐篇结果数、待删除旧字段非空行数、发布记录数。
- 活动生成作业和 Celery 队列数量；任一存在时先完成业务处置，不在维护窗口自动重放或改写状态。

本地测试至少覆盖 `0028 -> head` PostgreSQL 迁移、观测/发布定向后端测试、前端定向测试、OpenAPI 契约、lint、类型检查、构建和 `check-nginx-security.mjs`。

## 3. 一次性隔离恢复库

Hostdzire 按文档补齐 Debian 官方 `postgresql-client`。随后创建不持久化的一次性 PostgreSQL 16：

- 独立 Docker network 和唯一容器名。
- 数据目录使用 tmpfs，不挂载 `/root/partsignal-data` 或任何 staging volume。
- 只把数据库端口绑定到 `127.0.0.1:19002`。
- 用户、数据库和随机十六进制密码只在受保护 shell 内存中存在，不写文件、不输出。

维护窗口开始后，先停止旧 API、Worker 和 Scheduler，再从目标 release 运行 `backup.sh`。备份必须：

1. 非空且权限受限；
2. `gzip -t` 成功；
3. 记录 SHA-256；
4. 用 `restore-verify.sh` 恢复到新建空库；
5. 恢复后精确确认 revision=`0028_platform_logo_lifecycle` 和迁移前安全计数。

目标 release 的后端镜像在隔离 network 中使用恢复副本执行 `alembic upgrade head`。迁移后确认：

- revision=`0030_publication_record_delete`；
- 人工观测、逐篇结果、发布记录数量保持；
- `discovered/mentioned/accuracy` 保持；
- `recommendation_status/cited` 列不存在；
- 关键只读查询正常。

任一断言失败，删除一次性库，重启旧 `0028` release 的 API/Worker/Scheduler，结束维护窗口且不触碰正式数据库。

## 4. 正式发布与停写边界

隔离彩排通过后，在旧写入口仍停止的状态下运行目标 release 的默认 full 部署脚本。脚本完成后立即再次停止新 Worker/Scheduler，只保留新 API/前端供只读验收，避免后台任务在最终放行前推进业务状态。

维护窗口内要求其他操作者不执行业务写入。完整验收通过后：

1. 原子更新 `/root/partsignal/current`；
2. 启动并等待新 Worker/Scheduler 健康；
3. 再次检查 ready、容器、队列、内存和磁盘；
4. 宣布维护窗口结束。

若脚本在迁移前失败且正式库仍为 `0028`，重启旧 release 即可。若迁移已提交，禁止直接启动旧应用；优先保留现场并前滚修复。

## 5. Nginx 与公网验收

比较当前 release 与目标 release：

- staging 模板和项目安全 snippet 未变化：不重复安装或 reload，只执行 `nginx -t`。
- 任一变化：从同一个新 release 安装模板与 snippet，运行安全检查和 `nginx -t` 后 reload。

公网验收依次检查 DNS、live、ready、首页标题、真实哈希资源、`index.html`、SPA fallback、WOFF2、对象存储代理、缓存头和六项项目安全头。任何漂移都阻止更新 `current`。

## 6. Playwright 凭据边界

浏览器使用全新命名会话，只访问真实公网域名。启动 Playwright CLI 进程时，仅把远端环境中的 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 单个值注入该进程环境；自动化代码只引用环境变量名，不回显实际值。

提交密码前不执行 snapshot 或 screenshot。登录后只读检查工作台和 `/configuration/ai`，读取 console 与 requests；不创建数据、不修改配置、不保存 storage state。结束时退出登录、关闭会话并清除 shell 变量。

## 7. 回滚边界

- 迁移前：旧数据库仍为 `0028` 时，可重启已验证旧 release。
- 迁移后：`0029` downgrade 只能重建空列，不能恢复现场旧值；不得把旧 release 直接接到 `0030` 数据库。
- 必须回旧版本时：保持 API/Worker/Scheduler 停止，由负责人确认恢复点和数据取舍后，使用迁移前完整备份恢复主库，再启动兼容旧 release。
- 仓库没有自动覆盖 staging 主库的恢复脚本，因此实际主库恢复不在无人确认情况下执行。
- `current` 只是验收记录，不是流量开关；切换链接本身不能回滚容器或数据库。
