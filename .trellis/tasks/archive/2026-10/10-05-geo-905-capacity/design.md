# GEO-905 容量设计与决策

## 现有合同与目标
依赖607/902均done。R5真实PG基线100k+存量、30天当前8400候选/4375合格，P95全局洞察2.875s、总览1.546s。它证明PRD的3s门槛，不能证明技术建议2s或30天100k密度。目标环境及冻结阈值仍待输入，任何本地记录都不是VPS验收。

## Worker启动配置
复用已有CELERY_CONCURRENCY，默认1、范围1..10，由Settings校验并传给Celery worker_concurrency；三套Compose不再CLI覆盖。prefetch1、acks_late、reject_on_worker_lost、PG准入/发送账本/锁顺序不变。改env后须recreate进程；不部署或提升现有生产容量。共享Worker池与Profile max_concurrency是独立限制，不能用线程数绕过预算。

## 查询及索引策略
先以实际认证HTTP和EXPLAIN ANALYZE BUFFERS测量首/深页、复核筛选、批次/状态筛选、详情，再决定索引。不可仅因100k标题添加索引。既有0057索引(created_at DESC,id ASC)服务洞察/CSV；排序方向差异由真实计划决定。若无需新路径，合同及Alembic保持当前head。

## 流式导出
既有CsvStream拥有专用RR会话、每100候选keyset推进、完整校验合格性、固定as_of和取消关闭。新增测量使用ASGI send逐块消费，不使用会缓冲全量的TestClient；验证100000有序且无重复的行、RSS稳定区间、断流后连接回池。现有CSV低敏白名单、防公式注入、原始证据不泄露不变。

## 物化策略
未观察到足以授权物化缓存的测量证据；继续同一RR从PG完整历史/current/latest/当前复核派生。已有batch.status仅为可重建缓存，读与写授权不依赖它；不新增Redis业务缓存、不改变已批准指标和复核语义。

## 基准隔离及限制
虚构数据/临时PG迁移至head，全部约束守卫开启；Redis专用UUID队列，真实Celery十路消费者调用本地fake provider，重复20消息只产生10次请求。批次创建1000roots及幂等重放，锁内refresh测量。现有100k模板只有20个冻结输入/短回答/单引用，应明确披露，不能据此推断高多样性/长答案/多引用或生产prefork的内存容量。
