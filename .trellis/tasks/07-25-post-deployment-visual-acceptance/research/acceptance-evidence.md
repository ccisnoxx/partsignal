# 线上视觉验收证据索引

## 权威来源

- `docs/Hostdzire部署上线流程.md`：预发布域名、发布停止条件和浏览器只读验收边界。
- `docs/Hostdzire部署附录.md`：公网健康、缓存、登录凭据、控制台、网络和远端只读复核要求。
- `.trellis/spec/frontend/visual-system.md`：唯一视觉规范、共享几何、主题、响应式、缩放和批准资产规则。
- `.trellis/tasks/archive/2026-07/07-25-frontend-visual-system-recalibration/assets/approved/manifest.md`：四张统一锚点与九张页面局部参考的最终批准记录。

## 已确认事实

- 预发布地址：`https://geo.962850.xyz`
- 视觉系统工作提交：`2f00036`
- 推送后的 `main` 提交：`bee2ef4`
- 统一视觉锚点：总览、用户管理、GEO 分析洞察、内容审核。
- 页面局部参考：审计日志、发布账号、Prompt 管理、平台规则、平台管理、GEO 观测、发布管理、AI 渠道与模型、内容任务。

## 页面路由

| 页面 | 路由 |
| --- | --- |
| 总览 | `/` |
| 用户管理 | `/users` |
| GEO 分析洞察 | `/observations/insights` |
| 内容审核 | `/content/:contentVersionId` |
| 审计日志 | `/audit` |
| 发布账号 | `/settings?tab=accounts` |
| Prompt 管理 | `/configuration/prompts` |
| 平台规则 | `/configuration/platform-rules` |
| 平台管理 | `/configuration/platforms` |
| GEO 观测 | `/observations` |
| 发布管理 | `/publications` |
| AI 渠道与模型 | `/configuration/ai` |
| 内容任务 | `/tasks` |

动态详情路由只允许从已有列表或只读 API 解析现有对象，不得创建测试数据。

## 安全边界

- 所有线上操作只读，不更新 `current`、不重启、不修改配置或业务数据。
- 优先复用已登录会话；必须登录时，密码只进入浏览器自动化内存，不输出、不截图、不写临时文件。
- 不在公网运行依赖 Mock Provider 的纵向 E2E，不更新视觉 snapshot。
- 浏览器能力或安全登录不可用时记录“UI 未验证”并停止，不用命令行健康检查替代页面渲染结论。
