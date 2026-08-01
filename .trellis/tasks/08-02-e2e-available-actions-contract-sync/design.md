# E2E `available_actions` 合同同步设计

## 1. 设计结论

只修正三个现有 E2E 文件中的响应 fixture、动态动作期待和真实作业等待。mock 必须显式符合当前产品响应，不在产品消费者、测试路由或共享 helper 中填补缺失字段；自然化用例同时验证“投影隐藏/禁用入口”和“命令最终守卫”两层合同。

## 2. 不变量

1. 每个资源响应的 `available_actions` 必填且使用资源自己的 typed token。
2. 认证自服务不是管理动作上下文，`UserOut.available_actions` 固定为显式空数组。
3. Product 的 `DELETE` 依赖引用事实；隔离 mock 没有该事实时不猜测删除资格，只提供稳定的 `UPDATE`。
4. 非空事实工作区可 `SAVE` 和 `CREATE_VERSION`，与 `product_facts_draft_out` 当前实现一致。
5. Prompt 是否存在由服务端投影决定 `CREATE_HUMANIZATION_JOB`；写命令仍在请求时重新校验并保留领域错误。
6. E2E 的兼容、安全和 MVP 业务目标不变，本任务不重写其流程。

## 3. fixture 同步表

| E2E 文件 / 端点 | 当前缺口 | 计划响应 | 权威依据 |
| --- | --- | --- | --- |
| `compatibility.spec.ts` `/auth/me` | 缺字段 | `available_actions: []` | 认证自服务合同 |
| `compatibility.spec.ts` `/products` | 缺字段 | `available_actions: ['UPDATE']` | `products_out` 的基础动作；不猜测引用型删除 |
| `trusted-types.spec.ts` 两处已认证 `/auth/me` | 缺字段 | `available_actions: []` | 认证自服务合同 |
| `trusted-types.spec.ts` `/products/:id` | 缺字段 | `available_actions: ['UPDATE']` | `products_out` 基础动作 |
| `trusted-types.spec.ts` `/products/:id/facts` | 缺字段 | `available_actions: ['SAVE', 'CREATE_VERSION']` | 非空 `product_facts_draft_out` |
| `mvp-flow.spec.ts` `/publication-candidates` 路由改写 | 只清空账号 | 同步清空 `available_actions` | 无匹配账号时 `list_publication_candidates` 不投影 `REGISTER` |

数组直接写在现有响应对象中。三个文件没有既有 generated Schema 类型导入模式，本任务不为六个字段引入新 helper、fixture 工厂或平行类型系统。

## 4. 自然化验证链

```text
全局自然化 Prompt 不存在
  → content_versions_out 不投影 CREATE_HUMANIZATION_JOB
  → 内容版本行“自然化”按钮禁用
  → 直接 POST 仍由服务端拒绝 409/HUMANIZATION_PROMPT_MISSING
  → 保存全局 Prompt
  → Prompt 页创建真实自然化预览并等待本次作业 SUCCEEDED
  → 页面重新获取内容版本
  → 服务端投影 CREATE_HUMANIZATION_JOB
  → 按钮启用并完成既有自然化作业与追溯验证
```

把未配置分支从启用期待改为禁用期待；直接 API 失败断言保持原样。真实预览以其 POST 返回的作业 ID 轮询完成，不复用上一次预览已经存在的标题；源内容使用字段匹配保持不变，同时单独断言当前动态动作。

## 5. 兼容与失败边界

- mock 字段值必须是合法 typed token；不使用 `as any`、可选链、空值合并或默认 `[]` 隐藏缺字段。
- 不把产品/事实删除资格写入 fixture，因为测试没有数据库引用事实且不验证删除入口。
- 如果定向 E2E 在同步字段后出现新的运行时错误，先核对真实响应合同和失败归因；不得扩大到修复产品代码，除非证据证明当前产品实现回归并返回规划阶段。
- 发布候选路由改写必须同时维护业务事实与动作投影，不能让测试通过修改 `matching_accounts` 诱导客户端自行推导资格。
- Dashboard 视觉基线仍会让完整 `make e2e` 保持一项已知失败，因此本任务以三个目标文件的隔离 E2E 为提交门禁，完整门禁留到基线任务完成后统一重跑。

## 6. 验证设计

1. 一次隔离 E2E 运行三个目标文件，让 Chromium、Firefox、WebKit 和 Firefox 无 backdrop 项目按现有 `playwright.config.ts` 自动选取匹配用例。
2. MVP 用例复用现有 setup、隔离数据库、Redis、worker、临时对象存储、开发前端和生产 preview；脚本退出时必须报告数据库和存储清理成功。
3. `make contract-check` 证明 OpenAPI、后端递归语义与生成类型仍一致且没有被测试修复改变。
4. 前端 typecheck、lint 与 `git diff --check` 覆盖 TypeScript 和格式门禁。

## 7. 回滚

没有迁移、数据或产品行为变化。若验证失败，整体回退三个测试文件的局部修改即可；任务资料保留失败证据。不得通过回退 required `available_actions` 合同或给消费者加 fallback 让旧 fixture 继续运行。
