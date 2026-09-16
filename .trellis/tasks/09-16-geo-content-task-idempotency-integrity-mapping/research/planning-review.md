# Independent High-risk Planning Review

- Date: 2026-09-16
- Mode: 一次 full read-only review + 一次 targeted re-review
- Scope: 本Task五份规划工件、用户冻结要求、T5-C决策、ordinary已归档任务，以及直接相关
  service/ORM/migration/test evidence
- Runtime validation: 未运行会写数据库的测试；真实catalog、driver diagnostics和并发等待由获批后的
  implementation required gates负责。

## Full review findings

1. P1：初稿要求same GEO/source-only/cross-kind共享target资源场景的loser等待在unique INSERT，但winner
   未提交task持有的FK `KEY SHARE`与loser production `FOR UPDATE`不兼容，原顺序不可执行。
2. P2：初稿把既有ordinary race测试描述为双worker数据库等待证据；实际该测试在同步hook中先提交winner，
   能证明真实duplicate diagnostics和反向guard，但没有worker PID、目标SQL或blocker等待证据。

## Repairs

- 并发矩阵按资源锁兼容性拆分：
  - 共享product/fact/platform的same GEO、source-only差异和cross-kind场景，在首次lookup后、production资源锁前
    使用connection-local PostgreSQL test latch形成可观测数据库等待；winner完整commit后释放worker，随后执行
    全部production锁/资格复算/真实task INSERT并取得exact 23505。latch不冒充unique wait。
  - 不共享target资源的不同task identity场景才使用未提交winner，证明loser真实等待在
    `INSERT INTO content_tasks`的unique仲裁。
- 在允许修改的`test_geo_insights.py`新增ordinary loser + 完整GEO winner场景，调用unchanged ordinary
  service；既有ordinary integration只作为guard/diagnostics回归并保持零diff。

## Targeted re-review result

两项finding均关闭，修订没有引入新的material问题。实施时仍须以实际运行证据确认：

- latch仅影响指定测试连接，所有barrier/SQL wait/future均有界且异常路径释放；
- worker释放后确实执行原production资源校验；
- 逐字段差异只要共享任一production锁资源，就走共享资源路径，不误用无共享资源INSERT wait；
- current-head exact diagnostics、rollback、Session reuse、HTTP/no-leak与失败原子性全部通过required gates。

planning review额度已用完。本记录不替代实施完成后的独立高风险full review；后者按`implement.md`在required
validation通过后单独执行。
