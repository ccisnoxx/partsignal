# PartSignal Frontend V2 代码架构与目录结构

## 1. 架构风格

推荐：**Domain Vertical Slice + Thin Routes + Shared Design System**。

不采用非常重的多层 FSD 机械分层。PartSignal 的领域边界已经清晰，业务复杂度主要在 domain 内，过度水平分层会让一个业务修改跨越大量目录。

## 2. 推荐目录

```text
frontend-v2/
├── src/
│   ├── app/
│   │   ├── bootstrap/
│   │   ├── providers/
│   │   ├── router/
│   │   ├── auth/
│   │   └── layout/
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── login.tsx
│   │   ├── account/
│   │   └── _app/
│   │       ├── index.tsx
│   │       ├── products/
│   │       ├── content/
│   │       ├── publishing/
│   │       ├── geo/
│   │       ├── settings/
│   │       └── system/
│   ├── domains/
│   │   ├── product/
│   │   ├── content/
│   │   ├── publication/
│   │   ├── geo/
│   │   ├── platform/
│   │   ├── generation/
│   │   ├── identity/
│   │   └── audit/
│   ├── design-system/
│   │   ├── primitives/
│   │   ├── data-table/
│   │   ├── workspace/
│   │   ├── detail/
│   │   ├── forms/
│   │   ├── navigation/
│   │   ├── feedback/
│   │   └── status/
│   ├── shared/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── lib/
│   │   ├── hooks/
│   │   ├── constants/
│   │   ├── storage/
│   │   └── test/
│   └── styles/
├── .storybook/
├── e2e/
└── package.json
```

## 3. 依赖方向

允许：

```text
routes
  ↓
domains
  ↓
design-system / shared
```

禁止：

```text
design-system → domain
shared → domain
domain → route
```

Domain A 不直接 import Domain B 的内部组件。跨域关联优先通过 API summary DTO 或 route/application composition 处理。

## 4. Routes 必须薄

Route 文件只负责 validate search、loader/prefetch、permission、metadata、composition。完整页面业务逻辑放到 domain。

## 5. Domain 目录示例

```text
domains/content/
├── api/
│   ├── queries.ts
│   ├── mutations.ts
│   └── query-keys.ts
├── actions/
│   ├── registry.ts
│   └── resolve-actions.ts
├── model/
│   ├── search-schema.ts
│   ├── form-schema.ts
│   └── view-model.ts
├── tables/
│   ├── content-task-columns.tsx
│   └── content-task-table.tsx
├── components/
├── workspaces/
│   ├── content-editor-workspace.tsx
│   └── content-review-workspace.tsx
└── forms/
```

## 6. API 层

`shared/api/generated` 只放 OpenAPI generated types，不手工编辑。Domain 中用 query/mutation wrapper 封装 raw client，组件不要到处直接 `client.GET()`。

## 7. Query Key Factory

每个 domain 提供一致 query key factory，方便精准 invalidation，避免字符串散落。

## 8. Search Schema

每个列表 domain 独立定义自己的 Zod search schema。不要建立包含所有筛选字段的万能 schema。

## 9. Action Registry

每个 domain 的 `actions/` 负责 token → label/href/command/intent/confirmation，不计算 eligibility。

## 10. Design System 边界

Design System 只知道 UI 语义。例如 `<RowActions primary={...} overflow={...} />`，不能 import `ContentTaskStatus`。

## 11. Form Kit

`design-system/forms/` 提供 FormField、FormSection、FormActions、ErrorSummary、DirtyGuard；Domain 提供 Zod schema 和业务字段。

## 12. Editor

CodeMirror wrapper、toolbar、preview、diff、stats、dirty indicator 应形成稳定 Design System/Editor pattern，而不是只存在于某个页面。

## 13. Testing Placement

Unit/component 与源文件 colocate；E2E 单独放 `e2e/`，按业务闭环命名。

## 14. Barrel Files

谨慎使用 `index.ts`，禁止巨大 `export *` 让依赖边界不可见。只在稳定 public API 使用 barrel。

## 15. Circular Dependency

CI 至少阻止：`design-system -> domain`、`shared -> route/domain`、`domain -> route` 的反向依赖。可用 ESLint boundary 或 dependency-cruiser/madge。

## 16. Naming

- 文件：`kebab-case.tsx`
- Component：`PascalCase`
- hooks：`useXxx`
- query keys：`xxxKeys`
- Zod：`xxxSchema`
- API generated 类型：保持 contract 命名
- UI view model：`XxxViewModel`

## 17. Domain 关联

PublishedArticle 如果要展示 Content summary，不要 import content domain 的内部 Card；让 Publication API 返回必要 summary，由 publication domain 自己展示。

## 18. App Shell

`app/layout/` 负责 Sidebar、top shell、route outlet、mobile nav、account menu。业务导航 metadata 与 router 联动。

## 19. Auth

Auth 层只暴露 user、capabilities、isAuthenticated、signOut 等基础能力，不承载用户管理 domain。

## 20. V2 初始化原则

推荐独立 `frontend-v2/`：新 lockfile、新 Storybook、新 lint boundary、复用 OpenAPI，不复制 Ant Design theme，不先复制旧页面，从 Design System + Product Facts 第一条 vertical slice 开始。

## 21. Code Review Checklist

- [ ] domain 边界正确
- [ ] route 足够薄
- [ ] 没有重复 API DTO
- [ ] 没有从 status 推导 primary action
- [ ] URL state 用 Router schema
- [ ] Server state 用 Query
- [ ] 通用 UI 进入 Design System
- [ ] 没有新增自定义 action column 规则
- [ ] tests 足够
- [ ] responsive 验收
