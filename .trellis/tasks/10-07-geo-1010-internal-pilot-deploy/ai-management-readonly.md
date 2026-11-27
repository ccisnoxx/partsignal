# AI 管理配置只读核对 · 2026-10-24

结论：生产运行模式及加密主密钥可复用；现有受保护AI清单只能复用非敏感配置意图，不能直接导入或宣称已可调用。线上AI管理三表为空。本轮未修改任何线上配置、业务记录或受保护本地配置，未登录HTTP会话、调用模型、发现模型、解析供应商DNS、重启或部署。

## 现场事实

检查时间：2026-10-24 10:09:29北京时间。目标为原生SSH别名hostdzire；完整脱敏结果见[证据JSON](evidence/ai-management-readonly-20261024.json)。

- API、Worker、Scheduler均运行镜像`sha256:d496dd545155f32a598f6e07cd86f3db17ac52bb56299e5abaf8cf7d0d48cc90`，Compose工作目录仍为`pilot-20261008-054601-6a96bfcb/source/deploy`。
- API实际Settings为production、CONTENT_GENERATOR=openai-compatible、AI_ALLOW_LOCAL_HTTP=false、aliyun_oss；三服务相应环境一致。
- `/root/partsignal/shared/.env.production`为0600。AI加密主密钥已设置，本地生产文件、远端受保护runtime和三容器值一致；比较仅在进程内完成，证据不保存值或其摘要。主密钥是数据库凭据加密用途，不是供应商API Key。
- 数据库事务明确`transaction_read_only=on`，schema为0066；ai_channels、ai_models、ai_channel_headers、generation_jobs、geo_observation_runs、platform_profiles均为0。不存在可直接启用的已配置模型，也没有需要解密复用的渠道凭据。
- 8份线上关键源码哈希与6a96bfcb对应Git blob一致。线上使用旧`OpenAICompatibleClient/pinned_http`，当前仓库已换SDK；本次按线上实现判断，不把本地SDK交付当作已经上线。

## 受保护配置能否复用

| 输入 | 实际核对 | 复用结论 |
| --- | --- | --- |
| `.env.production`的生成模式、主密钥 | 与线上匹配，模式已启用，生产禁用本地HTTP | 可沿用，不需要新增OPENAI环境变量、轮换主密钥、重启或重部署来完成管理端配置 |
| `.env.production.ai.json` | 0600；已有渠道名/描述、协议、HTTPS Base URL、model ID `deepseek-flash`、60秒timeout、空request_parameters | 可作为人工录入来源；未证明地址可达、凭据权限、model ID存在或输出合同兼容 |
| 品牌字段 | 文件值为`OpenAI`；线上AIChannelCreate直接schema校验返回provider_brand enum错误 | 不能照搬原值。需按实际展示分类选择受支持枚举，如OPENAI或CUSTOM；品牌不选择协议，也不能从模型名称推断供应商。仅用OPENAI作内存schema示例通过，未替用户保存选择 |
| 模型输入 | 线上AIModelCreate schema通过 | 只证明字段格式；不代表供应商支持或测试通过 |
| 自定义Header | 仅有旧`custom_headers_required=true`，无具体名称、敏感标记及值 | 不能猜填。确认该端点确实需要哪些Header；不需要时不配，需要时走管理端普通/敏感Header入口。Authorization由API Key生成，不作为自定义Header重复填写 |
| 供应商凭据 | 清单无API Key字段，credential_ready=false、owner为空；检查的`.env`/`.env.production`/`.env.staging`无常见供应商API Key变量 | 本次范围内未找到可复用供应商Key；不推断其他密码管理器或受保护来源不存在。未来由凭据持有人通过既有安全渠道提供，不写进证据或聊天 |
| `.env.ai.json` | 0600，品牌/Base URL/model等关键项为空 | 是不完整开发输入，不能补齐生产凭据或模型身份 |

实际运行`backend/.venv/bin/python deploy/scripts/check-production-inputs.py --ai-only --ai-inputs .env.production.ai.json`返回exit 2、AI_KEY_SET_MISMATCH，原因是旧custom_headers_required不属于现行清单键集合。其credential预算/TTY确认字段也未就绪，但这些是bootstrap路径的输入，不是已选择admin-ui路径的新前置条件。本次不要求为管理端录入重做bootstrap清单，不再运行Host首次初始化，不改部署state。

## 最小补齐项（尚未执行）

1. 确认沿用已有Base URL和精确model ID、凭据持有人及一份有效供应商API Key；有效性只能在获批真实测试后确认。
2. 将品牌映射到合法枚举；明确Header是否实际必要及所需值。沿用现有协议、timeout和空参数作为已有候选输入，不擅自新增供应商参数。
3. 未来在获批管理操作范围内创建**1个渠道＋1个模型＋仅必要的Header**，初始保持停用；模型真实测试通过后再启用模型和渠道。当前状态为空，所以是新增配置，不是更新现有配置。
4. 真实业务生成另需获批的ACTIVE产品、APPROVED且PUBLIC的事实版本、ACTIVE平台及当前非空Platform Prompt、OPEN内容任务，以及明确可外发的完整Prompt/事实正文和调用预算。当前平台为0且用户暂不创建平台，因此这部分仍不能执行；不能借AI配置批准扩展为平台/业务数据写入批准。

## 最小真实 smoke 范围（计划，不是本轮授权或结果）

| 阶段 | 最小动作及外部请求 | 通过依据 / 停止条件 |
| --- | --- | --- |
| A：连接与配置 | 选定单个模型，管理端执行1次模型测试；线上实现向chat/completions发送一条`hi`消息，不发现模型列表 | test_status=PASSED。测试会写测试结果且模型保持停用；失败保存错误，不自动改参数、换模型或重试 |
| B：真实草稿生成 | A通过并显式启用后，从获批内容任务页面提交1次GENERATE；真实Worker执行1次供应商请求 | GenerationJob成功，产生1份AI草稿；严格title/summary/body_markdown/tags合同通过，快照/来源可追溯；记录request ID、耗时及可用token数据，未知费用不补零。未知或失败先按同一job核对，不重复提交 |
| C：MANUAL GEO主链路 | 另行在获批产品/问题/Profile/样本范围内走MANUAL采集、分析、复核、Overview及评估/Action/Retest入口 | 线上geo-analysis-v1为DETERMINISTIC，model_name/model_version为None，Worker规则分析本身不调用外部模型；人工访问真实AI平台取得回答仍需另外的获批范围。完整流程仍需业务写入、样本/截图和验收，A/B通过不能替代 |

A+B在一次成功路径下共2次外部Chat Completions请求；不包括模型发现、自然化、批量生成、API/Browser自动采集、自动发布或UAT。模型测试成功只证明连接与响应外形，不能证明业务草稿Schema；草稿生成成功也不等于内容已批准或发布。60秒是现有渠道输入，不构成已批准费用/token上限；预算和失败后的重试范围需在未来执行范围中明确。

MANUAL确定性分析并不以AI管理配置为技术前置；其当前不能执行的原因包括线上数据写入限制、缺获批样本/平台，以及任务验收依赖。不要继续将所有MANUAL步骤笼统标成“等待AI配置”。

## 实际执行与限制

- 通过`ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes hostdzire 'python3 -'`执行限定容器inspect与受保护runtime内存比较；通过既有API容器`python -`执行只读SELECT、Settings读取、源码哈希及Pydantic纯schema校验。没有调用任何配置service命令或HTTP认证接口。
- 对关键文件执行`git show 6a96bfcb:backend/...`核对线上身份及调用边界；没有运行应用测试或完整门禁。schema用占位Key，不读取/解密供应商凭据，不调用validate_base_url（线上该函数会解析DNS）。
- 首次只读探针在SELECT回滚后因误用不存在的Settings.generation_mode字段输出失败，已改用真实content_generator完成核对；不把探针失败记作应用故障。
- 未更改线上/本地受保护配置、启用渠道/模型、创建业务数据、操作OSS、重启、部署、暂存、提交或推送。没有本轮后台进程或临时环境。任务继续in_progress，真实AI smoke仍NOT_RUN。


## 后续：受保护来源与最小录入方案已收敛

再次只读检查项目本地6份受保护输入、Hostdzire shared目录6份runtime/历史备份，以及API/Worker/Scheduler相关环境字段，未发现供应商API Key或具体自定义Header值。所有被检查文件均0600，本地及远端项目secrets目录不存在。来源列表及范围见[脱敏核对JSON](evidence/ai-protected-sources-20261024.json)。未遍历无关应用、浏览器存储、shell历史或其他项目凭据，未提取旧数据库备份；上一份线上AI三表为空的只读快照复用，本轮未重复查询数据库。

受保护Base URL的主机与DeepSeek文档端点一致，不是OpenAI官方API主机；当前品牌枚举没有DEEPSEEK，明确选择**CUSTOM（自定义）**，协议仍为openai-compatible-chat-completions。品牌仅用于展示，不改请求适配器。

[DeepSeek官方接入文档](https://api-docs.deepseek.com/)当前列出deepseek-flash及Bearer Key认证。仅查阅文档，未调用API；这补足模型名称的公开文档依据，仍不证明某个Key的权限、余额或业务草稿输出。线上openai_client.py负责Authorization，pinned_http.py负责JSON Content-Type；因此此直连方案**自定义Header留空**。旧custom_headers_required=true是旧准备元数据，不构成必须新增Header的供应商要求；不把它导入管理端，也不复制Authorization或Content-Type为自定义项。

最小管理端录入清单（尚未保存）：

| 项目 | 录入方案 |
| --- | --- |
| 渠道名称、描述 | 沿用受保护生产AI清单；名称可在管理端清楚标识DeepSeek |
| 品牌 | CUSTOM（自定义） |
| 协议 | openai-compatible-chat-completions |
| Base URL | 沿用已核对的受保护DeepSeek地址，不改成Anthropic接口 |
| API Key | 待取得该供应商授权Key，通过管理端敏感字段输入；当前未找到可直接复用来源，不使用加密主密钥代替 |
| 超时 | 沿用60秒 |
| 自定义Header | 空，0项 |
| 模型显示名 / model ID | 显示名沿用；model ID=deepseek-flash |
| request_parameters | 沿用空对象，不因文档示例而自行增加thinking/reasoning参数 |
| 初始状态 | 新建1渠道＋1模型，均停用；模型测试与启用留到单独获批执行阶段 |

因此当前唯一未找到的敏感输入是供应商Key；品牌/Header方案已明确。最小配置录入本身不创建平台、不产生内容、不启动模型发现/测试；测试会外呼且写测试结果，不能纳入本轮只读动作。先前真实业务草稿smoke仍需要获批平台/Prompt/事实/任务与外发范围，当前限制不变。

本轮只读SSH、结构化配置检查、候选源码阅读和官方文档查阅；只新增本地脱敏证据及任务说明。没有修改任何受保护源文件、线上配置或业务数据，没有外部AI调用、重启、部署、提交或推送。

## 当前等待状态（用户明确指示）

AI配置执行状态为`WAITING_SUPPLIER_API_KEY`；保留CUSTOM、无额外Header、deepseek-flash、60秒、空参数及新建后停用方案。配置尚未录入，测试/真实smoke仍NOT_RUN；DEPLOY保持in_progress。收到Key不自动启动写入或测试，应按届时授权执行。受保护来源原始证据保持不变。
