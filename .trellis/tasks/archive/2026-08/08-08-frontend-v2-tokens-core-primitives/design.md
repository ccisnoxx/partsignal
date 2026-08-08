# Frontend V2 Tokens + Core Primitives 技术设计

## Architecture

本任务只建立以下单向依赖：

```text
src/styles/global.css
  -> Tailwind semantic utilities
  -> src/design-system/primitives/*
  -> application / Storybook / tests
```

`src/design-system` 不导入 `routes`、domain、API 或业务状态。应用只在现有 `AppProviders` 增加 Base UI Tooltip provider；Storybook preview 直接导入同一个 `global.css` 并使用相同 provider，不新建通用 DesignSystemProvider。

## Token Source and Layers

唯一权威文件为 `frontend-v2/src/styles/global.css`。为避免为未来主题预建三层生成系统，只采用两个实际层次：

1. `:root` 中的 PartSignal 语义值：surface、text、border、status、interaction、radius、focus、typography。
2. `@theme inline` 与 shadcn 兼容别名：只把 Tailwind/shadcn 所需名称映射回第一层变量，不复制颜色值。

不创建 `tokens.json`、`tokens.ts`、组件 token 文件或第二份 Storybook theme。颜色使用 OKLCH；仅提供 light baseline。`surface-overlay` 表示浮层内容表面，遮罩使用独立 `overlay-scrim`。

### Minimal Token Contract

- Surface：app、panel、raised、overlay、selected。
- Text：primary、secondary、muted、disabled、danger。
- Border：subtle、default、strong、focus。
- Status：success、warning、danger、info 及可读 foreground；danger 与 shadcn destructive 同源。
- Interaction：primary、primary-hover、primary-active、primary-foreground。
- Radius：control、panel、overlay；兼容 `--radius` 从这些值派生。
- Focus：ring width、ring offset、ring color；所有交互控件使用 `:focus-visible`。
- Typography：display `30/36 600`、page-title `24/32 600`、section-title `16/24 600`、body `14/22 400`、body-sm `12/18 400`、label `12/16 500`、mono `13/20 400`；仅系统字体栈。

Base Nova 提供初始视觉尺度，但最终 token 值只保留在上述文件；`success`、`warning`、`info` 使用独立、确定的新 baseline，不从 V1 继承。

## Primitive Contracts

shadcn/Base UI 生成源码位于 `src/design-system/primitives/`；PartSignal 只在同一源码上做经过验收的最小调整，不再包一层转发组件。

- Button：保留 shadcn `default | destructive | outline | secondary | ghost | link` 与 `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`，不增加 loading 或业务 intent。
- IconButton：唯一自定义组合；props 继承 Button，固定 icon size 类别，要求 `aria-label`，children 仅承载 icon。
- Input：原生 input props；以 `aria-invalid`、disabled、focus-visible 表达状态，不增加表单 schema。
- Select：直接导出 Base UI/shadcn anatomy；调用方传 `items`，`SelectItem` 必须位于 `SelectGroup`。
- Badge：保留 upstream variants，并只增加 `success | warning | info`；`destructive` 即 danger。
- Tooltip：直接导出 provider/root/trigger/content；应用和 Storybook 各在其既有 composition root 放置同一 provider。
- DropdownMenu：直接导出 anatomy；items 必须位于 `DropdownMenuGroup`。
- Dialog、Sheet：直接导出 anatomy；可视或 `sr-only` Title 为组合契约，overlay 使用 tokenized scrim。
- Tabs：直接导出 root/list/trigger/content；trigger 必须位于 list。
- Skeleton：只提供 tokenized loading placeholder；形状由布局类控制。

`className` 仅用于布局和调用方尺寸，不用于重写组件色彩或 typography。Base UI composition 使用 `render` 而非 Radix `asChild`。

## Files

```text
frontend-v2/
├── .storybook/{main.ts,preview.tsx}
├── components.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
└── src/
    ├── app/providers.tsx
    ├── design-system/primitives/
    │   ├── button.tsx
    │   ├── icon-button.tsx
    │   ├── input.tsx
    │   ├── select.tsx
    │   ├── badge.tsx
    │   ├── tooltip.tsx
    │   ├── dropdown-menu.tsx
    │   ├── dialog.tsx
    │   ├── sheet.tsx
    │   ├── tabs.tsx
    │   ├── skeleton.tsx
    │   ├── *.stories.tsx
    │   └── core-primitives.test.tsx
    ├── shared/lib/utils.ts
    └── styles/{global.css,global.test.ts}
```

不创建 `index.ts` barrel、空目录、通用 provider wrapper 或 future component placeholders。

## Configuration and Dependencies

- `components.json` 固定 Base UI、Nova、Tailwind 4、Lucide，并将 `ui` 指向 `@/design-system/primitives`、`utils` 指向 `@/shared/lib/utils`。
- TypeScript 与 Vite 增加单一 `@/* -> src/*` alias。
- 运行时依赖预期仅为实际生成源码消费的 `@base-ui/react`、`class-variance-authority`、`clsx`、`lucide-react`、`tailwind-merge`。
- 开发依赖仅为 shadcn CLI、Storybook React/Vite、a11y addon、Storybook 实际要求的最小 addon，以及交互测试需要的 `@testing-library/user-event`。最终以生成文件和构建实测为准，移除未消费依赖。
- 不升级 React、Vite、Tailwind、TypeScript、Vitest 或现有 Foundation 依赖。

## Storybook and Tests

`.storybook/preview.tsx` 导入 `src/styles/global.css`，用 decorator 放置 Tooltip provider，并注册 375、768、1024、1440 viewports。每个 primitive 使用一个紧邻源码的 story 文件；仅覆盖该组件适用的状态，避免故事模板框架。

测试分两层：

- `global.test.ts` 读取唯一 CSS 源，验证要求 token 存在、Tailwind/shadcn 映射引用变量、未出现 `.dark` 第二主题。
- `core-primitives.test.tsx` 验证 PartSignal 新增 Badge variants、IconButton accessible name、Select/Menu/Dialog/Sheet/Tabs 的关键 keyboard/focus/ARIA composition。

测试不重复 Base UI 的内部 positioning、portal、animation 或完整键盘矩阵。

## Accessibility and Responsive

- 所有可交互元素必须有可见 focus ring；disabled 与 invalid 同时保留语义属性和可辨识样式。
- IconButton 必须有 accessible name；Tooltip 不替代该名称。
- Dialog/Sheet 需要 Title，关闭后焦点返回 trigger；Menu/Select/Tabs 支持键盘打开、导航和选择。
- Storybook a11y 以 error 级别运行于 review stories。
- 在 375px 视口验证 long text、Menu、Dialog、Sheet 不出现不可操作内容或页面横向滚动；同时抽查 768/1024/1440。

## Compatibility and Rollback

本任务只扩展 `frontend-v2` Foundation 和当前 Trellis task，不更改 V1、合同、数据库、路由或部署。回滚点是任务提交：可整体回退 token、primitives、Storybook 配置和依赖；无数据或 API 迁移。不得用 broad reset 覆盖其他工作。
