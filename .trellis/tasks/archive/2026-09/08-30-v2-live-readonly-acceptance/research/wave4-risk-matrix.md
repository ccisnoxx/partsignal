# 波次 4 高风险与外部副作用流程矩阵

## 执行状态

`NOT_RUN`。本文件只固化后续授权与隔离门禁，不授权也不执行任何波次 4 动作。

| 流程 | Canonical 入口 | 主要风险 | 后续执行前必须具备 | 当前硬停止条件 |
| --- | --- | --- | --- | --- |
| Platform Account 与 Logo | `/settings/platforms/$platformId` | 真实外部身份、对象存储写入、启用后进入发布候选 | Staging 专用账号、隔离 OSS、可撤销测试对象、精确清理验证 | 没有专用账号或隔离存储；不得创建账户或上传 |
| Publication Work 与结果登记 | `/publishing/work`、`/publishing/work/$workId` | Work 无对称删除；关闭会取消源任务；登记和验证产生保留历史 | 专用 TEST 内容与平台、允许域名、明确恢复模型、单独授权 | 缺少删除/恢复路径或需要真实 URL；不得 START |
| Published Article / Issue / Repair | `/publishing/articles/$articleId`、`/publishing/issues/$issueId` | 修改保留的发布历史；永久删除需要精确预览且受 GEO 引用阻塞 | 专用测试文章、完整依赖图、恢复/永久删除授权包 | 任何真实发布 URL、GEO 引用或无恢复路径；不得打开 issue |
| GEO Observation / Correction / Optimization | `/geo/observations/new`、`/geo/observations/$observationId/correct`、`/geo/insights` | 上传、候选一致性、append-only 修正链、完整链删除 | 专用发布候选、隔离附件、合成观测数据、候选冻结和清理演练 | 无专用候选或隔离上传；不得创建观测、纠错或优化任务 |
| AI Channel / Model Test / Discovery | `/settings/ai`、`/settings/ai/$channelId` | API key 加密存储、真实 provider 调用、预算和 revision 冲突 | 可撤销 Staging key、专用 provider、预算/超时、日志脱敏和删除演练 | 没有专用 key/provider；不得 test、discover 或 enable |
| Generation / Humanization | `/content/tasks/$taskId/editor` | Celery/AI 外部调用、job 阻塞清理、生成不可变版本 | 专用模型和队列、可取消 job、预算、发布隔离 | 无明确开发适配器和可取消性；不得生成或润色 |
| Review / Approval / 正式发布链 | facts/content review 与 publishing workspace | 进入不可变历史或只向前状态机，不能普通回滚 | 独立测试聚合、完整反向依赖清理、状态恢复演练、单独批准 | 无对称恢复；不得批准或正式发布 |
| Global Prompt | `/settings/prompts` 的全局配置 | 单例影响全局生成且无删除接口 | 变更窗口、旧值安全快照、恢复验证、影响面确认 | 没有恢复方法；不得修改 |
| 用户 reset / bulk / export | `/system/users` | 会话撤销、账号状态批量变化、密码与个人数据泄露 | 仅 TEST 用户、合成密码、导出隔离、恢复策略 | 目标不是专用 TEST 用户；不得 reset/bulk/export |
| 永久删除 | 合同暴露的 preview/action 接口 | 跨历史删除、依赖阻塞、不可恢复 | 精确 archived 聚合、preview、依赖清单、双重确认和新授权 | 当前任务没有永久删除授权；不得执行 |

## 共同授权包

任何波次 4 执行都必须重新确认 Staging 身份，并提供专用外部账号/对象存储/模型凭据、预算与超时、测试对象清单、不可逆状态说明、恢复或清理演练、敏感数据处理规则和新的用户批准。缺少任一项时保持 `BLOCKED`。

## 依据

详细页面、API、服务端状态和源码位置见 `research/wave3-reversible-business-scope.md` 第 3–4 节。该研究和本矩阵均未登录线上、未调用外部服务，也未使用任何 key、Cookie 或 token。
