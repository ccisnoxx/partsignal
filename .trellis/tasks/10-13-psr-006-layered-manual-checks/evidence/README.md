# PSR-006 验收证据

本目录由 PSR-006 拥有，作为正式人工 review 与未来恢复依据保留，人工接受后按 Trellis 归档策略处理。只含源码/文档增量、虚构测试数据、命令与结果；不含真实 Provider Key、私有 .env 或生产数据。

- scripts-inventory.json：开始时57份 deploy脚本及2份 frontend测试Shell的完整内容指纹与结构/调用清单。
- make-plan.txt、release-compatibility.txt：七目标展开、快速/领域边界与旧完整发布展开保持证明，不能当作实际 suite 执行结果。
- check-*.log/json：四个实际目标输出、退出码与耗时；GEO initial 保留首次失败，不冒充通过。
- geo-affected-recheck、geo-utc-recheck：环境问题诊断与先重验失败项的真实结果。
- failure-propagation.json：四目标工具失败及三项缺环境的隔离命令替身验证，不冒充业务测试。
- actions-references-before.txt / actions-references-after.tsv：开始引用与结束声明/历史分类，无活动workflow操作教程。
- changed-files.txt、changes.patch：相对本轮临时基线的独立增量，保护前序dirty work；新增任务记录单独列出。
- final-acceptance.json：最终命令/路径/链接/哈希/状态/工作区/清理验收。

全部实际命令、首次失败、证据复用、未执行项与限制以 ../implement.md 为准。
