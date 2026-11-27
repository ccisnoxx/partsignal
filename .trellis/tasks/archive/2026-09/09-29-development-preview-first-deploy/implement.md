# 执行记录

2026-09-29 前置：用户选择现在部署开发预览。HEAD/local main/origin main 均为 975ea0f05a2a4bd7a3c62e7de41902c6408d043f；main 有前两项已评审、未提交的配置/文档/测试变更，候选 worktree clean。Hostdzire 只读现场：ROOT 仅 releases/shared，release 仅旧冻结三项，项目容器/网络 0，数据目录不存在，公网 410，Nginx site 为旧离线入口且 `nginx -t` 通过。

本机 `.env` (0600) 有 38 项且真实 OSS 四项已填写，但 `.env.staging` (0600) 仍为开发存储；直接复制整个 `.env` 会带入错误的环境/URL。`.env.production.ai.json` (0600) 有 15 项，供 Production 操作而非 staging 自动加载；其非 secret 检查显示 brand 枚举无效、owner/ready/TTY 未就绪、声明需要 custom headers。当前用户对本次是否接入真实服务的选择仍待回复。

`redeploy-staging-fast.sh` 需要 current release 和既有已迁移 DB，不适用首次空环境；使用 `deploy-staging.sh full`。该脚本的 `preflight-integrity` 在空库检查 `to_regclass` 后返回空问题，不依赖已有业务表，随后运行迁移。尚未进行 Git 提交、release/archive、远端写入或新门禁。

Remote旧shared `.env.staging` 只含30项（0600，旧关键布尔/密码身份有效），而本地新38项staging配置已通过Compose config --quiet与隔离Settings检查。故新部署不能直接复用旧30项；须备份后安装新文件，不输出值。Production AI --ai-only readonly检查 exit2/AI_CUSTOM_HEADERS_UNSUPPORTED，且brand无效、credential owner/ready/TTY未就绪；当前preview不读取此文件，不能外推为真实AI已启用。

## 最终部署结果（取代以上前置待办状态）

用户授权立即部署开发预览，未要求本次接入真实 OSS/AI。预览固定使用开发 fake-oss 与确定性 AI；本机 `.env` 的真实 OSS 字段及 `.env.production.ai.json` 未上传为 staging 运行输入。源码为 clean pushed `main`/`origin/main` 提交 `4e85aaf9f8c4f96dc121658f08ca49aa74810409`。新 release `preview-20260929-082104-4e85aaf9` 从该提交的 `git archive` 生成：1,930,049 bytes、755 项、SHA-256 `766f65d2d9bb42aa244722e6315ac561545fe87bef97ac3df5800093b11ed6c4`，无私有 env、secret、AppleDouble 或符号链接。忽略的 `.env.staging` 为 38 项、1,583 bytes、0600、SHA-256 `05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85`；远端旧 30 项文件已受控备份，新文件原子安装并保持 0600，未输出值。

最终 `make verify` exit 0，耗时 831.434 s，完整日志 233,517 bytes，SHA-256 `d9566bb2d4fcc2a3a989c8f2c11cdddc23f174ba04e66e4aed2cd3d8ec74f24d`。backend unit 691、真实 Docker integration 344、frontend Vitest 848、real-stack E2E 21、frontend 浏览器 E2E 494 通过，44 项按配置跳过；secret artifact scan clean。门禁覆盖生产构建、Compose/Docker、部署和生命周期。单独 `make test-deploy-scripts` exit 0，28.202 s，4,835 bytes，SHA-256 `2b4c36cef928e7edc4e20cba805ae5e3a671e5d46f8ea1005c1bee916437aba8`。受控测试数据库 0、Redis DB14 keys 0、端口 8000/9001/4174/19009 释放、临时存储移除、一时容器 0、测试网络 0；既存 Redis DB15 键未清除。早期门禁失败归因于 Colima 未启动、进程缺少数据库/Redis URL、DB15 已有键，以及定向 E2E 所缺的 Chromium；相关环境调整后才得到最终通过，早期失败不计为通过。

两轮独立只读 critical review 曾给出 BLOCKER：共享 env/Nginx 失败恢复不完整；公网验证可接受 3xx、缺少六项安全头验证，且归档/`current` 最终化在恢复保护之外。候选脚本逐项修复：归档在 env trap 生效时留存，公网根页面、JS、live/ready 精确 200 且检查六项安全头，`current` 在 Nginx trap 内设置并复验。第三位 fresh critical reviewer 对最终候选给出 **NO BLOCKER**。脚本/计划与候选哈希记录位于本机受限审计目录 `/Users/sc/.codex/audits/development-preview-deploy-20260929/`；三个 shell 脚本与两段嵌入 Python 语法检查通过。

最后只读远端前检：项目容器/网络 0、`current` 和数据目录不存在、公网 410、Nginx 有效、其他 9 个容器未变。`host-preflight-latest.json` 为 3,101 bytes，SHA-256 `a2f1a718e161e2b1a45d89a9705aaaf86c0237d569ceb48b797910bb557e46c8`。新 archive/env 上传到唯一 incoming 路径后，远端哈希、大小和 0600 权限均核对通过。准备步骤 exit 0；日志 223 bytes，SHA-256 `1c915421e2d010d85a60ef683f29c04b418792b76c35f030a4bb6361c98ff5d0`。

首次 `deploy-staging.sh full` exit 0；日志 43,698 bytes，SHA-256 `fae18d6cd99d153bf00bf49583ef427991f12eda2e2a8f4bf1aae6490b515574`。完成 PostgreSQL/Redis/fake-oss、完整性预检、迁移、worker/scheduler/API/frontend 和初始账号命令。激活前：7 个项目容器均运行、restart 0/OOM false、一时容器 0；三组网络物理名与 Compose logical label 一致，internal network 仍为 internal；API live/ready 与前端回环均 200，公网仍 410；其他 9 个容器未变。`post-deploy-pre-activation.json` 为 5,373 bytes，SHA-256 `cc90a9f07b0a8b399b86b5000998678559ddf79b086eea5142c7a58f461e485d`。

受保护的 Nginx 激活 exit 0；日志 588 bytes，SHA-256 `a812f633ca63375e37d9ca5141f45117c5409af0497e93c26c0adc3c8bbee8b9`。最终 `current` 指向 `releases/preview-20260929-082104-4e85aaf9`；公网根页面、JS、live/ready 精确 200，六项安全头匹配，pending marker 不存在，`nginx -t` 通过。本机外部 HTTPS 再次确认根页面 200（570 bytes）与 ready 200，PostgreSQL/Redis checks 均为 `ok`。激活后 7 个项目容器、3 个网络及其他 9 个容器的身份状态与激活前相同；旧冻结 archive/manifest 哈希与镜像存在性核对通过。`post-activation-verification.json` 为 4,840 bytes，SHA-256 `62c5c40c37d64f232dd73a9a1cfaf049f499a50d9d059537fa63f64e373a1e75`。

开发预览现可访问 `https://geo.962850.xyz/`。真实 AI/OSS 尚未启用，相关业务需后续单独配置验证。Production AI 参考文件的 brand 枚举、custom headers 与 credential owner/true-TTY 条件仍待正式发布流程解决；本次没有生成 Production manifest、修改 `.env.production`、进入 maintenance/quarantine/clean-init，或删除旧冻结证据。
