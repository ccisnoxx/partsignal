# I03-4-B2 production harness 清理修复设计边界

- 在 harness 启动时只计算一次规范化临时根，去除尾斜杠并解析符号链接/路径别名；`mktemp` 模板、`test_dir` 所有权判断和 cleanup 都从该值派生。
- cleanup 只允许删除规范化临时根直属的 `partsignal-production-test.*` 目录，但拒绝、目录越界或删除失败必须显式失败，不能被 EXIT trap 的原退出码静默掩盖。
- 回归测试应使用隔离的临时父目录模拟原始值与规范化值不同的情况，并同时断言 harness 业务断言和资源清理结果。
- 修复范围仅限测试 harness 与其回归覆盖；生产部署脚本、公共合同、候选业务代码和依赖不应随此任务变化。
