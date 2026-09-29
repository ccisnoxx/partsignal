# 配置归属与流程设计

采用 `clean-code-design`：复用 `backend/app/config.py`、`backend/app/cli.py`、Production Compose 与现有 bootstrap 参数合同，不新增第二套加载器或 secrets owner。

1. `.env.example` 保持开发默认值；独立 `.env.production.example` 精确覆盖 I04-1 的 35 项完整结构。四个历史记录字段和一个构建输入显式标注，开发存储三个字段不进入 Production。
2. AI 供应商、模型、凭据仍由 PostgreSQL 配置拥有；新增 `deploy/production-ai.example.json` 仅为操作输入清单，九项参数映射和六项准备确认/credential 字节预算写在稳定文档，不宣称自动读取。
3. 本地 `.env.production` 与 `.env.production.ai.json` 排他创建为草稿，不生成或读取 secret。服务器现有完整文件继续复用，草稿不得覆盖它。
4. 配置交付是一项独立授权的远端操作：既有 scp/SSH 运输、明确受控存储、原子安装前预检和旧 checksum 检查；本任务只描述步骤，不实现或执行自动同步。
5. 准备清单早于 release freeze；manifest/image 绑定的 Engine preflight 仍在新 freeze 后、维护前。真实 AI/OSS 验证保持原状态机位置，不把配置齐全冒充服务成功。
6. 独立 review 确认 Compose 插值可使随机密码与编码后的 URL 不一致。新增只读 `check-production-inputs.py`：显式私有文件输入、literal/no-substitution 格式、URL-safe secret、固定生产边界、数据库 URL 解码一致；隔离 cwd/environment 后复用真实 CLI 与 AI Schema。无 Docker/SSH/网络或状态写入；仅自身临时空 cwd 在退出时清理。反例和缺项覆盖由既有 Production harness 拥有。
7. 新工具独立复核发现 bootstrap envelope 64 KiB 合同遗漏。改为复用真实 envelope reader/上限，按 Host 紧凑 UTF-8 格式计算元数据开销，包含固定长度 request ID，并给 owner 声明的 credential JSON 上界预留空间；不读取 API Key、不放宽 bootstrap。新增超限/多字节负例。`--ai-only` 用于服务器 runtime 已验证的现状，不制造本地空 runtime 缺项，也不宣称检查过 runtime。

8. 最终复核的匿名反例证明原始 hostname 不等于 HttpUrl 规范化结果。公网 IP/localhost 检查移至真实 envelope reader 返回值，剥除 DNS 尾部根标签点；覆盖缩写、十六进制、整数 IPv4 和 localhost.。不解析 DNS、不放宽 transport，不改 bootstrap 状态机。

验证使用公开模板与合成配置；不读取真实 `.env` 或 `.env.production` 内容。本任务不改应用/部署运行行为，不重跑 `make verify` 或复用历史 Gate 为当前修改背书；未来发布应在新最终 clean source 上建立 Gate。只读命令的 `PASSED` 不代表 provider/OSS 或首次部署可激活。
