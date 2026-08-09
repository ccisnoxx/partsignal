# Frontend V2 Phase 2.3 — New Product Technical Design

## Contract 与 Backend

- `ProductCreate.part_number/brand/category` 在 OpenAPI 与 Pydantic 中统一为 trim 后 `1..160`。
- POST `/api/v1/products` 冻结声明 `201/401/403/409/422`；错误继续使用既有 `ErrorEnvelope`。
- Pydantic 请求边界 trim 并给出字段位置；service 使用已清理值，不增加兼容字段或静默默认值。
- `create_product` 在 `flush` 处只识别 `uq_products_normalized_brand`，回滚并抛出：

```json
{
  "error": {
    "code": "PRODUCT_ALREADY_EXISTS",
    "message": "品牌与产品型号组合已存在",
    "details": {
      "errors": [
        {"loc": ["body", "part_number"], "msg": "品牌与产品型号组合已存在", "type": "product_already_exists"},
        {"loc": ["body", "brand"], "msg": "品牌与产品型号组合已存在", "type": "product_already_exists"}
      ]
    },
    "request_id": "..."
  }
}
```

- 其他 `IntegrityError` 原样上抛，由既有请求事务回滚；不解析数据库错误文本。
- 数据库结构不变；`contracts/database.md` 只补充已存在的 `VARCHAR(160)` 和组合唯一约束说明。

## Route 与组件边界

```text
/_app/products                         navId=products, breadcrumb=产品
├── /products                          ProductsListPage
│   └── 现有 semantic header + 唯一 Link Primary「新建产品」
├── /products/new                      breadcrumb=新建产品
│   └── NewProductPage
│       ├── 页面标题与说明
│       ├── FormProvider + form
│       │   ├── ErrorSummary
│       │   ├── FormSection
│       │   │   ├── FormField part_number
│       │   │   ├── FormField brand
│       │   │   └── FormField category
│       │   └── FormActions：取消 / 创建产品
│       └── DirtyGuard
└── /products/$productId               已存在 canonical route
```

- route 只声明 metadata、读取 Auth CSRF context、组合页面，并注入 Cancel/created navigation callback。
- Product domain 拥有 form schema、DTO 映射、mutation/error mapping 和 NewProductPage。
- Design System 只复用现有 Form Kit，不识别 `ProductCreate`。
- 当前 V2 没有独立 PageHeader 组件；本 Task 扩展现有 semantic header，不新增无第二消费者的抽象。

## Form 与 API 数据流

```text
RHF raw values
  -> newProductFormSchema（trim / required / max 160）
  -> NewProductFormValues
  -> toProductCreate() satisfies generated ProductCreate
  -> createProduct(body, csrfToken)
  -> POST /api/v1/products
  -> generated Product canonical response
  -> reset dirty
  -> invalidate productsKeys.lists()
  -> /products/$productId
```

- UI schema 只描述表单输入，不导出手写 API DTO。
- wrapper 不导航、不 toast、不打开 Dialog、不写 Query cache。
- list query 只被标记失效；返回列表后从服务端重新获取 `ProductListItem` projection。
- 成功阶段先 `reset`，再在 DirtyGuard disabled 的 render/effect 周期触发导航，避免成功导航被旧 dirty 状态拦截。

## Error Mapping

- API wrapper 保留 `code/message/details/request_id`，不压平为仅含 message 的普通错误。
- mapper 只接受精确 `details.errors[].loc === ["body", approvedField]`；有效字段通过 `setError` 写入 RHF。
- 未知字段、畸形 details、无定位错误、403 和未知 code 使用 envelope message 进入 `root.server`。
- ErrorSummary 汇总当前三个 field errors、form-level error 和独立 request ID 项；字段项链接到固定 input id。
- mapper 不从 message 文本推导 duplicate、权限或字段身份。

## DirtyGuard、Pending 与导航

- `when = formState.isDirty`；pending 不关闭 guard，因为浏览器返回仍可能造成状态丢失。
- pending 时禁用全部字段、Cancel 和 submit；重复点击只能产生一个 POST。
- Cancel 调用 route callback 导航 `/products`，dirty 时由现有 guard 统一提示。
- success 用 canonical `Product.id` 导航 `/products/$productId`，不跳 Fact Workspace；无成功 toast。

## Compatibility 与 Rollback

- V1 只机械同步 generated schema；不改 V1 页面行为。
- 无数据库迁移、数据写入脚本、feature flag 或兼容层。
- rollback point 为分支创建基线 `a3f44cead73175c65b2126ad9c437ee55af4de02`；若实施前基线变化必须重新核验。
- 回滚只撤销本 Task 精确 diff，不使用 reset、历史改写或保留临时 wrapper。
