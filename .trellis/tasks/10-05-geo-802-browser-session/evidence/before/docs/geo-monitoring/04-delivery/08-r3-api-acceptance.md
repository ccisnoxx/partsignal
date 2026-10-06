# R3 API 自动观测使用与验收边界

GEO-408 完成运行中心的自动采集读取、费用/用量/错误展示、显式新尝试及本地纵向验收。
交付状态与实际门禁以 [任务清单](./task-manifest.yaml) 和
[实施记录](../../../.trellis/tasks/10-03-geo-408-api-acceptance/implement.md) 为准。
本记录不授予真实供应商采集批准或生产发布权。

## 1. 管理员与工程师操作

1. 管理员配置现有 AI 渠道和模型，测试模型并分别启用模型、渠道。凭据只在受保护配置入口提交，不填写到问题或 Profile settings。
2. 建立 `MODEL_API` 观测面，确认合规和当前采集资格；创建 API Profile，绑定渠道/模型，设置语言、地区、并发与每分钟配额。
3. 对 Profile 发起一次固定诊断。通过后仍停用，必须单独启用。变更依赖会撤销资格；重新测试和启用后建立新批次，不覆盖旧输入。
4. 工程师在监测计划选择对象、问题和 Profile，检查服务端预览，在运行中心从计划创建冻结批次。Worker 通过既有队列领取稳定 Run UUID。
5. 在运行详情查看原始回答、引用位置、冻结输入、实际时间线及尝试链。R3 成功为 `COLLECTED`；分析、复核、业务指标、机会和复测明确未实现。

生产 `openai-compatible-chat` 的 registry 批准仍为 false，工厂输入仍为 `INTERNAL`，
当前 Collector 不允许非 PUBLIC 数据外发。普通生产配置不能完成第 4 步的外部采集；
本地验收只对严格虚构数据使用测试进程内批准和 PUBLIC 装配。不得通过改数据库分类、
放宽网络规则或复制测试装配绕过真实外发审批。

## 2. 页面与费用语义

- 可见页面的排队、采集中和实际分析执行阶段每 5 秒读取一次；后台暂停。R3 `ANALYSIS_PENDING` 已无执行器，停止空轮询。Batch 读取依据服务端完整计数判断是否仍有活动工作，不按当前页计算进度。
- 读取失败暂停自动轮询，保留上次成功数据，并提供适用的显式恢复入口；权限或资源不存在时按安全退出处理。后台读取不重置表单或焦点。
- 输入、输出、总 token 三项独立显示。供应商未报告时显示“未报告”，不补零，也不由前两项推算总量。已报告的零保持零。
- 实际费用保留十进制字符串和币种。未知费用不等于零；完整 Batch summary 包含历史失败尝试的费用覆盖，同 cell 的最新尝试决定状态。
- 外部调用状态、固定安全错误、HTTP 状态与 `Retry-After` 原值可读。429 冷却由服务端处理，页面不会自动重试发送。未知结果表示无法证明供应商未执行。

## 3. 显式 retry 与不确定回执

只有服务端返回 `RETRY` 动作时，页面才提供“创建新采集尝试”。确认框说明额外调用和费用，
POST 使用最新 `expected_revision`，追加同一 Batch/cell 的新 UUID 和 attempt_no。
原尝试、回答、引用、冻结输入与终态保留。已存在后继、权限、资格、配置或预算问题由服务端明确拒绝。

retry API 没有请求幂等键。网络中断、5xx 或非法成功回执不能证明未提交，页面保持结果未知，
只允许 GET 尝试链寻找直接后继。没有后继仍不能盲目重发；可稍后继续读取。
pending/unknown 阻断在同一 QueryClient 会话内跨详情关闭、运行切换和路由卸载保留，
仅保存命令身份与阶段；认证主体 epoch 变化后丢弃旧 continuation。
确定 409 等错误时先读取 canonical 投影，再由用户重新确认。响应到达前退出详情、
切换主体或选择其他运行后，旧响应不覆盖新的导航意图。

## 4. 本地验收入口和隔离

先提供本地 PostgreSQL URL 和独占、启动前为空的非 0 Redis logical DB。
CI E2E 使用 DB 14，后端 integration 使用 DB 15。不得使用共享 Worker 正在消费的库。

```sh
make e2e
# 只诊断 GEO-408 三种模式，不替代完整门禁
deploy/scripts/e2e-geo.sh
# 仅指定一个模式；其他基础配置与生命周期仍由 runner 创建
PARTSIGNAL_E2E_GEO_MODE=enabled deploy/scripts/e2e-local.sh
```

完整 `make e2e` 依次运行既有 canonical 真实栈、GEO 正常/关闭 API/关闭总开关三阶段、
原有 production artifact 页面 suite。每个真实阶段创建随机独占 PostgreSQL 数据库、
PostgreSQL owner marker、临时对象存储和 Beat 文件，并清理精确 Celery 键、PID、端口和数据库。
GEO provider 固定回环 `127.0.0.1:19012`，没有真实平台凭据或请求。
GEO phase 使用现有 `GEO_PENDING_REDISPATCH_SECONDS=2`、`GEO_RECOVERY_SCAN_SECONDS=5`
缩短 429 冷却后的测试等待；仍由真实 Beat 补投尚未发送的 PENDING 新尝试，
不改变生产默认 120/60 秒，也不重发已发送或 UNKNOWN 的旧尝试。

`backend/tests/geo_e2e_*` 只在显式 test 入口装配。启动必须验证测试环境、随机数据库名与
实际 owner comment、非 0 Redis、确切 fake 地址及虚构输入范围。业务运行使用真实
OpenAI-compatible Collector、pinned transport、Application Service、PG/Celery 和 production preview。
fake 控制接口只配置闭合场景、返回实际接收次数与正文 hash，不通过去重伪造 at-most-once。
Profile/模型诊断使用独立 UUID，业务 Header 使用 Run UUID，retry 使用新 UUID；不更新持久化渠道 Header。

关闭开关阶段先通过既有 Application Service 创建并真实排队 PENDING，随后启动采用关闭配置的
全新 API/Worker。验收读取 `FAILED/COLLECTOR_DISABLED/NOT_STARTED` 与该 Run 的 provider count=0。
既有历史仍可读取，新增或 retry 不被允许。不能以隐藏按钮、修改 env 文件或拒绝新建批次代替此证据。

## 5. R3 演示证据映射

| 路线图演示 | 验证边界 |
|---|---|
| 创建 API Profile 并测试 | 渠道/模型/观测面/Profile 的真实管理 UI、诊断后仍停用与显式启用 |
| 计划生成 API Runs、Worker 领取 | UI 创建计划/批次，真实队列稳定 UUID、PG 状态与自动轮询 |
| provider 返回回答/引用/usage/cost、保存 AnswerSnapshot | 原文、重复引用位置 `[1,3]`、部分 usage/null、实际费用与 immutable GET |
| 重复消息不重复调用 | 受控测试命令重复投递真实 Celery UUID，provider count 保持 1；既有 at-most-once integration 补充交错覆盖 |
| 发送后未知结果 | fake 接收后断连，真实 Worker 保存 `FAILED/COLLECTOR_UNKNOWN_OUTCOME/UNKNOWN`，不自动重发 |
| 显式新 attempt | UI 费用确认、单次 POST、新 UUID、旧终态不变、尝试链及原/新计数各 1 |
| 预算和分类边界 | 有限预算不足或 INTERNAL 输入在外发前失败，provider count=0 |
| API/总开关关闭 | 新进程消费已排队任务、NOT_STARTED、安全失败、provider count=0 |

具体执行命令、退出码、截图、失败分类和未运行项只记录在任务实施记录，不能将此映射表当作通过结论。

## 6. 运维与恢复

现有参数、锁序、预算账本、限速与前滚操作以
[部署与运维](../03-technical/08-deployment-and-operations.md#当前-r3geo-405-运维参数) 为权威。
开关是进程启动快照；变更后需重启 API、Worker、Scheduler，观察各进程采用一致配置。
紧急停止新采集时关闭开关并停止 Worker/Beat，保留已经发送的未知事实。
`SENT/UNKNOWN` 不回退为 PENDING，不批量清空账本、错误或冻结输入。

诊断使用 Run/Batch ID、固定 code、阶段、发送事实与安全 request ID；不得输出 prompt、回答、
API Key、Cookie/Header、签名 URL 或供应商错误正文。429/未知失败先读取历史，
再由有权限的操作者决定是否创建新尝试。当前配置已变化时建立新批次。

GEO-408 没有新 Alembic revision 或数据回填，head 仍为 `0053_geo_collection_admission`。
既有不可变迁移禁止破坏性降级；恢复采用关闭新发送、备份与兼容当前 schema 的前向修复。
GEO-801 Browser 服务和 GEO-902 dashboard/alerts 不在本次交付。
