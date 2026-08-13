# 技术设计

## 1. Architecture

依赖方向保持 `routes -> domains -> design-system/shared`：

- Route 只拥有 UUID/search canonicalization、cache-aware prefetch、metadata 和跨域 cache composition。
- Configuration Domain 拥有 Detail/API/query keys、Platform action mapping、Overview/Logo/Generation 表单映射和 Workspace page。
- Design System 只消费 resolved actions，不识别 Configuration token。
- Server state 使用 TanStack Query，URL state 使用 TanStack Router，form state 使用 React Hook Form + Zod，Dialog/candidate/upload phase 使用 React local state。

不新增 Redux、Store、依赖、通用 Workspace、媒体层或第二 API DTO。

## 2. Contract and Read Boundary

`PlatformProfileDetail` 调整为：

```text
{
  profile,
  account_summary,
  reference_summary,
  platform_type_options
}
```

Detail route 在任何查询前设置 `REPEATABLE READ`，依赖改为 `CurrentUser`，service 显式接收 `can_manage`。ADMIN 为 `true`；ENGINEER 为 `false`，从而由既有 projection 返回空 `available_actions`、空 `primary_task` 和 `deletion=null`。

Detail 仍是首屏唯一业务请求。Account List、Prompt options 和 Logo candidate/upload 都由用户进入区域或显式操作后按需触发。`platform_type_options` 只包含稳定 summary，不返回 Platform Type CRUD metadata。

## 3. URL and Component Flow

```text
PlatformWorkspaceRoute
└── PlatformWorkspacePage
    ├── PlatformWorkspaceHeader
    ├── URL-controlled Tabs
    │   ├── PlatformOverviewSection
    │   │   └── PlatformOverviewForm + PlatformLogoField
    │   ├── PlatformAccountsReadOnlySection
    │   └── PlatformGenerationSection
    │       └── PromptReferenceForm
    └── DirtyGuard
```

Canonical search 为 `{tab}` 单字段。pathname 变化继续由 App Shell 管理焦点；query-only tab 变化不抢焦点。受控 Tabs 更新 Router search，DirtyGuard 在离开当前 dirty surface 前阻断。

根 frontend component/visual spec 的具体组件栈仍面向 V1 Ant Design；V2 以更具体的 `frontend-v2/AGENTS.md` 和 01–09 蓝图为准，复用现有 shadcn/Base UI/Tailwind primitives，只继承不冲突的响应式、动作、焦点和可访问性约束。

## 4. Forms and Commands

Overview 和 Generation 是两个独立表单，但都从同一个 Detail revision 建立 baseline，且任一时刻只有当前 tab 可持有 dirty 草稿。

- Overview PATCH：改变 name/type/website/domains；保留当前 prompt；Logo 未变时省略字段。
- Generation PATCH：保留 name/type/website/domains；只改变 prompt；省略 Logo。
- 保存成功先用 canonical Platform response 前进 revision，再 refetch Detail 校准 summaries/options。
- `REVISION_CONFLICT` 不 reset 表单；显式 reload 才放弃草稿。

Platform actions 复用 List owner：`UPDATE / ENABLE / DISABLE / DELETE` 与 blocker mapping 不在 Workspace 复制第二套规则。`primary_task=CONFIGURE_GENERATION` 可定位 Generation；其他 token 不用于重新计算资格。

## 5. Logo Lifecycle

Logo UI 仅编排已有能力：

1. 本地文件通过现有 `sha256File/transferFile` 完成上传；完成前不进入表单。
2. 官网 candidate 由显式 POST 下载到自有存储，preview 后再次确认。
3. Platform PATCH 绑定或解绑 FileRecord。
4. 旧文件延迟清理由服务端所有者调度；前端不删除对象或维护引用计数。

## 6. Query Keys and Invalidation

Configuration owner 扩展：

```text
platformKeys.lists()
platformKeys.detail(platformId)
platformKeys.accounts(platformId)
platformKeys.promptOptions()
```

| Mutation | Configuration | Content | Publication |
|---|---|---|---|
| identity/type/website/domains/logo | lists + detail | platform references、creation options、task list/detail/editor | nonterminal work list/context |
| enable/disable | lists + detail + accounts | creation options | ready items + workspace contexts |
| delete | lists；退出后标记旧 detail/accounts | references/options/task list/detail/editor | ready/work list/context |
| Prompt bind/unbind | lists + detail | generation options | 无 |

跨域 invalidation 由 route composition 调用各 Domain 已有 key owner；Configuration 不硬编码 sibling key 数组。candidate/upload 未保存前不失效 Platform cache；终态 PublishedArticle snapshot 不刷新。

## 7. Compatibility and Files

预计影响：

- `contracts/openapi.yaml`
- `backend/app/schemas/configuration.py`
- `backend/app/routers/configuration.py`
- `backend/app/services/platform_configuration.py`
- targeted backend contract/integration tests
- 两套 generated schema
- `frontend-v2/src/domains/configuration/platform.api.ts`
- Platform List action owner 的最小共享提取
- Platform Workspace model/page/components/tests
- `frontend-v2/src/routes/_app/settings/platforms/$platformId.tsx` 与 generated route tree
- Platform fixture/Playwright spec
- 直接相关 Phase 6、acceptance、ADR 和 Trellis specs

不预计修改数据库合同、migration、全局 CSS、Design System 或依赖。V1 仅接受 generated type 更新，不改其业务页面。

## 8. Risk and Rollback

- 最大风险是 Detail 权限扩大后错误投影管理动作；由 ADMIN/ENGINEER 同数据、不同 action 的 integration test 固定。
- 第二风险是两个表单共享 Platform revision；保存后必须同步 baseline，409 不重放。
- Logo 未绑定文件会由现有清理窗口回收；取消不执行额外删除。
- 回滚只需撤回 additive Detail 字段、读取权限和 V2 route；无数据库迁移。
