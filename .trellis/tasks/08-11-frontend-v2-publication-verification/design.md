# Frontend V2 Publication Verification — Design

## 1. 服务端权威流程

```text
AWAITING_VERIFICATION
  ├── VERIFY FAILED → ACTION_REQUIRED
  │                    ├── VERIFY FAILED → ACTION_REQUIRED (append only)
  │                    ├── Content workflow creates current APPROVED version
  │                    ├── SWITCH_CONTENT_VERSION → ACTION_REQUIRED
  │                    ├── REGISTER_RESULT → AWAITING_VERIFICATION
  │                    └── VERIFY PASSED → COMPLETED + PublishedArticle
  └── VERIFY PASSED → COMPLETED + PublishedArticle
```

UI 不预测下一状态；它提交 command 并采用 canonical response/Context。旧 Verification rows 保留各自的 `content_version_id` 和 result snapshots；切换只改变 work 的绑定 version/hash 并追加 event。

## 2. Candidate 与修正边界

`switch_candidate` is computed by Core's Context service from the same rules as the command:

- same `ContentTask`;
- exact `ContentTask.current_content_version_id`;
- candidate differs from work's bound version;
- candidate `APPROVED`;
- candidate fact version `APPROVED`.

Candidate 为零或一个。缺失时页面链接到 `/content/tasks/$taskId`，由现有 task actions 按需把用户带到 Editor/Review。Publication 页面不列出 drafts，也不编辑 Markdown。

现有基于 status 的 `SWITCH_CONTENT_VERSION` token 在没有 candidate 时也可能存在。因此页面同时要求两个 server projections：token 决定该 work 是否具有此动作，candidate 决定当前是否存在具体合法选项。这样既不改变现有 Work/List action semantics，也不在客户端重建 eligibility。

## 3. UI 组合

Verification 在已验收页面中增加：

```text
VerificationSection
├── current result snapshot
├── latest verification summary
├── VerificationTimeline
└── correction handoff / switch candidate

StickyActionBar
├── VERIFY → VerificationDialog
└── SWITCH_CONTENT_VERSION → SwitchContentVersionDialog
```

### Verification form

- 一个必选 radio：“发布页正文与当前批准内容一致 / 不一致”。
- 一致映射：match → `{outcome: PASSED, content_matches: true}`；mismatch → `{outcome: FAILED, content_matches: false}`。
- Failure comment 必填并使用 RHF/ErrorSummary；Passing comment 可选。
- 确认前显示 title/URL/published time/content version/hash；不自动抓取或解析公开 URL。

### Switch form

- 精确显示 server candidate 的 version/title/summary/hash。
- 要求 nonblank change comment 和当前 `expected_revision`。
- Candidate 缺失时不渲染 submit control，correction handoff 保持可见。
- 成功后关闭 Dialog、采用 canonical Work、失效 Context，并聚焦 content-version section。

### Completed state

- 服务端 actions 为空，因此所有 write controls 消失。
- Header/status、approved Markdown、final result、evidence、Event/Verification timelines 保持可读。
- 显示与 work ID 相同的 PublishedArticle ID 和已批准的 future href 作为 handoff，但本任务不增加 route，也不请求 article detail。

## 4. Mutation/cache 行为

- Verification 与 switch 复用 Core 的 mutation helper/error mapping，不增加 parallel client layer。
- 成功后取消 in-flight Context，仅用 canonical response patch `context.work`，禁用 stale actions，再失效 workspace、work lists、summary 与 Content task projections。
- Verification PASSED 还失效 Content list/detail/editor/review keys，因为服务端会完成 ContentTask。
- 409 keeps dialog values and request ID, performs no replay, and exposes explicit Context reload. If reload shows no token/candidate, the dialog closes only after the user adopts that Context.
- 有 cached data 时，background Context failure 保持 terminal/history evidence 可见。

## 5. Error contracts

Verification/switch 的 OpenAPI 必须声明真实错误：

```text
401 session
403 account type
404 work or content version
409 revision, invalid state, incomplete context, source task terminal,
    candidate not switchable/unchanged
422 UUID/body and verification consistency
```

不增加 fuzzy retry、默认 PASS/FAIL 或 compatibility candidate。

## 6. 测试数据隔离

Real-stack Flow B 使用与 Core Flow A 不同的 product/task/work。Test API 可以创建最小 platform/account/product/fact 前置条件并检查最终 projections，但所有 publication verify/switch/result commands 和 content correction/approval mutations 必须通过现有 V2 页面完成。禁止 `page.route`、browser spec 直接写数据库或 fixed success responses。

若现有 V2 route 无法完成审计代码所声称支持的必要内容修正，则停止并报告已验证的前置缺口，不得静默扩入 Publication scope。
