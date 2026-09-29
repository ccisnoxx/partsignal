# I04 Production 完整配置模板与本地准备流程

## 用户目标

一次取得完整配置项和填写位置，明确开发 `.env` 与生产 `.env.production` 的复制、交付和复用方式；已知缺项在 release freeze/维护前集中检查，不再中途分次询问。

## 交付与验收

- 开发模板保留原有有效值，纠正混用生产提示，说明实际未读取的历史字段与 Vite 代理输入。
- 独立生产模板列出当前生产文件完整 35 项；11 项必填留空，同源 `VITE_API_BASE_URL` 为空，不生成真实 secret。
- 提供完整 AI 九项 bootstrap metadata 与六项准备状态/credential 字节预算清单，不将未消费的 AI env 字段伪装成已支持配置。
- 仅在本地目标不存在时创建 `0600`、Git 忽略的 runtime/AI 草稿；不读写远端现有文件。
- 更新配置说明和 runbook：本地准备、单独受控交付、固定服务器文件后续复用、输入准备早于 freeze/维护。
- 提供本地只读输入检查命令，集中报告 runtime 与 AI 缺项，拒绝 dotenv 插值等已知风险；测试放在现有 Production harness，不新增测试框架。
- 静态完整性、当前实际 Settings/CLI 对合成配置的验证、部署回归与独立只读 critical review 通过。

## 范围

模板、文档、本地只读检查命令与非 secret 草稿；不改变应用配置加载、数据库 AI credential owner、bootstrap 状态机、部署/激活/回滚脚本或 Compose 语义。无配置上传、commit/push、新 release/manifest、maintenance/cutover。完成模板不表示真实 provider 输入或 External Services Gate 已就绪。
