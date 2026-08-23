# Frontend V2 Workbench E2E 技术设计

## 1. 设计结论

最小方案是在四个既有真实栈 spec 内加入 Workbench direct navigation 与 DOM/href 断言。既有 workflow 继续拥有
全部业务 mutation；Workbench 只读检查点不建立数据、不调用测试后门，也不新增 fixture、helper 文件或 orchestration。

```text
existing V2 UI mutation workflow
  → PostgreSQL authoritative state
  → page.goto('/') fresh document
  → GET /api/v1/workbench
  → count + unique attention item + server href
  → native attention anchor 返回既有 Workspace/Detail
  → existing workflow continues
```

strict `workbench.spec.ts` 继续拥有“只请求一个 aggregate、无浏览器 join、四档响应式”的 production-artifact
边界；四个 real-stack owner 只补真实 PostgreSQL 状态与 canonical navigation，不重复 strict fixture 职责。

## 2. 精确插入与断言

| Spec / 检查点 | 复用状态 | Count 断言 | Item / href 断言 | 后续导航 |
| --- | --- | --- | --- | --- |
| Product Flow A：submit 后、approve 前 | 本场景 pending FactVersion | `fact_reviews > 0` | 唯一 `PartSignal E2E {partNumber}`；fact canonical filter；`/products/{productId}/facts/review` | 点击 item 进入 Fact Review，替代原 List detour |
| Content Flow A：`createReviewReadyTask` 后、approve 前 | current pending ContentVersion | `content_reviews > 0` | 唯一 `{partNumber} 审核内容`；content canonical filter；`/content/tasks/{taskId}/review` | 点击 item 回到 Content Review |
| Publication Flow A：START 后 | `PREPARING` + `CONTINUE_PREPARATION` | `publication_actions > 0` | `继续准备` canonical filter；唯一内容 item `/publishing/work/{workId}#preparation` | 点击 item 替代原 continue link |
| Publication Flow A：result 后 | `AWAITING_VERIFICATION` | `publication_verifications > 0` | verification canonical filter；同一内容 item `/publishing/work/{workId}#verification` | 点击 item 返回 verification section |
| Publication Flow A：issue open 后 | `OPEN`、无 repair task | `content_issues > 0` | issue canonical filter；来源内容 `approvedContent.title` item `/publishing/issues/{issueId}#repair` | 点击 item 返回 repair section |
| GEO Flow A：PARTIAL root 后 | root 是 current manual tail | `geo_accuracy_issues > 0` | 两个 accuracy filters；唯一 `rootQuery` item `/geo/observations/{rootId}` | 点击 item 返回 Detail，再进入 Correction |
| GEO Flow A：UNJUDGEABLE correction 后 | correction 成为 current tail | 前值 `- 1` | `rootQuery` item 消失 | direct List 继续既有 chain assertions |

所有 `page.goto('/')` 都是完整 document navigation，确保连续检查点不复用前一次 30 秒 TanStack Query cache。
Attention anchor 是现有 native `<a>`，点击后直接验证 URL 和目标 heading/section；不在测试中重建 router search model。

## 3. GEO rate 断言

按 `dt` 标签将断言限定在 discovery、mention、accuracy 三个 card，避免页面其他 `0%`/“暂无数据”造成误命中：

| Current tail | Discovery | Mention | Accuracy |
| --- | --- | --- | --- |
| PARTIAL root | `100%`, `1 / 1` | `0%`, `0 / 1` | `0%`, `0 / 1` |
| UNJUDGEABLE correction | `0%`, `0 / 1` | `0%`, `0 / 1` | `暂无数据`, `0 / 0` |

root 与 correction 冻结同一个 chain 的 product/query/article；rate 改变来自 current tail 替换，不是第二组样本。

## 4. Failure 与敏感信息边界

- 新断言使用 Playwright locator matcher；自定义 assertion label 只写 category、synthetic resource 和 relative href。
- 不解析或打印 Workbench response body，不记录 request headers/body/cookies/localStorage/sessionStorage。
- 保留 real-stack config 的 `trace: off`、list reporter 和默认无 video/screenshot；不覆盖或弱化现有 browser error/secret
  assertions。
- 不修改 `secret-artifact.ts`；需要产物扫描时只复用 `expectSecretsAbsent`，不复制递归扫描实现。
- Workbench 响应本身只含 safe metadata，不含 content body、notes、prompt、header/body 或 credential。

## 5. Isolation、rollback 与 compatibility

- 每个 spec 通过独立 `PARTSIGNAL_E2E_V2_SPEC=... e2e-local.sh` 运行，复用脚本的 database、Redis、storage、
  process、port preflight/cleanup；测试文件不拥有资源生命周期。
- 没有 API、schema、产品行为或持久化变化，无 migration/rollout。回滚只删除四个 spec 的 Workbench checkpoint 和
  08 文档小节。
- 若某状态无法由当前 UI flow 自然产生，或服务端 href 与当前合同不一致，停止并报告 blocker；不添加 test-only
  mutation、compatibility alias、sleep/retry 或宽松 selector。
