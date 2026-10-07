# GEO-603 初审记录

来源：`/root/geo603_review` 的最终交付，critical_reviewer，fresh/只读。审查发生在两项修正前；发现如下两个P2，均构成当时的验收阻断。

1. `backend/app/services/geo_answer_insights.py:107` / schema:52 的准确率投影丢弃内部 unjudgeable_claim_count。1 ACCURATE + 100 UNJUDGEABLE 得公开 1/1=1，却没有未知声明数量，违反方法§10.4/18.2。建议保留计数及金标，不扩展604风险详情。
2. `backend/app/services/geo_metric_views.py:33` 对合法当前窗口0001-01-02Z～0001-01-04Z计算前期时 OverflowError。两个洞察入口在查询前触发。建议新洞察 DTO 明确拒绝，返回既有422，不改变旧Overview。

其余限定审查没有确认新缺陷：完整cell/冻结集合、BRANDED资格、低样本/多cell/空分母不可比、current/latest review与attempt、RR一次加载两期、全部变体保留、事件贡献下钻、工程师认证/no-store/无DML或外部调用，以及旧文章关系级接口保留。

初审阅读了定向13项PG/HTTP、3508后端/1170前端单元及类型检查日志，也准确指出当时lint闭包和generated漂移尚未修正，不能称最终门禁全部通过。审查者未重跑完整测试、未执行Git或写文件，不进行性能、容量、浏览器、生产或迁移验收。

主代理对第1项添加先红后绿的1+100服务金标，公开必填非负计数；对第2项加入两个HTTP入口422参数化回归。修正后的结论由独立fresh第二次复核给出，见independent-fix-review.md。
