# I04-3 证据与状态边界

`docs/frontend-v2/11-frontend-redevelopment-task-list.md` 允许 I04 按届时目标环境重新定义候选和部署验收。本轮目标是已经授权且完成首次部署的 Hostdzire 开发预览。I04-2 Production clean-init 路线的历史冻结证据保留原身份，终止状态只表达目标被替代，不表达执行成功。

远端检查脚本只读取固定路径元数据、Docker 的非敏感身份/状态/label、Nginx 检查退出码和公开 HTTP 状态/安全头；不读取 env 内容、凭据、Cookie 或业务数据。脱敏结果保存在本机受限审计目录，记录自身 bytes/SHA-256。用首次部署后快照逐字段比较容器和网络身份，用已记录的哈希比较历史 archive/manifest，用 image ID 存在性证明历史证据未覆盖。

输入连续性由 `git diff --name-status 4e85aaf9..HEAD` 与部署日志、review bundle 原件共同证明；任何产品/依赖/构建/Compose/部署脚本变化立即使复用无效。本轮只改状态记录，不对服务器执行写入。
