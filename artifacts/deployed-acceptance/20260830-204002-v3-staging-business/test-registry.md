# 波次 3 TEST registry

- Run ID：`20260830-204002-v3-staging-business`
- 唯一前缀：`TEST-W3-20260830-204002-`
- 权威目标：`https://geo.962850.xyz`
- Staging 门禁：`PASS`
- 浏览器会话：`v3-staging-204002`
- 当前状态：`COMPLETE_WITH_FINDINGS`

| 顺序 | 对象类型 | 业务标识 | 精确 ID | 页面 | 当前 revision | 引用状态 | 预期写入 | 清理动作 | 清理结果 |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| 1 | Product | `TEST-W3-20260830-204002-P001` | `30b696e0-824e-4366-bbe4-542b33b8f552` | `/products/30b696e0-824e-4366-bbe4-542b33b8f552` | `1` | 删除前为 `FACTS_EMPTY`；任务 0、发布成果 0、GEO 观测 0；`available_actions=UPDATE,DELETE` | `POST /api/v1/products` → 201；`PATCH /api/v1/products/{id}` → 200 | `DELETE /api/v1/products/{id}?expected_revision=1` → 204 | `CLEANED`；活动列表无匹配，精确详情 URL 显示“未找到产品” |
| 2 | Platform Type | `TEST-W3-20260830-204002-PlatformType-Edited` | `253dd868-7732-4c56-9bee-00be3431d348` | `/settings/platforms/types` | `1` | 删除前 `platform_count=0`；`available_actions=UPDATE,DELETE`；`deletion.blockers=[]` | `POST /api/v1/platform-types` → 201；`PATCH /api/v1/platform-types/{id}` → 200 | `DELETE /api/v1/platform-types/{id}?expected_revision=1` → 204 | `CLEANED`；列表恢复“暂无平台类型” |
| 3 | Platform Prompt | `TEST-W3-20260830-204002-Prompt-Edited` | `ae1251bd-91df-4474-a8fc-ec1dec4ba9e3` | `/settings/prompts?promptId=ae1251bd-91df-4474-a8fc-ec1dec4ba9e3` | `1` | 删除前 `bound_platform_count=0`；当前绑定 0；`available_actions` 提供删除按钮 | `POST /api/v1/platform-prompts` → 201；`PUT /api/v1/platform-prompts/{id}` → 200 | `DELETE /api/v1/platform-prompts/{id}?expected_revision=1` → 204 | `CLEANED`；URL 回到 `/settings/prompts`，Library 恢复空态 |

## 已知阻断分支

- Query Topic：`BLOCKED`。波次 2 已确认列表接口首次加载及一次重试均返回 HTTP 422；本 run 不创建对象、不绕过 UI。
- Platform Profile：仅当本 run 的 Platform Type 与可选 Prompt 均保持独立、页面动作投影和禁用/删除条件完全明确时再评估；未满足时记为 `NOT_APPLICABLE`。
- W3-B/W3-C：`BLOCKED`。测试工具输出发生敏感值回显；在轮换管理员密码并获得新的独立会话/登录授权前不再执行。

## 硬停止

任何 401/403/CSRF、未知 5xx、revision 冲突、引用 blocker、动作投影缺失、清理返回非预期状态或环境身份漂移，均停止后续写入。只清理本 registry 中服务端返回的精确 ID，不按名称模糊匹配，不修改真实对象。
