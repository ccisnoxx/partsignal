# GEO-704 独立复核与修正

独立 fresh critical_reviewer 已完成只读候选复核，交付两个确认P2；主代理接受其复核交付，不表示候选在修复前通过业务验收。审计Bundle `20261004T192838Z-geo-704-3eb5e6cf` 已生成SUBAGENT_EXECUTION_DIGEST、关闭并audit-verify通过。

1. Issue数据库守卫只比较Issue/Article，未校验产品/主题/事实/平台与保存来源。现已在0060比较完整身份及冻结来源自有产品资格；读取父Task身份不增加冲突父锁。真实PG直接SQL错产品、主题、事实和平台均23514，精确约束ck_geo_opportunity_action_target_owner。
2. Article删除预检漏旧source_snapshot=NULL且直接指向Issue的Action。现以UNION合并快照、直接Article及Article→Issue直接Action引用，按Action ID去重；旧行动预览阻断，实际删除409 PUBLISHED_ARTICLE_IN_USE。合法归档发布aggregate永久删除仍保留Action稳定ID/快照并显示目标缺失。

修正后的targeted-guards-fixed：6 passed；最终targeted-actions-final：16 passed，包含三失败注入阶段、同键/异键并发、来源冻结、权限/CSRF、迁移及上述反例。

证据等级：复核者只读检查初始候选，没有执行测试，也没有在修正后再次复核；修正验证由主代理执行。工具追踪来源为该fresh子代理当前session JSONL，15个exec工具调用包含28个字面量shell命令（保存在review-shell-calls.json），全部为读取/搜索/diff/status，无重定向、修改或Git写入；因此observed_write_paths=[]来自实际工具追踪，并非代理自报。Agent TOML read-only为配置证据，运行时没有使用只读sandbox，不将配置误称为实际隔离。
