# V2 波次 3 Staging 可清理业务流程报告

## 运行身份

- Run ID：`20260830-204002-v3-staging-business`
- 唯一前缀：`TEST-W3-20260830-204002-`
- 权威目标：`https://geo.962850.xyz`
- 浏览器会话：`v3-staging-204002`
- 执行时间：2026-08-30 20:40:02–20:50:55（Asia/Shanghai）
- 执行状态：`FAIL（业务对象已全部清理；发现 1 个 P2 产品缺陷和 1 个测试工具敏感输出事件）`

## 门禁

- Staging 运行态正面门禁：`PASS`。
- 执行前公网首页、live、ready：HTTP 200；PostgreSQL、Redis 为 `ok`。
- 当前只允许通过 V2 UI 创建、编辑并精确删除 TEST registry 中的低风险对象。

## 结果

### 汇总

已获授权的三个 W3-A 低风险流程均通过当前 V2 UI 完成创建、详情/列表核验、编辑与精确删除，所有对象均使用本 run 唯一前缀和服务端返回的真实 ID/revision。没有创建事实版本、内容任务、GEO 记录、平台 Profile、账号、上传或外部调用；业务对象无残留，append-only 审计按合同保留。

整体不判为 `PASS`，原因有二：Prompt 名称单独修改时出现保存按钮错误禁用；测试工具在登录和一次请求诊断输出中意外回显敏感值。后者未落盘，但工具输出不可撤回，因此后续登录测试必须先轮换管理员密码。

| 流程 | 创建 | 编辑 | 删除 | 最终状态 |
| --- | --- | --- | --- | --- |
| 空产品 | `POST /api/v1/products` → 201 | `PATCH /api/v1/products/{id}` → 200，revision `0 → 1` | `DELETE ...?expected_revision=1` → 204 | `PASS / CLEANED` |
| Platform Type | `POST /api/v1/platform-types` → 201 | `PATCH /api/v1/platform-types/{id}` → 200，revision `0 → 1` | `DELETE ...?expected_revision=1` → 204 | `PASS / CLEANED` |
| Platform Prompt | `POST /api/v1/platform-prompts` → 201 | `PUT /api/v1/platform-prompts/{id}` → 200，revision `0 → 1` | `DELETE ...?expected_revision=1` → 204 | `PASS / CLEANED` |
| Query Topic | 未执行 | 未执行 | 未执行 | `BLOCKED`：沿用 P1-002 列表 GET 422 当前证据，不绕过 UI |
| Platform Profile | 未执行 | 未执行 | 未执行 | `NOT_APPLICABLE`：本次授权收口到空产品、Platform Type、未绑定 Prompt |

### Product：PASS / CLEANED

- 业务标识：`TEST-W3-20260830-204002-P001`
- 精确 ID：`30b696e0-824e-4366-bbe4-542b33b8f552`
- 创建后：`ACTIVE`、`FACTS_EMPTY`、`ENTER_FACTS`、revision 0、`available_actions=UPDATE,DELETE`。
- 引用投影：事实为空、任务 0、发布成果 0、GEO 观测 0。
- 编辑后类别为 `TEST-W3-20260830-204002-Category-Edited`，revision 1。
- 删除返回 204；活动列表无精确业务标识，精确详情 URL 显示“未找到产品 / 该产品不存在，或已被删除”。
- 证据：`screenshots/01-product-edited-before-cleanup.png`。

### Platform Type：PASS / CLEANED

- 业务标识：`TEST-W3-20260830-204002-PlatformType-Edited`
- 精确 ID：`253dd868-7732-4c56-9bee-00be3431d348`
- Slug：`test-w3-20260830-204002-platform-type`
- 创建及编辑后均为 `platform_count=0`、`available_actions=UPDATE,DELETE`、`deletion.blockers=[]`；revision 1。
- 删除返回 204；列表恢复“暂无平台类型”。
- 证据：`screenshots/02-platform-type-edited-before-cleanup.png`。

### Platform Prompt：PASS / CLEANED，伴随 P2-004

- 业务标识：`TEST-W3-20260830-204002-Prompt-Edited`
- 精确 ID：`ae1251bd-91df-4474-a8fc-ec1dec4ba9e3`
- 创建后 revision 0、`bound_platform_count=0`、当前绑定 0。
- 编辑保存前先 GET 最新详情，随后 PUT 返回 200；编辑后 revision 1、绑定数仍为 0。
- 删除前重新 GET 最新详情，DELETE 使用 `expected_revision=1` 并返回 204；URL 回到 `/settings/prompts`，Library 恢复空态。
- 没有运行真实 Preview，没有绑定平台、模型或内容任务。
- 证据：`screenshots/03-prompt-edited-before-cleanup.png`。

## 新缺陷

### P2-004：Prompt 仅修改名称时保存按钮错误保持禁用

- 严重度：P2 / Medium
- 类型：功能逻辑 / 表单状态
- URL：`/settings/prompts?promptId=ae1251bd-91df-4474-a8fc-ec1dec4ba9e3`
- 前置状态：本 run 新建的未绑定 Prompt，revision 0；名称与 Markdown 均为已保存合法值。
- 最短复现：只把名称改为带 `-Edited` 的合法值并移出焦点。
- 预期：页面显示有未保存修改，“保存 Prompt”可用，提交包含当前 Markdown 和 `expected_revision=0`。
- 实际：页面显示“有未保存修改 · 基于 Revision 0”，但保存按钮为 `aria-disabled=true`，禁用原因显示“请先修正表单错误”，页面没有对应字段错误；没有发出 PUT。只有再次触碰并填写合法 Markdown 后，按钮才启用，随后 GET detail 与 PUT 200。
- 影响：管理员无法只修改 Prompt 名称；必须无意义地触碰 Markdown 才能保存，且错误提示没有指出字段。
- 代码侧佐证：`PromptEditor` 的 `canSave` 同时依赖 `form.formState.isValid`，现有 E2E 只覆盖 Markdown 编辑，没有覆盖名称单独编辑。该根因判断为基于运行行为与源码的推断，不替代修复任务中的最小复现。
- 截图：`screenshots/03-prompt-edited-before-cleanup.png` 记录同一 Prompt 编辑器在完成 workaround 后的 revision 1 与零绑定状态；禁用瞬间由 DOM/ARIA 与无 PUT 网络证据确认，未另存临时快照。

## 审计与清理

- 当前系统审计中，Product create/update/delete、Prompt create/update/delete 以及 Platform Type delete 均为成功事件并指向本 registry 精确 ID。
- Platform Type create/update 不在当前 `RETAINED_AUDIT_ACTIONS` 白名单内，因此没有把缺失事件判为线上缺陷。
- 抽查 Prompt delete 审计详情只展示稳定 ID、成功结果、解绑平台数 0 和安全结果说明；没有发现正文、密码、Cookie、Token 或其他秘密。
- 审计记录为 append-only 保留，不属于业务对象残留；没有尝试删除或修改审计。
- 清理后公网首页、live、ready 均为 HTTP 200，PostgreSQL 与 Redis 为 `ok`。

## 测试工具敏感输出事件

登录时虽通过不回显终端输入提供密码，但当前 `playwright-cli` 在生成代码输出中仍把填充值回显为明文；随后执行一次 `request 103` 又输出了临时 CSRF header。敏感值未写入任务文件、报告、截图、storage state 或 CLI 临时文件；文件级精确凭据扫描结果为 `credential_file_matches=0`，会话已关闭，当前 `browsers=[]`、`servers=[]`。本 run 的 28 份临时 YML/console 文件已按精确文件名永久删除，无法从工作区恢复。

但工具输出本身无法撤回，管理员密码仍应视为已暴露。后续 W3-B/W3-C 或任何再次登录保持 `BLOCKED`，直到用户轮换该密码并提供新的授权；本任务不会再次复用旧凭据。

## 范围与残余风险

- 本 run 没有执行 Query Topic、Platform Profile、W3-B/W3-C、波次 4 或任何外部副作用流程。
- 三张持久化截图已人工检查，不含密码、Token、Cookie、CSRF、API key、请求 Header或内部用户名；仅包含 ADMIN 角色标签和 TEST 业务数据。
- `playwright-cli` 持续提示项目 skill 与工具版本不匹配，但本 run 的页面操作和网络状态可被当前工具观察；这仍是后续自动化可靠性风险。
