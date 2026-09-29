# 执行记录

2026-09-29 前置：用户选择现在部署开发预览。HEAD/local main/origin main 均为 975ea0f05a2a4bd7a3c62e7de41902c6408d043f；main 有前两项已评审、未提交的配置/文档/测试变更，候选 worktree clean。Hostdzire 只读现场：ROOT 仅 releases/shared，release 仅旧冻结三项，项目容器/网络 0，数据目录不存在，公网 410，Nginx site 为旧离线入口且 `nginx -t` 通过。

本机 `.env` (0600) 有 38 项且真实 OSS 四项已填写，但 `.env.staging` (0600) 仍为开发存储；直接复制整个 `.env` 会带入错误的环境/URL。`.env.production.ai.json` (0600) 有 15 项，供 Production 操作而非 staging 自动加载；其非 secret 检查显示 brand 枚举无效、owner/ready/TTY 未就绪、声明需要 custom headers。当前用户对本次是否接入真实服务的选择仍待回复。

`redeploy-staging-fast.sh` 需要 current release 和既有已迁移 DB，不适用首次空环境；使用 `deploy-staging.sh full`。该脚本的 `preflight-integrity` 在空库检查 `to_regclass` 后返回空问题，不依赖已有业务表，随后运行迁移。尚未进行 Git 提交、release/archive、远端写入或新门禁。

Remote旧shared `.env.staging` 只含30项（0600，旧关键布尔/密码身份有效），而本地新38项staging配置已通过Compose config --quiet与隔离Settings检查。故新部署不能直接复用旧30项；须备份后安装新文件，不输出值。Production AI --ai-only readonly检查 exit2/AI_CUSTOM_HEADERS_UNSUPPORTED，且brand无效、credential owner/ready/TTY未就绪；当前preview不读取此文件，不能外推为真实AI已启用。
