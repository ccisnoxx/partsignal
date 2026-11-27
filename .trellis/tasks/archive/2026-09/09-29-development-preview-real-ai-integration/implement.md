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

## 用户自行配置后的恢复核对（2026-09-29 晚间）

- 用户告知已在管理员页面创建渠道与模型。只读查询确认渠道 `d6e8f8b9-a5b2-4b35-b175-ac20598526af`：provider brand=`OPENAI`、protocol=`openai-compatible-chat-completions`、revision=1、enabled=true；模型 `ac74a39e-5d40-4171-b22c-34f9e57c2d75`：精确 model ID=`deepseek-flash`、revision=4、test_status=`PASSED`、enabled=true、last_tested_at=`2026-09-30T04:03:39.197441Z`。brand 是管理员选择的分类，不据此推断实际上游厂商身份。没有自定义 Header 记录。查询仅允许身份、状态、revision 和数量，不查询 credential、Header 值、base URL 或配置正文。
- 这次线上配置满足模型测试及启用前置条件；本机参考文件此前缺项不再足以说明线上配置缺失。没有重新调用供应商测试。active Product、PUBLIC 批准事实、带 Prompt 的 active Platform、Platform Prompt、空 Content Task 和 GenerationJob 数量仍均为 0；需要正常业务流程准备明确命名的合成测试数据。
- 当前 runtime mode 仍未切到 openai-compatible；之前确认的设置消费缺陷没有改变。现有正式 Worker 路径能够调用真实客户端，不能由该缺陷推断真实生成不能执行；但原验收所要求的 env 模式切换和 deterministic 恢复仍不能被证明有效。已向用户请求明确是否改用渠道/模型停用门禁并将模式开关留待另行修复；决定到达前不执行依赖该决定的数据库/远端写入、生成调用或 env 修改。
- Git 恢复基线为 local main/origin/main=`f79b5dd55a8e9bf24179d627275fe9c36ac184de`，只读检查时工作树 clean；该提交只含先前任务记录，运行 release 未变。
- 只读健康核对 SSH exit 0，检查脚本 exit 1：唯一失败项为与首次部署历史基线比较的 `other containers`。原非项目容器 `sub2api-kin` ID=`7f8316e56b7f` 已由外部操作替换为 `8d631e3cb546`，新容器 running=true、healthy、restart=0、OOM=false；其余非项目容器没有漂移。本任务没有执行容器操作。该变化应在最终检查中使用本次恢复的基线比较并保留历史差异，不能声称原始全项检查通过。
- 7 个项目容器身份未变、restart=0/OOM=false；3 个网络、current release、Nginx 和 pending 状态未变。公网 root/asset/live/ready 均 200，六项安全 Header 一致。脱敏日志 `/Users/sc/.codex/audits/development-preview-real-ai-resume-20260929/remote-readonly.json`：6,898 bytes、SHA-256=`2c01215136fe9077e4a59e37fc3a088117786ce6bd6f8d61384a2621893848ff`；receipt 在同目录。远端核对时间为 `2026-09-30T04:08:24Z`，本机时区为 2026-09-29。
- 用户随后明确“继续”，已将恢复合同与验收同步为现有真实路径+配置停用门禁，不修改 env、不重建容器；历史模式开关缺陷仍存在。fresh `critical_reviewer` `/root/resumed_prewrite_review` 独立只读复核结论 **NO BLOCKER**；静态权限、revision、PUBLIC facts、严格输出 Schema、幂等/不可变版本、单作业和 secret 边界无新增阻断项。独立复核特别确认：已经通过配置检查的 RUNNING 作业可在停用成功后仍外发，失败恢复必须保留该限制和部分停用/冲突实态。
- 后续安全 DB 核对：endpoint 仅记录 HTTPS host=`api.deepseek.com`，不输出完整 URL 或 query；generation_eager=false，active Jobs=0，其余已启用且 PASSED 的身份/revision 未变。脚本最初容器名称及 Platform 列名选择错误导致只读 exit 1，改用已核验容器 ID 与权威 `is_active` 列后 exit 0；未执行供应商请求或 DB 写入。脱敏 DB 日志同 audit 目录 `db-safe-read.json`：1,056 bytes、SHA-256=`9751f4c200dd7e472dfb23542d471c6efc4cfa1af3265c89e4b3d9b03c09b0ba`。
- 恢复审计 Bundle `20260930T042643Z-development-preview-real-ai-resumed-7cc601f4` CLOSED/VERIFIED：1 次执行/交付验收、1 次 fresh 独立 review、无子代理写入或异常。NO BLOCKER 是写入前计划放行，不是业务完成或最终 E2E 复核。
- 浏览器恢复点：Chrome 的已发现本机 CDP 地址不可用；CLI open 不支持 `--cdp`，因此打开独立可见 session=`real-ai-resumed`，由用户亲自登录。仅调用 auth/session 读取 authenticated/admin 布尔摘要，没有读取表单值或保存 Cookie/Token/browser state。最后核对返回 HTTP 204（无会话）；暂未获可执行写入的管理员会话，测试数据脚本只准备在本机 audit 目录、未执行。等待用户登录这一必要前置，不是供应商配置缺失。按 `playwright-cli` skill 的 final 前清理规则关闭本任务 session，list 无活动 browser/session；CDP/CLI 选择失败不涉及远端或 DB 写入。
- 本轮结束前使用已诊断的恢复基线比较：健康检查 exit 0、全部通过；保留首次历史 `other containers` 差异。7 项目容器、3 网络、9 其他容器均与恢复基线一致，root/asset/live/ready=200，restart=0/OOM=false，release/Nginx 无漂移。日志 `final-health/remote-readonly.json`：6,898 bytes、SHA-256=`08493a89906f424783513c6fd73ae2230c7b1e353a37398417015ce38064986f`，remote UTC=`2026-09-30T04:44:48Z`。本轮没有远端/数据库写入、生成 Provider 调用或 env/容器修改；task 仍 in_progress，修改记录未提交，后续登录后可恢复正常测试数据与单次生成验证。

## 已登录侧栏浏览器中的真实生成闭环（2026-09-29）

- 用户告知已在 Codex 侧栏浏览器登录；复用其现有 tab 1，首页显示系统管理员。按用户当前指定的浏览器使用 CUA 的 Playwright/AX 操作；没有再次请求登录、读取输入框、读取 Cookie 或导出认证状态。首次写入前 NO BLOCKER 的范围/配置未漂移；再次只读确认模型 PASSED+enabled、channel revision=1/model revision=4、active Jobs=0，Git 仅有本任务记录修改。
- 正常产品流程创建 `DEV-PREVIEW-AI-20260929-2219`，Product=`c44dc902-283e-4e25-b96b-158e0b451a2a`。事实 Markdown 明确说明这是人工创建的合成样本，不对应销售产品，无规格或性能参数；保存为 PUBLIC，draft revision=1，提交后正常批准 FactVersion=`965f1c89-5cfb-49a7-9d88-4f49660f15e9` v1。
- 页面创建 PlatformPrompt=`3406aad6-60e9-4762-affa-8f16961523fc` revision=0，要求只按公开事实生成严格四字段 JSON，保留合成样本及使用限制。页面创建 PlatformType=`39663e14-0262-4a5d-9d1e-4c28aff7215c`。平台列表未提供创建入口，使用现有 ADMIN+CSRF 公开 API 创建 PlatformProfile=`b1f25fd0-b4b7-4ce7-aa60-313da2242bc6` revision=0 并绑定 Prompt，HTTP 201；CSRF 只在已登录浏览器内存流转，输出仅含 status/ID/revision，未打印请求/响应正文。创建后平台页面确认 enabled、无缺 Prompt；缺发布账号是非阻断提示，本任务不发布。
- 页面正常创建 ContentTask=`1f313697-2062-43ec-9d40-24492bf1f964`（CT-1F313697）。GET generation-options HTTP 200 返回 model=`ac74a39e-5d40-4171-b22c-34f9e57c2d75`、精确 model_id=`deepseek-flash`、channel=`d6e8f8b9-a5b2-4b35-b175-ac20598526af`、上述 Prompt revision=0 和平台身份。没有重测模型或更新 credential/Header。
- 从可见 Content Editor 点击“AI 生成首稿”，在“确认 Prompt 与模型”明确选择模型并点击确认按钮，仅一次。页面显示 Job=`01f4506d-9975-4779-9d81-ac5663f79511` 执行中，随后 Job list HTTP 200 返回 SUCCEEDED、attempt_count=1、error_code=null、ContentVersion=`8494fa1f-ab2c-4bb0-b5a0-f1337ee1d342`。开始 UTC=`2026-09-30T05:27:17.714461Z`，完成=`2026-09-30T05:27:19.541817Z`。没有重试、自然化、人工内容保存、审核或发布命令。
- Worker completion 日志通过固定格式 allowlist 提取，同一 Job/Version、GENERATE、SUCCEEDED、耗时 1767 ms。运行 release 的 worker.py/generation.py/openai_client.py SHA 与本机源码精确相同；generation_eager=false，正式 Celery Worker 不注入 generator，走 `OpenAICompatibleClient.complete`，无 deterministic fallback。Job adapter=`openai-compatible-chat-completions`；真实 target 为 HTTPS host `api.deepseek.com`。Usage 全量 HTTP 200：total_jobs=1、succeeded=1、failed=0、success_rate=1、prompt_tokens=257、completion_tokens=339、total_tokens=596、average_duration=1767 ms。渠道 Logs HTTP 200，有 5 条配置安全审计事件；业务完成记录在 Job、Worker 与任务 Activity，未伪称有独立的 channel completion audit 事件。
- PostgreSQL 只读 lineage：task current pointer、Job content_version_id 和 Version ID 一致；Version source_job_id 指向该 Job、source_type=AI、status=DRAFT、version=1、revision=0，created_at=updated_at，content_hash=`78f5c85a0cdcff74eeef10c0670771ba7db27d6bd53672d3705c9b1de529c741`。snapshot contract=`content-markdown-v3`，Prompt ID/revision、channel/model ID、精确 model ID、PUBLIC fact ID 都匹配；在 DB 内比较冻结的 system/user 消息与当前 Prompt/批准事实 Markdown，布尔结果均 true，不输出正文。content_review_records=0、publication_works=0、ContentVersion 数量=1、active Jobs=0。
- 所有正常 UI 操作均有服务端更新后的页面状态确认；API 创建平台 HTTP 201，options/jobs/usage/logs HTTP 200，DB/Worker/env/健康 SSH 核对 exit 0。Prompt 编辑曾因 AX setValue 未触发 CodeMirror 输入而被本地表单校验拒绝，改用 Playwright textbox.fill 后创建成功；没有把该本地失败当作 Provider 重试，也没有发生额外生成请求。
- 生成后健康核对 exit 0：7 项目容器、3 网络、9 非项目容器与恢复基线一致，restart=0/OOM=false，公网 root/asset/live/ready=200 且六项安全 Header 正确，pending 不存在、nginx -t=0、release 与 Nginx 身份未漂移。两端 env 仍各 1,583 bytes、0600、普通文件、非 symlink，本机 uid501/远端 uid0；SHA 均仍是 `05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85`。没有 env 安装、备份或重载动作，不声称配置切换；fake-oss/PostgreSQL/Redis/current release 均未修改。

### 脱敏证据清单

统一目录 `/Users/sc/.codex/audits/development-preview-real-ai-resume-20260929/`，证据 manifest 同目录；只有安全身份、状态、指标、布尔比较和不含敏感表单的截图，不保存 raw Provider log、secret、Cookie、env 值或完整消息。

| 文件 | bytes | SHA-256 |
|---|---:|---|
| generation-lineage.json | 4858 | e902687f4872b00c562c6833b4057cdd10f521c75e6183404bf6d0bc2bea3542 |
| worker-proof.json | 795 | ef76f6fbce22c9f4477ca3d1b3dd45e95b81031f903b5ff96440f0fc5983a8ab |
| usage-logs.json | 1536 | 2a0799ff81698ded208abdb4e1d8db3107e8a74edb969cb4b958f571af3724fc |
| env-metadata-final.json | 475 | 16c29bfd893dd55034f99bf370669709406d146f81bdbe4397fd3ba850b68e0f |
| generation-final-health/remote-readonly.json | 6898 | 96cdc2ba600e5622f0b93f5f4e6ed42d9a7ca5758728989aefdbbc4d822a251b |
| generation-final-health/readonly-check-receipt.json | 570 | f086b3ba7be9b55253c1f19a8be2b7a13076ac366270cff2ffdad5c2f5f0d628 |
| generation-result.jpg | 21284 | 5b66e14520bb041a17c6e3c713e930007b422ef43a2ad139d2d34f83a1a0faf5 |

### 覆盖缺口与保留限制

- 用户接受了原验收的明确调整，env 仍字面 deterministic，但有效执行为真实适配器。模式开关缺陷未修复，停用不能取消已通过配置检查的 RUNNING 作业；本次没有故意制造 Provider 失败或执行停用演练，该恢复路径有静态合同/独立审查证据。
- UI 曾观察“执行中”，精确 PENDING/RUNNING 瞬态未逐一采样；started_at/attempt_count、固定 Worker 状态机与 SUCCEEDED 记录共同证明执行转换，不伪称已采样每个中间态。渠道/模型 revision 为本次 live 配置核对值，历史 snapshot 冻结 ID/配置而不保存该 revision 字段。
- 尚不代表生产容量、长时间可用性或所有模型/协议测试。没有打开完整作业快照或导出/扫描原始供应商响应，不能将 allowlist 摘要扫描表述为所有进程原始日志的穷尽审计。当前成功无需重试；没有真实 OSS、Production cutover、I05 或产品代码改动。
- 收尾 `git diff --check` exit 0，任务 JSON/JSONL 解析通过。tracked 高信号 secret scan 覆盖 2,482 文件，2 个 unchanged baseline Bearer fixture/历史位置，5 个修改文件命中 0，受保护 env 均未 tracked；exit 0。`final-tracked-secret-scan.json`：859 bytes、SHA-256=`f5af9d344bb06c29b5f5296684e11cca99d4713beddadb2fd120ca065029a9d3`。只修改本任务 4 个记录文件和确实过期的开发预览说明，没有产品/依赖/Compose/部署脚本变化，因此不重复 make verify。本轮不另行提交或 push，main/origin/main 仍 `f79b5dd55a8e9bf24179d627275fe9c36ac184de`；本轮记录作为未提交 diff 保留，不声称工作树 clean。

## 最终独立复核与任务完成

- fresh `critical_reviewer` 独立只读最终复核结论 **NO BLOCKER**：核对五个实际修改文件、六份 JSON 证据及 SHA、真实 Worker 路径、Job/Version/Usage/lineage、环境健康与未审核/未发布状态；无子代理写入。失败恢复没有现场演练、PENDING/RUNNING 未逐帧采样、长期容量和原始日志未穷尽审计的覆盖限制仍保留。
- 审计 `20260930T053547Z-development-preview-real-ai-final-review-59d1d4b9` 已 CLOSED/VERIFIED，8 个产物校验通过，无警告/错误；validated SUBAGENT_EXECUTION_DIGEST：1 次执行、1 次验收通过、1 次 fresh 独立复核、无残留活跃 Worker。模型 `gpt-6.1-sol`/`xhigh` 来自固定配置证据，不声称独立运行时验证。
- 独立任务按用户确认的调整合同标记 completed；parent 仍为空，不修改已完成前端父任务或 I04，不创建 I05。保留真实生成的 DRAFT、Job 和审计历史；用户侧栏浏览器保留在生成结果页面，未关闭或导出登录状态。
- 最终仅本任务四份记录及开发预览说明有未提交 diff；不另行提交或 push，不声称工作树 clean。无产品代码、依赖、Compose、部署脚本或 env 改动，不重复运行完整 make verify。完成记录后停止本任务。
