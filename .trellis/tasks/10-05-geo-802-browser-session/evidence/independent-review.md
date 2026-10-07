# GEO-802 独立只读复核

独立代理：critical_reviewer；fresh、无继承实现上下文；只读，覆盖 Application Service、加密/文件边界、Collector 解密、管理员 UI、OpenAPI/DDL/迁移及定向测试。复核任务交付已由主代理验收；不把运行时 completed 当作验收证据。正式审计已关闭并通过 audit-verify。

## 确认发现与修复

1. P2：外层 Envelope 的 expires_at 原使用 Pydantic 默认 Z，内层 AES-GCM AAD 使用 +00:00，Collector 拒绝恢复。现用专用 serializer 输出 UTC 六位微秒及 +00:00；实际 DTO→Node 解密覆盖零/非零微秒，API 集成测试核对外内期限一致。独立复核者再次运行跨语言检查并确认修正。
2. P3：available_actions 原仅考虑 APPROVED/AUTHENTICATED，网站缺失/HTTP 时仍显示 IMPORT。主代理将 HTTPS 网站规则归入共用 _import_website；投影与命令共同使用，三种反例 PG 测试通过。此最终修正由主代理检查与定向测试验证，未声称独立复核者再次审查。

## 已获得的补充证据与覆盖缺口

审计写入失败的导入和访问均有实际 PG 测试：导入引用不发布，access 抛出且没有密文返回或访问审计残留。并发导入 CAS 只有一个成功。直接 SQL 不可改身份/摘要/期限，不可删除历史或逆转撤销/清理。

access 与 revoke 以及用户降权与 access 的并发交错使用静态锁序复核；本任务没有分别新增动态调度测试。User 当前身份锁与 Profile/Surface/session 锁串行裁决；已返回消费方内存的材料无法远程追回，后续真实 consumer 必须在 SEND 前建立自己的授权边界。无真实平台、生产迁移或浏览器矩阵验证。

主代理最终检查另发现 TRUNCATE 缺口：先新增反例确认旧实现 DID NOT RAISE，再为同一守卫增加 statement-level TRUNCATE trigger。该最终补丁由主代理与定向 PG/迁移测试验证，未声称独立复核者重新检查；没有改变允许状态或移除历史。
