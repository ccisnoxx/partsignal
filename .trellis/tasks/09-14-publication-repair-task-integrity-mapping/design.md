# Design

## Command boundary

`create_repair_task`持有standalone HTTP command的root Session。保留Issue `FOR UPDATE`和现有precheck；在新增ContentTask的最窄`flush()`边界捕获`IntegrityError`。

```text
lock Issue -> revision/state/precheck -> build Repair Task -> flush
                                                     │
                  exact 23505 + approved conname ────┤── rollback -> REPAIR_TASK_EXISTS
                  any other diagnostics ─────────────┘── original raise
```

分类只读取：

- `error.orig.sqlstate == "23505"`
- `error.orig.diag.constraint_name == "uq_content_tasks_source_published_content_issue_id"`

exact path先rollback再抛与precheck相同的`AppError`；unknown不在service伪装为业务错误。helper只负责diagnostics或构造同义错误，不抽象transaction owner，不建立registry。

## Concurrency

- production路径：Issue row lock使合规请求串行，第二请求在winner提交后命中precheck。
- DB final authority：test-only writer/barrier绕过同一service precheck但保留真实unique，证明23505 diagnostics和single winner。
- 不在rollback后查询winner以分类或返回资源；`REPAIR_TASK_EXISTS`是blocker，不是idempotent replay。

## Persistence invariants

- exact loser root rollback，不能留下待flush task或其他identity map副作用；Session可复用。
- unknown HTTP由`get_db` rollback/close；default 500 body不进入公共合同。
- source FK的head权威是0037 `SET NULL`。Repair Task解绑不改state/revision；Article来源ContentTask才由删除command恢复state/revision。
- mapper位置不得包围无关publication flush/commit，防止误分类event、verification、article、audit或guard失败。

## Contract impact

- OpenAPI、router `responses`、runtime response metadata、generated client：零变化。
- `contracts/database.md`与三份backend spec：记录exact pair、precheck/DB authority、rollback、unknown和final-head FK sentinel。
- backend integration：增加catalog、production lock、bypass unique、HTTP、unknown、Session和deletion invariant证明。

## Rollback

回滚仅删除本Task在allowlist中的service/test/contract/spec变更。若catalog漂移，业务mapper保持未实施状态，schema修复由独立Task负责；不得修改历史migration或兼容两个FK动作。
