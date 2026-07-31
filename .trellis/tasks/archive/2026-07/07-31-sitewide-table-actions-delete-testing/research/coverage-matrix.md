# 全项目覆盖矩阵

## 1. 恢复后执行基线

- Run ID：`E2E-FULL-20260731-02`
- Git：`d446666929a9235e620cb5a65b4522984e2da913`
- 分支：`main`
- 数据库迁移：`0033_task_owned_history_delete`
- 环境：本机 Docker PostgreSQL 16、Redis 7.4、FastAPI；显式 `vite.config.ts` 的 Vite 5174；Playwright Chromium/Firefox/WebKit
- 状态只使用：`PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`、`NOT_APPLICABLE`

## 2. 自动化基线

| 检查 | 状态 | 实际结果 | 判定 |
|---|---|---|---|
| `make contract-check` | PASS | 运行时 OpenAPI、权威合同与前端生成类型一致 | 合同基线可用 |
| `make test-unit` | BLOCKED | 后端当前 `140 passed`；首次基线前端 `174 passed`、视觉合同 `23 passed`，但收尾全量前端 Vitest 补跑超过两分钟未结束并持续占满单 worker CPU | 相关修复定向测试通过，当前全量前端补跑不能记为 PASS |
| `make test-integration` | PASS | `68 passed` | 门禁恢复后的状态机、删除守卫、迁移和可靠性集成基线通过 |
| `make e2e` | FAIL | `51 passed / 1 failed` | 唯一失败为可复用 Prompt 页面旧“当前平台”文案断言 |
| DELETE 边界探针 | PASS | 13/13 | 匿名、工程师、管理员、CSRF 和未知目标边界符合合同 |
| DELETE 成功探针 | PASS | 13/13 | 首次 204、重复 404、目标消失和成功审计全部通过 |
| `make lint` | PASS | Ruff、ESLint、主题脚本通过 | 静态规范通过 |
| `make typecheck` | PASS | mypy 与 TypeScript 通过 | 类型基线通过 |
| `make build` | PASS | 后端、前端生产镜像构建成功 | 构建基线通过 |
| `make verify` | NOT_RUN | 只会重复上述分项 | 没有新增证明价值 |

## 3. W0–W6

| 波次 | 范围 | 状态 | 当前证据 | 失败或残余覆盖 |
|---|---|---|---|---|
| W0 | 认证、会话、用户、平台、Prompt、发布账号、AI 配置 | FAIL | 登录/权限、用户边界、平台与 Prompt 管理、AI 渠道/Header/模型 HTTP 和审计通过 | Header 删除影响说明缺失；Header/模型菜单确认取消后焦点丢失；Prompt E2E 旧文案断言失败 |
| W1 | 产品、事实版本、审核、不可变 | FAIL | 产品/事实组件、Markdown、审核状态、事实与产品引用删除守卫通过 | 产品删除确认焦点丢失；产品/事实版本使用“物理删除”术语 |
| W2 | 内容任务、AI 作业、人工首稿、自然化、内容审核 | PASS | 生成可靠性集成恢复；编辑工作台、人工首稿、AI 草稿、自然化 409、取消与删除通过 | 真实第三方提供商 smoke 未运行 |
| W3 | 发布候选、记录、证据、状态推进 | PASS | 发布工作台、状态命令、记录删除、共享附件保护和并发序列化通过 | 未将每个命令扩展为双标签完整笛卡尔矩阵 |
| W4 | 发布异常与修复 | PASS | 待办、详情、修复任务和状态边界由 E2E/集成覆盖 | 每个异常命令的网络迟到恢复未单独重放 |
| W5 | GEO 问题、观测、更正链、洞察、打印 | FAIL | 观测/纠错链/洞察/筛选/分页、三浏览器打印、320px 与 200% 通过 | 删除确认正文使用“物理删除”术语 |
| W6 | 重复、并发、恢复、跨页一致性、可访问性 | FAIL | 主题、reduced-motion、移动导航、常规 Modal、表格内部滚动和代表键盘流程通过 | Dropdown 危险确认焦点回收失败；并非每个写操作都执行双标签/迟到响应 |

## 4. 路由、表格与 UI/UX

| 维度 | 状态 | 证据 |
|---|---|---|
| 主要前端路由 | PASS | 静态/动态路由、匿名和权限页在当前 E2E 中挂载 |
| 24 张业务表运行边界 | PASS | `cross-page-visual-convergence.spec.ts:550` 在 1440/375 两个宽度执行通过 |
| 代表窄屏 | PASS | 375×900、320×800；表格保持区域内横向滚动 |
| 真实 200% 浏览器缩放 | PASS | 内容任务、发布、GEO、用户、AI 五类表格执行通过 |
| 打印 | PASS | Chromium、Firefox、WebKit 可读宽度通过 |
| 主题 / reduced-motion | PASS | 浅色、深色、跟随系统和动态效果偏好通过 |
| 键盘与焦点 | FAIL | 导航、Drawer、常规 Modal 通过；产品/Header/模型菜单危险确认取消后焦点落到 `BODY` |
| 对比度 | BLOCKED | 产品页深色普通文字自动抽样无失败；没有覆盖全部 24 表、全部状态色与主题 |
| 危险操作文案 | FAIL | 5 处页面仍出现用户可见“物理删除”；Header 删除缺真实副作用说明 |

## 5. 真实浏览器补充抽查

| 页面/对象 | 状态 | 观察 |
|---|---|---|
| `/tasks` | PASS | 152 条历史开发数据可加载；表格、分页和状态正常，无 console error |
| `/products` 桌面/375px | FAIL | 无文档级溢出，内部表格可滚动；删除确认使用“物理删除”，取消后焦点落到 `BODY` |
| 产品页深色主题 | PASS | 主题切换成功；普通可见文本 WCAG AA 计算抽样无失败 |
| AI Header | FAIL | UI 删除 204、重复 404、审计成功；确认缺少测试结论失效说明，取消后焦点丢失 |
| AI 模型 | FAIL | UI 删除 204、重复 404、审计成功；影响说明存在，但取消后焦点丢失 |
| 本机 Docker Vite | BLOCKED | 未跟踪旧 `vite.config.js` 导致代理 500；显式使用受跟踪 `vite.config.ts` 后正常 |

## 6. 未覆盖声明

以下内容不能折算通过：

- 13 个 DELETE 每条路径各自的双请求并发、状态在确认框打开后变化、网络迟到响应和 UI 缓存覆盖。
- 24 张表全部操作逐项执行确认、取消、重复点击和键盘回收；本轮几何与挂载通过不等于操作组合全部通过。
- 真实第三方 AI 提供商 smoke。
- 24 表全部状态色、图表、浅深/system 组合的自动对比度审计。

本轮未执行业务代码或现有测试修复，未覆盖项按报告任务约束如实保留。
