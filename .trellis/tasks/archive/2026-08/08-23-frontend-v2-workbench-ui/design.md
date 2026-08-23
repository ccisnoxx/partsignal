# Frontend V2 Workbench UI 技术设计

## 1. 设计边界

Workbench 是 `GET /api/v1/workbench` 的只读投影，不是跨域客户端协调器。服务端拥有数据选择、
action eligibility、workflow health、排序和 canonical href；前端只负责合同穷尽映射、格式化与可访问展示。

## 2. Ownership

| Owner | 文件 | 职责 |
| --- | --- | --- |
| API/query | `frontend-v2/src/domains/workbench/workbench.api.ts` | 定义唯一 aggregate query key、调用 generated client、保留结构化错误、关闭 query retry；不轮询、不 join |
| Model | `frontend-v2/src/domains/workbench/workbench.model.ts` | 穷尽映射 labels/visual tone，格式化 rate/date；不推导资格、href、health 或总数 |
| Page | `frontend-v2/src/domains/workbench/workbench-page.tsx` | 消费单一 query，渲染 loading/error/retry/success/empty，组合现有 primitives 与 semantic tokens |
| Route | `frontend-v2/src/routes/_app/index.tsx` | 声明 Workbench metadata，按相同 key 预取 aggregate，渲染 domain page；不映射业务字段 |
| Strict fixture/spec | `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts`、`frontend-v2/tests/e2e/workbench.spec.ts` | 合同驱动 fixture、意外 API 审计、Workbench UI/状态/链接/四档响应式验收 |
| Foundation smoke | `frontend-v2/tests/e2e/foundation-smoke.spec.ts` | 在 `/publishing` 验证受保护 App Shell；不允许任何业务 API |
| 蓝图 | `docs/frontend-v2/03-page-and-workflow-blueprint.md` | 记录 aggregate-only 页面结构，移除不存在的客户端总数 |

## 3. 数据流

1. `/` route loader 检查相同 Workbench query key 的缓存；无状态时预取一次 aggregate。
2. `WorkbenchPage` 使用相同 `queryOptions` 和既有的 30 秒 `staleTime` 模式，由 TanStack Query 复用
   loader 结果，避免挂载时重复 GET。
3. API 层只调用 `GET /api/v1/workbench`；没有第二业务 query、mutation、自动刷新或全局 store。
4. Model 对 generated union 做穷尽显示映射；页面将服务端 `href` 直接赋给原生 `<a>`。

## 4. Aggregate 合同到 UI 的穷尽映射

### 4.1 Actionable counts

| 合同字段 | UI 标签 | 链接形态 |
| --- | --- | --- |
| `fact_reviews` | 事实审核 | 直接使用 `href` |
| `content_reviews` | 内容审核 | 直接使用 `href` |
| `publication_verifications` | 待核验发布 | 直接使用 `href` |
| `publication_actions` | 发布处理 | 遍历并保留每个 `links[].label/href` |
| `content_issues` | 内容问题 | 直接使用 `href` |
| `geo_accuracy_issues` | GEO 准确性问题 | 遍历并保留每个 `links[].label/href` |

`value: 0` 仍显示数字和合同提供的链接。不求和形成 overall total，不根据 count 决定资格。

### 4.2 Attention queue

`FACT_REVIEW`、`CONTENT_REVIEW`、`PUBLICATION_VERIFICATION`、
`PUBLICATION_ACTION`、`CONTENT_ISSUE`、`GEO_ACCURACY_ISSUE` 全部通过
`satisfies Record<AttentionCategory, ...>` 映射标签/视觉 tone。标题、摘要、发生时间和链接均来自响应；
列表顺序不重排。空数组显示明确空态。

### 4.3 Workflow health

`product_facts`、`content`、`publication`、`geo` 全部通过生成类型的 key 做穷尽标签映射。
`CLEAR` 与 `ATTENTION` 只映射 Badge/颜色语义；说明文字直接显示服务端 `summary`，不根据 count
重新计算健康状态。

### 4.4 GEO 30 日 summary

展示 `window.date_from/date_to`，以及 discovery、mention、accuracy 三项的 numerator、denominator、value。
`value === null` 显示“暂无数据”；否则用既有平台能力格式化百分比，合法 0 显示为 0%。不渲染图表。

## 5. UI 与可访问性

- 页面内使用语义化 heading、section 和 native anchor；不为链接增加自制键盘事件。
- count 区域在 375 为单列、768 为两列、1024/1440 为三列；health 与 GEO summary 使用同一套既有
  responsive utilities 自然换列，不写 JS breakpoint。
- 长标题、summary 与链接允许换行；容器使用现有 max-width/padding 和必要的 `min-w-0`，页面根不得横向溢出。
- loading 保持页面结构的 Skeleton；fatal error 显示错误和现有 Button retry；retry 只调用 query refetch。
- attention empty 与 zero count 是成功状态，不进入 fatal error；nullable rate 不显示伪造的 0。

## 6. 测试职责

### Vitest

- `workbench.model.test.ts`：六类 count、六种 category、四域 health、两个 status、null/zero rate 的
  穷尽格式化行为。
- `workbench-page.test.tsx`：最小 component boundary，覆盖成功映射、empty/zero/null、fatal error 与 retry，
  并确认 canonical href 未改写。

### Workbench strict fixture Playwright

- fixture 提供 populated、empty/zero/null、loading、fatal error/retry 响应。
- 每次直接导航只允许一个 Workbench aggregate GET；loader 与 component 不重复请求。
- 任何跨 domain join 或未声明业务 API 都在 teardown 失败。
- spec 覆盖每个 canonical count/attention link 可通过 Tab 依次聚焦、空态、0 与 null 区分、retry，
  以及 375、768、1024、1440 的根节点无横向溢出。

### Foundation smoke

改为访问 `/publishing`，继续验证认证、导航、面包屑、main landmark 和刷新后的 App Shell。
`foundation.fixture.ts` 不改，因而 business API allowlist 仍为空。该 spec 不再承担 Workbench 业务断言。

## 7. 文档范围

只更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md`：删除无合同来源的总数，补齐六类 counts、
attention queue、四域 health、30 日 GEO summary 和 aggregate-only/canonical href 约束。
OpenAPI、05、07、08、09 已准确，本任务不修改它们。

## 8. 回滚策略

本任务没有持久化或合同迁移。若实施失败，删除本任务新增的 Workbench domain、tests/fixture，恢复根路由占位页、
Foundation smoke 原访问目标和蓝图对应段落即可。只回退本任务精确 hunks，不使用 `git reset --hard`、
`git checkout --` 或历史改写，也不触碰其他未识别改动。
