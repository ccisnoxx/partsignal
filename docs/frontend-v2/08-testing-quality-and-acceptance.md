# PartSignal Frontend V2 测试、质量与验收规范

## 1. 目标

V2 不允许再次出现：开发环境正常但部署后表格崩坏、按钮只在特殊状态报错、路由可进但菜单/返回/筛选不对、操作列行为漂移、只在 1440 验证、前端隐藏动作但后端业务流程仍出错。

测试覆盖：Domain behavior、Design System contract、URL/navigation、production build、responsive、accessibility、server action contract。

## 2. 测试分层

```text
Unit
  ↓
Component
  ↓
Storybook interaction / visual
  ↓
Integration
  ↓
E2E
  ↓
Production build smoke
```

## 3. Unit

重点：search schema、action mapping、status mapping、filter normalization、formatter、view-model、error parser。

`resolve-actions.ts` 必须验证 server primary task 映射、unknown action fallback、danger confirmation，且不从 status 计算资格。

## 4. Component Tests

RowActions：一个 primary、overflow keyboard、disabled reason、destructive confirm。  
FilterBar：URL state、reset、page reset。  
Table：loading/empty/filtered empty/selection/pagination/long text。  
Workspace：sticky actions、disabled submit、revision conflict、dirty guard。

## 5. Storybook

Table Story：0/1/50 rows、loading、error、long title、only overflow、no action、narrow。  
Workspace Story：long Markdown、empty reference、many warnings、dirty、conflict、review readonly、mobile。

## 6. E2E 核心流程

### Auth

login → must change password → unauthorized admin route → logout。

### Product Facts

create product → enter facts → submit → review → approve → create content task。

### Fact Changes

submit → changes requested → revise → resubmit → approve。

### Content

create task → generate/manual draft → edit → submit review → approve。

### Content Revision

review reject → create revision → update → review。

### Publication

approved content → start work → register result → verify success → PublishedArticle。

### Failed Verification

verify fail → ACTION_REQUIRED → update/switch version → reverify。

### Post-Publication Issue

open issue → create repair task → resolve issue。

### GEO

new observation → detail → correction → original remains immutable。

### GEO Optimization

insight anomaly → server revalidate → create optimization task。

## 7. Router E2E

每个核心列表都验证：direct URL、filter URL、refresh、Back、Forward、open new tab、invalid search param fallback、breadcrumb、sidebar active state。

## 8. Responsive Matrix

| Width | 意义 |
|---:|---|
| 375 | Mobile |
| 768 | Tablet / narrow |
| 1024 | Small desktop |
| 1440 | Primary desktop |

核心 Workspace 额外考虑 1280 / 1920。

## 9. Table Acceptance

- [ ] primary column 清晰
- [ ] 行高一致
- [ ] header/fixed 行为稳定
- [ ] horizontal overflow 可控
- [ ] action 标准
- [ ] sort/filter state 恢复
- [ ] page reset 正确
- [ ] empty / filtered empty 分开
- [ ] long text 不破版
- [ ] row navigation keyboard accessible

## 10. Action Acceptance

- [ ] Primary 来源 server `primary_task`
- [ ] 最多 1 个 row primary
- [ ] Secondary 在 overflow
- [ ] destructive confirmation
- [ ] disabled reason 可解释
- [ ] mutation server revalidation
- [ ] conflict 清楚处理
- [ ] success 后 canonical state 更新

## 11. Workspace Acceptance

- [ ] 主要 artifact 面积最大
- [ ] context/reference 可访问
- [ ] 1024 不崩
- [ ] mobile 可通过 tabs/sheet 工作
- [ ] sticky action 不盖正文
- [ ] dirty guard
- [ ] loading 不抹掉整个 shell
- [ ] server error 可恢复
- [ ] immutable snapshot 不可编辑

## 12. Accessibility

人工与自动结合：keyboard-only、focus order/visible、dialogs/menus、form labels/errors、status color redundancy、reduced motion、contrast。可引入 axe，但自动检查不替代人工键盘验收。

## 13. Production Build

每个 PR/merge：lint、typecheck、unit、component、build。主分支/staging：E2E + production smoke。

生产构建必须对真实 build artifact 跑 smoke，而不只跑 Vite dev server。

## 14. Deployment Smoke

部署后至少验证：`/login`、`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、管理员 `/settings/*`、`/system/audit`。

检查 JS chunks、API base URL、client routing fallback、direct deep link、asset caching、CSP/source map 策略。

## 15. Visual Regression

优先抓 Pattern，而不是机械截全站：Table default/action、Workspace 3-pane、Review、Dialog、Sheet、mobile list、Analytics KPI。

## 16. Error Contract Tests

覆盖 revision conflict、forbidden、action no longer available、referenced object cannot delete、validation、AI unavailable、publication verification failure、stale data。前端对应 error code 必须有明确 UX。

## 17. Performance

关注 initial JS、route lazy loading、table render、large Markdown、analytics chart、query fan-out。Server pagination 优先；不要为 20 行表过早虚拟化；真正大量数据才用 TanStack Virtual；避免 waterfall。

## 18. Observability

前端错误建议记录 route、user-visible action、error code、request id、app version、build sha。严禁记录 API key、密码、secret headers 或其他敏感 credential。

## 19. Definition of Done

一个页面只有同时满足 Product + Architecture + Contract + Test + Responsive + Accessibility + Production Build，才算 V2 可迁移页面。
