# W0～W2 功能回归执行矩阵

## 1. 执行边界与证据

| 证据编号 | 环境 | 范围 | 数据处理 |
| --- | --- | --- | --- |
| `LIVE-W0-20260731` | 共享开发环境，`playwright-cli` 独立 ADMIN/ENGINEER 会话 | 登录、会话、角色直达、用户创建/改密/编辑/批量停用/删除、配置入口 | 自建两个 `qa2_r2_*` 用户；停用并删除后查询残留 0 |
| `LIVE-W1-20260731` | 共享开发环境，同源 API 与浏览器会话 | 产品编辑、RESTRICTED 事实工作区、版本审核状态机、不可变、任务取消/删除 | 自建产品、事实和任务；任务→事实→产品依次删除后残留 0 |
| `LIVE-W2-20260731` | 共享开发环境，只读浏览器核对与预期失败 API | 任务/内容详情、生成与自然化历史、失败原因、质量阻断、终态操作 | 未修改既有任务；预期失败重试前后作业数均为 7 |
| `AUTO-R2-20260731` | 本轮隔离单元、集成、E2E | W0～W2 完整正向、异常、并发和恢复性合同 | `make test-unit`、`make test-integration`、`make e2e` 均为零失败并完成隔离清理 |

共享开发环境的不可变历史只做只读核对；完整 AI、人工首稿、自然化和审核写链复用本轮刚执行且已精确清理的隔离 E2E 证据，不重复污染共享数据。

## 2. W0：认证、用户、平台与配置

| 用例 | 结果 | 证据/实际结果 |
| --- | --- | --- |
| 匿名直达、错误登录、正确登录 | PASS | 匿名 `/users` 跳转 `/login`；错误凭据显示“用户名或密码错误”；管理员登录进入 `/` |
| 强制改密、刷新、退出、后退、失效会话 | PASS | 新建 ENGINEER 首次登录进入 `/change-password`；改密后进入工作台；刷新保留会话；退出后 `/auth/me`=204，浏览器后退仍回登录；批量停用后原会话 `/auth/me`=401 |
| 管理员与工程师导航/直达权限 | PASS | ENGINEER 直达 `/users`、`/audit`、`/configuration/ai` 均显示“无权访问”；同轮 E2E 进一步验证管理 API=403，工程师正常业务入口可用 |
| 用户创建、编辑与旧 revision | PASS | UI 创建 `qa2_r2_eng_0731a`；外部改密后旧编辑数据保存得到 `REVISION_CONFLICT` 且未覆盖；刷新后编辑成功并在用户自身页头同步 |
| 批量停用、会话撤销、删除和审计 | PASS | 真实选中两个用户，确认文案显示影响，结果“已批量停用 2 个用户”；删除确认说明业务引用和审计保留；残留用户 0；审计含 created/updated/password_changed/deleted 的 SUCCESS 及旧 revision FAILED |
| 最后管理员、密码重置与用户边界 | PASS | `mvp-flow.spec.ts` 和 `test_identity_management.py` 本轮通过：最后管理员 409、弱临时密码 422、自重置阻断、其他会话撤销、业务引用删除阻断 |
| 平台类型、平台、Prompt 与绑定 | PASS | ADMIN 实页 `/configuration/platform-types`、`/configuration/platforms`、`/configuration/prompts` 正常加载；本轮 E2E/集成覆盖创建、编辑、revision 冲突、绑定、启停、引用阻断与删除 |
| 发布账号 | PASS | ADMIN 实页 `/settings?tab=accounts` 正常加载；本轮单元/集成覆盖 revision 编辑、启停、规范化重复冲突、禁用平台阻断和删除引用 |
| AI 渠道/Header/模型 | PASS | ADMIN 实页和详情正常加载；本轮 `ai-channel-management.spec.ts` 与集成测试覆盖创建、敏感值遮罩、Header、发现/测试/启停模型、失效重测、权限和删除历史 |
| 登录页浏览器资源 | FAIL | 独立登录会话重复请求 `/favicon.ico` 并得到 404；见 `PS-QA2-UI-001` |

W0 业务状态与权限合同通过，但因登录页资源缺失，波次结论记为 `FAIL`。

## 3. W1：产品与事实

| 用例 | 结果 | 证据/实际结果 |
| --- | --- | --- |
| 产品创建与编辑 | PASS | 自建产品返回 201，按 revision 编辑品牌返回 200；完成后删除 204 |
| PUBLIC 事实完整链 | PASS | 本轮 `mvp-flow.spec.ts` 真实完成 Markdown 工作区、版本创建、提交、UI 批准、生成引用保护和历史追溯 |
| RESTRICTED 事实完整链 | PASS | 自建快照完成 `DRAFT → PENDING_REVIEW → CHANGES_REQUESTED → PENDING_REVIEW → APPROVED → RETIRED`；历史动作为 submit/request-changes/submit/approve/retire |
| 工作区修订与版本不可变 | PASS | 创建 RESTRICTED V1 后把当前工作区改为 PUBLIC 和不同正文；V1 在批准、退役后仍保持原 RESTRICTED 分类、原 Markdown 与变更摘要 |
| 旧 revision 与非法状态 | PASS | 旧 revision 操作返回 409；本轮集成测试覆盖空退回意见、阻断质量问题、非法状态转换和版本独立审核历史 |
| 分级生成边界 | PASS | 任务允许锁定非 PUBLIC 事实，但 `test_generation_snapshot_rejects_non_public_fact` 与前端“非 PUBLIC 不请求生成选项”用例本轮通过，第三方发送边界显式拒绝 |
| 事实/产品删除和引用保护 | PASS | 本轮集成覆盖全部事实状态的无引用删除、内容引用 409、ADMIN/ENGINEER 权限；本次自建任务取消删除后，事实与产品依次删除且产品查询残留 0 |

W1 未发现新缺陷，波次结论为 `PASS`。

## 4. W2：内容任务、生成、自然化与审核

| 用例 | 结果 | 证据/实际结果 |
| --- | --- | --- |
| 内容任务创建、幂等、取消与删除 | PASS | 本轮 E2E 创建任务；集成测试覆盖同键重放、并发同键单任务、不同意图新任务；本次自建任务取消后 `available_actions=[DELETE]`，删除 204 |
| AI 首稿、人工首稿与自然化 | PASS | 本轮 E2E 真实经过本机 OpenAI-compatible HTTP 边界，产生 AI DRAFT、HUMAN DRAFT 和基于源版本的新自然化 DRAFT；源版本保持不变 |
| Prompt/事实/模型快照和历史 | PASS | E2E 校验 system/user message、模型参数、事实 Markdown、Prompt revision 与历史作业快照；共享实页展示最新追溯身份和参数，不回显完整敏感消息 |
| 生成失败、失败原因与恢复 | PASS | E2E 显示 `AI_PROVIDER_TIMEOUT`，更新配置并按原快照重试成功；集成覆盖安全诊断码、离线积压恢复和并发恢复锁 |
| 重复执行、迟到结果 | PASS | `test_duplicate_workers_use_one_real_provider_call_and_one_content_version` 与 `test_max_timeout_is_not_killed_early_and_late_response_cannot_win` 本轮通过 |
| 内容审核、退回、再提交、批准 | PASS | E2E 完成提交与批准；集成完成 submit-review/request-changes/resubmit/approve，退回意见和审核历史保持，批准后无可执行动作 |
| 人工修订、差异和批准后只读 | PASS | E2E 创建人工修订并展示版本差异；共享 V8 已批准内容没有编辑/审核按钮，显示“当前状态没有可执行审核操作” |
| 未知事实质量门禁 | PASS | 共享 V7 明确显示 `UNKNOWN_NUMERIC_FACT`、阻断问题 1 和“正文包含事实快照未批准的数字：99”；本轮测试覆盖阻断问题不得批准 |
| 禁用配置 | PASS | 本轮集成覆盖禁用平台阻断账号、任务、发布和修复；AI 配置变更使模型回到未测试/停用并要求重测 |
| 终态任务失败作业操作列 | FAIL | COMPLETED 任务仍显示可点击“重试原快照”；真实 POST 返回 409，作业数 7→7；见 `PS-QA2-FUNC-001` |

W2 主流程和服务端边界通过，但操作列与终态只读语义冲突，波次结论记为 `FAIL`。

## 5. 非法与恢复性专项结论

| 专项 | 结果 | 主要证据 |
| --- | --- | --- |
| 非法状态 | PASS | 最后管理员、空退回意见、质量阻断、终态服务端重试均拒绝 |
| 旧 revision | PASS | 用户编辑 409、事实 transition 409、Prompt/账号/平台集成冲突测试 |
| 未知事实 | PASS | `UNKNOWN_NUMERIC_FACT` 显式阻断，不替换为默认值 |
| 禁用配置 | PASS | 平台和 AI 配置状态门禁由服务端执行 |
| 重复提交 | PASS | 任务 Idempotency-Key、重复 Worker、单一内容版本 |
| 迟到结果 | PASS | 超时后迟到响应不能覆盖失败/重试结果 |
| 失败恢复 | PASS | 超时重试、Broker 元数据丢失、离线积压和并发恢复均通过 |
