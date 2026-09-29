# 执行计划与证据

## 写入前步骤

1. 核对本地 Git、旧候选工作区、远端 release/容器/网络/Nginx/pending、公开 HTTP、数据库 AI 配置安全摘要、本机 `.env.ai.json` 结构和权限；缺失供应商字段由用户本机补齐。
2. 检查 Settings/Compose/生成 Worker 的设置消费关系、AI 命令与 revision、安全日志、Prompt 与 Content 创建入口，选定精确容器重载和回退范围。
3. 形成受控写入命令/页面步骤、失败分支和安全证据清单；fresh `critical_reviewer` 只读复核为 NO BLOCKER 后才执行首次远端或数据库写入。若发现产品代码实质缺陷，记录 blocker 并停止本任务。

## 条件满足后的写入顺序

1. 打开可见管理员页面，由用户亲自登录并填写 API Key、必要敏感 Header；不截取或读取明文。创建 disabled channel，按最新 revision 添加 Header 与精确 model，执行一次真实模型测试。只有明确 PASSED 才 enable model/channel。
2. 核对 Usage/Logs 安全摘要及数据库 ID/revision/test 状态。记录本机/远端 env 元数据与 SHA，分别备份；构造只变更 `CONTENT_GENERATOR` 的候选，Settings 和 Compose `config --quiet` 通过后按原 SHA CAS/原子安装，远端 root-owned/0600/regular/non-symlink。本机与远端 SHA 精确一致。
3. 仅重载经代码确认实际消费该字段的服务；核对容器身份、restart/OOM、API live/ready 和公网。正常业务流程取得合格 Context，在 Prompt Preview 或 Content Editor 明确确认一次真实生成，跟踪 Job 和不可变 ContentVersion，核验 lineage 与 Usage/Logs。
4. 失败时分类为 provider/credential/网络、配置、环境或产品缺陷。仅在相关输入/证据变化后重测；对实质产品缺陷停止扩展，CAS 恢复 deterministic、禁用配置或按既有安全合同处理，保留审计/Job/Version。
5. 最终重复健康与漂移检查、`git diff --check`、tracked secret scan；fresh 独立只读高风险复核 NO BLOCKER 后记录非敏感身份/ID/revision/退出状态/日志 bytes+SHA、完成 task，必要时仅提交任务记录和确实过期的说明，非强制 push 并核对 main/origin/main/clean。

## 已完成只读基线

- HEAD/main/origin/main=`eb43b8140364b709394b2a364c4c2870ee889135`；创建任务前工作树 clean。旧候选工作区独立存在，未修改。
- current release 为 `preview-20260929-082104-4e85aaf9`。7 个项目容器运行，restart=0/OOM=false；3 个项目网络身份正确；其他 9 个容器运行。公网 root/live/ready=200，`nginx -t` exit 0，pending marker 不存在。
- 本机/远端 `.env.staging` 均 1,583 bytes、`0600`、普通文件，SHA-256=`05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85`；远端 uid=0，本机 uid=501。没有输出 env 值。
- 数据库 AI channels/models/headers 数量均为 0；API 进程 Settings 的 `content_generator` 为 `deterministic`。
- 本机 `.env.ai.json` 普通文件、非 symlink、owner 为当前用户、`0600`，JSON 有九项且类型有效。四项仍为空：`provider_brand`、`base_url`、`model_display_name`、`model_id`。HTTPS 检查因此尚未通过；不读取 Production AI 文件作为输入。

## 写入前 BLOCKER 与恢复点（2026-09-29）

- **BLOCKER：`CONTENT_GENERATOR` 不控制业务生成执行路径。** `backend/app/config.py:114-150` 只声明/校验配置，`backend/app/worker.py:41-44` 对 `process_generation_job` 不传 generator，`backend/app/services/generation.py:274-312,339-384` 在默认 `generator=None` 时直接走 `OpenAICompatibleClient.complete`。全 `backend/app` 的该设置使用仅在 Settings 与 Production CLI。当前 DB 没有渠道/模型，所以目前没有可执行真实 Job；但若按计划启用真实模型，env 即使仍为 `deterministic`，合格 Job 也会外发。仅把 env CAS 恢复为 deterministic 并重载 Worker 无法切断真实调用，违反本任务的生成模式切换与失败回退合同。`docs/development-preview.md` 对确定性 AI 的描述因此与实际运行路径不一致。
- 独立 `analyst` 只读调查与 fresh `critical_reviewer` 写入前高风险复核均确认上述调用链；复核明确结论 **BLOCKER**，没有放行首次数据库或远端写入。审计 Bundle `20260929T180831Z-development-preview-real-ai-integration-c2dc96c0` 已关闭并验证通过；2 次只读执行均按交付验收，其中独立高风险复核 1 次，子代理写入观测为 0。该审计通过只证明复核执行和证据记录，不代表本任务业务验收通过。
- 因 blocker 停止执行：未创建或启用 AI channel/model/Header，未让用户输入 Key/Header，未调用供应商，未创建 GenerationJob/ContentVersion，未变更 `.env.staging`，未重载容器，未修改 release/Nginx/网络/PostgreSQL/Redis/fake-oss。模型与渠道仍为 0；环境保持原始 `deterministic` 配置字面值，不能据此声称有可用 deterministic 生成器。只读登录页 Playwright 会话 `real-ai-preview` 已关闭，`playwright-cli list --all --json` 无活动 browser/session。
- 收尾只读健康脚本 SSH `hostdzire` exit `0`，全部检查通过：7 个项目容器、3 个项目网络、9 个其他容器身份未漂移，restart=0/OOM=false，公网 root/asset/live/ready 精确 200 且六项安全 Header 一致，`nginx -t` exit 0，pending marker 不存在，current release 与站点身份未漂移。脱敏日志 `/Users/sc/.codex/audits/development-preview-real-ai-20260929/remote-readonly.json`：6,898 bytes、SHA-256 `fb38e61ce7f0d225ffff7581061d8bdd9291d842cd1f96bcf448bd2db04102fd`；receipt 同目录 `readonly-check-receipt.json`：539 bytes、SHA-256 `6b1bb46d849fd4b07686768b14fc8068f1b05a953e6c8a2c15917405ea7da2d9`。日志仅包含脱敏身份和公开健康摘要，不含 env 值、credential、Cookie 或请求正文。
- 收尾再次只读核对，本机和远端 `.env.staging` 仍各为 1,583 bytes、普通文件、非 symlink、`0600`，SHA-256 均仍为 `05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85`；远端 AI channels/models/headers/GenerationJobs 数量均为 0。两项 SSH 核对退出码均为 `0`，未读取或输出 env 字段值。
- 记录范围只含本任务 Trellis 文件，未加入 `.env*`、浏览器状态或原始 Provider 日志。`git diff --check` 和暂存 diff check 均 exit `0`。高信号 tracked secret pattern 扫描覆盖 2,482 个 tracked 文件：命中 2 个原有且与 HEAD 字节相同的 Bearer fixture/历史文档位置，拟提交文件命中 0；四个受保护 env 文件均未被追踪。扫描 exit `0`；脱敏结果 `/Users/sc/.codex/audits/development-preview-real-ai-20260929/tracked-secret-scan.json` 为 957 bytes，SHA-256 `70920e27605f7a1345aec70236452bcd4ce439e0ecf0cf657045f87df3707f6e`。该启发式扫描不替代对未知秘密格式的完整检测。
- 恢复点：另行授权的产品代码任务应使正式 Worker 路径显式遵守 `CONTENT_GENERATOR` 模式门禁，证明 deterministic 下不调用真实供应商、openai-compatible 下准确外发，并修正预览文档；之后重新做独立高风险复核。恢复接入任务时重查本机 `.env.ai.json` 九项字段、两端 env SHA、远端健康和 DB 现状；禁用渠道/模型才是当前代码中可阻止后续新 Job 的运行门禁，且任何已入队 Job 须按现有安全合同核对，不可只依赖 env 回退。本任务维持 `in_progress`，不得标记 completed 或归入已完成的前端父任务。
