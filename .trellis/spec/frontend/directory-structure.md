# 前端目录结构

> canonical `frontend/` 的模块职责与依赖方向。

## 目录布局

```text
frontend/
├── src/
│   ├── app/                 # Router、认证 Provider、导航和 AppShell
│   ├── design-system/       # primitives 与可复用 table/form/editor/workspace patterns
│   ├── domains/             # 按业务域组织的 model、API、页面与组件
│   ├── routes/              # TanStack Router 文件路由、search/loader/metadata/composition
│   ├── shared/              # API generated/client、通用 hooks 与无领域依赖工具
│   ├── styles/global.css    # Tailwind、语义 Token 与真正共享样式的唯一入口
│   └── test/                # Vitest/jsdom 公共 setup
├── tests/e2e/               # Playwright fixture 与 real-stack specs/fixtures
├── .storybook/              # Storybook 配置
├── scripts/                 # OpenAPI 等前端静态检查
├── Dockerfile               # development、build 与 Nginx runtime stages
├── nginx.conf               # canonical production artifact 容器配置
├── playwright.config.ts
└── vite.config.ts
```

`frontend-v2/` 和旧 V1 源码目录均不是受支持入口，不得恢复第二套前端。`docs/frontend-v2/` 是迁移设计与历史记录目录，不是源码路径。

## 依赖方向

```text
routes -> domains -> design-system/shared
```

- Route 只负责 search validation、loader/prefetch、permission、metadata 和 composition；业务逻辑归所属 Domain。
- Domain 不导入其他 Domain 的内部组件；跨域展示通过 API summary DTO 或 route/application composition 完成。
- `design-system` 不导入 Domain；`shared` 不导入 Domain 或 Route。
- OpenAPI generated types 位于 `src/shared/api/generated/`，是 API 类型唯一前端来源。

## 命名与所有权

- 文件按既有 kebab-case 组织；React component/type 继续使用 PascalCase，函数与变量使用 camelCase。
- Domain 内的 `*.model.ts`、`*.api.ts`、`*-page.tsx` 和相邻测试由该 Domain 持有，不为单一消费者创建跨层 wrapper。
- primitives 位于 `design-system/primitives/`；组合 pattern 位于 data-table、forms、editor 或 workspace 子目录。只有多个真实消费者需要时才新增共享抽象。
- `src/routeTree.gen.ts` 是 TanStack Router 生成产物，不手工维护平行路由表。

## 验证

- 新路径或依赖边界变更至少运行 lint、typecheck、相关 unit 和 build。
- 修改 Router/generated type owner 时必须运行 `api:check` 与对应路由测试。
- 目录迁移后使用限定范围搜索确认 Makefile、CI、Compose、deploy scripts、specs 与现行文档没有活动的旧源码路径。
