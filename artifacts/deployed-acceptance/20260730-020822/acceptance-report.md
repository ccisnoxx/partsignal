# PartSignal AI 专项补充验收报告

## 1. 结论

- AI 专项结论：**通过**
- 与完整验收合并结论：**部分通过**
- 补充 run-id：`20260730-020822`
- 关联完整验收 run-id：`20260730-002915`
- 测试对象前缀：`E2E-ACCEPT-AI-20260730-020822`
- 目标环境：`https://geo.962850.xyz`
- 执行时间：`2026-07-30 02:08–02:42 CST`
- 浏览器：项目 `playwright-cli`，持续命名 Chromium 会话
  `accept-ai-20260730-020822`，headed，`1440×900`

本轮使用用户明确授权且页面中已配置、已启用、连接测试已通过的
`gpt-5.6-terra`，补齐了此前受安全边界阻断的 AI 正向链路、格式失败、
Prompt 修正后重试、审核退回、新 revision、批准、审计追踪和刷新恢复。
AI 阻断已解除。合并结论仍为“部分通过”，唯一高优先级原因是原 run 的
DEF-002（快速双击创建两条内容任务）尚未修复；本轮没有修改代码或复测其修复。

## 2. 范围与安全控制

本报告仅补充原完整验收中因模型安全条件不足而未完成的 AI 项目，不重复执行
已经得到完整结论的独立 W0–W6 项目。执行前复用原 run 已完整阅读的验收计划、
部署文档、业务设计、OpenAPI 和数据库合同，并重新通过真实页面验证本轮模型、
事实、Prompt、任务、作业和审计证据；未直接沿用此前 AI 结论。

| 控制项 | 实际结果 | 状态 |
|---|---|---|
| 测试模型可追溯 | 页面确认渠道 `gpt`、模型 ID、渠道 ID、启用状态及既有连接通过状态 | PASS |
| 外发事实隔离 | 唯一输入为隔离测试产品的已批准 `PUBLIC V1`；未发送 RESTRICTED、未批准或归属不明事实 | PASS |
| 输出合同 | 合规 Prompt 要求单一 JSON 对象及 `title`、`summary`、`body_markdown`、`tags` 四个非空字段 | PASS |
| 失败透明 | 非 JSON 输出的作业明确为 FAILED，错误为“模型响应不是单个合法 JSON 对象”，未生成内容 | PASS |
| 历史不可变 | Prompt revision 0/1、失败/成功作业、内容 V1/V2、审核和审计记录均保留 | PASS |
| 外部发布边界 | 未向任何第三方平台真实发布 | PASS |
| 敏感信息 | 报告、截图和快照不包含密码、Cookie、Token、API Key、Authorization 或完整 storage state | PASS |

## 3. 模型与调用预算

| 项目 | 标识/结果 |
|---|---|
| AI 渠道 | `gpt`；ID `6f64a1f2-2a0d-48c6-a818-dfacf3c56c49` |
| 模型 | `gpt-5.6-terra`；ID `ca43062b-66c3-4170-9611-11e9b4b4a83e` |
| 渠道与模型状态 | 已启用，页面已有连接测试通过结果 |
| 唯一外发事实 | `1399c5dd-395a-4f79-a76d-500413f629a8`，APPROVED / PUBLIC V1 |

| 调用类型 | 上限 | 实际 | 结论 |
|---|---:|---:|---|
| 连接测试 | 1 | 0 | 复用页面已有可追溯的通过结果，不重复消耗外部调用 |
| 合规 AI 草稿 | 1 | 1 | SUCCESS |
| 格式错误 Prompt | 1 | 1 | FAILED，符合预期 |
| Prompt 修正后额外重试 | 1 | 1 | SUCCESS |
| 自然化 | 1 | 0 | NOT_APPLICABLE：页面提示未配置全局自然化 Prompt |

没有循环调用模型碰运气。格式错误后未点击“重试原快照”，而是先修正本轮 Prompt，
再以 revision 1 创建一次新作业。

## 4. 风险矩阵增量

| ID | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|
| R02 事实分级与外发控制 | 仅批准且明确属于测试用途的 PUBLIC 事实可外发 | 请求详情仅包含隔离测试 PUBLIC V1；未见 RESTRICTED 或其他事实 | PASS |
| R07 Prompt/模型/AI 作业版本一致 | 作业固定 Prompt revision、事实版本、模型、渠道与参数快照 | 合规作业显示 Prompt revision 1、PUBLIC V1、`gpt / gpt-5.6-terra`、`reasoning_effort=high`；Prompt 修订审计为 0→1 | PASS（由 PARTIAL 更新） |
| R08 高风险写入防重 | AI 生成不应因重复动作创建额外作业 | 受模型调用上限约束，生成入口均只单击一次，未执行会额外调用模型的双击场景 | NOT_APPLICABLE（本补充范围） |
| R12 外部依赖失败透明 | 模型输出失败不得伪装成功 | 非 JSON 输出作业为 FAILED、无内容版本；修正 Prompt 后另建作业成功 | PASS |

## 5. 核心不变量增量

| ID | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|
| INV-02 | 内容任务只引用已批准事实版本 | 两个 AI 任务均仅引用批准的 PUBLIC V1 | PASS |
| INV-03 | 被退回内容不得原位覆盖 | AI 内容 V1 退回后保留为 CHANGES_REQUESTED，修改由独立 V2 承载 | PASS |
| INV-04 | AI 作业绑定确定的事实、Prompt revision、模型与渠道快照 | 作业详情完整展示并固定上述快照，成功/失败作业均可追溯 | PASS（由 BLOCKED 更新） |
| INV-15 | revision/状态冲突不得静默覆盖 | Prompt 通过页面由 revision 0 明确修订为 revision 1，审计记录保留前后 revision | PASS |

## 6. AI 状态机矩阵

| 场景 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|
| 合规生成 | 单次创建作业，成功后产生四字段非空草稿 | 作业 `b6f02463-65c0-40b0-a9df-8d06c2c503ea` SUCCESS；内容 V1 四字段非空、5 个标签、质量问题 0 | PASS |
| 格式错误 | 非单一合法 JSON 应失败且不产生内容 | 作业 `464e92c6-4b31-42d1-a806-d8dd91f2c36d` FAILED；无内容版本 | PASS |
| Prompt 修正重试 | 修订后使用新 revision 新建作业，旧失败记录保留 | revision 1 作业 `5c3814e3-c650-411d-9c66-f533581e3522` SUCCESS；旧 FAILED 作业仍在 | PASS |
| 内容审核 | DRAFT→IN_REVIEW→CHANGES_REQUESTED；新 revision 再提交批准 | V1 被退回；V2 独立创建并完成 IN_REVIEW→APPROVED | PASS |
| 刷新恢复 | 刷新后作业、内容及状态仍可恢复 | 重载后 FAILED、SUCCESS 作业和修正后内容均保留 | PASS |
| AI 创建双击防重 | 额外外部调用不得超出预算 | 为遵守“合规草稿最多 1 次/格式错误最多 1 次/修正重试最多 1 次”，未执行双击 | NOT_APPLICABLE |
| 自然化 | 配置存在时最多调用一次 | 页面明确提示未配置全局自然化 Prompt，未调用 | NOT_APPLICABLE |

AI 生成作业状态机与 SM-AI-01 由原 run 的 BLOCKED 更新为 PASS；适用的成功、
格式失败、修正重试和刷新恢复均有本轮证据，没有无理由的 NOT_RUN。

## 7. W0–W6 增量

| 工作流 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|
| W0 安全模型前置 | 模型身份、渠道、启用和连接状态可追溯 | `gpt-5.6-terra` 及 `gpt` 渠道页面信息完整，未重复连接测试 | PASS |
| W1 安全事实前置 | 只使用本轮批准的 PUBLIC 测试事实 | 仅使用 PUBLIC V1 `1399c5dd-395a-4f79-a76d-500413f629a8` | PASS |
| W2 内容任务与内容审核 | AI 草稿成功，退回后新 revision 修订并批准 | 合规 V1 生成、退回；V2 独立修订并批准；主任务最终取消并保留历史 | PASS（由 PARTIAL 更新） |
| W3 发布 | 不因 AI 补测触发真实外部发布 | 未创建或执行第三方真实发布 | NOT_APPLICABLE |
| W4 发布异常恢复 | 本补充不重复原 run 已完成的异常发布链 | 原 run 结论保持 PASS，本轮无新增发布 | NOT_APPLICABLE |
| W5 GEO | 本补充不重复原 run 已完成的 GEO 链 | 原 run 结论保持 PASS，本轮无新增 GEO 记录 | NOT_APPLICABLE |
| W6 审计与权限 | Prompt 修订、成功/失败作业可审计且不泄露敏感值 | Prompt create/update 与两个作业 create 审计均可按 ID 检索；详情仅为非敏感摘要 | PASS（AI 增量） |

## 8. 测试对象与最终状态

| 类型 | ID | 最终状态 | 未删除原因 |
|---|---|---|---|
| 复用测试产品 | `a2967016-519e-46ce-98a2-7ae36b26435c` | ENABLED | 原 run 隔离测试历史依赖 |
| 复用 PUBLIC V1 | `1399c5dd-395a-4f79-a76d-500413f629a8` | APPROVED | 本轮唯一外发事实及不可变审核历史 |
| 复用合规 Prompt | `27dbd409-fca6-4b1f-9ee7-04e675ed4bd8` | revision 1 / 已恢复绑定 | 原 run 测试平台的原配置 |
| 复用测试平台 | `cadd4a6a-f645-43cf-bcf5-626b2efa32ea` | DISABLED / 已恢复原 Prompt | 关联历史任务、内容和发布记录 |
| 合规任务 | `420858be-050f-4ea2-99ac-7f68938c4e73` | CANCELLED | 含 AI 作业和内容，不破坏历史 |
| 合规作业 | `b6f02463-65c0-40b0-a9df-8d06c2c503ea` | SUCCESS | AI 作业历史 |
| AI 内容 V1 | `05da12ad-db90-47ff-b8f7-5472441cea6f` | CHANGES_REQUESTED | 保留退回内容和审核历史 |
| AI 内容 V2 | `96d6a77f-7606-4f2f-a6e8-c4186dc476e2` | APPROVED | 保留批准内容和 revision 历史 |
| 格式测试 Prompt | `e1ff345d-6164-4578-97f8-9142b1638583` | revision 1 / 未绑定 | 保留 revision 0→1 和审计历史 |
| 格式测试任务 | `a4ff70d9-2ddd-4008-ae3a-81c699515fa0` | CANCELLED | 含失败/成功作业和内容 |
| 格式失败作业 | `464e92c6-4b31-42d1-a806-d8dd91f2c36d` | FAILED | 负向状态证据 |
| 修正后作业 | `5c3814e3-c650-411d-9c66-f533581e3522` | SUCCESS | Prompt 修正后恢复证据 |
| 修正后内容 | `f16fa628-bfa4-4fc6-b01e-1475a9cc5340` | DRAFT | 成功作业产物和历史依赖 |

## 9. 缺陷与观测

### 9.1 功能/业务逻辑

本补充 run 未发现新的 AI 业务逻辑缺陷。合并结论仍受原报告缺陷影响：

| ID | 严重程度 | URL | 问题与复现 | 证据 |
|---|---|---|---|---|
| DEF-002（原 run） | High / P1 | `/content-tasks` | 打开创建内容任务弹窗，填写合法数据后快速双击“创建任务”；实际生成两条相同业务输入的任务 | 原 run `20260730-002915` 报告与证据 |

### 9.2 UI/UX/可访问性

本补充 AI 专项没有发现新的视觉、响应式、键盘或可访问性缺陷；这些专项的完整
视口和键盘结论仍以原 run 为准。原有 DEF-001（工程师直达无权限审计页反馈为空）
尚未修复，本轮不重复改写其历史结论。

### 9.3 控制台、请求和异常状态码

| ID | 严重程度 | URL | 实际结果 | 恢复与证据 |
|---|---|---|---|---|
| DEF-AI-001 | Low / P3 | `/platforms`、`GET /api/v1/platform-prompts` | 恢复平台原 Prompt 后，紧随 PATCH 200 的一次 GET 返回 502，控制台记录一条资源加载错误 | 下一次自动 GET 返回 200，页面最终状态正确；见 `platform-restored-good-prompt.yaml`、`platform-final-disabled.yaml` |

其余已观察请求中，合规、格式错误和修正后生成的
`POST /api/v1/generation-jobs` 均返回 202；最终业务状态分别为 SUCCESS、FAILED、
SUCCESS。登录后初始控制台为 0 error / 0 warning。除上述瞬时 502 外，未观察到
其他新增控制台错误或失败请求。

## 10. 关键证据

- 模型与渠道：`gpt-channel-detail.yaml`、`gpt-models.yaml`、
  `ai-model-options.yaml`
- 合规生成：`ai-ready-terra.yaml`、`ai-content-v1.yaml`
- 审核与修订：`content-v1-changes-requested.yaml`、
  `content-v2-approved.yaml`
- 格式失败：`bad-ai-result.yaml`
- 修正重试与恢复：`corrected-retry-result.yaml`、
  `corrected-task-after-reload.yaml`
- 审计：`audit-prompt-update-detail.yaml`、
  `audit-success-job-detail.yaml`、`audit-failed-job-filtered.yaml`
- 配置恢复：`platform-restored-good-prompt.yaml`、
  `platform-final-disabled.yaml`
- 登出与清理：`logged-out.yaml`
- 视觉基线：
  `screenshots/20260730-020822-ai-ready-terra.png`、
  `screenshots/20260730-020822-ai-content-v1.png`、
  `screenshots/20260730-020822-ai-content-v2-approved.png`

全部路径均位于
`artifacts/deployed-acceptance/20260730-020822/`。

## 11. 清理结果与残余风险

- 两个本轮内容任务均已取消，平台已恢复原合规 Prompt 并停用。
- 已退出测试管理员账号；命名浏览器会话已关闭，本地用户数据已删除。
- 未删除 Prompt、任务、作业、内容、审核或审计记录，因为这些对象构成本轮可追溯、
  不可变的测试业务历史。
- 未修改代码、数据库、部署、真实业务配置或历史业务记录。
- 未真实发布内容，未调用自然化。

残余风险：

1. DEF-002 仍可能造成内容任务重复创建，因此完整环境不能升级为“通过”。
2. DEF-001 仍使无权限审计页缺少明确反馈。
3. DEF-AI-001 表明 Prompt 列表读取存在一次瞬时 502；虽然自动恢复且未影响最终
   配置，但应结合服务端日志确认网关或后端瞬时失败原因。
4. 自然化未配置，故只能判定 NOT_APPLICABLE，不能证明该能力在本环境可用。

最终判定：**AI 专项通过；完整部署验收部分通过。**
